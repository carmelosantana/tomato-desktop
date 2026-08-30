# macOS local build — hand-off brief

**For:** a Claude Code (or human) agent running on a **local macOS machine**
(Apple Silicon or Intel). This box is **not** for building — it produces the
unsigned macOS bundles that CI also produces, but locally, without spending
runner minutes.

**Repo:** `git@github.com:carmelosantana/tomato-desktop.git` (private).
**What you're building:** the Tomato desktop app (Tauri v2 tray app) — a `.dmg`
and a `Tomato.app`, plus an optional `.app.tar.gz`, matching CI's macOS output.

Builds are **unsigned** (no Apple Developer account). That's expected; the
Gatekeeper workaround is documented at the end.

---

## 0. One-time prerequisites

```bash
# Xcode command-line tools (compiler + headers)
xcode-select --install    # skip if `xcode-select -p` already prints a path

# Rust (stable toolchain)
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
source "$HOME/.cargo/env"

# Node 22 + pnpm 11 (via corepack, no global install needed)
#   - if you use nvm/fnm/asdf, select Node 22 there instead
corepack enable
corepack prepare pnpm@11 --activate
```

Verify:

```bash
rustc --version && node --version && pnpm --version   # expect rust stable, v22.x, 11.x
```

## 1. Clone and pick the ref

```bash
git clone git@github.com:carmelosantana/tomato-desktop.git
cd tomato-desktop
# Build from main once the CI PR is merged; before that, use the branch:
git checkout main            # or: git checkout ci/cross-compile   (or a vX.Y.Z tag)
```

## 2. Detect your arch (sets the Rust target + output names)

```bash
if [ "$(uname -m)" = "arm64" ]; then
  RUST_TARGET=aarch64-apple-darwin;  ARCH=aarch64
else
  RUST_TARGET=x86_64-apple-darwin;   ARCH=x64
fi
rustup target add "$RUST_TARGET"     # no-op if already installed
echo "Building for $RUST_TARGET (arch label: $ARCH)"
```

## 3. Install deps and build (mirrors CI exactly)

```bash
pnpm install --frozen-lockfile
pnpm tauri build --target "$RUST_TARGET" --bundles app dmg
```

`pnpm install` runs `tsc && vite build` via Tauri's `beforeBuildCommand`, so a
type error fails the build here too. (Optional pre-check: `pnpm test` — 124
pure-core tests, OS-independent.)

## 4. Collect the outputs

```bash
BDIR="src-tauri/target/$RUST_TARGET/release/bundle"
VERSION=$(node -p "require('./src-tauri/tauri.conf.json').version")

ls -lh "$BDIR/dmg/"     # Tomato_${VERSION}_${ARCH}.dmg
ls -lh "$BDIR/macos/"   # Tomato.app  (the runnable bundle)

# Optional: the same .app.tar.gz artifact CI attaches to releases
tar -C "$BDIR/macos" -czf "$BDIR/macos/Tomato_${VERSION}_${ARCH}.app.tar.gz" "Tomato.app"
ls -lh "$BDIR/macos/Tomato_${VERSION}_${ARCH}.app.tar.gz"
```

## 5. Run it (unsigned → clear the quarantine flag once)

```bash
xattr -cr "$BDIR/macos/Tomato.app"
open "$BDIR/macos/Tomato.app"
```

If installing the `.dmg` instead: drag **Tomato.app** to `/Applications`, then
`xattr -cr /Applications/Tomato.app` before first launch (or right-click →
**Open** → **Open**).

---

## Notes / gotchas

- **Intel `.dmg` name is unverified.** Only the `aarch64` dmg has been produced
  so far. On an Intel Mac, confirm Tauri actually names it `Tomato_<v>_x64.dmg`
  (not `_x86_64`); if it differs, adjust the `ARCH`/filename references above.
- **`--bundles app dmg`** overrides `tauri.conf.json`'s bundle targets (which are
  Linux-oriented); no config edit needed. The `--target` flag makes the bundle
  path predictable: `src-tauri/target/<RUST_TARGET>/release/bundle/…`.
- **This is a fresh install on pnpm v11**, which honors `allowBuilds` in
  `pnpm-workspace.yaml` (esbuild's build script). If you see
  `ERR_PNPM_IGNORED_BUILDS`, you're on an old commit predating that fix — update.
- **The app is a tray/menubar app**; after launch look for the tomato icon in the
  menu bar, not a dock window.
- To match a specific release, `git checkout vX.Y.Z` before step 2 — the bundle
  version comes from `src-tauri/tauri.conf.json`, so it'll match the tag if the
  tree does.
