// Pure settings-form logic: minutes↔seconds conversion with clamping to the
// Spec 1 duration bounds. No Tauri/DOM dependency, so it is unit-tested here and
// reused by the (impure) settings window script.
//
// The config store keeps every duration in SECONDS (see native/config.ts), while
// the settings UI presents durations to the user in MINUTES. These helpers are
// the single source of truth for that conversion and for enforcing the bounds
// before anything is persisted.

/** Inclusive second bounds for one duration control. */
export interface DurationBounds {
  readonly minS: number;
  readonly maxS: number;
}

/** Spec 1 duration bounds (seconds). */
export const SPRINT_BOUNDS: DurationBounds = { minS: 60, maxS: 3600 };
export const BREAK_BOUNDS: DurationBounds = { minS: 30, maxS: 1800 };
export const GRACE_BOUNDS: DurationBounds = { minS: 0, maxS: 600 };

/** Main ⇄ settings channel: settings window → main, "config was saved, reload". */
export const SETTINGS_SAVED = "tomato://settings-saved";

/** Clamp `n` to the inclusive range [lo, hi]. */
export function clamp(n: number, lo: number, hi: number): number {
  if (n < lo) return lo;
  if (n > hi) return hi;
  return n;
}

/**
 * Convert a minutes value to whole seconds, rounding to the nearest second. A
 * non-finite input (empty/NaN field) yields 0 so the caller's clamp lands it on
 * the lower bound rather than propagating NaN.
 */
export function minutesToSeconds(minutes: number): number {
  if (!Number.isFinite(minutes)) return 0;
  return Math.round(minutes * 60);
}

/** Convert whole seconds to minutes (may be fractional, e.g. 30s → 0.5). */
export function secondsToMinutes(seconds: number): number {
  return seconds / 60;
}

/**
 * Take a minutes value from the UI and return the persist-ready SECONDS: round
 * to whole seconds, then clamp into the control's bounds. This is the load-
 * bearing sanitizer used on Save.
 */
export function minutesToClampedSeconds(minutes: number, bounds: DurationBounds): number {
  return clamp(minutesToSeconds(minutes), bounds.minS, bounds.maxS);
}

/**
 * Keystroke-level guard for the plain-text duration fields: keep only digits and
 * a single decimal point (the first one wins; later dots are dropped). This lets
 * the inputs be `type="text"` — no spinner arrows — while still refusing letters
 * and stray punctuation as the user types. Final bounds clamping still happens on
 * Save via `minutesToClampedSeconds`.
 */
export function sanitizeNumericField(raw: string): string {
  let out = "";
  let dotSeen = false;
  for (const ch of raw) {
    if (ch >= "0" && ch <= "9") {
      out += ch;
    } else if (ch === "." && !dotSeen) {
      out += ch;
      dotSeen = true;
    }
  }
  return out;
}
