# Tomato Desktop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the standalone, offline Tomato agentic-Pomodoro desktop app (Tauri v2, Linux-first) that conforms to Spec 1, wired to the delivered brand kit, with an early runnable MVP, local build, and GitHub Actions CI (committed, not pushed).

**Architecture:** A **pure TypeScript core** implements all Spec 1 logic (timer state machine, event vocabulary, ring geometry, DND-aware nudge decision, stats aggregation) and is fully unit-tested. A **thin Rust/Tauri v2 shell** provides the OS surfaces (tray + runtime-drawn ring, break-card and grace-toast windows, notifications, DND detection, autostart) and does file I/O (append-only JSONL event log + JSON config at XDG paths). The UI is HTML/CSS/TS styled from the design tokens.

**Tech Stack:** Tauri v2, TypeScript, pnpm, Vitest; Rust (thin shell); design tokens from `docs/design/tomato-tokens.{json,css}`; fonts Hanken Grotesk + IBM Plex Mono (bundled, offline).

## Global Constraints

- **Conforms to Spec 1** (`../../tomato-protocol/spec-1-agentic-15min-window.md`). Defaults: `sprint_duration_s=900`, `break_duration_s=300`, `grace_s=120`, `early_grace_s=300` (first sprint of a streak), `enforcement_mode=enforced`. States: `idle / focus / grace / break`. **MUST NOT auto-chain sprints.**
- **Offline only:** no network, no Kanboard. Session events are written locally as append-only JSONL.
- **Event vocabulary (exact):** `sprint_started` (`planned_s`, `enforcement_mode`), `boundary_reached`, `grace_started` (`grace_s`, `streak_index`), `grace_ended` (`actual_grace_s`, `ended_by`), `break_started` (`break_id`, `planned_s`), `break_completed` (`break_id`, `actual_s`), `break_skipped` (`break_id?`, `after_s`), `sprint_ended` (`actual_focus_s`, `over_run_s`). Common envelope `{ event, ts, sprint_id, ... }`, `ts` = unix seconds.
- **All business logic in pure TS** under `src/core/` (Vitest-tested). Every OS capability sits behind a TS interface with an in-memory fake for tests and a Tauri-backed impl under `src/native/`.
- **Design tokens are the source of truth** for color/type/spacing/ring geometry. Import `docs/design/tomato-tokens.css`; do not hardcode hex values in components. Ring geometry: diameter 0.84×canvas, stroke 0.15×diameter, start −90°, clockwise, round cap, 2px inner gap.
- **State is color-blind-safe:** always pair a state color with its glyph (● focus, ◑ grace, ◼ break, ▲ over-run).
- **Theme-aware:** light is `:root`; dark via `[data-theme="dark"]` and `prefers-color-scheme`.
- **XDG paths:** events `~/.local/share/tomato/events.jsonl`; config `~/.config/tomato/config.json`.
- **License:** none yet — do not add an OSS license; the `LICENSE` placeholder stays until a decision is made. Do not push to any remote; local commits only.
- **Visual source of truth:** `docs/design/Tomato Screens.dc.html` and `Tomato Brand Foundation.dc.html` (open in a browser). Match them; this plan specifies behavior + structure, the mockups specify pixels.
- Commit after each task with the message shown. Small, frequent commits.

---

# Phase 0 — Scaffold & foundation

### Task 1: Scaffold Tauri v2 + pnpm + Vitest

**Files:**
- Create: the Tauri v2 project in `tomato-desktop/` (alongside existing `docs/`, `README.md`, `LICENSE`, `.gitignore`)
- Create: `vitest.config.ts`, `src/core/version.ts`, `src/core/version.test.ts`

**Interfaces:**
- Produces: `APP_VERSION` (`'0.1.0'`) — single source of the app version; a green Vitest run; a launchable Tauri dev app.

- [ ] **Step 1: Scaffold into the existing directory**

Run:
```bash
cd ~/Projects/Tomato/tomato-desktop
pnpm create tauri-app@latest . --template vanilla-ts --manager pnpm --yes
pnpm install
```
If prompted despite `--yes`: package name `tomato`, frontend TypeScript, template Vanilla. Keep the existing `README.md`, `LICENSE`, `.gitignore`, and `docs/` (do not let the scaffold overwrite them; if it complains the dir is non-empty, scaffold in a temp dir and move `src/`, `src-tauri/`, `index.html`, `package.json`, `vite.config.*`, `tsconfig.json` in).

