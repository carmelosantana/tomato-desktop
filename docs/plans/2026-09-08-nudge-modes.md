# Nudge Modes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land the stranded hard-nudge overlay behind a user-selectable `nudge_mode` (soft / hard / escalating), and make its 10-second dismiss lock actually total.

**Architecture:** The soft-vs-hard choice stays a pure function in `src/core/nudge.ts` that the shell composes after the existing DND gate; the overlay window, settings form and tray orchestrator remain impure and manually verified, exactly as the rest of this codebase splits them. Two new pure functions (`chooseNudgeSurface`, `dismissLockLabel`) plus one type guard (`isNudgeMode`) carry all the testable logic.

**Tech Stack:** Tauri v2, TypeScript (strict), Vitest, pnpm, vanilla DOM (no framework), CSS custom properties from `src/styles/tokens.css`.

**Spec:** `docs/specs/2026-09-08-nudge-modes-design.md`

## Global Constraints

- Every duration in `TomatoConfig` is stored in **SECONDS**; the timer core works in **milliseconds**. Do not store ms. (`src/native/config.ts` units note.)
- Pure logic lives in `src/core/` and **is** unit-tested with Vitest. Anything touching Tauri APIs or the DOM is **not** unit-tested and is verified manually in-app. Do not add Vitest tests for webview-only modules.
- The DND gate (`decideNudge`) suppresses **both** surfaces and is checked **once** per coalesced batch. Never fire two surfaces for one batch.
- The dismiss lock is **10000 ms**, a module constant. It is not a setting.
- Default `nudge_mode` is `"escalating"` for new **and** existing configs.
- Verification gate for every commit: `pnpm test` + `npx tsc --noEmit` green. `cargo check` before the final commit.
- Settings window is **not resizable** and is sized to its card — adding a row means bumping `SETTINGS_H` in `src/main.ts` or the card will clip.

## File Structure

| File | Responsibility | Task |
| --- | --- | --- |
| `src/core/nudge.ts` | Pure nudge decisions: DND gate, mode→surface, lock label | 2, 3 |
| `src/core/nudge.test.ts` | Vitest for the above | 2, 3 |
| `src/native/config.ts` | `nudge_mode` persistence + sanitizing | 4 |
| `src/settings.html` | The "Nudge style" row markup | 5 |
| `src/styles/settings.css` | Segmented-control styling | 5 |
| `src/settings.ts` | Load/save the mode | 5 |
| `src/onboarding.ts` | Preserve the mode through first-run | 4 |
| `src/nudge-overlay.ts` | The total dismiss lock + countdown | 6 |
| `src/nudge-overlay.html` | Lock-state markup | 6 |
| `src/main.ts` | `react()` surface dispatch; `SETTINGS_H` | 5, 7 |

---

### Task 1: Land the branch backlog and rebase the overlay

No code changes — this task makes the working tree the one every later task assumes. `feat/hard-nudge-overlay` is 8 commits behind `main` and carries 3 unrelated reviewed commits that also exist on `polish/v2-followups`.

**Files:**
- Modify: none (git history only)

**Interfaces:**
- Consumes: nothing
- Produces: a `feat/hard-nudge-overlay` branch rebased onto `main`, containing `src/nudge-overlay.{html,ts}`, `src-tauri/capabilities/nudge-overlay-window.json`, `escalateNudge` in `src/core/nudge.ts`, and the overlay wiring in `src/main.ts`. Every later task builds on this branch.

- [ ] **Step 1: Confirm the starting state**

```bash
git checkout main && git status --short
git log --oneline -1
git log --oneline main..polish/v2-followups
git log --oneline main..feat/hard-nudge-overlay
```

Expected: clean tree; `main` at the `docs(spec): nudge modes` commit; 3 commits on `polish/v2-followups`; 12 on `feat/hard-nudge-overlay` (those 3 plus 9 overlay commits).

- [ ] **Step 2: Land the polish commits on main**

```bash
git merge --ff-only polish/v2-followups
```

Expected: fast-forward, `main` advances by 3 commits. If it refuses (not a fast-forward), stop and report — do not create a merge commit.

- [ ] **Step 3: Verify main is still green**

```bash
pnpm test && npx tsc --noEmit
```

Expected: all Vitest suites pass, no type errors.

- [ ] **Step 4: Rebase the overlay branch onto main**

