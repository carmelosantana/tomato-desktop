# Cross-OS CI/CD Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend `.github/workflows/build.yml` into an OS matrix that builds Linux (deb + AppImage) and macOS arm64 (`.dmg` + `.app.tar.gz`, unsigned) on every `v*` tag and attaches all of it to one GitHub Release with a Gatekeeper install note; intel64 staged as a ready-to-flip matrix entry.

**Architecture:** One `build` matrix job (per-leg `runner`/`rust_target`/`bundles`, uniform bundle paths via `--target` on every leg, vitest gate on the Linux leg only) feeding one `release` job (tag-gated) that downloads every leg's artifacts and publishes a single release via `softprops/action-gh-release`. No `tauri-action`, no signing, no `tauri.conf.json` change (the `--bundles` CLI flag overrides its targets per leg).

**Tech Stack:** GitHub Actions, Tauri v2 CLI (`pnpm tauri build`), pnpm 11 / Node 22, `dtolnay/rust-toolchain`, `swatinem/rust-cache`, `actions/upload-artifact@v4` + `download-artifact@v4`, `softprops/action-gh-release@v2`.

**Design spec:** `docs/specs/2026-08-30-ci-cross-compile-design.md`

## Global Constraints

- **Approach:** extend the hand-rolled workflow (NOT `tauri-action`). One file: `.github/workflows/build.yml`.
- **Legs (now):** `linux` (`ubuntu-latest`, `x86_64-unknown-linux-gnu`, bundles `deb appimage`) and `macos-arm64` (`macos-14`, `aarch64-apple-darwin`, bundles `app dmg`). **Staged (do not build now):** `macos-intel` (`macos-13`, `x86_64-apple-darwin`, `app dmg`) as a commented `include` entry.
- **Uniform paths:** pass `--target ${{ matrix.rust_target }}` on **every** leg → `src-tauri/target/<rust_target>/release/bundle/…`.
- **Gate on Linux leg only:** `pnpm test` + `npx tsc --noEmit` run only on `runner.os == 'Linux'`; every leg still type-checks via `tauri build`'s `beforeBuildCommand` (`pnpm build` = `tsc && vite build`).
- **macOS both formats:** `--bundles app dmg` yields `.dmg`; a `tar` step yields `Tomato_<version>_<arch>.app.tar.gz` (`arch` = `aarch64` / `x64`).
- **Unsigned:** no signing/notarization; the Gatekeeper workaround is baked into the release `body` (verbatim text in Task 1).
- **Release = tag `v*` only**, one consolidated release; `permissions: contents: read` top-level, `contents: write` on the `release` job.
- **Housekeeping:** drop the stale `build/desktop-v0.1` trigger; add a `concurrency` group; `fail-fast: false`.
- **Verification requires real CI runs** (macOS runners bill at 10× minutes) and pushing to `origin` (private repo `carmelosantana/tomato-desktop`). Branch: `ci/cross-compile`.

---

### Task 1: Author the matrix workflow + validate locally

**Files:**
- Modify (overwrite): `.github/workflows/build.yml`

**Interfaces:**
- Consumes: existing `src-tauri/tauri.conf.json` (`productName: "Tomato"`, `version`), `package.json` scripts (`test`, `tauri`, `build`).
- Produces: artifacts named `tomato-linux` / `tomato-macos-arm64`; a `release` job that consumes those. Bundle output dir per leg: `src-tauri/target/<rust_target>/release/bundle/{deb,appimage,dmg,macos}/`.

- [ ] **Step 1: Overwrite `.github/workflows/build.yml` with the matrix workflow**

Write this exact content:

