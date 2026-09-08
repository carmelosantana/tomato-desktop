# Tomato — Nudge Modes (soft / hard / escalating) + enforced dismiss lock

**Status:** Design approved (grilling) — 2026-09-08
**Scope:** One self-contained feature. Lands the unmerged
`feat/hard-nudge-overlay` branch behind a user-selectable mode, and fixes the
dismiss mechanic that branch got wrong.
**Predecessors:** `docs/specs/2026-08-30-hard-nudge-overlay-design.md` (the
overlay itself), `docs/plans/2026-08-27-tomato-v2-presence.md` (v2).

## Why

v2 ships exactly one boundary signal: a quiet, DND-aware OS notification. It is
easy to miss entirely — a GNOME banner auto-hides in seconds, and the next
re-nudge is a full interval away (default 15 min). A companion whose whole job is
to say "step away" effectively says nothing.

The `feat/hard-nudge-overlay` branch already solved this once: a full-screen
dimmed overlay with a centered card, fired on any re-nudge. It is written,
reviewed twice, and manually verified — but **unmerged**, and it hardcodes the
escalation with no way to choose. Its own spec listed "No new Settings" as a
non-goal and flagged the toggle as "an easy later follow-up."

This is that follow-up, plus one correction: the branch's 10-second rest period
does **not** do what it was believed to do (see *The dismiss lock* below).

## Vocabulary

Three terms this feature pins down, previously used loosely:

- **Nudge surface** — *how* a nudge is delivered. Exactly two: **soft** (an OS
  notification) and **hard** (the on-screen overlay). A surface is a delivery
  mechanism, never a user setting.
- **Nudge mode** — the user's persisted preference for which surface fires at
  which nudge index. Three values: `soft`, `hard`, `escalating`.
- **Dismiss lock** — the fixed 10-second window after the overlay appears during
  which it cannot be cleared **by any means**. Distinct from the branch's "rest
  period", which only gated backdrop clicks.

## Decisions

| # | Decision | Chosen | Why |
| --- | --- | --- | --- |
| 1 | Scope of this push | Nudge modes only | Stats week-browsing explicitly deferred (see Non-goals) |
| 2 | Branch strategy | Land `polish/v2-followups` on `main` first, then rebase `feat/hard-nudge-overlay` onto it | The overlay branch carries 3 unrelated reviewed commits; separating them keeps each branch's subject honest |
| 3 | Setting shape | One enum `nudge_mode: "soft" \| "hard" \| "escalating"` | Matches the user's mental model 1:1; one config key, one pure function. A numeric "escalate after N" is more expressive and worse to explain |
| 4 | Default | `escalating`, for new **and** existing configs | The premise of the overlay work is that soft-only says nothing. `loadConfig()` already falls back to defaults for absent keys, so existing installs adopt it silently |
| 5 | Dismiss lock | Lock **every** dismissal path for 10 s, with a visible countdown | The enforced pause is the mechanic that works; the branch's version leaves the button instant, so it delays nobody who reaches for the button |
| 6 | Do Not Disturb | DND continues to suppress **both** surfaces | Screen-sharing and presentations are the case that matters; the escape hatch (turn DND off) is one click. No second setting to explain |
| 7 | Settings control | Three-way segmented control below "Re-nudge every" | Shows all three modes and their trade-off at once; a dropdown hides two-thirds of the decision |
| 8 | Onboarding | Unchanged, stays at its current steps | A fourth step for a setting with a good default is scope creep |

## Behavior

### Surface selection (pure)

`escalateNudge(maxIndex)` on the branch is replaced by a mode-aware successor in
`src/core/nudge.ts`:

```ts
export type NudgeMode = "soft" | "hard" | "escalating";
export type NudgeSurface = "soft" | "hard";

/** Which surface a coalesced batch warrants, given the mode and the batch's
 *  HIGHEST nudge index. Pure and total. The DND gate (decideNudge) is applied
 *  separately by the shell, and gates both surfaces. */
export function chooseNudgeSurface(mode: NudgeMode, maxIndex: number): NudgeSurface;
```

| Mode | index 0 (boundary) | index ≥ 1 (re-nudge) |
| --- | --- | --- |
| `soft` | soft notification | soft notification |
| `hard` | **overlay** | **overlay** |
| `escalating` | soft notification | **overlay** |

The escalation threshold is fixed at `index >= 1` — it is not configurable
(that is what picking `hard` is for).

### `main.ts` `react()` — new shape

```
if batch has no nudge → return
dnd = await dndDetector.current()
if decideNudge(dnd) !== "notify" → return          // DND suppresses everything
maxIndex = max index among the batch's nudge events
if chooseNudgeSurface(config.nudge_mode, maxIndex) === "soft":
    notify(...)                                     // unchanged
else:
    openNudgeOverlay(activeMs)                      // show/refresh overlay
```

Coalescing is unchanged: at most one surface per batch, DND checked once.

Overlay **lifecycle** is unchanged from the branch: single-instance (re-show and
focus if already open), auto-closed in `apply()` whenever the machine leaves
`active` (going idle *is* the break, so a stale card must not linger), reopened
by the next qualifying nudge.

### The dismiss lock

The branch's `nudge-overlay.ts` sets `REST_MS = 10000` but wires it only to
`document.addEventListener("click", dismiss)`. The **Dismiss button** and **Esc**
both fire immediately. The delay therefore does nothing for anyone who reaches
for the button — which is everyone, after the first day.

The lock becomes real and total:

- For the first **10 seconds**, no path dismisses the overlay: not the button,
  not Esc, not a backdrop click.
- The `#dismiss` button is `disabled` and shows a live countdown —
  `Dismiss in 10` … `Dismiss in 1` — ticking once per second.
- On expiry: the button enables and reverts to `Dismiss`, Esc starts working,
  the existing `#hint` ("or click anywhere to dismiss") fades in, and the
  document click handler is attached — i.e. the branch's current unlock, extended
  to the other two paths.
- The lock duration is a module constant, not a setting.
- The existing one-shot `dismissed` guard stays (a single click after unlock
  reaches both the element handler and the bubbled document handler; a second
  `close()` on a closing window rejects).

The overlay still **never blocks input** — it takes focus and covers the screen,
but the user can alt-tab away at any time, including during the lock. The lock
governs the overlay's own dismissal, not the desktop.

The countdown's label is a pure function, unit-tested in core:

```ts
/** Button label for a dismiss lock with `remainingMs` left.
 *  > 0 → "Dismiss in N" (N = seconds, rounded up); 0 or less → "Dismiss". */
export function dismissLockLabel(remainingMs: number): string;
```

### Config

`TomatoConfig` gains one key:

```ts
/** Which nudge surface fires at which nudge index. */
nudge_mode: NudgeMode;
```

`DEFAULT_CONFIG.nudge_mode = "escalating"`.

`loadConfig()` sanitizes it like the durations: a value that is not one of the
three literals — absent, misspelled, hand-edited, or a retired v1 key — falls
back to the default rather than flowing through. A `sanitizeMode()` helper sits
beside the existing `sanitizeDuration()`.

`saveConfig()` needs no change; `settings.ts` adds `nudge_mode` to the object it
persists, alongside the preserved `onboarded`.

### Settings UI

A fourth row in `src/settings.html`, between "Re-nudge every" and "Autostart on
login", following the existing `.row` / `.row-text` / `.row-title` / `.row-sub`
structure:

- **Title:** `Nudge style`
- **Sub:** `how firmly Tomato asks you to step away`
- **Control:** a segmented control of three buttons in the `.field` slot, styled
  from the existing design tokens, using `role="radiogroup"` with
  `aria-checked` per option (mirroring how the autostart toggle already carries
  its state):

| Option | Label | Description |
| --- | --- | --- |
| `soft` | Soft | a quiet desktop notification |
| `hard` | Hard | a full-screen card, every time |
| `escalating` | Escalating | soft first, then full-screen |

Selection is local UI state until **Save**, matching the rest of the form.
`SETTINGS_SAVED` already triggers a config reload in `main.ts`; because
`applyPendingConfig()` defers swaps until the machine is between sprints, a mode
change lands on the next sprint rather than mid-sprint — consistent with the
durations, and correct (no surface change under a running sprint).

## Non-goals

- **Stats week browsing.** Arrows to page the stats window forward/back were
  raised and deliberately cut from this push. The two real questions it opens —
  whether the tiles rescope to the selected period or stay pinned to today, and
  whether a "week" is a Mon-start calendar week or a rolling 7-day page — are
  unanswered and belong to their own effort.
- **No `kind` field on the `nudge` event** and no new event. Stats does not
  distinguish soft from hard; adding the field later is cheap, so YAGNI holds.
- **No change to `PresenceMachine`** or the event vocabulary. Surface choice is
  purely a shell reaction to `index` plus config.
- **No configurable escalation threshold** — picking `hard` is the knob.
- **No configurable lock duration** — 10 s is a constant.
- **No DND override toggle.**
- **No overlay preview button** in settings.
- **No onboarding step.**
- **Not a break timer.** No countdown, no "Break now"/"Pause" controls. Dismiss
  only.

## Sequencing

1. **Land `polish/v2-followups` on `main`** — 3 already-reviewed commits
   (dead-code removal, tray Start/Stop derivation, D-Bus connection caching).
2. **Rebase `feat/hard-nudge-overlay` onto `main`** — 8 commits behind; the
   polish commits drop out of the rebase as already-applied.
3. **Core (TDD):** `NudgeMode`, `chooseNudgeSurface`, `dismissLockLabel` in
   `core/nudge.ts` — replacing `escalateNudge` and its tests.
4. **Config:** `nudge_mode` key, `sanitizeMode()`, default `escalating`.
5. **Settings:** the segmented control — markup, styling, load/save wiring.
6. **Overlay:** the total dismiss lock + countdown in `nudge-overlay.{html,ts}`.
7. **Shell:** `react()` reads `config.nudge_mode` through `chooseNudgeSurface`.

## Verification gate

- `pnpm test` + `npx tsc --noEmit` + `cargo check` green.
- **Manual walk-through** (extends the branch's evidence in
  `docs/verification.md`), with a short sprint + short renudge, once per mode:
  - `soft` — boundary and every re-nudge give a banner; the overlay never opens.
  - `hard` — the boundary itself opens the overlay; no banner.
  - `escalating` — boundary banner, first re-nudge opens the overlay.
  - **Lock:** on open, the button reads `Dismiss in 10` and counts down; button,
    Esc and backdrop clicks all do nothing until it hits `Dismiss`, then each
    works.
  - **Auto-close:** stepping away while the overlay is up closes it.
  - **DND:** with `show-banners=false`, no surface fires in any mode.
  - **Deferred apply:** changing the mode mid-sprint takes effect on the next
    sprint, not immediately.