```bash
git checkout feat/hard-nudge-overlay
git rebase main
```

Expected: the 3 polish commits drop out as already-applied; the 9 overlay commits replay. Resolve any conflict in favour of `main`'s version for CI/docs files, and the branch's version for `src/nudge-overlay.*`, `src/core/nudge.ts` and `src/main.ts`.

- [ ] **Step 5: Verify the rebased branch is green**

```bash
pnpm test && npx tsc --noEmit
```

Expected: all pass, including the branch's `escalateNudge` tests.

- [ ] **Step 6: Confirm the overlay files are present**

```bash
ls src/nudge-overlay.html src/nudge-overlay.ts src-tauri/capabilities/nudge-overlay-window.json
grep -n "escalateNudge" src/core/nudge.ts src/main.ts
```

Expected: all three files exist; `escalateNudge` is defined in `core/nudge.ts` and imported in `main.ts`.

---

### Task 2: Mode type, guard, and surface selection

Replaces the branch's fixed `escalateNudge(maxIndex)` with a mode-aware `chooseNudgeSurface(mode, maxIndex)`. The type guard lives here (not in `config.ts`) so it is unit-testable — `config.ts` is webview-only and untested.

**Files:**
- Modify: `src/core/nudge.ts`
- Modify: `src/core/nudge.test.ts`
- Modify: `src/main.ts` (import only — full wiring is Task 7)

**Interfaces:**
- Consumes: nothing from earlier tasks
- Produces:
  - `type NudgeMode = "soft" | "hard" | "escalating"`
  - `type NudgeSurface = "soft" | "hard"`
  - `function isNudgeMode(value: unknown): value is NudgeMode`
  - `function chooseNudgeSurface(mode: NudgeMode, maxIndex: number): NudgeSurface`
  - `escalateNudge` is **deleted**; Task 7 removes its last call site.

- [ ] **Step 1: Write the failing tests**

Replace the `escalateNudge` describe block in `src/core/nudge.test.ts` with:

```ts
import { describe, it, expect } from "vitest";
import { chooseNudgeSurface, isNudgeMode } from "./nudge";

describe("chooseNudgeSurface", () => {
  it("soft mode is soft at the boundary and at every re-nudge", () => {
    expect(chooseNudgeSurface("soft", 0)).toBe("soft");
    expect(chooseNudgeSurface("soft", 1)).toBe("soft");
    expect(chooseNudgeSurface("soft", 7)).toBe("soft");
  });

  it("hard mode is hard from the boundary onward", () => {
    expect(chooseNudgeSurface("hard", 0)).toBe("hard");
    expect(chooseNudgeSurface("hard", 1)).toBe("hard");
    expect(chooseNudgeSurface("hard", 7)).toBe("hard");
  });

  it("escalating mode is soft at the boundary, hard from the first re-nudge", () => {
    expect(chooseNudgeSurface("escalating", 0)).toBe("soft");
    expect(chooseNudgeSurface("escalating", 1)).toBe("hard");
    expect(chooseNudgeSurface("escalating", 7)).toBe("hard");
  });

  it("treats a negative or fractional index as the boundary in escalating mode", () => {
    expect(chooseNudgeSurface("escalating", -1)).toBe("soft");
    expect(chooseNudgeSurface("escalating", 0.5)).toBe("soft");
  });
});

describe("isNudgeMode", () => {
  it("accepts the three modes", () => {
    expect(isNudgeMode("soft")).toBe(true);
    expect(isNudgeMode("hard")).toBe(true);
    expect(isNudgeMode("escalating")).toBe(true);
  });

  it("rejects anything else", () => {
    expect(isNudgeMode("Escalating")).toBe(false);
    expect(isNudgeMode("gentle")).toBe(false);
    expect(isNudgeMode("")).toBe(false);
    expect(isNudgeMode(undefined)).toBe(false);
    expect(isNudgeMode(null)).toBe(false);
    expect(isNudgeMode(1)).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
pnpm test -- src/core/nudge.test.ts
```

Expected: FAIL — `chooseNudgeSurface` and `isNudgeMode` are not exported from `./nudge`.

- [ ] **Step 3: Write the implementation**

In `src/core/nudge.ts`, delete `escalateNudge` and its doc comment, then append:

```ts
/** The user's preference for which surface fires at which nudge index. */
export type NudgeMode = "soft" | "hard" | "escalating";

/** How a nudge is delivered. Two surfaces only. */
export type NudgeSurface = "soft" | "hard";

const NUDGE_MODES: readonly NudgeMode[] = ["soft", "hard", "escalating"];

/** Narrow an unknown (a hand-edited config value, a retired key) to a NudgeMode. */
export function isNudgeMode(value: unknown): value is NudgeMode {
  return typeof value === "string" && (NUDGE_MODES as readonly string[]).includes(value);
}

/**
 * Which surface a coalesced batch warrants, given the mode and the batch's
 * HIGHEST nudge index.
 *  - "soft"       → always the quiet desktop notification.
 *  - "hard"       → always the on-screen overlay, boundary included.
 *  - "escalating" → soft at the boundary (index 0), hard from the first
 *                   re-nudge (index >= 1).
 * Pure and total. The DND gate (decideNudge) is applied separately by the shell
 * and suppresses BOTH surfaces.
 */
export function chooseNudgeSurface(mode: NudgeMode, maxIndex: number): NudgeSurface {
  switch (mode) {
    case "soft":
      return "soft";
    case "hard":
      return "hard";
    case "escalating":
      return maxIndex >= 1 ? "hard" : "soft";
    default: {
      const _exhaustive: never = mode;
      return _exhaustive;
    }
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
pnpm test -- src/core/nudge.test.ts
```

Expected: PASS, 6 tests.

- [ ] **Step 5: Keep the build compiling**

`src/main.ts` still imports the now-deleted `escalateNudge`. Change its import line from `import { decideNudge, escalateNudge } from "./core/nudge";` to:

```ts
import { chooseNudgeSurface, decideNudge } from "./core/nudge";
import type { NudgeMode } from "./core/nudge";
```

and change the one call site in `react()` from `escalateNudge(top.index)` to `chooseNudgeSurface("escalating", top.index)` — a literal placeholder that preserves today's behavior exactly. Task 7 replaces it with the real config value.

- [ ] **Step 6: Verify the whole suite and types**

```bash
pnpm test && npx tsc --noEmit
```

Expected: all pass, no type errors.

- [ ] **Step 7: Commit**

```bash
git add src/core/nudge.ts src/core/nudge.test.ts src/main.ts
git commit -m "feat(core): chooseNudgeSurface + isNudgeMode replace fixed escalateNudge"
```

---

### Task 3: Dismiss-lock countdown label

The overlay's button label during the lock. Pure so it can be tested; the timer that drives it is webview-only (Task 6).