```yaml
name: Build

on:
  push:
    branches: [main]
    tags: ["v*"]
  pull_request:
  workflow_dispatch:

permissions:
  contents: read

concurrency:
  group: build-${{ github.ref }}
  cancel-in-progress: true

jobs:
  build:
    name: Build (${{ matrix.name }})
    runs-on: ${{ matrix.runner }}
    strategy:
      fail-fast: false
      matrix:
        include:
          - name: linux
            runner: ubuntu-latest
            rust_target: x86_64-unknown-linux-gnu
            bundles: deb appimage
          - name: macos-arm64
            runner: macos-14
            rust_target: aarch64-apple-darwin
            bundles: app dmg
          # Staged — enable intel64 by uncommenting this leg (macOS runners bill 10x):
          # - name: macos-intel
          #   runner: macos-13
          #   rust_target: x86_64-apple-darwin
          #   bundles: app dmg

    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Install system dependencies (Linux)
        if: runner.os == 'Linux'
        run: |
          sudo apt-get update
          sudo apt-get install -y \
            libwebkit2gtk-4.1-dev \
            libayatana-appindicator3-dev \
            librsvg2-dev \
            patchelf \
            build-essential \
            curl \
            wget \
            file \
            libssl-dev \
            libgtk-3-dev

      - name: Set up pnpm
        uses: pnpm/action-setup@v4
        with:
          version: 11

      - name: Set up Node
        uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: pnpm

      - name: Set up Rust toolchain
        uses: dtolnay/rust-toolchain@stable
        with:
          targets: ${{ matrix.rust_target }}

      - name: Cache Rust build
        uses: swatinem/rust-cache@v2
        with:
          workspaces: src-tauri

      - name: Cache Tauri bundler helpers (Linux)
        if: runner.os == 'Linux'
        uses: actions/cache@v4
        with:
          path: ~/.cache/tauri
          key: ${{ runner.os }}-tauri-cache-${{ hashFiles('src-tauri/tauri.conf.json') }}
          restore-keys: |
            ${{ runner.os }}-tauri-cache-

      - name: Install dependencies
        run: pnpm install --frozen-lockfile

      - name: Test + typecheck (Linux leg only — the core is pure/OS-independent)
        if: runner.os == 'Linux'
        run: |
          pnpm test
          npx tsc --noEmit

      - name: Build Tauri bundle
        run: pnpm tauri build --target ${{ matrix.rust_target }} --bundles ${{ matrix.bundles }}

      - name: Package .app.tar.gz (macOS)
        if: runner.os == 'macOS'
        run: |
          VERSION=$(node -p "require('./src-tauri/tauri.conf.json').version")
          case "${{ matrix.rust_target }}" in
            aarch64-apple-darwin) ARCH=aarch64 ;;
            x86_64-apple-darwin)  ARCH=x64 ;;
            *) ARCH=unknown ;;
          esac
          BDIR="src-tauri/target/${{ matrix.rust_target }}/release/bundle/macos"
          tar -C "$BDIR" -czf "$BDIR/Tomato_${VERSION}_${ARCH}.app.tar.gz" "Tomato.app"

      - name: Upload Linux artifacts
        if: runner.os == 'Linux'
        uses: actions/upload-artifact@v4
        with:
          name: tomato-${{ matrix.name }}
          if-no-files-found: error
          path: |
            src-tauri/target/${{ matrix.rust_target }}/release/bundle/deb/*.deb
            src-tauri/target/${{ matrix.rust_target }}/release/bundle/appimage/*.AppImage

      - name: Upload macOS artifacts
        if: runner.os == 'macOS'
        uses: actions/upload-artifact@v4
        with:
          name: tomato-${{ matrix.name }}
          if-no-files-found: error
          path: |
            src-tauri/target/${{ matrix.rust_target }}/release/bundle/dmg/*.dmg
            src-tauri/target/${{ matrix.rust_target }}/release/bundle/macos/*.app.tar.gz

  release:
    name: Release
    needs: build
    runs-on: ubuntu-latest
    if: startsWith(github.ref, 'refs/tags/v')
    permissions:
      contents: write

    steps:
      - name: Download all artifacts
        uses: actions/download-artifact@v4
        with:
          path: dist

      - name: Publish GitHub Release
        uses: softprops/action-gh-release@v2
        with:
          generate_release_notes: true
          files: |
            dist/**/*.deb
            dist/**/*.AppImage
            dist/**/*.dmg
            dist/**/*.app.tar.gz
          body: |
            ## Install

            **Linux** — `.AppImage` (`chmod +x` and run) or `.deb` (`sudo apt install ./Tomato_*.deb`).

            **macOS** — this build is **not signed** (no Apple Developer account), so
            macOS Gatekeeper blocks the first launch. Pick your chip:

            - Apple Silicon (M1/M2/M3…): `*_aarch64.dmg` (or `*_aarch64.app.tar.gz`)
            - Intel: `*_x64.dmg` (or `*_x64.app.tar.gz`) — available once the intel leg is enabled

            Move **Tomato.app** to `/Applications`, then run once:

            ```
            xattr -cr /Applications/Tomato.app
            ```

            and open it normally. (Equivalent: right-click Tomato.app → **Open** → **Open**.)
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

- [ ] **Step 2: Validate the YAML locally**

Run (prefers `actionlint` if present, always does a YAML parse):
```bash
cd ~/Projects/Tomato/tomato-desktop
command -v actionlint >/dev/null && actionlint .github/workflows/build.yml || echo "actionlint not installed — skipping lint"
python3 -c "import yaml; yaml.safe_load(open('.github/workflows/build.yml')); print('YAML OK')"
```
Expected: `YAML OK` (and, if `actionlint` is installed, no errors).

- [ ] **Step 3: Sanity-check the matrix and gate structure**

Run:
```bash
cd ~/Projects/Tomato/tomato-desktop
python3 - <<'PY'
import yaml
w = yaml.safe_load(open('.github/workflows/build.yml'))
legs = [m['name'] for m in w['jobs']['build']['strategy']['matrix']['include']]
assert legs == ['linux', 'macos-arm64'], legs          # intel stays commented
assert w['jobs']['release']['if'].startswith("startsWith(github.ref, 'refs/tags/v')")
assert w['concurrency']['cancel-in-progress'] is True
print('matrix legs:', legs, '| release gated on tag | concurrency on — OK')
PY
```
Expected: `matrix legs: ['linux', 'macos-arm64'] | release gated on tag | concurrency on — OK`

- [ ] **Step 4: Commit**

```bash
cd ~/Projects/Tomato/tomato-desktop
git add .github/workflows/build.yml
git commit -m "ci: cross-OS matrix build (linux + macOS arm64, unsigned) + consolidated release"
```

---

### Task 2: Verify a real `workflow_dispatch` run (build legs green)

No code — verifies the enabled legs actually build and upload on GitHub. Consumes CI minutes (macOS ≈ 10×).

**Files:** none.

- [ ] **Step 1: Push the branch**

```bash
cd ~/Projects/Tomato/tomato-desktop
git push -u origin ci/cross-compile
```
Expected: branch pushed to `carmelosantana/tomato-desktop`.

- [ ] **Step 2: Trigger the workflow on this branch**

```bash
cd ~/Projects/Tomato/tomato-desktop
gh workflow run build.yml --ref ci/cross-compile
sleep 5
gh run list --workflow build.yml --branch ci/cross-compile --limit 1
```
Expected: a run is queued/in-progress for `ci/cross-compile`.

- [ ] **Step 3: Watch it to completion**

```bash
cd ~/Projects/Tomato/tomato-desktop
RID=$(gh run list --workflow build.yml --branch ci/cross-compile --limit 1 --json databaseId -q '.[0].databaseId')
gh run watch "$RID" --exit-status
```
Expected: exit 0 — both `Build (linux)` and `Build (macos-arm64)` jobs succeed. The `Release` job is **skipped** (not a tag). If a leg fails, read `gh run view "$RID" --log-failed`, fix `build.yml` (amend Task 1), re-validate (Task 1 Steps 2–3), recommit, and re-run this task.

- [ ] **Step 4: Confirm artifacts uploaded**

```bash
cd ~/Projects/Tomato/tomato-desktop
RID=$(gh run list --workflow build.yml --branch ci/cross-compile --limit 1 --json databaseId -q '.[0].databaseId')
gh run view "$RID" --json jobs -q '.jobs[].name'
gh api "repos/carmelosantana/tomato-desktop/actions/runs/$RID/artifacts" -q '.artifacts[].name'
```
Expected: artifact names include `tomato-linux` and `tomato-macos-arm64`.

---

### Task 3: Verify the release path with a throwaway pre-release tag

No code — proves the tag-gated `release` job consolidates all assets with the Gatekeeper note, then cleans up. `v0.1.0-ci-test` is a **pre-release** marker so it never looks like a real release.

**Files:** none.

- [ ] **Step 1: Create + push a throwaway tag**

```bash
cd ~/Projects/Tomato/tomato-desktop
git tag v0.1.0-ci-test
git push origin v0.1.0-ci-test
```
Expected: tag pushed; a new `Build` run starts for the tag ref.

- [ ] **Step 2: Watch the tag run (build + release) to completion**

```bash
cd ~/Projects/Tomato/tomato-desktop
sleep 5
RID=$(gh run list --workflow build.yml --branch v0.1.0-ci-test --limit 1 --json databaseId -q '.[0].databaseId')
gh run watch "$RID" --exit-status
```
Expected: exit 0 — build legs succeed **and** the `Release` job runs (tag ref).

- [ ] **Step 3: Confirm the consolidated release + assets + note**

```bash
cd ~/Projects/Tomato/tomato-desktop
gh release view v0.1.0-ci-test --json assets,body -q '.assets[].name'
gh release view v0.1.0-ci-test --json body -q '.body' | head -20
```
Expected: assets include a `.deb`, an `.AppImage`, a `*_aarch64.dmg`, and a `*_aarch64.app.tar.gz`; the body begins with the `## Install` Gatekeeper block, followed by auto-generated notes.

