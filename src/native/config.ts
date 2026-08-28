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

/** Tomato v2 settings. All *_s fields are durations in SECONDS (see units note). */
export interface TomatoConfig {
  /** Focus sprint length, seconds. */
  sprint_s: number;
  /** Idle span that resets an in-progress sprint, seconds. */
  idle_reset_s: number;
  /** Interval between renudges once a sprint boundary is reached, seconds. */
  renudge_every_s: number;
  /** Whether first-run onboarding has been completed. */
  onboarded: boolean;
}

/** v2 Presence defaults: 15m sprint / 5m idle-reset / 15m renudge. */
export const DEFAULT_CONFIG: TomatoConfig = {
  sprint_s: 900,
  idle_reset_s: 300,
  renudge_every_s: 900,
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
 * Load config and return a CLEANED object: for each known key, the stored value
 * when present else the default. Retired keys (e.g. v1's `break_s`, `grace_s`,
 * `early_grace_s`, `mode`) are silently ignored — never spread through. Returns
 * the full defaults when the file is absent or corrupt.
 */
export async function loadConfig(): Promise<TomatoConfig> {
  const path = await configPath(false);
  if (!(await exists(path))) return { ...DEFAULT_CONFIG };
  try {
    const raw = JSON.parse(await readTextFile(path)) as Partial<TomatoConfig>;
    return {
      sprint_s: raw.sprint_s ?? DEFAULT_CONFIG.sprint_s,
      idle_reset_s: raw.idle_reset_s ?? DEFAULT_CONFIG.idle_reset_s,
      renudge_every_s: raw.renudge_every_s ?? DEFAULT_CONFIG.renudge_every_s,
      onboarded: raw.onboarded ?? DEFAULT_CONFIG.onboarded,
    };
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