**Files:**
- Modify: `src/core/nudge.ts`
- Modify: `src/core/nudge.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces: `function dismissLockLabel(remainingMs: number): string` — `"Dismiss in N"` while locked (N = whole seconds, rounded **up**, so a fresh 10000 ms lock reads `"Dismiss in 10"`), `"Dismiss"` at or below zero. Task 6 calls it once per second.

- [ ] **Step 1: Write the failing test**

Append to `src/core/nudge.test.ts` (add `dismissLockLabel` to the existing import from `./nudge`):

```ts
describe("dismissLockLabel", () => {
  it("rounds up to whole seconds so a fresh lock reads its full duration", () => {
    expect(dismissLockLabel(10000)).toBe("Dismiss in 10");
    expect(dismissLockLabel(9001)).toBe("Dismiss in 10");
    expect(dismissLockLabel(9000)).toBe("Dismiss in 9");
  });

  it("counts down to one, never showing a zero", () => {
    expect(dismissLockLabel(1000)).toBe("Dismiss in 1");
    expect(dismissLockLabel(1)).toBe("Dismiss in 1");
  });

  it("unlocks at zero and below", () => {
    expect(dismissLockLabel(0)).toBe("Dismiss");
    expect(dismissLockLabel(-500)).toBe("Dismiss");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm test -- src/core/nudge.test.ts
```

Expected: FAIL — `dismissLockLabel` is not exported from `./nudge`.

- [ ] **Step 3: Write the implementation**

Append to `src/core/nudge.ts`:

```ts
/**
 * Button label for the overlay's dismiss lock. Seconds round UP, so a fresh
 * 10000 ms lock reads "Dismiss in 10" and the display never shows a zero before
 * the lock actually lifts. At or below zero the button is unlocked.
 */
export function dismissLockLabel(remainingMs: number): string {
  if (remainingMs <= 0) return "Dismiss";
  return `Dismiss in ${Math.ceil(remainingMs / 1000)}`;
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
pnpm test -- src/core/nudge.test.ts
```

Expected: PASS, 9 tests total in the file.

- [ ] **Step 5: Commit**

```bash
git add src/core/nudge.ts src/core/nudge.test.ts
git commit -m "feat(core): dismissLockLabel for the overlay's dismiss countdown"
```

---

### Task 4: Persist `nudge_mode`

**Files:**
- Modify: `src/native/config.ts`
- Modify: `src/settings.ts`, `src/onboarding.ts` (both build a `TomatoConfig` literal and stop compiling without the new key)

**Interfaces:**
- Consumes: `NudgeMode`, `isNudgeMode` from Task 2
- Produces: `TomatoConfig.nudge_mode: NudgeMode`, defaulting to `"escalating"`. Tasks 5 and 7 read it.

Webview-only module (Tauri fs) — no Vitest tests, per the Global Constraints. The pure guard it leans on is already tested in Task 2.

- [ ] **Step 1: Import the mode type and guard**

In `src/native/config.ts`, add below the existing `settingsForm` imports:

```ts
import { isNudgeMode } from "../core/nudge";
import type { NudgeMode } from "../core/nudge";
```

- [ ] **Step 2: Add the field to the interface**

In `interface TomatoConfig`, after `renudge_every_s`:

```ts
  /** Which nudge surface fires at which nudge index. */
  nudge_mode: NudgeMode;
```

- [ ] **Step 3: Add the default**

Update `DEFAULT_CONFIG` and its doc comment:

```ts
/** v2 Presence defaults: 15m sprint / 5m idle-reset / 15m renudge, escalating nudges. */
export const DEFAULT_CONFIG: TomatoConfig = {
  sprint_s: 900,
  idle_reset_s: 300,
  renudge_every_s: 900,
  nudge_mode: "escalating",
  onboarded: false,
};
```

- [ ] **Step 4: Sanitize on load**

Add beside `sanitizeDuration`:

```ts
/**
 * Sanitize the stored nudge mode: anything that is not one of the three literals
 * — absent, misspelled, hand-edited, or a retired key — falls back to the
 * default rather than flowing through to the shell.
 */
function sanitizeMode(raw: unknown): NudgeMode {
  return isNudgeMode(raw) ? raw : DEFAULT_CONFIG.nudge_mode;
}
```

and add to the object `loadConfig()` returns, after the `renudge_every_s` entry:

```ts
      nudge_mode: sanitizeMode(raw.nudge_mode),
```

Widen the parse cast so an unknown mode string type-checks: change
`JSON.parse(await readTextFile(path)) as Partial<TomatoConfig>` to
`JSON.parse(await readTextFile(path)) as Partial<Record<keyof TomatoConfig, unknown>>`,
and read the durations through it unchanged (`sanitizeDuration` already guards
`typeof raw === "number"`, so update its parameter type from
`number | undefined` to `unknown`).

- [ ] **Step 5: Keep the two other TomatoConfig builders compiling**

`TomatoConfig` is constructed as a full literal in two more places, and both stop
compiling the moment the key is required:

- `src/settings.ts` — the `next` object in `save()`. Add `nudge_mode: DEFAULT_CONFIG.nudge_mode,`
  as a one-line stopgap; **Task 5 Step 3 replaces it** with the real selection.
- `src/onboarding.ts:129` — the `next` object in its save path. Onboarding gains
  no UI for the mode (spec Decision 8), so it **preserves** whatever is stored,
  mirroring how it already preserves `renudge_every_s` via a module-level
  variable at `src/onboarding.ts:65`.

In `src/onboarding.ts`, add to the config imports:

```ts
import type { NudgeMode } from "./core/nudge";
```

Add beside `renudgeEveryS`:

```ts
// Not editable during onboarding; preserved so first-run never clobbers it.
let nudgeMode: NudgeMode = DEFAULT_CONFIG.nudge_mode;
```

In its load path, beside where the other preserved values are read from `cfg`:

```ts
  nudgeMode = cfg.nudge_mode;
```

And in the `next` literal:

```ts
    nudge_mode: nudgeMode,
```

- [ ] **Step 6: Verify types and suite**

```bash
pnpm test && npx tsc --noEmit
```

Expected: PASS, no type errors — all three `TomatoConfig` builders now supply the key.

- [ ] **Step 7: Commit**

```bash
git add src/native/config.ts src/settings.ts src/onboarding.ts
git commit -m "feat(config): nudge_mode key, sanitized, defaulting to escalating"
```

---

### Task 5: The "Nudge style" settings control

Three-way segmented control. It sits in a **stacked** row (title/sub above, control full-width below) rather than the inline `.field` slot — three labelled options do not fit beside `.row-text` in a 560 px window.

**Files:**
- Modify: `src/settings.html`
- Modify: `src/styles/settings.css`
- Modify: `src/settings.ts`
- Modify: `src/main.ts:56` (`SETTINGS_H`)

**Interfaces:**
- Consumes: `TomatoConfig.nudge_mode` from Task 4, `NudgeMode` / `isNudgeMode` from Task 2
- Produces: a persisted `nudge_mode` that Task 7 reads at runtime

- [ ] **Step 1: Add the markup**

In `src/settings.html`, between the "Re-nudge every" row and the "Autostart" row:

```html
        <!-- Nudge style -->
        <div class="row stack">
          <div class="row-text">
            <div class="row-title">Nudge style</div>
            <div class="row-sub">how firmly Tomato asks you to step away</div>
          </div>
          <div class="seg" id="nudge-mode" role="radiogroup" aria-label="Nudge style">
            <button type="button" class="seg-opt" data-mode="soft" role="radio" aria-checked="false">
              <span class="seg-label">Soft</span>
              <span class="seg-sub">a quiet desktop notification</span>
            </button>
            <button type="button" class="seg-opt" data-mode="hard" role="radio" aria-checked="false">
              <span class="seg-label">Hard</span>
              <span class="seg-sub">a full-screen card, every time</span>
            </button>
            <button type="button" class="seg-opt" data-mode="escalating" role="radio" aria-checked="false">
              <span class="seg-label">Escalating</span>
              <span class="seg-sub">soft first, then full-screen</span>
            </button>
          </div>
        </div>
```

- [ ] **Step 2: Add the styling**

Append to `src/styles/settings.css`, after the `.toggle` block:

```css
/* --- nudge style segmented control ----------------------------------------- */
.row.stack {
  display: block;
}
.seg {
  display: flex;
  gap: 6px;
  margin-top: 10px;
}
.seg-opt {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 8px 10px;
  text-align: left;
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  color: var(--text);
  cursor: pointer;
  transition:
    background var(--duration-state) var(--ease-standard),
    border-color var(--duration-state) var(--ease-standard);
}
.seg-opt:hover {
  border-color: var(--text-muted);
}
.seg-opt[aria-checked="true"] {
  border-color: var(--tomato);
  background: var(--surface);
}
.seg-label {
  font-size: 13px;
  font-weight: var(--weight-semibold);
}
.seg-opt[aria-checked="true"] .seg-label {
  color: var(--tomato);
}
.seg-sub {
  font-size: 11px;
  line-height: 1.3;
  color: var(--text-muted);
}
```

Add `.seg-opt` to the existing `@media (prefers-reduced-motion: reduce)` block at the bottom of the file so its transition is disabled alongside `.toggle`.

- [ ] **Step 3: Wire load and save**

In `src/settings.ts`, add to the imports:

```ts
import { isNudgeMode } from "./core/nudge";
import type { NudgeMode } from "./core/nudge";
```

Add an element handle beside the others:

```ts
const segEl = $("nudge-mode");
```

Add local state beside `autostartOn`:

```ts
// Selected nudge mode; local until Save, like every other field.
let nudgeMode: NudgeMode = DEFAULT_CONFIG.nudge_mode;
```

Add the render + click handler after the autostart block:

```ts
// --- nudge style segmented control -----------------------------------------
function renderMode(): void {
  for (const opt of segEl.querySelectorAll<HTMLButtonElement>(".seg-opt")) {
    opt.setAttribute("aria-checked", String(opt.dataset.mode === nudgeMode));
  }
}
segEl.addEventListener("click", (e) => {
  const opt = (e.target as HTMLElement).closest<HTMLButtonElement>(".seg-opt");
  if (!opt || !isNudgeMode(opt.dataset.mode)) return;
  nudgeMode = opt.dataset.mode;
  renderMode();
});
```

In `load()`, after `onboarded = cfg.onboarded;`:

```ts
  nudgeMode = cfg.nudge_mode;
  renderMode();
```

In `save()`, replace the Task 4 Step 5 stopgap line in the `next` object with:

```ts
    nudge_mode: nudgeMode,
```

- [ ] **Step 4: Grow the settings window**

The window is not resizable and is sized to the card; the new stacked row adds roughly 96 px. In `src/main.ts`, change `const SETTINGS_H = 512;` to:

```ts
const SETTINGS_H = 608;
```

- [ ] **Step 5: Verify types and suite**

```bash
pnpm test && npx tsc --noEmit
```

Expected: PASS, no type errors.

- [ ] **Step 6: Verify in the app**

```bash
pnpm tauri dev
```

Open Settings from the tray. Confirm: the four rows and the autostart toggle all fit with no scrollbar and even margins; the segmented control shows the mode loaded from `~/.config/tomato/config.json` (Escalating on a fresh config); clicking an option moves the selection; Save then reopening Settings shows the saved mode; and `cat ~/.config/tomato/config.json` shows the new `nudge_mode` key.

- [ ] **Step 7: Commit**

```bash
git add src/settings.html src/styles/settings.css src/settings.ts src/main.ts
git commit -m "feat(settings): nudge style segmented control (soft/hard/escalating)"
```

---

### Task 6: Make the dismiss lock total

The branch sets `REST_MS = 10000` but wires it only to `document.addEventListener("click", dismiss)` — the Dismiss button and Esc fire immediately, so the pause delays nobody who reaches for the button. Every path now holds for the full 10 s, with a countdown on the button.

**Files:**
- Modify: `src/nudge-overlay.ts`
- Modify: `src/nudge-overlay.html`

**Interfaces:**
- Consumes: `dismissLockLabel` from Task 3
- Produces: nothing consumed by later tasks

Webview-only — no Vitest tests; verified manually in Step 5.

- [ ] **Step 1: Start the button locked in markup**

In `src/nudge-overlay.html`, change the dismiss button so it never paints an enabled state on the first frame:

```html
        <button class="dismiss" id="dismiss" type="button" disabled>Dismiss in 10</button>
```

Add a disabled style next to the existing `.dismiss` rule in that file's `<style>` block:

```css
      .dismiss:disabled {
        opacity: 0.55;
        cursor: default;
      }
```

- [ ] **Step 2: Replace the lock logic**

In `src/nudge-overlay.ts`, add to the imports:

```ts
import { dismissLockLabel } from "./core/nudge";
```

Replace everything from the `let dismissed = false;` declaration to the end of the file with:

```ts
// One-shot: after the lock lifts, a single click reaches both the element's own
// handler and the bubbled document handler — guard so we only close once (a
// second close() on a closing window can reject).
let dismissed = false;
// The lock holds EVERY dismissal path — button, Esc and backdrop click — for the
// full rest period. A lock that leaves the button live delays nobody.
let locked = true;

function dismiss(): void {
  if (locked || dismissed) return;
  dismissed = true;
  void getCurrentWindow().close().catch(() => {});
}

const dismissBtn = document.getElementById("dismiss") as HTMLButtonElement | null;
dismissBtn?.addEventListener("click", dismiss);
window.addEventListener("keydown", (e) => {
  if (e.key === "Escape") dismiss();
});

// Tick the button's countdown once a second while the lock holds.
const lockStartedAt = Date.now();
const ticker = window.setInterval(() => {
  const remaining = REST_MS - (Date.now() - lockStartedAt);
  if (dismissBtn) dismissBtn.textContent = dismissLockLabel(remaining);
}, 1000);

// Lock lifts: enable the button, allow Esc, reveal the hint, and attach
// click-anywhere-to-dismiss.
window.setTimeout(() => {
  window.clearInterval(ticker);
  locked = false;
  if (dismissBtn) {
    dismissBtn.disabled = false;
    dismissBtn.textContent = dismissLockLabel(0);
  }
  document.getElementById("hint")?.classList.add("shown");
  document.addEventListener("click", dismiss);
}, REST_MS);
```

Set the button's initial label from the constant so markup and code cannot drift — insert immediately after the `#nudge-line` block near the top of the file:

```ts
const initialBtn = document.getElementById("dismiss");
if (initialBtn) initialBtn.textContent = dismissLockLabel(REST_MS);
```

- [ ] **Step 3: Update the file's header comment**

Replace the two lines describing the old behavior:

```ts
// It reads how long you've been focused from its own ?focused=<seconds> query
// param. EVERY dismissal path — the Dismiss button, Esc, and click-anywhere — is
// LOCKED for the rest period (REST_MS), with a countdown on the button, so the
// overlay cannot be cleared until you have actually paused. The lock then lifts
// and any of the three dismisses. Dismiss closes the window; main.ts reopens it
// on the next qualifying nudge.
```

- [ ] **Step 4: Verify types and suite**

```bash
pnpm test && npx tsc --noEmit
```

Expected: PASS.

- [ ] **Step 5: Verify in the app**

```bash
pnpm tauri dev
```

Set Sprint length to 1 min and Re-nudge every to 1 min in Settings, pick **Hard**, and save. Wait for the sprint boundary. Confirm: the overlay opens with the button reading `Dismiss in 10` and counting down once per second; clicking the button, pressing Esc, and clicking the dim all do nothing while it counts; at zero the button reads `Dismiss`, the "or click anywhere" hint fades in, and each of the three paths closes the overlay.

- [ ] **Step 6: Commit**

```bash
git add src/nudge-overlay.ts src/nudge-overlay.html
git commit -m "fix(overlay): hold every dismissal path for the full lock, with a countdown"
```

---

### Task 7: Dispatch the surface from the user's mode

**Files:**
- Modify: `src/main.ts`
- Modify: `docs/verification.md`

**Interfaces:**
- Consumes: `chooseNudgeSurface` (Task 2), `config.nudge_mode` (Task 4)
- Produces: the finished feature

- [ ] **Step 1: Read the mode from config**

In `src/main.ts`, replace the Task 2 placeholder `chooseNudgeSurface("escalating", top.index)` with `chooseNudgeSurface(config.nudge_mode, top.index)`.

`config` is already the live `TomatoConfig` that `applyPendingConfig()` swaps in, so no new plumbing is needed. Update the comment above the branch in `react()`:

```ts
  // DND-aware nudge. Which surface fires is the user's nudge_mode: "soft" is
  // always a desktop notification, "hard" is always the overlay, "escalating"
  // sends the boundary soft and every re-nudge hard.
```

Remove the now-unused `NudgeMode` type import added in Task 2 Step 5 if nothing else in the file references it.

- [ ] **Step 2: Confirm the deferred-apply path is unchanged**

Read `applyPendingConfig()` and confirm it swaps `config` wholesale only when the machine is `away` or `paused`. No change is needed — a mode change therefore lands on the next sprint, never mid-sprint, exactly like the durations.

- [ ] **Step 3: Verify the full gate**

```bash
pnpm test && npx tsc --noEmit && (cd src-tauri && cargo check)
```

Expected: all Vitest suites pass, no type errors, `cargo check` clean.

- [ ] **Step 4: Run the manual walk-through**

```bash
pnpm tauri dev
```

With Sprint length 1 min and Re-nudge every 1 min, verify each row and record the results:

| Check | Expected |
| --- | --- |
| `soft` mode | boundary and every re-nudge give a banner; overlay never opens |
| `hard` mode | the boundary itself opens the overlay; no banner |
| `escalating` mode | boundary banner; first re-nudge opens the overlay |
| Lock | button counts `Dismiss in 10`→`1`; button, Esc and backdrop all inert until it reads `Dismiss` |
| Auto-close | stepping away (idle past reset) while the overlay is up closes it |
| DND | with `gsettings set org.gnome.desktop.notifications show-banners false`, no surface fires in any mode |
| Deferred apply | changing mode mid-sprint takes effect on the next sprint, not immediately |

- [ ] **Step 5: Record the evidence**

Append a `## Nudge modes (2026-09-08)` section to `docs/verification.md` with the seven rows above and their actual observed results, matching the format of the existing hard-nudge-overlay section.

- [ ] **Step 6: Commit**

```bash
git add src/main.ts docs/verification.md
git commit -m "feat(nudge): dispatch the nudge surface from the user's nudge_mode"
```

---

## Milestones

- Task 1: Land the branch backlog and rebase the overlay
- Task 2: Mode type, guard, and surface selection
- Task 3: Dismiss-lock countdown label
- Task 4: Persist nudge_mode
- Task 5: The "Nudge style" settings control
- Task 6: Make the dismiss lock total
- Task 7: Dispatch the surface from the user's mode
