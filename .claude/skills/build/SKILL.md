---
name: build
description: Build Tomato's shippable Linux bundle (.AppImage + .deb) exactly the way CI does, then hand over the artifact paths. Use whenever asked to build, package, bundle, or produce a launchable/release artifact of tomato-desktop — "make a build", "build it so I can launch it", "link me the build" — and whenever /build or /powerup:build runs in this repo. This is the repo's verified build path; it outranks generic Tauri detection, whose default output directory is wrong for this project.
---

# build — Tomato desktop bundle

Mirrors the Linux leg of `.github/workflows/build.yml`. First match wins over any generic
Tauri recipe: this repo builds with an explicit `--target`, so output lands under
`target/x86_64-unknown-linux-gnu/`, **not** `target/release/bundle/`.

| Step | Command | Pass when |
| --- | --- | --- |
| 1. Gate | `pnpm test && npx tsc --noEmit` | all suites pass, no type errors |
| 2. Bundle | `pnpm tauri build --target x86_64-unknown-linux-gnu --bundles deb appimage` | log ends `Finished 2 bundles` (~3–4 min cold; use a 10-min timeout) |
| 3. Verify | `ls -lh "$B"/deb/*.deb "$B"/appimage/*.AppImage` and `file -b "$B"/appimage/*.AppImage` | both exist, non-empty; AppImage is an x86-64 ELF |
| 4. Hand over | `SendUserFile` the `.deb`; give the AppImage path in text | user has both |
| 5. Sync (optional) | `$H place <file> "$($H derive-app .)" "$($H derive-version .)" linux x64` for each bundle | prints `~/Builds/tomato/tomato-<ver>-<sha>-linux-x64.<ext>` |

`B=src-tauri/target/x86_64-unknown-linux-gnu/release/bundle`. Filenames are
`Tomato_<version>_amd64.{deb,AppImage}`; `<version>` comes from `src-tauri/tauri.conf.json`.

`H=~/.claude/plugins/cache/carmelosantana/powerup/0.1.0/skills/build-sync/assets/builds` — the
build-sync helper. Its skill points at `~/.claude/skills/build-sync/...`, which does not exist here.
Use the derived tokens as-is: they place local builds in `~/Builds/tomato/` with the commit hash in
the name. **Never pass `tomato-desktop` as the app** — that folder holds the synced v0.1.0 release
files, and the keep-2-newest prune would delete them.

## Rules

- **Launching is the user's call.** Build, verify, hand over the paths. Launch only if asked
  (`./"$B"/appimage/Tomato_*_amd64.AppImage` — Tauri emits it already executable).
- **The AppImage (~78 MB) exceeds the 30 MB `SendUserFile` limit** for phone/web viewers — it only
  reaches the desktop app. Always also print its path.
- **Build what was asked.** If the requested feature lives on an unmerged branch, say so before
  spending the build — a bundle of `main` without it is useless to launch.
- **Clear build caches only after Step 5.** `src-tauri/target` holds the only copy of the bundles
  until they're placed in `~/Builds`. Once placed, reclaim space with
  `cargo clean --manifest-path src-tauri/Cargo.toml` (and `rm -rf dist`); the next build is then cold
  (~5+ min).
- **macOS is not buildable here.** CI builds `macos-arm64` (`app dmg`) on tags and
  `workflow_dispatch` only; for a local Mac build see `docs/macos-local-build.md`.
