# Tomato — Hard-Nudge Overlay (soft→hard escalation)

**Status:** Design approved (brainstorm) — 2026-08-30
**Scope:** One self-contained feature. Follow-up to the v2 Presence Companion
(`docs/plans/2026-08-27-tomato-v2-presence.md`).

## Problem

v2's only boundary signal is a **soft** OS notification (a quiet, DND-aware
desktop banner). In practice that banner is easy to miss entirely — a GNOME
banner auto-hides after a few seconds, and if you aren't looking you never see
it. The next re-nudge isn't due for a full renudge interval (default 15 min), so
a whole overrun can pass with no perceived signal. The companion that exists to
say "step away" effectively says nothing.

## Goal

Reintroduce a **hard nudge** — an on-screen **overlay** — as an *escalation* when
the soft nudge is missed, while keeping the gentle-first philosophy:

- **Nudge #1** (the sprint boundary, `index 0`): unchanged **soft** desktop
  notification.
- **Nudge #2 and every re-nudge after** (`index ≥ 1`): a **hard** overlay — a
  centered card over a dimmed backdrop — instead of the soft notification.

This is a deliberate, opt-in reversal of v2's "no windows, never blocking"
stance: the overlay is **un-missable but never blocking** (one gesture clears it,
input is never locked, no break is forced).

## Non-goals

- No change to the **PresenceMachine** or the **event vocabulary**. The machine
  already emits `nudge {ts, sprint_id, active_s, index}`; soft-vs-hard is purely a
  reaction to `index`, decided in the shell.
- No new persisted event and no `kind` field on `nudge` (YAGNI — revisit only if
  stats ever need to distinguish soft/hard).
- No new Settings for now. Escalation is fixed (soft→hard at `index ≥ 1`). A
  toggle/threshold is an easy later follow-up.
- Not a break timer. v2 has no break state; the overlay is a prompt, not a
  countdown, and carries **no** "Break now"/"Pause" controls — **Dismiss only**.

## Behavior

### Escalation decision (pure, testable)

Add one pure helper to `src/core/nudge.ts`:

```ts
/** Which nudge surface a batch warrants, by its highest nudge index.
 *  index 0 (boundary) → soft; index ≥ 1 (any re-nudge) → hard. */
export function escalateNudge(maxIndex: number): "soft" | "hard";
```

The shell composes the two existing/added pure decisions:

1. **DND gate** (`decideNudge(dndState)`) — unchanged. If DND is active
   (`show-banners=false`), **neither** surface fires. A center overlay during
   Focus/Do-Not-Disturb would be the rudest possible violation, so the hard nudge
   is DND-gated exactly like the soft one — the same single check already in
   `react()`.
2. **Surface** (`escalateNudge(maxIndex)`) — soft vs hard, given DND allows it.

A coalesced batch may carry several catch-up nudge indices; use the **highest**
index in the batch (matching today's "at most one notification per batch" rule):
if it's `≥ 1` → hard, else → soft. Never fire both for one batch.

### `main.ts` `react()` — new shape

```
if batch has no nudge → return
dnd = await dndDetector.current()
if decideNudge(dnd) !== "notify" → return           // DND suppresses everything
maxIndex = max index among the batch's nudge events
if escalateNudge(maxIndex) === "soft":
    notify(...)                                      // today's path, unchanged
else:
    openNudgeOverlay(activeMs)                       // hard: show/refresh overlay
```

## The overlay window

- New window `src/nudge-overlay.html` + `src/nudge-overlay.ts`, label
  `"nudge-overlay"`, registered in `tauri.conf.json` windows and a capability
  file (`capabilities/nudge-overlay-window.json`) matching the other child
  windows.
- **Full-screen, transparent, always-on-top, skip-taskbar, non-resizable.** Paints
  a translucent dim over the whole screen with a **centered card**. Card: the
  tomato/ring mark, title **"Time to step away"**, a line like **"You've been
  focused for 4 minutes — take a short break,"** and a single primary **"Dismiss"**
  button. Themed from the existing design tokens (light/dark), background painted
  on creation like the other windows to avoid a white flash.
- **Dismiss** via the button, **Esc**, or clicking the dim. Dismiss = close the
  window. It does **not** lock input for any duration and does **not** force a
  break. It takes focus (so Esc/Enter work and it's truly on top); that momentary
  interruption is the intended "hard" quality.
- Reuses the deleted grace-toast's transparent-window/card patterns as prior art
  (see history `4ae9128^:src/grace-toast.{html,ts}`), rebuilt for a centered
  dimmed layout with v2 (windowless) copy.

## Lifecycle

- **Open:** on a hard nudge, open the overlay; if it's already open, just refresh
  its "focused for N" text (mirror of the Stats/Settings single-instance pattern
  in `main.ts`).
- **Auto-close on step-away:** when the machine leaves `active` (sprint ends /
  goes idle past reset, or is paused) the overlay closes — going idle *is* the
  break, so a stale "step away" card must not linger. `apply()` already runs every
  tick with the machine's new state; close the overlay there when
  `state !== "active"`.
- **Reappear:** if dismissed while you keep working, the next re-nudge
  (`index ≥ 1`, one renudge interval later) opens it again. That escalating
  persistence is the point; it only stops when you actually step away.

## Testability

- **Pure/unit-tested (Vitest):** `escalateNudge` in `core/nudge.ts` — boundary at
  `index 0 → "soft"`, `index 1,2,… → "hard"`. `decideNudge` unchanged.
- **Impure/manually verified:** the overlay window (HTML/TS) and the `react()` /
  `apply()` wiring in `main.ts`, like every other window. Manual check: run with a
  short sprint + short renudge, confirm boundary → banner, next re-nudge → centered
  dimmed overlay, Esc/click/Dismiss closes it, stepping away closes it, and DND
  (`show-banners=false`) suppresses both.

## Files touched

- `src/core/nudge.ts` (+ `nudge.test.ts`) — add `escalateNudge`.
- `src/main.ts` — branch `react()` soft/hard; open/refresh + auto-close overlay in
  the tick pipeline.
- `src/nudge-overlay.html`, `src/nudge-overlay.ts` — new overlay window.
- `src-tauri/tauri.conf.json` — register the window; `vite.config.ts` rollup input.
- `src-tauri/capabilities/nudge-overlay-window.json` — window capability.
- `src/styles/*` — overlay-specific styling as needed (tokens-driven).

## Verification gate

`pnpm test` + `npx tsc --noEmit` + `cargo check` green, plus the manual overlay
walk-through above.
