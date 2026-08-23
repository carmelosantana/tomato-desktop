# Tomato (desktop)

The agentic Pomodoro timer — a standalone, offline **Tauri v2** menu-bar app.
15-minute focus sprints with a grace window and a real break, on the bet that
your AI agents keep working while you step away, so the break is guilt-free.

Conforms to **Spec 1 — The Agentic 15-Minute Window** (see
[`../tomato-protocol`](../tomato-protocol) and
[`app-linux-design.md`](../tomato-protocol/app-linux-design.md)).

- **Platform:** Linux first (macOS-ready code; verified on Linux).
- **Stack:** Tauri v2, TypeScript frontend, thin Rust shell.
- **Offline:** no network, no Kanboard. Session events are written to a local
  append-only JSONL log.

## Layout

- `docs/design/` — the delivered brand kit (tokens, tray/app icons, UI icons,
  mockups). `docs/design/tomato-tokens.json` (+ `.css`) is the source of truth for
  design tokens.
- `docs/plans/` — implementation plan(s).
- `src/` — TypeScript frontend (pure core + UI). *(scaffolded during the build)*
- `src-tauri/` — Rust shell. *(scaffolded during the build)*

## Build

- **Local:** `pnpm install` then `pnpm tauri dev` (dev) / `pnpm tauri build`
  (release). *(exact steps land with the implementation plan)*
- **CI/CD:** GitHub Actions workflows build release artifacts. Workflow files are
  committed but only run once a remote is created (repo is local-only for now).

## License

**TBD.** Visibility/licensing (public / private / hybrid, possibly paid) is
undecided; no open-source license is granted yet. See [`LICENSE`](LICENSE).
