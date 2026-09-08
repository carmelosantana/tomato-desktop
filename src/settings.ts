// Settings window script — loads the current config, lets the user edit the
// three v2 durations (shown in MINUTES) and autostart-on-login, then on Save
// persists via saveConfig() and signals main to reload (SETTINGS_SAVED).
//
// IMPURE / webview-only: uses Tauri's fs (via native/config), the autostart
// plugin, the event bus, the window API, and the DOM. Not unit-tested; the pure
// pieces it leans on (minutesToClampedSeconds, secondsToMinutes, the bounds,
// sanitizeNumericField, resolveTheme) ARE unit-tested in core.

import { emit } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { enable, disable, isEnabled } from "@tauri-apps/plugin-autostart";

import { loadConfig, saveConfig, DEFAULT_CONFIG } from "./native/config";
import type { TomatoConfig } from "./native/config";
import {
  minutesToClampedSeconds,
  secondsToMinutes,
  sanitizeNumericField,
  SETTINGS_SAVED,
  SPRINT_BOUNDS,
  IDLE_RESET_BOUNDS,
  RENUDGE_BOUNDS,
} from "./core/settingsForm";
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
const sprintEl = $<HTMLInputElement>("sprint");
const idleEl = $<HTMLInputElement>("idle");
const renudgeEl = $<HTMLInputElement>("renudge");
const autostartEl = $<HTMLButtonElement>("autostart");
const saveEl = $<HTMLButtonElement>("save");
const cancelEl = $<HTMLButtonElement>("cancel");
const msgEl = $("msg");

// Local UI state that is not a plain form value.
let autostartOn = false;
// onboarded is set by first-run onboarding; preserve whatever is stored.
let onboarded = DEFAULT_CONFIG.onboarded;

// Round to at most one decimal place for a clean minutes display (e.g. 0.5).
const toMinField = (seconds: number): string =>
  String(Math.round(secondsToMinutes(seconds) * 10) / 10);

// The duration fields are plain text (no spinner arrows); keep them numeric as
// the user types. Bounds clamping still happens on Save.
for (const el of [sprintEl, idleEl, renudgeEl]) {
  el.addEventListener("input", () => {
    const clean = sanitizeNumericField(el.value);
    if (clean !== el.value) el.value = clean;
  });
}

// --- autostart toggle ------------------------------------------------------
function renderAutostart(): void {
  autostartEl.setAttribute("aria-checked", String(autostartOn));
}
autostartEl.addEventListener("click", () => {
  autostartOn = !autostartOn;
  renderAutostart();
});

// --- load ------------------------------------------------------------------
async function load(): Promise<void> {
  syncTheme();
  let cfg: TomatoConfig;
  try {
    cfg = await loadConfig();
  } catch (err) {
    console.error("settings: failed to load config", err);
    cfg = { ...DEFAULT_CONFIG };
  }
  sprintEl.value = toMinField(cfg.sprint_s);
  idleEl.value = toMinField(cfg.idle_reset_s);
  renudgeEl.value = toMinField(cfg.renudge_every_s);
  onboarded = cfg.onboarded;

  // Reflect the real login-item state so the toggle matches reality on reopen.
  try {
    autostartOn = await isEnabled();
  } catch (err) {
    console.error("settings: isEnabled() failed", err);
    autostartOn = false;
  }
  renderAutostart();
}

// --- save ------------------------------------------------------------------
async function save(): Promise<void> {
  saveEl.disabled = true;
  msgEl.textContent = "";
  // Clamp minutes → persist-ready seconds within the v2 Presence bounds.
  const next: TomatoConfig = {
    sprint_s: minutesToClampedSeconds(parseFloat(sprintEl.value), SPRINT_BOUNDS),
    idle_reset_s: minutesToClampedSeconds(parseFloat(idleEl.value), IDLE_RESET_BOUNDS),
    renudge_every_s: minutesToClampedSeconds(parseFloat(renudgeEl.value), RENUDGE_BOUNDS),
    nudge_mode: DEFAULT_CONFIG.nudge_mode, // stopgap — Task 5 wires the real control
    onboarded, // preserved; set by first-run onboarding
  };

  // Step 1 — the actual persist. Only this failing means settings weren't saved.
  try {
    await saveConfig(next);
  } catch (err) {
    console.error("settings: saveConfig failed", err);
    msgEl.textContent = "Couldn't save settings.";
    saveEl.disabled = false;
    return;
  }

  // Step 2 — apply the autostart choice, then confirm the effective state so the
  // login entry and the persisted config never drift apart. Non-fatal.
  try {
    if (autostartOn) await enable();
    else await disable();
  } catch (err) {
    console.error("settings: autostart toggle failed", err);
  }

  // Step 3 — tell main to reload. Non-fatal (config is on disk already).
  try {
    await emit(SETTINGS_SAVED);
  } catch (err) {
    console.error("settings: emit(SETTINGS_SAVED) failed", err);
  }

  // Step 4 — close. If this fails the save still succeeded, so say so.
  try {
    await getCurrentWindow().close();
  } catch (err) {
    console.error("settings: window close failed", err);
    msgEl.textContent = "Saved — but the window wouldn't close.";
    saveEl.disabled = false;
  }
}

saveEl.addEventListener("click", () => void save());
cancelEl.addEventListener("click", () => void getCurrentWindow().close());

void load().catch((err) => console.error("settings failed to load", err));
