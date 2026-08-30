# Hard-Nudge Overlay Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Escalate a missed soft nudge to a hard on-screen overlay — nudge #1 (boundary) stays a soft desktop notification; nudge #2+ (each re-nudge) opens a centered card over a dimmed backdrop.

**Architecture:** The pure `PresenceMachine` is untouched — it already emits `nudge {ts, sprint_id, active_s, index}`. Soft-vs-hard is a new PURE decision (`escalateNudge`, unit-tested) composed with the existing DND gate (`decideNudge`) inside the impure shell (`main.ts`). The overlay is a runtime-created transparent full-screen Tauri window (like stats/settings/onboarding), Dismiss-only, that `main.ts` auto-closes when the sprint leaves `active`.

**Tech Stack:** Tauri v2 (TS frontend + thin Rust), Vitest, existing design tokens (`src/styles/tokens.css`, `fonts.css`).

**Design spec:** `docs/specs/2026-08-30-hard-nudge-overlay-design.md`

## Global Constraints

- **No change to the PresenceMachine or the event vocabulary.** Soft/hard is a reaction to the existing `nudge.index`, decided in the shell. No new persisted event, no `kind` field.
- **Units:** the machine works in **milliseconds**; config/events are seconds. `nudge.activeMs` is ms.
- **Escalation rule (fixed):** highest nudge index in a batch — `index 0` → soft, `index ≥ 1` → hard. At most ONE surface per batch.
- **DND gates BOTH surfaces.** If `decideNudge(dnd) !== "notify"` (GNOME `show-banners=false`), neither the notification nor the overlay fires. Single DND check, as today.
- **Overlay is Dismiss-only**, never locks input, never forces a break; auto-closes on step-away, reappears on the next re-nudge.
- **No new Settings.** Escalation is fixed.
- **Patterns to follow:** runtime child windows created via `WebviewWindow` with a single-instance ref + `tauri://destroyed` clearing it (see `openStats`/`openSettings` in `src/main.ts`); each child window has its own `src-tauri/capabilities/<name>-window.json`; child HTML links `styles/fonts.css` + `styles/tokens.css` and paints a themed `html{background}` on first frame; child windows close themselves with `getCurrentWindow().close()`.
- **Verification gate:** `pnpm test` + `npx tsc --noEmit` + `cargo check` green, plus the manual walkthrough in Task 4.

---

### Task 1: `escalateNudge` — the pure soft/hard decision

**Files:**
- Modify: `src/core/nudge.ts` (append one function)
- Test: `src/core/nudge.test.ts` (append a `describe` block)

**Interfaces:**
- Consumes: nothing.
- Produces: `escalateNudge(maxIndex: number): "soft" | "hard"` — used by `main.ts` `react()` in Task 3.

- [ ] **Step 1: Write the failing test**

Append to `src/core/nudge.test.ts`:

```ts
describe("escalateNudge", () => {
  it("the boundary nudge (index 0) is soft", () => {
    expect(escalateNudge(0)).toBe("soft");
  });

  it("every re-nudge (index >= 1) is hard", () => {
    expect(escalateNudge(1)).toBe("hard");
    expect(escalateNudge(2)).toBe("hard");
    expect(escalateNudge(10)).toBe("hard");
  });
});
```

Ensure the test file imports it — update the existing import at the top of `src/core/nudge.test.ts` to include `escalateNudge` (e.g. `import { decideNudge, escalateNudge } from "./nudge";`). If the current test imports symbols differently, just add `escalateNudge` to the existing import from `"./nudge"`.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd ~/Projects/Tomato/tomato-desktop && pnpm test -- nudge`
Expected: FAIL — `escalateNudge is not a function` / import error.

- [ ] **Step 3: Write minimal implementation**

Append to `src/core/nudge.ts`:

```ts
/**
 * Which nudge surface a batch warrants, by its HIGHEST nudge index.
 *  - index 0 (the sprint boundary) → "soft" (a quiet desktop notification).
 *  - index >= 1 (any re-nudge) → "hard" (the on-screen overlay).
 * Pure and total; the DND gate (decideNudge) is applied separately by the shell.
 */
