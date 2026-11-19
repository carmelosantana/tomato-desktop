# Tomato

A gentle, presence-aware focus companion that lives in your system tray. Tomato
notices when you've been at the keyboard for a while and nudges you to step away.
It doesn't make you start or stop a timer, force a break, or lock your screen.

Built with **Tauri v2**: a TypeScript frontend and a thin Rust shell. Runs on Linux
and macOS.

## How it works

- **Presence, not timers.** Tomato reads how long it's been since your last
  keyboard or mouse input from the OS. A focus sprint starts when you're active
  and ends on its own when you've been idle past the reset threshold (5 minutes
  by default).
- **Nudges.** At the sprint boundary (15 minutes by default) Tomato nudges you,
  then repeats on a cadence. There are three modes:
  - **soft:** a desktop notification.
  - **hard:** a full-screen overlay. You can dismiss it after a 10-second rest.
  - **escalating:** soft first, then hard if you keep going.
- **Dismiss & reset.** Dismiss the overlay, or use **Reset timer** in the tray, to
  end the sprint and start fresh.
- **Game-aware.** While a Steam game is running, nudges stay a quiet
  notification instead of covering the game.
- **Tray ring.** The tray icon fills as the sprint progresses and pulses red when
  you've gone past the boundary.
- **Offline and local.** Tomato makes no network calls and has no account. Your
  settings and an append-only log of sprints stay in your user config and data
  folders, and a stats window summarizes them.

## Install

Download the latest `.deb`, `.AppImage` or `.dmg` from
[Releases](https://github.com/carmelosantana/tomato-desktop/releases), or from
[carmelosantana.com/tomato](https://carmelosantana.com/tomato).

The macOS builds aren't signed. After dragging Tomato to Applications, run
`xattr -cr /Applications/Tomato.app` before the first launch (or right-click the
app and choose **Open**).

## Build

You need Node 22+, pnpm 11, and a Rust toolchain. On Debian or Ubuntu, also install
the Tauri system libraries:

```bash
sudo apt-get install -y libwebkit2gtk-4.1-dev libayatana-appindicator3-dev \
  librsvg2-dev patchelf build-essential libssl-dev libgtk-3-dev
```

Then install dependencies and run the app:

```bash
pnpm install
pnpm tauri dev        # run in development
pnpm test             # unit tests (pure core)
pnpm tauri build      # release bundles
```

Run the Rust tests with `cargo test --manifest-path src-tauri/Cargo.toml`.

GitHub Actions builds the Linux and macOS bundles on every `v*` tag and attaches
them to a release. See [`docs/macos-local-build.md`](docs/macos-local-build.md) to
build the macOS bundles on a local Mac.

## Layout

- `src/core/` — pure, unit-tested logic: the presence state machine, nudge
  policy, the tray ring, and stats.
- `src/native/` — wrappers around the Tauri commands.
- `src/*.html` / `src/*.ts` — the onboarding, settings, stats and nudge-overlay
  windows, plus the hidden main loop (`main.ts`).
- `src-tauri/` — the Rust shell: idle sampling, game detection, the tray, and
  autostart.
- `docs/design/` — the brand kit (tokens, tray and app icons, UI icons, mockups).

## License

Copyright (C) 2026 Carmelo Santana.

Tomato is free software. You can redistribute it and/or modify it under the terms of
the GNU General Public License, version 3 or (at your option) any later version.
See [`LICENSE`](LICENSE).

The bundled fonts (Hanken Grotesk and IBM Plex Mono) are under the SIL Open Font
License 1.1, with their license texts in [`src/assets/fonts/`](src/assets/fonts/).
Third-party dependencies carry their own licenses.
