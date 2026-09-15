# Tomato — End-to-end verification

Verification instrument for the desktop app (`build/v2-presence`). Tomato v2 is a
**Presence Companion**: it does not enforce a timer. It watches OS input-idle,
auto-starts a "sprint" when you begin working, ends it (logging a break) when you
step away, and gently nudges when a sprint runs long. Automated checks run green in
this environment; GUI/native behavior is exercised by the manual test-drive
checklist below, on a real display. The ~2-week concept test-drive is the point of
this instrument.

## Build prerequisites

- **Linux:** `sudo apt-get install -y libxss-dev libx11-dev` is **required**. The
  `x11` crate's `build.rs` runs `pkg-config --cflags --libs xscrnsaver` even at
  `cargo check` (not just at link time), so without `xscrnsaver.pc` (from
  `libxss-dev`) even `cargo check` panics. `libx11-dev` provides `x11.pc`.
- **macOS:** the macOS idle provider ships compiled and `cfg`-gated, but on-device
  Mac verification is **deferred** — no Mac in this environment.

## Automated verification (green here)

- **Unit tests:** `pnpm test` → **121 passed** across **13 test files**, ~0.3s.
- **Type check:** `npx tsc --noEmit` → clean (exit 0).
- **`cargo check`** (in `src-tauri/`): green **only with `libxss-dev` + `libx11-dev`
  installed**. Without them it panics at the `x11` crate's build script:
  `Package 'xscrnsaver' … not found` — this is the documented build prereq above,
  not a code fault.
- **Coverage note:** the pure v2 core is unit-tested — `presence`, `events`,
  `ring`, `nudge`, `stats`, `jsonl`, `settingsForm`, `statsChart`, `onboardingSteps`
  (plus `format`, `theme`, `tokens`, `version`).

## Manual test-drive checklist (GUI / native)

Run with `pnpm tauri dev`, or launch the packaged AppImage, on a real display.
Tip: temporarily shorten sprint length / idle-reset / re-nudge in Settings (or
`~/.config/tomato/config.json`) to run a full cadence in seconds.

### Presence auto-start & idle reset
- [ ] Start typing/moving with nothing running: a sprint auto-starts once activity
  clears the idle threshold (and the noise floor — very short sprints are never
  logged).
- [ ] Tray ring begins filling green while the sprint is active.
- [ ] Step away (no input) for ≥ the idle-reset threshold: the sprint ends and the
  ring returns to idle. The idle gap becomes the **break** in Stats.
- [ ] A sprint shorter than the noise floor logs neither `sprint_started` nor
  `sprint_ended`.

### Boundary nudge & re-nudge
- [ ] When the active span reaches the sprint length, a boundary **nudge** fires
  (notification / gentle ring tint) — nothing is blocked or forced.
- [ ] Keep working past the boundary: re-nudges fire on the re-nudge cadence
  (index 1, 2, …), with the ring reflecting the over-run.
- [ ] JSONL shows, in order: `sprint_started {trigger:"activity"}` →
  `nudge {index:0}` → `nudge {index:1}` … → `sprint_ended {ended_by:"idle_reset"}`,
  with a plausible `active_s` / `over_s`.

### Pause / Resume
- [ ] Tray **Pause** stops presence tracking; an in-progress sprint ends with
  `ended_by:"paused"`, and no new sprints start while paused.
- [ ] Tray **Resume** re-enables tracking; the next activity auto-starts a sprint.

### Manual mode (honest degrade)
- [ ] On a platform where OS idle detection is unavailable (e.g. non-GNOME
  Wayland), the app surfaces **manual mode** honestly — it does not silently claim
  to be tracking presence.
- [ ] In manual mode, only explicit start/stop drives sprints (wall-time nudges
  only); there is no auto-start or idle auto-reset.

### Stats window
- [ ] Opens from the tray.
- [ ] **Active time** (today), **longest stretch**, **breaks** (count + total),
  **nudges / nudge-adherence**, and the **7-day active chart** render correctly in
  **light** and **dark**.
- [ ] Every metric matches the event log: active time = Σ `sprint_ended.active_s`;
  breaks = gaps between a `sprint_ended` and the next same-day `sprint_started`;
  nudge-adherence = fraction of boundary nudges whose sprint ended by `idle_reset`
  within the adherence window.
- [ ] Empty state shown when there is no data.

### Persistence / config round-trip
- [ ] Events append as valid JSON lines to `~/.local/share/tomato/events.jsonl`.
- [ ] A torn/partial last line does not make the log unreadable (rest still parses).
- [ ] `~/.config/tomato/config.json` round-trips on Settings save (sprint length,
  idle-reset, re-nudge, noise floor); a corrupt config falls back to defaults.
- [ ] Config changes take effect on the **next** sprint (an in-progress sprint is
  unaffected).

### Onboarding
- [ ] First run (no `onboarded` in config) shows onboarding.
- [ ] Get-started persists `onboarded: true` + durations.
- [ ] Second run goes straight to tray.