export function escalateNudge(maxIndex: number): "soft" | "hard" {
  return maxIndex >= 1 ? "hard" : "soft";
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd ~/Projects/Tomato/tomato-desktop && pnpm test -- nudge && npx tsc --noEmit`
Expected: PASS (all nudge tests) and tsc exit 0.

- [ ] **Step 5: Commit**

```bash
cd ~/Projects/Tomato/tomato-desktop
git add src/core/nudge.ts src/core/nudge.test.ts
git commit -m "feat(nudge): escalateNudge — index 0 soft, index >=1 hard"
```

---

### Task 2: The hard-nudge overlay window

Delivers a working, standalone overlay window (renders + dismisses) — not yet wired to nudges. Verified by loading it in the Vite dev server and by the build.

**Files:**
- Create: `src/nudge-overlay.html`
- Create: `src/nudge-overlay.ts`
- Create: `src-tauri/capabilities/nudge-overlay-window.json`
- Modify: `vite.config.ts` (add the HTML entry to `rollupOptions.input`)

**Interfaces:**
- Consumes: nothing (reads its own `?focused=<seconds>` query param).
- Produces: a window with label `"nudge-overlay"` and URL `src/nudge-overlay.html`, opened by `main.ts` in Task 3. Dismisses via button / Esc / backdrop click by calling `getCurrentWindow().close()`.

- [ ] **Step 1: Create the overlay HTML**

Create `src/nudge-overlay.html`:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Tomato — step away</title>
    <link rel="stylesheet" href="styles/fonts.css" />
    <link rel="stylesheet" href="styles/tokens.css" />
    <style>
      /* Transparent window ground so only the dim + card paint. */
      html,
      body {
        margin: 0;
        padding: 0;
        background: transparent;
      }
      *,
      *::before,
      *::after {
        box-sizing: border-box;
      }
      body {
        color: var(--text);
        font-family: var(--font-body);
        -webkit-font-smoothing: antialiased;
        overflow: hidden;
        user-select: none;
      }
      /* Full-screen dim backdrop; clicking it (not the card) dismisses. */
      .backdrop {
        position: fixed;
        inset: 0;
        display: flex;
        align-items: center;
        justify-content: center;
        background: rgba(20, 15, 10, 0.42);
        animation: fade-in var(--duration-toast-in, 160ms) var(--ease-out, ease);
      }
      .card {
        width: 380px;
        max-width: calc(100vw - 48px);
        background: var(--surface);
        border: 1px solid var(--border);
        border-top: 4px solid var(--overrun);
        border-radius: var(--radius-md, 12px);
        box-shadow: var(--shadow-card, 0 12px 30px rgba(40, 30, 20, 0.25));
        padding: 26px 26px 22px;
        text-align: center;
        animation: card-in var(--duration-toast-in, 160ms) var(--ease-out, ease);
      }
      .mark {
        font-size: 40px;
        line-height: 1;
        margin-bottom: 12px;
      }
      .title {
        font-size: 18px;
        font-weight: 700;
        color: var(--text);
      }
      .line {
        font-size: 13.5px;
        color: var(--muted);
        margin-top: 6px;
      }
      .dismiss {
        margin-top: 20px;
        font-family: var(--font-body);
        font-size: 13.5px;
        font-weight: 600;
        color: #fff;
        background: var(--overrun);
        border: none;
        border-radius: 8px;
        padding: 10px 22px;
        cursor: pointer;
      }
      .dismiss:hover {
        filter: brightness(1.05);
      }
      @keyframes fade-in {
        from {
          opacity: 0;
        }
        to {
          opacity: 1;
        }
      }
      @keyframes card-in {
        from {
          opacity: 0;
          transform: translateY(10px) scale(0.98);
        }
        to {
          opacity: 1;
          transform: none;
        }
      }
    </style>
  </head>
  <body>
    <div class="backdrop" id="backdrop">
      <div class="card" id="card">
        <div class="mark">🍅</div>
        <div class="title">Time to step away</div>
        <div class="line" id="nudge-line">Take a short break.</div>
        <button class="dismiss" id="dismiss" type="button">Dismiss</button>
      </div>
    </div>
    <script type="module" src="nudge-overlay.ts"></script>
  </body>
</html>
```

- [ ] **Step 2: Create the overlay script**

Create `src/nudge-overlay.ts`:

```ts
// Hard-nudge overlay window script — the escalation surface shown on re-nudges
// (nudge index >= 1) when the soft desktop notification is missed.
//
// IMPURE / webview-only: DOM + Tauri window API, so NOT unit-tested. The
// soft/hard decision it serves IS unit-tested in core/nudge.ts (escalateNudge).
//
// It reads how long you've been focused from its own ?focused=<seconds> query
// param and offers a single action: Dismiss (button, Esc, or clicking the dim).
// Dismiss closes the window; main.ts reopens it on the next re-nudge.
import { getCurrentWindow } from "@tauri-apps/api/window";

const focusedS = Number(new URLSearchParams(location.search).get("focused")) || 0;
const mins = Math.max(1, Math.round(focusedS / 60));
const line = document.getElementById("nudge-line");
if (line) {
  line.textContent = `You've been focused for ${mins} minute${
    mins === 1 ? "" : "s"
  } — take a short break.`;
}

function dismiss(): void {
  void getCurrentWindow().close();
}

document.getElementById("dismiss")?.addEventListener("click", dismiss);
// Clicking the dim backdrop (but not the card) dismisses.
document.getElementById("backdrop")?.addEventListener("click", (e) => {
  if (e.target === e.currentTarget) dismiss();
});
window.addEventListener("keydown", (e) => {
  if (e.key === "Escape") dismiss();
});
```

