// Native config store — load/save Tomato's settings as human-readable JSON.
//
// IMPURE: depends on Tauri's fs + path plugins, so it is NOT unit-tested (the
// Tauri runtime is unavailable under node/vitest). Verify manually in-app.
//
// Config lives at $XDG_CONFIG_HOME/tomato/config.json (i.e. ~/.config/tomato/
// config.json on Linux).
//
// UNITS — PINNED CROSS-TASK CONTRACT (Tasks 9 & 12): every duration is stored in
// SECONDS, matching event `ts` (seconds) and the settings UI. The timer core
// works in MILLISECONDS, so consumers MUST convert seconds → ms when building a
// TimerConfig (e.g. `sprintMs: cfg.sprint_s * 1000`). Do NOT store ms here.

import { mkdir, writeTextFile, readTextFile, exists } from "@tauri-apps/plugin-fs";
import { configDir, join } from "@tauri-apps/api/path";

/** Enforcement mode: "enforced" holds the boundary; "soft" only nudges. */
export type EnforcementMode = "enforced" | "soft";

/** Tomato settings. All *_s fields are durations in SECONDS (see units note). */
export interface TomatoConfig {
  /** Focus sprint length, seconds. */
  sprint_s: number;
  /** Break length, seconds. */
  break_s: number;
  /** Post-boundary grace window, seconds. */
  grace_s: number;
  /** Allowance for ending a sprint early, seconds. */
  early_grace_s: number;
  /** Boundary enforcement behavior. */
  mode: EnforcementMode;
  /** Whether first-run onboarding has been completed. */
  onboarded: boolean;
}

/** Spec 1 defaults: 15m sprint / 5m break / 2m grace / 5m early-grace, enforced. */
export const DEFAULT_CONFIG: TomatoConfig = {
  sprint_s: 900,
  break_s: 300,
  grace_s: 120,
  early_grace_s: 300,
  mode: "enforced",
  onboarded: false,
};

const APP_DIR = "tomato";
const CONFIG_FILE = "config.json";

async function configPath(ensureDir: boolean): Promise<string> {
  const dir = await join(await configDir(), APP_DIR);
  if (ensureDir) await mkdir(dir, { recursive: true });
  return join(dir, CONFIG_FILE);
}

/**
 * Load config, merging any stored values OVER the defaults. Returns the full
 * defaults when the file is absent, and defaults for any individual key the
 * file omits (partial configs are tolerated).
 */
export async function loadConfig(): Promise<TomatoConfig> {
  const path = await configPath(false);
  if (!(await exists(path))) return { ...DEFAULT_CONFIG };
  try {
    const raw = JSON.parse(await readTextFile(path)) as Partial<TomatoConfig>;
    return { ...DEFAULT_CONFIG, ...raw };
  } catch {
    // Corrupt or unreadable config.json — fall back to defaults, same as absent.
    return { ...DEFAULT_CONFIG };
  }
}

/** Persist config as pretty-printed JSON (human-readable), creating the dir. */
export async function saveConfig(config: TomatoConfig): Promise<void> {
  const path = await configPath(true);
  await writeTextFile(path, JSON.stringify(config, null, 2) + "\n");
}