### Packaging
- [ ] The built AppImage launches to tray and runs a full presence cadence outside
  dev.

## Known limitations / notes

- This headless environment cannot exercise GUI/native behavior; hence the manual
  checklist.
- `cargo check`/`build` requires `libxss-dev` + `libx11-dev` (see Build
  prerequisites); macOS on-device verification is deferred.
- The ~2-week concept test-drive is the real evaluation this instrument enables.

## Hard-nudge overlay — manual walkthrough (2026-08-30)

GNOME/X11 (mutter), `tauri dev`, fast config (`sprint_s=60`, `renudge_every_s=60`).
Feature commits `f08c8a7..3a7b383`. Automated gate at HEAD: `npx tsc --noEmit` exit 0,
`pnpm test` 113/113, `cargo check` exit 0.

- [x] **Soft nudge (index 0):** boundary at 60s emits a `nudge index 0` event and a
  quiet desktop notification (event log confirmed; notification is the existing,
  separately-proven path).
- [x] **Hard overlay (index ≥ 1):** each re-nudge opens a full-screen overlay —
  centered card over a **translucent** dim (not solid black). *User-confirmed.*
- [x] **Full-screen coverage:** overlay sized to `primaryMonitor()` at origin covers
  the whole screen (the earlier `fullscreen:true` fell back to an 800×600 corner box
  on mutter — fixed in `3a7b383`). *User-confirmed.*
- [x] **Dismiss — button:** the Dismiss button closes the overlay. *User-confirmed.*
- [x] **Dismiss lock (10s rest period):** button + Esc dismiss immediately; clicking
  the dim is locked for 10s, then unlocks with a fade-in hint. *Implemented per user
  request (`3a7b383`); user reviewing UX — reported "running great".*
- [x] **Auto-close / reset:** with `idle_reset=60`, stepping away ended the sprint —
  `sprint_ended … ended_by:"idle_reset"` in the event log — the transition on which
  `apply()` closes the overlay. *Event-log corroborated.*
- [ ] **DND suppression (live):** not run live. Covered by code: the single
  `decideNudge(dnd) !== "notify"` gate precedes BOTH surfaces, and DND suppression of
  the soft path was proven earlier. Low-risk; a live spot-check remains optional.

### Notes
- Under Vite's polling watcher (`CHOKIDAR_USEPOLLING`, used to dodge an inotify
  `ENOSPC` on this box) the 1 Hz tick stalled once and the machine emitted catch-up
  nudges (`index 4/5/6` timestamped past `sprint_ended`). Pre-existing
  `PresenceMachine` catch-up behavior; the shell coalesces a batch to one surface, so
  it does not multiply overlays. Not introduced by this feature.
- GNOME top-bar strip may remain undimmed (a normal window can't cover the panel
  layer) — accepted.

## Nudge modes (2026-09-08)

Automated gate — **run and green** on this branch:

- [x] `pnpm test` — 12 files, 120 tests pass (9 new in `core/nudge.test.ts`:
  `chooseNudgeSurface` × 4, `isNudgeMode` × 2, `dismissLockLabel` × 3).
- [x] `npx tsc --noEmit` — clean. Caught the two `TomatoConfig` builders that
  needed the new key (`settings.ts:109`, `onboarding.ts:129`).
- [x] `cargo check` — clean.

Manual walk-through — **NOT YET RUN.** These need a live session with a short
sprint + short renudge (Sprint length 1 min, Re-nudge every 1 min) and have not
been observed by the agent. Do not treat this feature as verified until they are
checked off.

- [ ] **`soft` mode:** boundary and every re-nudge give a desktop banner; the
  overlay never opens.
- [ ] **`hard` mode:** the boundary itself opens the overlay; no banner.
- [ ] **`escalating` mode:** boundary banner, first re-nudge opens the overlay.
- [ ] **Dismiss lock (total):** on open the button reads `Dismiss in 10` and
  counts down once per second; the button, Esc, **and** a backdrop click are all
  inert until it reads `Dismiss`, after which each closes the overlay. This is
  the behavior corrected in `d3fbc97` — the previous build's button and Esc
  fired instantly, so the lock delayed nothing.
- [ ] **Auto-close:** stepping away (idle past reset) while the overlay is up
  closes it.
- [ ] **DND:** with `gsettings set org.gnome.desktop.notifications show-banners false`,
  no surface fires in any of the three modes.
- [ ] **Deferred apply:** changing the mode mid-sprint takes effect on the next
  sprint, not immediately (`applyPendingConfig()` only swaps while away/paused).
- [ ] **Settings layout:** the four rows plus the autostart toggle fit with no
  scrollbar and even margins at `SETTINGS_H = 608` (grown from 512 for the new
  stacked row; the window is sized to its card and not resizable).

### User report (2026-09-15)

Launched the 2026-09-08 AppImage built from `5f76cc8` and reported it "working
pretty good". That is a general sign-off, not a per-item result, so the boxes
above stay unchecked until the individual behaviors are confirmed.