- [ ] **Step 3: Register the window as a Vite build entry**

Modify `vite.config.ts` — add the overlay to `build.rollupOptions.input` alongside the existing entries:

```ts
      input: {
        main: resolve(root, "index.html"),
        stats: resolve(root, "src/stats.html"),
        settings: resolve(root, "src/settings.html"),
        onboarding: resolve(root, "src/onboarding.html"),
        "nudge-overlay": resolve(root, "src/nudge-overlay.html"),
      },
```

- [ ] **Step 4: Create the window capability**

Create `src-tauri/capabilities/nudge-overlay-window.json`:

```json
{
  "$schema": "../gen/schemas/desktop-schema.json",
  "identifier": "nudge-overlay-window",
  "description": "Capability for the hard-nudge overlay window: it reads a query param and closes itself. No fs, no events out.",
  "windows": ["nudge-overlay"],
  "permissions": [
    "core:default",
    "core:event:default",
    "core:window:default",
    "core:window:allow-close"
  ]
}
```

- [ ] **Step 5: Type-check, then eyeball the window in the dev server**

Run: `cd ~/Projects/Tomato/tomato-desktop && npx tsc --noEmit`
Expected: exit 0.

Then, with the Vite dev server running (`pnpm dev`), open `http://localhost:1420/src/nudge-overlay.html?focused=240` in a browser.
Expected: a centered card over a dim backdrop reading "You've been focused for 4 minutes — take a short break." with a Dismiss button. (In a plain browser the Tauri `close()` is a no-op — that's fine; this step only verifies rendering. Real dismiss is verified in Task 4.)

- [ ] **Step 6: Commit**

```bash
cd ~/Projects/Tomato/tomato-desktop
git add src/nudge-overlay.html src/nudge-overlay.ts vite.config.ts src-tauri/capabilities/nudge-overlay-window.json
git commit -m "feat(overlay): hard-nudge overlay window (dismiss-only, dimmed card)"
```

---

### Task 3: Wire soft/hard escalation into the shell

**Files:**
- Modify: `src/main.ts` (import, a new overlay-window section, `react()`, `apply()`)

**Interfaces:**
- Consumes: `escalateNudge` (Task 1); the `nudge-overlay` window (Task 2); existing `WebviewWindow`, `decideNudge`, `dndDetector`, `notify`, `machine`, `windowBg`.
- Produces: nothing downstream.

- [ ] **Step 1: Import `escalateNudge` and add the overlay label constant**

In `src/main.ts`, update the nudge import to include `escalateNudge`:

```ts
import { decideNudge, escalateNudge } from "./core/nudge";
```

Add a label constant next to the other window-label constants (near `STATS_LABEL`):

```ts
/** Hard-nudge overlay window label — must match capabilities/nudge-overlay-window.json. */
const NUDGE_OVERLAY_LABEL = "nudge-overlay";
```

- [ ] **Step 2: Add the overlay-window open/close helpers**

In `src/main.ts`, add a new section modeled on `openStats` (place it just after the stats-window section). It uses the same single-instance-ref + `tauri://destroyed` pattern:

```ts
  // --- Hard-nudge overlay -----------------------------------------------------

  // The hard-nudge overlay (null when closed). Opened on a re-nudge (index >= 1),
  // auto-closed when the sprint leaves `active` (see apply), and reopened on the
  // next re-nudge if still active.
  let nudgeOverlayWindow: WebviewWindow | null = null;

  /**
   * Open the hard-nudge overlay (or focus it if already open). Full-screen,
   * transparent, always-on-top, decorationless: a dimmed backdrop with a centered
   * card. It takes focus so Esc/click can dismiss it. `activeMs` fills the
   * "focused for N" copy via a query param.
   */
  async function openNudgeOverlay(activeMs: number): Promise<void> {
    if (nudgeOverlayWindow) {
      await nudgeOverlayWindow.show().catch(() => {});
      await nudgeOverlayWindow.setFocus().catch(() => {});
      return;
    }
    const focusedS = Math.round(activeMs / 1000);
    const win = new WebviewWindow(NUDGE_OVERLAY_LABEL, {
      url: `src/nudge-overlay.html?focused=${focusedS}`,
      fullscreen: true,
      transparent: true,
      alwaysOnTop: true,
      decorations: false,
      skipTaskbar: true,
      resizable: false,
      focus: true,
    });
    nudgeOverlayWindow = win;
    win.once("tauri://error", (e) => console.error("nudge overlay failed", e));
    win.once("tauri://destroyed", () => {
      nudgeOverlayWindow = null;
    });
  }

  /** Close the overlay if open (idempotent). */
  async function closeNudgeOverlay(): Promise<void> {
    const win = nudgeOverlayWindow;
    if (!win) return;
    nudgeOverlayWindow = null;
    await win.close().catch(() => {});
  }
```

- [ ] **Step 3: Replace `react()` with the soft/hard branch**

In `src/main.ts`, replace the entire existing `react` function with:

```ts
  // React to raw presence events. The boundary nudge (index 0) is a quiet,
  // DND-aware desktop notification (soft). Every re-nudge (index >= 1) escalates
  // to the on-screen overlay (hard) — the soft one is easy to miss.
  async function react(raw: PresenceEvent[]): Promise<void> {
    // Coalesce: a single batch may carry catch-up nudges (index 0,1,2…). Fire at
    // most ONE surface for the whole batch and check DND only once, so a burst
    // can never become a storm. The batch's HIGHEST index picks the surface.
    const nudges = raw.filter(
      (e): e is Extract<PresenceEvent, { type: "nudge" }> => e.type === "nudge",
    );
    if (nudges.length === 0) return;
    // DND gates BOTH surfaces: a center overlay during Focus/DND is the rudest
    // possible violation, so it's suppressed exactly like the soft notification.
    if (decideNudge(await dndDetector.current()) !== "notify") return;
    const top = nudges.reduce((a, b) => (b.index > a.index ? b : a));
    if (escalateNudge(top.index) === "soft") {
      await notify(
        "Tomato",
        "You've been focused a while — a good moment to step away.",
      );
    } else {
      await openNudgeOverlay(top.activeMs);
    }
  }
```

- [ ] **Step 4: Auto-close the overlay in `apply()` when not active**

In `src/main.ts`, replace the existing `apply` function with (adds the final close-on-not-active line):

```ts
  // Single pipeline for every batch of raw events: persist → react → redraw →
  // reflect state in the tray menu → close the overlay if we've left a sprint.
  async function apply(raw: PresenceEvent[]): Promise<void> {
    await persist(raw);
    await react(raw);
    await refreshIcon();
    await syncMenu();
    // The overlay is a live "step away" prompt: once the sprint is no longer
    // active (you stepped away, or paused) it must not linger. Going idle IS the
    // break.
    if (machine.currentState() !== "active") await closeNudgeOverlay();
  }
```

- [ ] **Step 5: Type-check + full unit suite**

Run: `cd ~/Projects/Tomato/tomato-desktop && npx tsc --noEmit && pnpm test`
Expected: tsc exit 0; all tests pass (core suite unchanged + Task 1's escalateNudge tests).

- [ ] **Step 6: Commit**

```bash
cd ~/Projects/Tomato/tomato-desktop
git add src/main.ts
git commit -m "feat(nudge): escalate re-nudges to the hard overlay; auto-close on step-away"
```

---

### Task 4: End-to-end manual verification + full gate

No code — this is the acceptance gate for the feature. Uses a fast config so a re-nudge arrives in ~2 minutes instead of 15.

**Files:** none (temporary edit to `~/.config/tomato/config.json`, restored after).

- [ ] **Step 1: Green the automated gate**

Run:
```bash
cd ~/Projects/Tomato/tomato-desktop && pnpm test && npx tsc --noEmit
cd ~/Projects/Tomato/tomato-desktop/src-tauri && cargo check
```
Expected: tests pass, tsc exit 0, `cargo check` Finished (exit 0).

- [ ] **Step 2: Back up config and write a fast one**

```bash
cp ~/.config/tomato/config.json ~/.config/tomato/config.json.bak 2>/dev/null || true
cat > ~/.config/tomato/config.json <<'EOF'
{ "sprint_s": 60, "idle_reset_s": 1800, "renudge_every_s": 60, "onboarded": true }
EOF
```
(Boundary at 60s → soft notification; first re-nudge at 120s → hard overlay; then every 60s.)

- [ ] **Step 3: Run the app and drive it**

Run `pnpm tauri:dev` (Vite is fixed to port 1420, `strictPort` — it fails loudly rather than collide with other Tauri work). Stay active (keyboard/mouse) so the sprint keeps running.

Verify, in order:
- **~60s:** a **soft** desktop notification ("You've been focused a while…") — the boundary nudge (index 0).
- **~120s:** the **hard overlay** — a centered card over a dimmed backdrop reading "You've been focused for ~2 minutes — take a short break," with a **Dismiss** button. Confirm it takes focus and sits above other windows.
- **Dismiss** via the button, then again on the next overlay via **Esc**, then again via **clicking the dim** (not the card). Each closes it.
- **Step away** (don't touch input) for `idle_reset` — actually 30 min here is too long to wait; instead, while the overlay is open, click the tray → **Pause tracking**: the machine leaves `active`, and the overlay must **auto-close**. (Pause exercises the same `state !== "active"` path as an idle reset.) Then **Resume**.
- **DND:** run `gsettings set org.gnome.desktop.notifications show-banners false`, keep working past a re-nudge — **neither** the notification **nor** the overlay appears. Re-enable with `gsettings set org.gnome.desktop.notifications show-banners true`.

- [ ] **Step 4: Restore config**

```bash
mv ~/.config/tomato/config.json.bak ~/.config/tomato/config.json 2>/dev/null || rm -f ~/.config/tomato/config.json
```
(The app tolerates the v1-era file / a missing file — defaults fill any gaps.)

- [ ] **Step 5: Record verification evidence**

Append a short dated entry to `docs/verification.md` noting: soft@boundary, hard@re-nudge, three dismiss paths, auto-close on Pause, DND suppresses both — with the commit SHA. Commit:

```bash
cd ~/Projects/Tomato/tomato-desktop
git add docs/verification.md
git commit -m "docs(verify): hard-nudge overlay manual walkthrough"
```

---

## Notes for the implementer

- **Transparent full-screen on GNOME:** `transparent: true` + `fullscreen: true` gives a compositor-backed overlay on GNOME/mutter (compositing is on). If the backdrop paints solid black instead of translucent on your setup, fall back to `fullscreen: false` + `maximized: true` and keep `decorations: false`; the dim is CSS (`rgba(...)`) either way. Note any such change in the Task 4 evidence.
- **Focus steal is intended** — the "hard" quality is that it interrupts. It's still Dismiss-only and never locks input.
- **Branch:** this plan's branch (`feat/hard-nudge-overlay`) currently stacks on the polish commits. If the polish branch merges first, rebase is a no-op; otherwise rebase onto `main` before PR.
