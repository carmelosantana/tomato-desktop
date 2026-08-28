# Tomato v2 — Presence Companion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reframe Tomato from an enforced Pomodoro timer into a presence-driven companion conforming to **Spec 1 v2 — The Presence Companion** (`../tomato-protocol/spec-1-v2-presence-companion.md`): OS idle detection auto-starts/resets sprints, the boundary is a gentle non-blocking nudge, and the break is the gap you take by stepping away.

**Architecture:** Unchanged split — a **pure TS core** (`src/core/`, Vitest-tested) drives an **impure native shell** (`src/native/` + `src-tauri/`, manually verified). New this version: a cross-platform **presence provider** in Rust (`idle_seconds()` command) feeding a new pure **PresenceMachine** on the 1 Hz loop.

**Tech Stack:** Tauri v2 (TS frontend + thin Rust), Vitest, zbus 5 (Linux, already transitive), `x11` crate (`xss`), CoreGraphics extern (macOS).

## Global Constraints

- **Units:** config + events are in **SECONDS**; the machine works in **MILLISECONDS**. Consumers convert (`sprintMs = sprint_s * 1000`). Never store ms.
- **Defaults:** `sprint_s: 900`, `idle_reset_s: 300`, `renudge_every_s: 900`, `onboarded: false`. Constants: `activity_threshold_s: 5`, `min_sprint_log_s: 60`.
- **Bounds:** sprint 60–3600, idle_reset 60–1800, renudge 60–3600 (seconds).
- **Event vocabulary (exact JSONL):** `sprint_started {ts, sprint_id, trigger}`; `nudge {ts, sprint_id, active_s, index}`; `sprint_ended {ts, sprint_id, active_s, over_s, ended_by}`. `trigger ∈ {"activity","manual"}`. `ended_by ∈ {"idle_reset","paused","manual"}`. `ts` = unix seconds; `sprint_id` = per-sprint UUID minted in main on `sprint-started`.
- **Noise floor:** a sprint whose logged duration would be `< min_sprint_log_s` emits **nothing** (defer `sprint_started` until the sprint crosses the floor; if it ends first, emit neither event).
- **Honest degrade:** when `idle_seconds()` returns `null` (no provider — non-GNOME Wayland), run **honest manual mode** (manual Start/Stop + nudge, no auto-start/reset), and surface "presence detection unavailable". Never fabricate presence.
- **Offline:** no network, no Kanboard. Fonts/assets vendored.
- **Cross-platform:** providers cfg-gated so the Linux build never pulls macOS crates and vice-versa. macOS ships compiled but is verified on-device later.
- **Retired (do not implement):** `focus/grace/break` states, `enforced/soft` modes, grace/early-grace, break card, grace toast, and the `break_*`/`grace_*` events. Enforced-style enforcement is a **later fast-follow**, out of this plan.

---

## File Structure

**Rewritten pure core:** `core/presence.ts` (new, replaces `core/timer.ts`), `core/events.ts`, `core/ring.ts`, `core/stats.ts`, `core/statsChart.ts`, `core/nudge.ts`, `core/settingsForm.ts`.
**Rewritten native:** `native/config.ts`, `native/presence.ts` (new), `native/trayIcon.ts` (color roles), `main.ts`.
**New Rust:** `src-tauri/src/presence.rs` (+ `lib.rs` wiring, `Cargo.toml`).
**Rewritten screens:** `settings.html/.ts`, `onboarding.html/.ts`, `stats.html/.ts`, `styles/*.css` as needed.
**Deleted:** `core/timer.ts` + `timer.test.ts`, `core/boundaryEvents.ts`, `grace-toast.{html,ts}`, `break-card.{html,ts}`, `capabilities/boundary-windows.json`, unused `assets/tray/tray-break-*.png`, and `vite.config.ts` inputs for the removed pages.

---

### Task 1: Config contract + settings bounds

**Files:** Modify `src/native/config.ts`; Modify `src/core/settingsForm.ts`; Modify `src/core/settingsForm.test.ts`.

