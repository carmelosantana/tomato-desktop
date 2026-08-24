// Settings window script — loads the current config, lets the user edit the
// durations (shown in MINUTES), enforcement mode, and autostart-on-login, then
// on Save persists via saveConfig() and signals main to reload (SETTINGS_SAVED).
//
// IMPURE / webview-only: uses Tauri's fs (via native/config), the autostart
// plugin, the event bus, the window API, and the DOM. Not unit-tested; the pure
// pieces it leans on (minutesToClampedSeconds, secondsToMinutes, the bounds,
// resolveTheme) ARE unit-tested in core.

import { emit } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { enable, disable, isEnabled } from "@tauri-apps/plugin-autostart";

import { loadConfig, saveConfig, DEFAULT_CONFIG } from "./native/config";
import type { TomatoConfig, EnforcementMode } from "./native/config";
import {
  minutesToClampedSeconds,
  secondsToMinutes,
  SETTINGS_SAVED,
  SPRINT_BOUNDS,
  BREAK_BOUNDS,
  GRACE_BOUNDS,
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
const breakEl = $<HTMLInputElement>("break");
const graceEl = $<HTMLInputElement>("grace");
const modeGroup = $("mode");
const autostartEl = $<HTMLButtonElement>("autostart");
const saveEl = $<HTMLButtonElement>("save");
const cancelEl = $<HTMLButtonElement>("cancel");
const msgEl = $("msg");

// Local UI state that is not a plain form value.
let mode: EnforcementMode = DEFAULT_CONFIG.mode;
let autostartOn = false;
// early_grace_s is not exposed as a control; preserve whatever is stored.
let earlyGraceS = DEFAULT_CONFIG.early_grace_s;

// Round to at most one decimal place for a clean minutes display (e.g. 0.5).
const toMinField = (seconds: number): string =>
  String(Math.round(secondsToMinutes(seconds) * 10) / 10);

// --- enforcement segmented toggle ------------------------------------------
function renderMode(): void {
  for (const btn of modeGroup.querySelectorAll<HTMLButtonElement>(".seg")) {
    btn.setAttribute("aria-checked", String(btn.dataset.mode === mode));
  }
}
modeGroup.addEventListener("click", (e) => {
  const btn = (e.target as HTMLElement).closest<HTMLButtonElement>(".seg");
  if (!btn || !btn.dataset.mode) return;
  mode = btn.dataset.mode as EnforcementMode;
  renderMode();
});

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
  breakEl.value = toMinField(cfg.break_s);
  graceEl.value = toMinField(cfg.grace_s);
  mode = cfg.mode;
  earlyGraceS = cfg.early_grace_s;
  renderMode();

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
  try {
    // Clamp minutes → persist-ready seconds within the Spec 1 bounds.
    const next: TomatoConfig = {
      sprint_s: minutesToClampedSeconds(parseFloat(sprintEl.value), SPRINT_BOUNDS),
      break_s: minutesToClampedSeconds(parseFloat(breakEl.value), BREAK_BOUNDS),
      grace_s: minutesToClampedSeconds(parseFloat(graceEl.value), GRACE_BOUNDS),
      early_grace_s: earlyGraceS, // preserved; not exposed as a control
      mode,
    };
    await saveConfig(next);

    // Apply the autostart choice, then confirm the effective state so the login
    // entry and the persisted config never drift apart.
    try {
      if (autostartOn) await enable();
      else await disable();
    } catch (err) {
      console.error("settings: autostart toggle failed", err);
    }

    // Tell main to re-read config (durations/mode apply on the NEXT sprint).
    await emit(SETTINGS_SAVED);
    await getCurrentWindow().close();
  } catch (err) {
    console.error("settings: save failed", err);
    msgEl.textContent = "Couldn't save settings.";
    saveEl.disabled = false;
  }
}

saveEl.addEventListener("click", () => void save());
cancelEl.addEventListener("click", () => void getCurrentWindow().close());

void load().catch((err) => console.error("settings failed to load", err));
