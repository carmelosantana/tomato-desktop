# Tomato — End-to-end verification

Verification instrument for the desktop app (`build/desktop-v0.1`). Automated checks
run green in this environment; GUI/native behavior is exercised by the manual
test-drive checklist below, on a real display. The ~2-week concept test-drive is the
point of this instrument.

## Automated verification (green here)

- **Unit tests:** `pnpm test` → **101 passed** across **13 test files**, ~0.3s.
- **Type check:** `npx tsc --noEmit` → clean (exit 0).
- **Build artifacts** (from Task 14, `pnpm tauri build`):
  - `src-tauri/target/release/bundle/deb/Tomato_0.1.0_amd64.deb` — ~4.9M
  - `src-tauri/target/release/bundle/appimage/Tomato_0.1.0_amd64.AppImage` — ~77M
  - Rebuild only if needed (slow): `pnpm tauri build`.
- **Coverage note:** the pure Spec-1 core is unit-tested — `timer`, `events`,
  `ring`, `nudge`, `stats`, `jsonl`, `settingsForm`, `statsChart`, `onboardingSteps`
  (plus `format`, `theme`, `tokens`, `version`).

## Manual test-drive checklist (GUI / native)

Run with `pnpm tauri dev`, or launch the packaged AppImage, on a real display.
Tip: temporarily shorten sprint/break/grace in Settings (or `~/.config/tomato/config.json`)
to run a full cadence in seconds.

### Persistence
- [ ] Two events append as valid JSON lines to `~/.local/share/tomato/events.jsonl`.
- [ ] `~/.config/tomato/config.json` round-trips on Settings save.
- [ ] A torn/partial last line does not make the log unreadable (rest still parses).
- [ ] Corrupt config falls back to defaults.

### Tray + loop
- [ ] Tray shows the ring.
- [ ] Ring fills and re-tints: green → amber (grace) → (break static) → idle.
- [ ] Start / Stop / Quit menu items work.
- [ ] Stats… and Settings… open their windows.

### Cadence (enforced mode)
- [ ] At boundary the ring goes amber + grace toast: "Wrap up — break in M:SS".
- [ ] Break-now starts the break immediately.
- [ ] Otherwise the break card counts down; Skip ends it.
- [ ] On break completion, returns to idle (no auto-chain).
- [ ] JSONL shows, in order: `sprint_started` → `boundary_reached` →
  `grace_started` → `grace_ended` → `break_started` → `break_completed` →
  `sprint_ended`, with correct `over_run_s`.

### DND
- [ ] GNOME Do-Not-Disturb ON: enforced break degrades to an OS notification (card suppressed).
- [ ] DND state unknown: a quiet card (no focus steal / no sound).
- [ ] Soft mode: notification only, no card, at boundary.

### Cold-idle (early grace)
- [ ] A fresh Start after >30 min idle emits `grace_started` with
  `grace_s == early_grace_s`.

### Stats window
- [ ] Opens from tray.
- [ ] Today's sprints, breaks-taken-vs-skipped, over-run, streak, timeline, and
  7-day chart render correctly in **light** and **dark**.
- [ ] Numbers match the event log.
- [ ] Empty state shown when there is no data.

### Settings
- [ ] Opens.
- [ ] Changing sprint/break/grace (minutes) + mode + Save persists to `config.json`.
- [ ] The NEXT sprint uses the new values (an in-progress sprint is unaffected).
- [ ] Autostart toggle creates/removes the login entry and reflects real state on reopen.

### Onboarding
- [ ] First run (no `onboarded` in config) shows onboarding.
- [ ] Get-started persists `onboarded: true` + durations.
- [ ] Second run goes straight to tray.

### Packaging
- [ ] The built AppImage launches to tray and runs a full cadence outside dev.

## Known limitations / notes

- This headless environment cannot exercise GUI/native behavior; hence the manual checklist.
- CI (`.github/workflows`) has never executed — it is local-only and runs once a
  remote exists.
- The ~2-week concept test-drive is the real evaluation this instrument enables.