**Interfaces — Produces:**
```ts
// native/config.ts
export interface TomatoConfig {
  sprint_s: number;        // 900
  idle_reset_s: number;    // 300
  renudge_every_s: number; // 900
  onboarded: boolean;
}
export const DEFAULT_CONFIG: TomatoConfig = { sprint_s: 900, idle_reset_s: 300, renudge_every_s: 900, onboarded: false };
```
- `loadConfig()` reads config.json and returns a **cleaned** object: each known key from stored value if present else default; **retired keys ignored** (do not spread unknown keys through). Corrupt/absent → defaults.
- `saveConfig(config)` unchanged mechanism (mkdir + writeTextFile).
- `settingsForm.ts`: replace bounds with `SPRINT_BOUNDS {minS:60,maxS:3600}`, `IDLE_RESET_BOUNDS {minS:60,maxS:1800}`, `RENUDGE_BOUNDS {minS:60,maxS:3600}`; keep `clamp`, `minutesToSeconds`, `secondsToMinutes`, `minutesToClampedSeconds`, `sanitizeNumericField`, `SETTINGS_SAVED`. Remove `BREAK_BOUNDS`, `GRACE_BOUNDS`.

**Steps (TDD):** update `settingsForm.test.ts` for the three new bounds (in-range, clamp-high, clamp-low, empty→lower) → run red → implement → green → commit. `config.ts` is impure (not unit-tested); verify via `tsc`.

---

### Task 2: PresenceMachine (pure core — the heart)

**Files:** Create `src/core/presence.ts`; Create `src/core/presence.test.ts`. (Delete `timer.ts`/`timer.test.ts` in Task 13.)

**Interfaces — Produces:**
```ts
export type PresenceState = "away" | "active" | "paused";
export interface PresenceConfig { sprintMs: number; idleResetMs: number; renudgeEveryMs: number; activityThresholdMs: number; minSprintLogMs: number; }
export type PresenceEvent =
  | { type: "sprint-started"; at: number; trigger: "activity" | "manual" }
  | { type: "nudge"; at: number; activeMs: number; index: number }
  | { type: "sprint-ended"; at: number; activeMs: number; overMs: number; endedBy: "idle_reset" | "paused" | "manual" };
export interface PresenceSnapshot { state: PresenceState; activeMs: number; overMs: number; }
export class PresenceMachine {
  constructor(config: PresenceConfig);
  setConfig(config: PresenceConfig): void;      // caller gates to away/paused
  currentState(): PresenceState;
  tick(now: number, idleMs: number | null): PresenceEvent[];  // idleMs null = manual mode
  manualStart(now: number): PresenceEvent[];    // away → active (manual mode)
  manualStop(now: number): PresenceEvent[];     // active → away, ended_by "manual"
  pause(now: number): PresenceEvent[];          // → paused; ends active sprint (paused)
  resume(now: number): PresenceEvent[];         // paused → away
  snapshot(now: number): PresenceSnapshot;
}
```

**Behavior (normative):**
- Internal: `state`, `sprintStartAt`, `sprintStartedEmitted`, `nudgeIndex`, `nextNudgeAt`.
- **`tick(now, idleMs)`** —
  - `paused` → `[]`.
  - `idleMs === null` (manual): if `active`, run the **nudge loop** (below) on wall time; else `[]`.
  - Presence mode; let `lastActivityAt = now - idleMs`:
    - `away`: if `idleMs <= activityThresholdMs` → start sprint: `state="active"`, `sprintStartAt = lastActivityAt`, `sprintStartedEmitted=false`, `nudgeIndex=0`, `nextNudgeAt = sprintStartAt + sprintMs`; fall through to active handling. Else `[]`.
    - `active`: if `idleMs >= idleResetMs` → end: `activeMs = max(0, lastActivityAt - sprintStartAt)`; if `sprintStartedEmitted` push `sprint-ended {at: lastActivityAt, activeMs, overMs: max(0, activeMs - sprintMs), endedBy:"idle_reset"}`; `state="away"`; return. Else: if `!sprintStartedEmitted && (now - sprintStartAt) >= minSprintLogMs` push `sprint-started {at: sprintStartAt, trigger:"activity"}`, set flag; then run the **nudge loop**.
- **Nudge loop** (active only, after start emitted): `while (now >= nextNudgeAt) { push nudge {at: nextNudgeAt, activeMs: nextNudgeAt - sprintStartAt, index: nudgeIndex}; nudgeIndex++; nextNudgeAt += renudgeEveryMs; }`.
- **`manualStart`**: `away`→`active`, `sprintStartAt=now`, `sprintStartedEmitted=true`, `nudgeIndex=0`, `nextNudgeAt=now+sprintMs`; return `[sprint-started {at:now, trigger:"manual"}]`.
- **`manualStop`**: if `active`, `activeMs=now-sprintStartAt`; `state="away"`; return `[sprint-ended {at:now, activeMs, overMs:max(0,activeMs-sprintMs), endedBy:"manual"}]`.
- **`pause`**: if `active && sprintStartedEmitted`, emit `sprint-ended {at:now, activeMs:now-sprintStartAt, overMs, endedBy:"paused"}`; `state="paused"`.
- **`resume`**: `paused`→`away`.
- **`snapshot(now)`**: `active` → `{state, activeMs: now-sprintStartAt, overMs: max(0, (now-sprintStartAt)-sprintMs)}`; else `{state, activeMs:0, overMs:0}`.

