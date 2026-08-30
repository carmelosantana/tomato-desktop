# Tomato — Cross-OS CI/CD (Linux + macOS, unsigned)

**Status:** Design approved (brainstorm) — 2026-08-30
**Scope:** One self-contained subsystem — extend `.github/workflows/build.yml`.
**Related, separate:** the `add-to-builds` pull-mirror skill (GitHub Releases →
`~/Builds` via Syncthing) is brainstormed on its own after this.

## Problem / goal

`build.yml` today builds and releases **Linux only** (deb + AppImage, tag `v*` →
GitHub Release via `softprops/action-gh-release`). We want the same tag to also
produce **macOS** builds — **arm64 now, intel64 staged for later** — attached to
the **same** release. Builds are **unsigned** (no Apple Developer account), so the
release notes carry the Gatekeeper workaround. **GitHub Releases is the canonical
build store** (a later skill mirrors it into `~/Builds`).

## Approach (decided)

**Extend the existing hand-rolled workflow into an OS matrix** (not `tauri-action`).
Rationale: keep the working, transparent Linux pipeline and the house style; no new
third-party action in the supply chain; "both macOS formats" needs a manual `tar`
step regardless, which erases most of the action's convenience. Release
consolidation across the matrix is standard `upload-artifact` → `download-artifact`
plumbing.

## Architecture

Two jobs in `.github/workflows/build.yml`:

### `build` job — `strategy.matrix.include`
One skeleton, per-leg values:

| leg (`name`) | `runner` | `rust_target` | `bundles` | phase |
|---|---|---|---|---|
| `linux` | `ubuntu-latest` | `x86_64-unknown-linux-gnu` | `deb appimage` | **now** |
| `macos-arm64` | `macos-14` | `aarch64-apple-darwin` | `app dmg` | **now** |
| `macos-intel` | `macos-13` | `x86_64-apple-darwin` | `app dmg` | **staged** (commented `include` entry + note; flip on later) |

Steps (guards via `matrix` / `runner.os`):
1. `actions/checkout@v4`.
2. **Linux only** — apt system deps (existing list: `libwebkit2gtk-4.1-dev`,
   `libayatana-appindicator3-dev`, `librsvg2-dev`, `patchelf`, `build-essential`,
   `curl`, `wget`, `file`, `libssl-dev`, `libgtk-3-dev`).
3. `pnpm/action-setup@v4` (v11); `actions/setup-node@v4` (node 22, `cache: pnpm`).
4. `dtolnay/rust-toolchain@stable` **with `targets: ${{ matrix.rust_target }}`** so
   the intel leg cross-compiles without an extra `rustup target add`.
5. `swatinem/rust-cache@v2` (`workspaces: src-tauri`) — keys already include the
   runner OS, so each leg caches independently.
6. **Linux only** — cache `~/.cache/tauri` (AppImage `linuxdeploy` helpers).
7. `pnpm install --frozen-lockfile`.
8. **Linux only** — the gate: `pnpm test` (vitest is pure/OS-independent, so it runs
   once here). `tsc` needs no separate step — `tauri build`'s `beforeDevCommand`
   equivalent `beforeBuildCommand` (`pnpm build` = `tsc && vite build`) runs on every
   leg, so a type error still fails every OS.
9. **Build:** `pnpm tauri build --target ${{ matrix.rust_target }} --bundles ${{ matrix.bundles }}`.
   `--target` on **every** leg makes bundle paths uniform:
   `src-tauri/target/<rust_target>/release/bundle/…`. `--bundles` overrides
   `tauri.conf.json`'s `bundle.targets` (which stays Linux-oriented; the CLI flag
   wins), so no conf change is required.
10. **macOS only** — `.app.tar.gz` step (the "both" second format):
    `tar czf "Tomato_${VERSION}_${ARCH}.app.tar.gz" -C src-tauri/target/<rust_target>/release/bundle/macos "Tomato.app"`
    (`ARCH` = `aarch64` / `x64`; `VERSION` read from `tauri.conf.json`).
11. `actions/upload-artifact@v4` per leg (`name: tomato-${{ matrix.name }}`), globbing
    that leg's bundle dir plus the `.app.tar.gz` on macOS; `if-no-files-found: error`.

### `release` job — tag `v*` only
`needs: build`, `if: startsWith(github.ref, 'refs/tags/v')`,
`permissions: contents: write`.
1. `actions/download-artifact@v4` with **no `name`** → pulls every leg's artifacts
   into one dir.
2. `softprops/action-gh-release@v2`:
   - `files:` all assets — `*.deb`, `*.AppImage`, `*.dmg`, `*.app.tar.gz`.
   - `body:` the **Gatekeeper block** (below), then `generate_release_notes: true`
     for auto commit/PR notes.
   - `env: GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}`.

### Gatekeeper release-note block (baked into `body`)
```
## Install

**Linux** — `.AppImage` (chmod +x and run) or `.deb` (`sudo apt install ./Tomato_*.deb`).

**macOS** — this build is **not signed** (no Apple Developer account), so Gatekeeper
blocks the first launch. Pick your chip:
- Apple Silicon (M1/M2/M3…): `*_aarch64.dmg` (or `_aarch64.app.tar.gz`)
- Intel: `*_x64.dmg` (or `_x64.app.tar.gz`)  ← available once the intel leg is enabled

Move **Tomato.app** to `/Applications`, then run once:

    xattr -cr /Applications/Tomato.app

and open it normally. (Equivalent: right-click Tomato.app → **Open** → **Open**.)
```

## Triggers & housekeeping
- Triggers: `push: { branches: [main], tags: ["v*"] }`, `pull_request`,
  `workflow_dispatch`. **Drop** the stale `build/desktop-v0.1` branch trigger.
- Add a `concurrency` group (`group: build-${{ github.ref }}`, `cancel-in-progress: true`)
  to cancel superseded runs.
- `permissions: contents: read` at top; the `release` job elevates to
  `contents: write` locally.

## Version convention (documented, not enforced)
Release = bump `src-tauri/tauri.conf.json` **and** `src-tauri/Cargo.toml` to `X.Y.Z`,
commit, `git tag vX.Y.Z`, `git push --tags`. CI builds all legs and publishes one
release. (An optional "tag == config version" guard step is deferred — YAGNI.)

## Non-goals
- **No signing / notarization** (no Apple account) — unsigned by design; Gatekeeper
  handled by the note, not CI.
- **No Tauri updater** artifacts/signing key in this pass.
- **No Windows** leg.
- **No `~/Builds` mirroring** here — that's the separate `add-to-builds` skill;
  this subsystem's only output contract is "assets on the GitHub Release."
- **intel64 not built now** — staged as a ready-to-flip matrix entry.

## Verification
- `workflow_dispatch` run on the branch: all enabled legs build; artifacts upload.
- A throwaway pre-release tag (e.g. `v0.1.0-ci-test`) on the branch produces one
  GitHub Release carrying linux `.deb`/`.AppImage` + macOS `.dmg`/`.app.tar.gz`
  (arm64), with the Gatekeeper note in the body; then delete the test release/tag.
- Confirm a downloaded arm64 `.app.tar.gz` unpacks to a launchable `Tomato.app` on
  Apple Silicon (manual, on-device — deferred if no Mac at hand; note it).