- [ ] **Step 4: Clean up the throwaway release + tag**

```bash
cd ~/Projects/Tomato/tomato-desktop
gh release delete v0.1.0-ci-test --yes --cleanup-tag
git tag -d v0.1.0-ci-test
git fetch --prune origin
```
Expected: the test release and its tag (local + remote) are gone.

- [ ] **Step 5: Record verification evidence**

Append a dated entry to `docs/verification.md` noting: dispatch run green (linux + macos-arm64), artifacts uploaded, tag run produced one consolidated release with all four asset types + the Gatekeeper note, and cleanup done — with the workflow commit SHA. Commit:
```bash
cd ~/Projects/Tomato/tomato-desktop
git add docs/verification.md
git commit -m "docs(verify): cross-OS CI dispatch + throwaway-tag release proven"
```

---

## Notes for the implementer

- **Do not enable the intel leg** — it stays commented. Enabling later is uncommenting the `include` entry; no other change needed (the `--target`, tar `ARCH=x64`, and `*_x64.*` note already handle it).
- **`--bundles app dmg`**: `app` yields `Tomato.app` (tarred in the macOS step), `dmg` yields `Tomato_<version>_<arch>.dmg`. The CLI flag overrides `tauri.conf.json`'s `bundle.targets`; leave the conf file unchanged.
- **`softprops` `body` + `generate_release_notes`**: the `body` is *pre-pended* to the auto-generated notes, so the Gatekeeper block appears first.
- **If macOS bundle paths differ** (a Tauri version rename of the `macos`/`dmg` dirs), read the failing run's log and adjust the globs in Task 1's two upload steps + the tar `BDIR`; keep `--target` so the parent path stays `target/<rust_target>/release/bundle/`.
- **Cost:** Tasks 2 and 3 each spend macOS runner minutes (10×). Run Task 3 once; delete the throwaway release promptly (Step 4).