**Key test cases (write first, watch fail):**
1. Away + activity (`idleMs=1000`) → after `minSprintLogMs` a `sprint-started`; a short blip (goes idle before floor) emits **nothing**.
2. Active reaching `sprintMs` → one `nudge` index 0 with `activeMs≈sprintMs`; then a `nudge` index 1 at `+renudgeEveryMs`.
3. Active then `idleMs>=idleResetMs` → `sprint-ended endedBy idle_reset`, `activeMs` measured to `lastActivityAt` (trailing idle excluded), `state→away`.
4. Micro-idle (`idleMs` between threshold and reset) does **not** reset; sprint continues.
5. `pause` during active → `sprint-ended endedBy paused`; ticks while paused → `[]`; `resume` → away.
6. Manual mode (`idleMs=null`): `manualStart`→`sprint-started trigger manual`; ticks fire nudges on wall time; `manualStop`→`sprint-ended endedBy manual`.

Commit after green.

---

### Task 3: Event vocabulary + pure mapper

**Files:** Modify `src/core/events.ts`; Modify `src/core/events.test.ts`.

**Interfaces — Produces:**
```ts
interface Envelope { ts: number; sprint_id: string; }
export type DomainEvent =
  | (Envelope & { event: "sprint_started"; trigger: "activity" | "manual" })
  | (Envelope & { event: "nudge"; active_s: number; index: number })
  | (Envelope & { event: "sprint_ended"; active_s: number; over_s: number; ended_by: "idle_reset" | "paused" | "manual" });
export interface EventSink { append(e: DomainEvent): Promise<void>; }
export class InMemoryEventSink implements EventSink { readonly events: DomainEvent[]; append(e): Promise<void>; }
export interface MapContext { sprintId: string; trigger: "activity" | "manual"; }
export function toDomainEvents(raw: PresenceEvent[], ctx: MapContext): DomainEvent[];
```
- `toSeconds = ms => Math.floor(ms/1000)`. `ts = toSeconds(e.at)`, `sprint_id = ctx.sprintId`.
- `sprint-started → sprint_started {trigger: e.trigger}` (prefer the event's own trigger; ctx.trigger is the fallback). `nudge → nudge {active_s: toSeconds(activeMs), index}`. `sprint-ended → sprint_ended {active_s, over_s, ended_by}`.
- Exhaustive `switch` over the 3-variant union.

**Tests:** each variant maps with correct seconds conversion + fields; exhaustiveness holds. Red→green→commit.

---

### Task 4: Ring visual

**Files:** Modify `src/core/ring.ts`; Modify `src/core/ring.test.ts`; Modify `src/native/trayIcon.ts` (color-role map).

**Interfaces — Produces:**
```ts
export type RingColorRole = "idle" | "focus" | "overrun";
export interface RingVisual { progress: number; colorRole: RingColorRole; }
export function ringVisual(state: PresenceState, activeMs: number, sprintMs: number): RingVisual;
```
- `away`/`paused` → `{progress: 0, colorRole: "idle"}`.
- `active`, `activeMs < sprintMs` → `{progress: clamp01(activeMs/sprintMs), colorRole: "focus"}`.
- `active`, `activeMs >= sprintMs` → `{progress: 1, colorRole: "overrun"}`.
- `trayIcon.ts`: map roles → tokens `focus → --focus`, `overrun → --overrun`, `idle → --border/muted` (drop grace/break). Keep `renderRing(size, progress, colorRole, theme)` shape.

**Tests:** boundaries (0, mid, ==sprintMs, past), each state → role. Red→green→commit.

---

### Task 5: Stats metrics + chart

**Files:** Modify `src/core/stats.ts`; Modify `src/core/stats.test.ts`; Modify `src/core/statsChart.ts`; Modify `src/core/statsChart.test.ts`.

**Interfaces — Produces:** a `computeStats(events: DomainEvent[], nowS: number, opts?: {adherenceWindowS?: number})` returning at least:
```ts
interface DayStats {
  activeS: number;          // sum of sprint_ended.active_s today
  sprints: number;          // count of sprint_ended today
  longestStretchS: number;  // max active_s today
  breaks: number;           // count of gaps between a sprint_ended and the next sprint_started (same day)
  totalBreakS: number; avgBreakS: number;
  nudges: number;           // count of nudge events today
  nudgeAdherence: number;   // fraction of boundary (index 0) nudges whose sprint ended (idle_reset) within adherenceWindowS (default 600)
}
// plus a 7-day series of active minutes for statsChart.
```
- Pair events by `sprint_id`. A break = `next.sprint_started.ts − prev.sprint_ended.ts` when positive and same local day.
- Empty-state safe (no events → zeros, `avgBreakS=0`, `nudgeAdherence=0`).
- `statsChart.ts`: build the 7-day bar series (active minutes per day), same rendering contract the stats window expects.

**Tests:** hand-built event fixtures → each metric; longest-stretch picks the max; adherence counts only boundary nudges resolved by an idle_reset within window; empty-state. Red→green→commit.

---

### Task 6: Nudge / DND decision

**Files:** Modify `src/core/nudge.ts`; Modify `src/core/nudge.test.ts`.

**Interfaces — Produces:**
```ts
export type NudgeDecision = "notify" | "suppress";
export function decideNudge(dnd: "active" | "inactive" | "unknown"): NudgeDecision;
```
- `active → "suppress"`; `inactive`/`unknown → "notify"` (unknown delivers quietly — that quietness is a presentation detail handled in main/notify).

**Tests:** three inputs → expected. Red→green→commit.

---

### Task 7: Rust cross-platform presence providers + `idle_seconds` command

**Files:** Create `src-tauri/src/presence.rs`; Modify `src-tauri/src/lib.rs`; Modify `src-tauri/Cargo.toml`.

**Build prerequisite (Linux):** ensure `libxss-dev` and `libx11-dev` are installed for the `x11` `xss` link (`sudo apt-get install -y libxss-dev libx11-dev`). `cargo check` passes without them (no link step); `cargo build`/`tauri build` needs them. Document in `verification.md`.

**Cargo.toml additions:**
```toml
[target.'cfg(target_os = "linux")'.dependencies]
zbus = "5"                                            # unify with Tauri's transitive zbus (verify: cargo tree -i zbus)
x11  = { version = "2", features = ["xlib", "xss"] }
# macOS: CoreGraphics is linked via #[link] in presence.rs — no crate needed.
```

**`presence.rs`** — verified providers (from research):
```rust
// macOS — CoreGraphics extern (no crate, no TCC permission needed).
#[cfg(target_os = "macos")]
fn idle_seconds_macos() -> f64 {
    #[link(name = "CoreGraphics", kind = "framework")]
    extern "C" {
        fn CGEventSourceSecondsSinceLastEventType(state_id: i32, event_type: u32) -> f64;
    }
    // state 0 = CombinedSessionState; event_type ~0 = kCGAnyInputEventType.
    unsafe { CGEventSourceSecondsSinceLastEventType(0, u32::MAX) }
}

// Linux GNOME — Mutter IdleMonitor over D-Bus (zbus 5 blocking).
#[cfg(target_os = "linux")]
#[zbus::proxy(
    interface = "org.gnome.Mutter.IdleMonitor",
    default_service = "org.gnome.Mutter.IdleMonitor",
    default_path = "/org/gnome/Mutter/IdleMonitor/Core"
)]
trait IdleMonitor {
    #[zbus(name = "GetIdletime")]
    fn get_idletime(&self) -> zbus::Result<u64>; // milliseconds
}
#[cfg(target_os = "linux")]
fn idle_seconds_gnome() -> zbus::Result<f64> {
    let conn = zbus::blocking::Connection::session()?;
    let proxy = IdleMonitorProxyBlocking::new(&conn)?;
    Ok(proxy.get_idletime()? as f64 / 1000.0)
}

// Linux GNOME fallback — gdbus Command (parses "(uint64 12345,)").
#[cfg(target_os = "linux")]
fn idle_seconds_gnome_gdbus() -> Option<f64> {
    use std::process::Command;
    let out = Command::new("gdbus").args([
        "call","--session","--dest","org.gnome.Mutter.IdleMonitor",
        "--object-path","/org/gnome/Mutter/IdleMonitor/Core",
        "--method","org.gnome.Mutter.IdleMonitor.GetIdletime",
    ]).output().ok()?;
    if !out.status.success() { return None; }
    let s = String::from_utf8_lossy(&out.stdout);
    let ms: u64 = s.trim().trim_start_matches('(').trim_end_matches(')')
        .trim_end_matches(',').trim().strip_prefix("uint64")?.trim().parse().ok()?;
    Some(ms as f64 / 1000.0)
}

// Linux X11 — XScreenSaver (x11 crate, xss feature). .idle is milliseconds.
#[cfg(target_os = "linux")]
fn idle_seconds_x11() -> Option<f64> {
    use std::ptr;
    use x11::xlib::{XOpenDisplay, XCloseDisplay, XDefaultRootWindow, XFree};
    use x11::xss::{XScreenSaverAllocInfo, XScreenSaverQueryInfo};
    unsafe {
        let dpy = XOpenDisplay(ptr::null());
        if dpy.is_null() { return None; }
        let info = XScreenSaverAllocInfo();
        if info.is_null() { XCloseDisplay(dpy); return None; }
        let root = XDefaultRootWindow(dpy);
        let status = XScreenSaverQueryInfo(dpy, root, info);
        let result = if status != 0 { Some((*info).idle as f64 / 1000.0) } else { None };
        XFree(info as *mut _);
        XCloseDisplay(dpy);
        result
    }
}

/// Seconds since last input, or None when no provider is available (honest manual mode).
pub fn idle_seconds() -> Option<f64> {
    #[cfg(target_os = "macos")]
    { return Some(idle_seconds_macos()); }
    #[cfg(target_os = "linux")]
    {
        let session = std::env::var("XDG_SESSION_TYPE").unwrap_or_default();
        let desktop = std::env::var("XDG_CURRENT_DESKTOP").unwrap_or_default().to_ascii_uppercase();
        if desktop.contains("GNOME") {
            if let Ok(s) = idle_seconds_gnome() { return Some(s); }
            if let Some(s) = idle_seconds_gnome_gdbus() { return Some(s); }
        }
        if session != "wayland" {
            if let Some(s) = idle_seconds_x11() { return Some(s); }
        }
        return None;
    }
    #[cfg(not(any(target_os = "macos", target_os = "linux")))]
    { None }
}
```
**`lib.rs`:** add `mod presence;`, a command `#[tauri::command] fn idle_seconds() -> Option<f64> { presence::idle_seconds() }`, and register it in `generate_handler![dnd_state, quit, idle_seconds]`.

**Steps:** add deps → write `presence.rs` → wire `lib.rs` → `cargo check` (green) → `cargo build -p tomato` (green, after installing libxss-dev) → commit. Manual runtime verification is deferred to the integration test-drive (Task 13 checklist).

---

### Task 8: `native/presence.ts` wrapper

**Files:** Create `src/native/presence.ts`.

**Interfaces — Produces:**
```ts
import { invoke } from "@tauri-apps/api/core";
/** Seconds since last input, or null when no provider is available (→ manual mode). */
export async function idleSeconds(): Promise<number | null> {
  const v = await invoke<number | null>("idle_seconds");
  return typeof v === "number" ? v : null;
}
```
Impure; verify via `tsc`. (No capability needed — app commands are not ACL-gated.) Commit.

---

### Task 9: `main.ts` integration rewrite

**Files:** Rewrite `src/main.ts`.

**Behavior:**
- Build `PresenceConfig` from `TomatoConfig` (seconds→ms; `activityThresholdMs: 5000`, `minSprintLogMs: 60000`).
- **1 Hz loop:** `const idle = await idleSeconds(); const idleMs = idle === null ? null : Math.round(idle*1000); apply(machine.tick(Date.now(), idleMs));`. Track `available = idle !== null` for degrade UI/menu. Keep the re-entrancy guard.
- **`persist(raw)`:** mint `sprintId = crypto.randomUUID()` on `sprint-started`; map via `toDomainEvents(raw, {sprintId, trigger})`; append each; discard sub-floor handled by the machine (it simply doesn't emit).
- **`react(raw)`:** on `nudge`, `decideNudge(await dndDetector.current())`; if `notify`, `notify("Tomato", "You've been focused a while — good moment to step away.")`. No windows.
- **Tray menu:** `Pause tracking` / `Resume` (toggle by state via `machine.pause/resume`), `Stats…`, `Settings…`, `Quit`. In **manual mode** (`available === false`) also show `Start` / `Stop` (→ `machine.manualStart/manualStop`) and set the tooltip to note presence detection is unavailable. `syncMenu()` enables/disables by state.
- **Icon:** `ringVisual(snap.state, snap.activeMs, timerConfig.sprintMs)` → `renderRing` when active, static idle icon when away/paused.
- **Config reload:** keep `SETTINGS_SAVED` listener + `pendingConfig`/`applyPendingConfig` gated to `away`/`paused`.
- **Auto-start on load:** none needed — presence auto-starts. In manual mode, do not auto-start.
- Remove all grace/break/boundary-window code and imports.

Manual-verify (headless can't run it); `tsc` must pass. Commit.

---

### Task 10: Settings screen

**Files:** Rewrite `src/settings.html`; Rewrite `src/settings.ts`; adjust `src/styles/settings.css`.

- Three text fields (numeric-enforced via `sanitizeNumericField`): **Sprint length**, **Reset after idle**, **Re-nudge every** (minutes), plus **Autostart on login**. Remove break/grace/enforcement rows.
- `save()`: build `TomatoConfig` from the three clamped fields (`SPRINT_BOUNDS`/`IDLE_RESET_BOUNDS`/`RENUDGE_BOUNDS`) + `onboarded` preserved; keep the per-step try/catch (write → autostart → emit → close) and `type="text"` inputs with the anti-FOUC critical `<style>`.
- Size the window to the (now shorter) card; no scrollbar (reuse the centered-flex body).

`tsc` clean; manual-verify. Commit.

---

### Task 11: Onboarding screen copy

**Files:** Modify `src/onboarding.html`; Modify `src/onboarding.ts`.

- Rewrite the three step bodies to the presence model: (1) "Tomato follows your presence — start working and it starts with you." (2) "Step away and it resets; your agents keep working, so the break costs nothing." (3) "Set your sprint length and idle reset." Fields: **Sprint length** + **Reset after idle** (replace the break field). Preserve `onboarded:true` persist + `SETTINGS_SAVED` + per-step close, text inputs, anti-FOUC style.
- Keep `onboardingSteps` core as-is.

`tsc` clean; manual-verify. Commit.

---

### Task 12: Stats screen

**Files:** Rewrite `src/stats.ts`; Modify `src/stats.html`; adjust `src/styles/stats.css`.

- Render the Task 5 metrics: today's **active time**, **sprints**, **longest stretch**, **breaks taken** + avg length, **nudge adherence**, and the **7-day active-minutes chart**. Light + dark via tokens. Empty state when no events.
- Reads the event log via `jsonlEventStore.readAllEvents()` (unchanged) and `computeStats`.

`tsc` clean; manual-verify. Commit.

---

### Task 13: Cleanup, capabilities, verification

**Files:** Delete `src/core/timer.ts`, `src/core/timer.test.ts`, `src/core/boundaryEvents.ts`, `src/grace-toast.html`, `src/grace-toast.ts`, `src/break-card.html`, `src/break-card.ts`, `src-tauri/capabilities/boundary-windows.json`, unused `src/assets/tray/tray-break-*.png`; Modify `vite.config.ts` (drop grace-toast/break-card inputs); Modify `docs/verification.md`.

- Remove every remaining import of the deleted modules (grep to confirm none dangle).
- `verification.md`: replace the enforced-cadence checklist with the v2 test-drive — presence auto-start/reset, boundary nudge + re-nudge, Pause/Resume, honest manual-mode surface, Stats metrics correctness, config round-trip, cross-platform note (macOS deferred; `libxss-dev` build prereq).
- Full green gate: `pnpm test`, `npx tsc --noEmit`, `cargo check` (and `cargo build` if libxss-dev present). Commit.

## Self-review (author checklist)

- **Spec coverage:** away/active/paused (T2,T9), auto-start/reset (T2,T9), boundary+re-nudge (T2), providers+degrade (T7,T8,T9), Pause (T9), events (T3), noise floor (T2), metrics (T5), non-destructive config (T1). ✅
- **Type consistency:** `PresenceEvent`/`DomainEvent`/`PresenceConfig`/`RingColorRole` names shared across T2–T5, T9. `ended_by` union identical in T2/T3. ✅
- **No placeholders:** Rust is verified/complete; TS gives exact signatures, behavior, and test cases for TDD.
