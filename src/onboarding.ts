// First-run onboarding window script — walks the user through the presence
// cadence in a few light steps, lets them confirm/adjust the sprint length & idle
// reset, then on "Get started" persists the durations + `onboarded: true` via
// saveConfig(), signals main to reload config (SETTINGS_SAVED), and closes to the
// tray.
//
// IMPURE / webview-only: uses Tauri's fs (via native/config), the event bus, the
// window API, and the DOM. Not unit-tested; the pure pieces it leans on
// (onboardingSteps navigation, minutesToClampedSeconds/secondsToMinutes + bounds,
// resolveTheme) ARE unit-tested in core.

import { emit } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";

import { loadConfig, saveConfig, DEFAULT_CONFIG } from "./native/config";
import type { TomatoConfig } from "./native/config";
import type { NudgeMode } from "./core/nudge";
import {
  minutesToClampedSeconds,
  secondsToMinutes,
  sanitizeNumericField,
  SETTINGS_SAVED,
  SPRINT_BOUNDS,
  IDLE_RESET_BOUNDS,
} from "./core/settingsForm";
import {
  makeSteps,
  nextStep,
  prevStep,
  isFirst,
  isLast,
} from "./core/onboardingSteps";
import type { StepState } from "./core/onboardingSteps";
import { applyTheme, resolveTheme } from "./core/theme";

const $ = <T extends HTMLElement = HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`missing #${id}`);
  return el as T;
};

// --- theme (light/dark via tokens) -----------------------------------------
function syncTheme(): void {
  const dark =
    typeof matchMedia === "function" && matchMedia("(prefers-color-scheme: dark)").matches;
  applyTheme(document, resolveTheme("system", dark));
}
if (typeof matchMedia === "function") {
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", syncTheme);
}

// --- element handles -------------------------------------------------------
const stepEls = Array.from(document.querySelectorAll<HTMLElement>(".step"));
const dotEls = Array.from(document.querySelectorAll<HTMLElement>(".dot"));
const sprintEl = $<HTMLInputElement>("sprint");
const idleResetEl = $<HTMLInputElement>("idle-reset");
const backEl = $<HTMLButtonElement>("back");
const nextEl = $<HTMLButtonElement>("next");
const msgEl = $("msg");

// Cursor over the steps rendered in the HTML (kept in sync with the DOM count).
let steps: StepState = makeSteps(stepEls.length);

// Config not exposed in onboarding; seeded from stored config on load and
// preserved verbatim through "Get started".
let renudgeEveryS = DEFAULT_CONFIG.renudge_every_s;
let nudgeMode: NudgeMode = DEFAULT_CONFIG.nudge_mode;

// Round to at most one decimal place for a clean minutes display (e.g. 0.5).
const toMinField = (seconds: number): string =>
  String(Math.round(secondsToMinutes(seconds) * 10) / 10);

// The duration fields are plain text (no spinner arrows); keep them numeric as
// the user types. Bounds clamping still happens on "Get started".
for (const el of [sprintEl, idleResetEl]) {
  el.addEventListener("input", () => {
    const clean = sanitizeNumericField(el.value);
    if (clean !== el.value) el.value = clean;
  });
}

// --- render ----------------------------------------------------------------
function render(): void {
  stepEls.forEach((el) => {
    const idx = Number(el.dataset.step);
    el.hidden = idx !== steps.index;
  });
  dotEls.forEach((el, idx) => {
    el.classList.toggle("active", idx === steps.index);
  });
  backEl.hidden = isFirst(steps);
  nextEl.textContent = isLast(steps) ? "Get started" : "Next";
}

// --- navigation ------------------------------------------------------------
backEl.addEventListener("click", () => {
  steps = prevStep(steps);
  render();
});

nextEl.addEventListener("click", () => {
  if (isLast(steps)) {
    void finish();
    return;
  }
  steps = nextStep(steps);
  render();
});

// --- load ------------------------------------------------------------------
async function load(): Promise<void> {
  syncTheme();
  let cfg: TomatoConfig;
  try {
    cfg = await loadConfig();
  } catch (err) {
    console.error("onboarding: failed to load config", err);
    cfg = { ...DEFAULT_CONFIG };
  }
  sprintEl.value = toMinField(cfg.sprint_s);
  idleResetEl.value = toMinField(cfg.idle_reset_s);
  // Preserve the fields onboarding does not expose.
  renudgeEveryS = cfg.renudge_every_s;
  nudgeMode = cfg.nudge_mode;
  render();
}

// --- finish (Get started) --------------------------------------------------
async function finish(): Promise<void> {
  nextEl.disabled = true;
  msgEl.textContent = "";
  const next: TomatoConfig = {
    sprint_s: minutesToClampedSeconds(parseFloat(sprintEl.value), SPRINT_BOUNDS),
    idle_reset_s: minutesToClampedSeconds(parseFloat(idleResetEl.value), IDLE_RESET_BOUNDS),
    renudge_every_s: renudgeEveryS, // preserved; not exposed here
    nudge_mode: nudgeMode, // preserved; not exposed here
    onboarded: true,
  };

  // Step 1 — the actual persist. Only this failing means the settings weren't
  // saved, so only this shows the "couldn't save" message and stops.
  try {
    await saveConfig(next);
  } catch (err) {
    console.error("onboarding: saveConfig failed", err);
    msgEl.textContent = "Couldn't save. Please try again.";
    nextEl.disabled = false;
    return;
  }

  // Step 2 — tell main to reload. Non-fatal: the config is already on disk and
  // main also re-reads on its next start, so a failure here shouldn't block.
  try {
    await emit(SETTINGS_SAVED);
  } catch (err) {
    console.error("onboarding: emit(SETTINGS_SAVED) failed", err);
  }

  // Step 3 — close to the tray. If this fails the save still succeeded, so say so.
  try {
    await getCurrentWindow().close();
  } catch (err) {
    console.error("onboarding: window close failed", err);
    msgEl.textContent = "Saved — but the window wouldn't close.";
    nextEl.disabled = false;
  }
}

void load().catch((err) => console.error("onboarding failed to load", err));