Expected: `src-tauri/` and `src/` exist; `pnpm tauri --version` prints v2.

- [ ] **Step 2: Add Vitest**

Run: `pnpm add -D vitest`. Add to `package.json` scripts: `"test": "vitest run"`, `"test:watch": "vitest"`. Create `vitest.config.ts`:
```ts
import { defineConfig } from "vitest/config";
export default defineConfig({ test: { environment: "node", include: ["src/**/*.test.ts"] } });
```

- [ ] **Step 3: Write the failing smoke test**

`src/core/version.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { APP_VERSION } from "./version";
describe("APP_VERSION", () => {
  it("is 0.1.0", () => { expect(APP_VERSION).toBe("0.1.0"); });
});
```

- [ ] **Step 4: Run test → fails** — `pnpm test` (cannot resolve `./version`).

- [ ] **Step 5: Implement** — `src/core/version.ts`: `export const APP_VERSION = "0.1.0";`

- [ ] **Step 6: Run test → passes** — `pnpm test`.

- [ ] **Step 7: Confirm dev launch** — `pnpm tauri dev` opens the default window; close it. (Tray/window config comes later.)

- [ ] **Step 8: Commit**
```bash
git add -A && git commit -m "chore: scaffold Tauri v2 + pnpm + Vitest"
```

---

### Task 2: Design tokens, fonts, theming

**Files:**
- Create: `src/styles/tokens.css` (import of the kit token CSS), `src/styles/base.css`
- Create: `src/assets/fonts/` (bundled woff2) + `src/styles/fonts.css`
- Create: `src/core/theme.ts`, `src/core/theme.test.ts`
- Modify: `index.html` (link styles, set base font/vars)

**Interfaces:**
- Produces: `resolveTheme(pref: "light"|"dark"|"system", systemDark: boolean): "light"|"dark"` and `applyTheme(doc, theme)` — sets `data-theme`. Tokens available as CSS vars app-wide; fonts load offline.

- [ ] **Step 1: Bring in tokens + fonts**

Copy the kit token CSS into the app build:
```bash
cp docs/design/tomato-tokens.css src/styles/tokens.css
```
Vendor the fonts **locally** (offline requirement — no CDN): download Hanken Grotesk (400/500/600/700/800) and IBM Plex Mono (400/600) woff2 into `src/assets/fonts/`, and create `src/styles/fonts.css` with `@font-face` blocks pointing at them (`font-display: swap`). The token stacks already fall back to `system-ui`/`ui-monospace`.

- [ ] **Step 2: Write the failing theme test**

`src/core/theme.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { resolveTheme } from "./theme";
describe("resolveTheme", () => {
  it("honors explicit choices", () => {
    expect(resolveTheme("light", true)).toBe("light");
    expect(resolveTheme("dark", false)).toBe("dark");
  });
  it("follows system when set to system", () => {
    expect(resolveTheme("system", true)).toBe("dark");
    expect(resolveTheme("system", false)).toBe("light");
  });
});
```

- [ ] **Step 3: Run → fails** (`pnpm test`).

- [ ] **Step 4: Implement `src/core/theme.ts`**
```ts
export type ThemePref = "light" | "dark" | "system";
export type Theme = "light" | "dark";
export function resolveTheme(pref: ThemePref, systemDark: boolean): Theme {
  if (pref === "light" || pref === "dark") return pref;
  return systemDark ? "dark" : "light";
}
export function applyTheme(doc: Document, theme: Theme): void {
  doc.documentElement.setAttribute("data-theme", theme);
}
```

- [ ] **Step 5: Run → passes.**

- [ ] **Step 6: Wire styles into `index.html`** — link `fonts.css`, `tokens.css`, `base.css` (in that order). In `base.css` set `body { background: var(--bg); color: var(--text); font-family: var(--font-body); }` and a small reset.

- [ ] **Step 7: Commit**
```bash
git add -A && git commit -m "feat: design tokens, bundled fonts, light/dark theming"
```

---

# Phase 1 — Pure core (Spec 1, TDD)

### Task 3: Timer state machine (idle/focus/grace/break)

