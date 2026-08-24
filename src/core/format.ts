// Pure time formatting for the boundary UX countdowns. No Tauri/DOM dependency.

/**
 * Format a non-negative millisecond duration as M:SS (minutes uncapped, seconds
 * zero-padded). Rounds UP to the next whole second so a countdown reads the
 * ceiling of the time remaining (e.g. 1999ms → "0:02", 120000ms → "2:00").
 * Negative inputs clamp to "0:00".
 */
export function formatMMSS(ms: number): string {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}