**Files:** Create `src/core/timer.ts`, `src/core/timer.test.ts`

**Interfaces:**
- Produces:
  - `type TimerState = "idle" | "focus" | "grace" | "break" | "stopped"`
  - `interface TimerConfig { sprintMs: number; breakMs: number; graceMs: number; earlyGraceMs: number; mode: "enforced" | "soft" }`
  - `interface TimerSnapshot { state: TimerState; sprintElapsedMs: number; graceElapsedMs: number; breakElapsedMs: number; activeFocusMs: number; overRunMs: number; streakIndex: number }`
  - `type TimerEvent` = discriminated union mirroring the Spec 1 vocabulary (see Task 4's `DomainEvent` — the timer returns lightweight `{type, ...}` events from `tick`/actions that Task 4 maps to persisted `DomainEvent`s).
  - `class TimerMachine`:
    - `constructor(config: TimerConfig)`
    - `start(now: number): TimerEvent[]` — idle/stopped → focus; `streakIndex` = count of completed sprints since cold idle.
    - `tick(now: number): TimerEvent[]` — advances; in `enforced`, at boundary emits `boundary-reached` + `grace-started` and enters `grace`; when grace elapses emits `grace-ended{ended_by:"timeout"}` + `break-started` and enters `break`; when break elapses emits `break-completed` and → `idle` (no auto-chain). In `soft`, at boundary emits `boundary-reached` + `nudge`, stays `focus`.
    - `breakNow(now)`, `beginBreak(now)` (soft manual), `skipBreak(now)`, `stop(now)` — each returns events.
    - `snapshot(now)`, `effectiveGraceMs()`.

- [ ] **Step 1: Write the failing tests** (`src/core/timer.test.ts`) — cover: start→focus; enforced boundary enters grace with `early_grace` on first sprint (streakIndex 0) and `grace_s` after; grace timeout → break; `breakNow` ends grace early (`ended_by:"user"`); break elapse → idle (no auto-chain); soft boundary emits nudge and stays focus; `activeFocusMs` accrues only in focus/grace not break; `overRunMs` = focus time past boundary; `skipBreak`; `stop` from any active state.

```ts
import { describe, it, expect } from "vitest";
import { TimerMachine } from "./timer";
const cfg = { sprintMs: 900_000, breakMs: 300_000, graceMs: 120_000, earlyGraceMs: 300_000, mode: "enforced" as const };
const types = (es: {type:string}[]) => es.map(e => e.type);

describe("TimerMachine (enforced)", () => {
  it("uses early grace on the first sprint, normal grace after", () => {
    const t = new TimerMachine(cfg);
    t.start(0);
    expect(types(t.tick(cfg.sprintMs))).toEqual(["boundary-reached","grace-started"]);
    expect(t.snapshot(cfg.sprintMs).state).toBe("grace");
    // early grace (5m) not yet elapsed at 2m:
    expect(t.tick(cfg.sprintMs + 120_000)).toEqual([]);
    // elapses at 5m → break:
    expect(types(t.tick(cfg.sprintMs + cfg.earlyGraceMs))).toEqual(["grace-ended","break-started"]);
  });

  it("breakNow ends grace early", () => {
    const t = new TimerMachine(cfg); t.start(0); t.tick(cfg.sprintMs);
    const es = t.breakNow(cfg.sprintMs + 10_000);
    expect(types(es)).toEqual(["grace-ended","break-started"]);
  });

  it("break elapse returns to idle without auto-chaining", () => {
    const t = new TimerMachine(cfg); t.start(0); t.tick(cfg.sprintMs);
    t.tick(cfg.sprintMs + cfg.earlyGraceMs); // break started
    const es = t.tick(cfg.sprintMs + cfg.earlyGraceMs + cfg.breakMs);
    expect(types(es)).toContain("break-completed");
    expect(t.snapshot(cfg.sprintMs + cfg.earlyGraceMs + cfg.breakMs).state).toBe("idle");
  });

  it("accrues activeFocusMs in focus+grace, not break; tracks overRun", () => {
    const t = new TimerMachine(cfg); t.start(0);
    t.tick(cfg.sprintMs + 60_000);         // 60s into grace
    const snap = t.snapshot(cfg.sprintMs + 60_000);
    expect(snap.activeFocusMs).toBe(cfg.sprintMs + 60_000);
    expect(snap.overRunMs).toBe(60_000);
  });
});

describe("TimerMachine (soft)", () => {
  it("nudges at boundary and stays in focus", () => {
    const t = new TimerMachine({ ...cfg, mode: "soft" }); t.start(0);
    expect(types(t.tick(cfg.sprintMs))).toEqual(["boundary-reached","nudge"]);
    expect(t.snapshot(cfg.sprintMs).state).toBe("focus");
  });
});
```

- [ ] **Step 2: Run → fails.**
- [ ] **Step 3: Implement `src/core/timer.ts`** to satisfy the tests (accumulate elapsed by `delta = now - lastTick`; guard transitions; `effectiveGraceMs = streakIndex === 0 ? earlyGraceMs : graceMs`; `activeFocusMs` accrues in `focus`+`grace`; `overRunMs = max(0, activeFocusMs - sprintMs)`; increment `streakIndex` on each `break-completed`/`break-skipped`; reset to 0 when returning from a long idle/`stop`).
- [ ] **Step 4: Run → passes.**
- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat(core): Spec 1 timer state machine (grace, early-flow, break-now)"`

---

### Task 4: Domain events + emitter

**Files:** Create `src/core/events.ts`, `src/core/events.test.ts`

**Interfaces:**
- Produces:
  - `type DomainEvent` — the exact Spec 1 envelopes, e.g. `{ event: "sprint_started", ts, sprint_id, planned_s, enforcement_mode }`, … through `sprint_ended`.
  - `interface EventSink { append(e: DomainEvent): Promise<void> }` (in-memory fake for tests; JSONL impl in Task 8).
  - `function toDomainEvents(raw: TimerEvent[], ctx: { sprintId: string; breakId?: string; nowS: number; ... }): DomainEvent[]` — maps Task 3's lightweight events to persisted `DomainEvent`s with ids and unix-second `ts`.

- [ ] **Step 1: Write failing tests** — each `TimerEvent` type maps to the correct `DomainEvent` with required fields; `ts` in seconds; ids threaded (sprint_id stable per sprint, break_id per break); `sprint_ended` carries `actual_focus_s` + `over_run_s`.
- [ ] **Step 2: Run → fails.**
- [ ] **Step 3: Implement** `events.ts` (pure mapping; ids passed in, not generated here, for determinism).
- [ ] **Step 4: Run → passes.**
- [ ] **Step 5: Commit** — `git commit -am "feat(core): Spec 1 domain events + mapper"`

---

### Task 5: Ring geometry & progress

**Files:** Create `src/core/ring.ts`, `src/core/ring.test.ts`

**Interfaces:**
- Produces (geometry constants read from tokens; keep them here as typed consts mirroring `tomato-tokens.json`):
  - `function ringProgress(elapsedMs: number, totalMs: number): number` — `[0,1]`, guards `totalMs<=0`, clamps overflow to 1.
  - `function ringVisual(state: TimerState, sprintElapsedMs, sprintMs, graceActive): { progress: number; colorRole: "focus"|"grace"|"overrun"; glyph: "●"|"◑"|"◼"|"▲" }` — focus→●, grace→◑, over-run(>1 or overrun)→▲, break→◼.
  - `interface RingGeometry { diameterRatio: 0.84; strokeRatio: 0.15; startAngleDeg: -90; clockwise: true; cap: "round"; innerGapPx: 2 }` and `describeRing(size: number)` → pixel dims for the renderer (Task 9).

- [ ] **Step 1: Write failing tests** — progress at 0/half/over; guard total≤0; state→colorRole+glyph mapping; `describeRing(32)` returns expected diameter/stroke.
- [ ] **Step 2–4: Run→fail, implement, run→pass.**
- [ ] **Step 5: Commit** — `git commit -am "feat(core): ring geometry + progress/state mapping"`

---

### Task 6: DND-aware nudge decision

**Files:** Create `src/core/nudge.ts`, `src/core/nudge.test.ts`

**Interfaces:**
- Produces: `type DndState = "active"|"inactive"|"unknown"`; `type NudgeKind = "card"|"card-quiet"|"notification"`; `function decideNudge(dnd: DndState): NudgeKind` (inactive→card, active→notification, unknown→card-quiet); `interface DndDetector { current(): Promise<DndState> }` (fake in tests; Linux impl in Task 10).

- [ ] **Step 1: Write failing tests** (all three mappings). **Steps 2–4:** run→fail, implement, run→pass.
- [ ] **Step 5: Commit** — `git commit -am "feat(core): DND-aware nudge decision"`

---

### Task 7: Stats aggregator (the test instrument)

**Files:** Create `src/core/stats.ts`, `src/core/stats.test.ts`

**Interfaces:**
- Produces: `interface DayStats { date: string; sprints: number; breaksTaken: number; breaksSkipped: number; overRunS: number; timeline: Array<{kind:"sprint"|"break"; startS:number; endS:number}> }`; `interface Streak { current: number }`; `function aggregate(events: DomainEvent[], opts: { todayStartS: number; nowS: number }): { today: DayStats; streak: Streak; week: Array<{date:string; sprints:number}> }` — pure fold over the event log.

- [ ] **Step 1: Write failing tests** from a fixture event array: counts sprints, breaks taken vs skipped, sums over-run for today, builds the day timeline, computes current streak (consecutive sprints each followed by a taken break), and a 7-day sprint-per-day array. Cover empty log (all zeros).
- [ ] **Steps 2–4:** run→fail, implement, run→pass.
- [ ] **Step 5: Commit** — `git commit -am "feat(core): stats aggregator over the event log"`

---

# Phase 2 — Native shell → FIRST RUNNABLE MILESTONE

### Task 8: JSONL event store + config store

**Files:** Create `src/core/jsonl.ts` (+ test), `src/native/eventStore.ts`, `src/native/config.ts`; Rust: ensure fs/path access.

**Interfaces:**
- Produces: pure `serializeEvent(e: DomainEvent): string` / `parseEvents(text: string): DomainEvent[]` (JSONL, one object per line, tolerant of a trailing newline) — **unit-tested**; `EventSink` impl `jsonlEventStore` appending to `~/.local/share/tomato/events.jsonl` and `readAllEvents()`; `loadConfig()/saveConfig()` for `~/.config/tomato/config.json` with Spec 1 defaults.

- [ ] **Step 1: Write failing tests for `jsonl.ts`** — round-trip serialize→parse; parse ignores blank trailing line; parse of empty string → `[]`.
- [ ] **Steps 2–4:** run→fail, implement `jsonl.ts`, run→pass.
- [ ] **Step 5: Implement native stores** using `@tauri-apps/plugin-fs` (add: `pnpm add @tauri-apps/plugin-fs`; register in Rust) resolving XDG dirs via `@tauri-apps/api/path` (`appLocalDataDir`/`appConfigDir` or explicit XDG). `jsonlEventStore.append` opens the file in append mode and writes `serializeEvent(e)+"\n"`.
- [ ] **Step 6: Manual verify** — a temporary dev call appends two events; confirm the JSONL file exists at the XDG path with two valid lines.
- [ ] **Step 7: Commit** — `git add -A && git commit -m "feat: JSONL event store + config store (XDG)"`

---

### Task 9: Tray + runtime-drawn ring + timer loop

**Files:** Create `src/native/trayIcon.ts`, `src/main.ts`; Rust: tray setup in `src-tauri/src/lib.rs`; `src-tauri/tauri.conf.json` (hide main window, app icons from `docs/design/assets/app-icon/png`).

**Interfaces:**
- Consumes: `TimerMachine`, `ringVisual`/`describeRing`, tokens, `jsonlEventStore`, `toDomainEvents`.
- Produces: a tray icon that updates each second with the drawn ring; menu Start / Stop / Settings / Quit; the timer loop persisting domain events.

- [ ] **Step 1: Ring renderer** — `renderRing(size, progress, colorRole, theme)` draws per `describeRing` using OffscreenCanvas: track (`--ring-track`), progress arc (role color from tokens), start −90° clockwise, round cap; returns RGBA `Uint8Array`. Read token colors from a small generated TS map (mirror `tomato-tokens.json`; keep in `src/core/tokens.ts` so it's testable). For `idle`/`break` states use the corresponding kit PNGs from `docs/design/assets/tray/` as static icons.
- [ ] **Step 2: Tray + loop in `src/main.ts`** — create `TrayIcon` with a `Menu` (Start/Stop/Settings/Quit); `setInterval(1000)` calls `timer.tick(Date.now())`, maps events via `toDomainEvents` → `jsonlEventStore.append`, and refreshes the icon from `ringVisual`+`renderRing`. Start/Stop call the machine and persist. Machine ids: `sprint_id`/`break_id` via `crypto.randomUUID()`.
- [ ] **Step 3: Config** — `tauri.conf.json`: main window `"visible": false`; wire app icons; Linux tray needs `libayatana-appindicator3-1`.
- [ ] **Step 4: Manual verify** — `pnpm tauri dev`: tray shows a green ring that fills over a shortened sprint (temporarily set `sprintMs` small); Start/Stop work; events land in the JSONL log.
- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat: tray ring (runtime-drawn) + timer loop persisting events"`

---

### Task 10: Grace toast, break card, notifications, DND  ← **MVP**

**Files:** Create `src/break-card.html` + `src/break-card.ts`, `src/grace-toast.html` + `src/grace-toast.ts`, `src/native/dnd.ts`, `src/native/notify.ts`; Rust: `dnd_state` command; wire windows.

**Interfaces:**
- Consumes: `decideNudge`/`DndDetector`, `TimerMachine`, tokens; break/grace windows created by the shell.
- Produces: the full enforced/soft/DND boundary experience. **After this task you can live with the cadence and it logs the full event vocabulary.**

- [ ] **Step 1: DND detector (`src/native/dnd.ts` + Rust `dnd_state`)** — Rust runs `gsettings get org.gnome.desktop.notifications show-banners`; `false`→`active`, `true`→`inactive`, else `unknown`. TS wraps it, mapping errors → `unknown`.
- [ ] **Step 2: Grace toast** — a small, bottom-corner `WebviewWindow` (`alwaysOnTop`, `focus:false`, no decorations) loading `grace-toast.html`; shows "Wrap up — break in M:SS" + a **Break now** button (emits an event the main loop handles via `timer.breakNow`). Styled from tokens (grace color + ◑). Non-focus-stealing.
- [ ] **Step 3: Break card** — a centered `alwaysOnTop` `WebviewWindow` loading `break-card.html`; large mono countdown of the break, **Skip** button; **neutral** copy. On `nudge`/grace→break, decide presentation via `decideNudge(await dnd.current())`: `card`→focus the card; `card-quiet`→show without focus/sound; `notification`→close/skip the card and send an OS notification instead (add `@tauri-apps/plugin-notification`).
- [ ] **Step 4: Soft mode** — at boundary send an OS notification only (no windows).
- [ ] **Step 5: Manual verify (checklist)** — enforced: ring→amber grace→toast→(Break now / timeout)→break card countdown→Skip/complete→idle; soft: notification only; DND on (GNOME) → card degrades to notification; JSONL shows `grace_started/ended`, `break_started/completed|skipped`, `sprint_ended` with correct `over_run_s`.
- [ ] **Step 6: Commit** — `git add -A && git commit -m "feat: grace toast + break card + notifications + DND (MVP cadence complete)"`

---

# Phase 3 — UI screens

### Task 11: Stats window

**Files:** Create `src/stats.html`, `src/stats.ts`, `src/styles/stats.css`; open from tray "Stats"/left-click.

**Interfaces:** Consumes `aggregate` (Task 7) over `readAllEvents()`; renders per `Tomato Screens.dc.html`.

- [ ] **Step 1:** Window (~720×520) reading all events → `aggregate` → render: today's sprint count, breaks taken vs skipped (donut/stacked bar using `--chart-*`), total over-run, current streak badge, today's sprint/break timeline strip, and a 7-day sprint bar chart. Charts hand-rolled inline SVG (no chart lib), theme-aware, color-blind-safe (glyph/label + color).
- [ ] **Step 2: Manual verify** against a real/seeded event log; light + dark.
- [ ] **Step 3: Commit** — `git add -A && git commit -m "feat: stats window (adherence view + charts)"`

---

### Task 12: Settings + autostart

**Files:** Create `src/settings.html`, `src/settings.ts`, `src/styles/settings.css`; add autostart plugin.

**Interfaces:** Reads/writes config (Task 8); toggles autostart via `@tauri-apps/plugin-autostart`.

- [ ] **Step 1:** Window (~560×480, per mockup): sprint/break/grace duration steppers, enforcement mode toggle (Enforced ↔ Soft), autostart-on-login toggle; persist to config; the running machine picks up new durations on the next sprint.
- [ ] **Step 2: Manual verify** — change durations/mode, confirm persistence + effect; toggle autostart and confirm the login entry.
- [ ] **Step 3: Commit** — `git add -A && git commit -m "feat: settings window + autostart"`

---

### Task 13: First-run / onboarding (optional)

**Files:** Create `src/onboarding.html`, `src/onboarding.ts`.

- [ ] **Step 1:** 2–3 light steps explaining the cadence and setting initial durations (per mockup); shown once (a `config.onboarded` flag).
- [ ] **Step 2: Manual verify** first-run flow. **Step 3: Commit** — `git commit -am "feat: first-run onboarding"`

---

# Phase 4 — Build & CI

### Task 14: Local build + packaging

**Files:** Modify `src-tauri/tauri.conf.json` (bundle: AppImage + deb; icons; identifier `com.carmelosantana.tomato`); `package.json` scripts.

- [ ] **Step 1:** Ensure `pnpm tauri build` produces an AppImage and `.deb` on Linux; icons resolve from the app-icon PNGs; app identifier set.
- [ ] **Step 2: Manual verify** — run the built AppImage; tray + cadence work outside dev.
- [ ] **Step 3: Commit** — `git add -A && git commit -m "build: local Tauri bundle (AppImage + deb)"`

---

### Task 15: GitHub Actions CI (committed, not pushed)

**Files:** Create `.github/workflows/build.yml`.

- [ ] **Step 1:** Workflow: on push/tag + manual dispatch, on `ubuntu-latest`, install system deps (webkit2gtk, libayatana-appindicator3-dev), Rust + pnpm, `pnpm install`, `pnpm test`, `pnpm tauri build`, upload AppImage/deb artifacts. Gate a release job on tags `v*`. **Do not push** — the workflow only runs once a remote is created.
- [ ] **Step 2: Validate** locally (`act` if available, or lint the YAML). 
- [ ] **Step 3: Commit** — `git add -A && git commit -m "ci: GitHub Actions build/release workflow (runs once remote exists)"`

---

# Phase 5 — Verification

### Task 16: End-to-end verification & test-drive

**Files:** Create `docs/verification.md`.

- [ ] **Step 1: Full suite green** — `pnpm test` (all pure-core tests).
- [ ] **Step 2: Real-world test-drive** — run the built app for a real work block at default durations; confirm: tray ring fills; grace toast + Break-now; break card (and DND degrade); soft mode; events logged; stats window reflects the session; settings persist.
- [ ] **Step 3: Record evidence** in `docs/verification.md` (commands, screenshots, a sample of the JSONL log). This is the instrument for judging whether the cadence concept holds over ~2 weeks.
- [ ] **Step 4: Commit** — `git add -A && git commit -m "test: end-to-end verification + test-drive notes"`

---

## Self-Review notes

- **Spec 1 coverage:** states idle/focus/grace/break (T3); grace + early-flow (T3); enforced/soft modes (T3, T10); event vocabulary emitted + persisted (T4, T8); no auto-chain (T3); DND-aware (T6, T10); ring geometry from tokens (T5, T9); local-only JSONL (T8); defaults incl. 5-min break / 2-min grace / 5-min early grace (Global Constraints, T3).
- **Design kit wired:** tokens.css + fonts (T2), tokens mirrored to TS for the ring (T9), tray/app/UI icons (T9, T11, T14), screens match the `.dc.html` mockups (T10–T13).
- **Out of scope held:** no network/Kanboard, no agent detection, no escalation, no multi-profile, no macOS packaging (code portable, Linux-verified).
- **Type consistency:** `DomainEvent` (T4) is the one event type persisted by `EventSink` (T8) and consumed by `aggregate` (T7); `DndState`/`DndDetector` defined once (T6) and implemented in T10; `TimerState` shared by T3/T5; ring geometry consts mirror `tomato-tokens.json` exactly.
- **Milestones:** first runnable = end of T9; full cadence (MVP) = end of T10; full app = T13; shippable = T14–15.
