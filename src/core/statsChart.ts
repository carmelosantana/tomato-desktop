// Pure chart geometry for the Stats window. NO DOM / SVG / clock access — these
// helpers only turn numbers into the coordinates a hand-rolled SVG/flex chart
// needs, so they are deterministic and unit-tested. DOM rendering lives in
// src/stats.ts; keep it out of here.

/**
 * Map bar values to pixel heights against a fixed max height. The tallest value
 * maps to `maxPx`; the rest scale proportionally. Zero (or negative) values map
 * to 0. All-zero input → all zeros (caller shows a flat track).
 */
export function scaleBars(values: number[], maxPx: number): number[] {
  const max = Math.max(0, ...values);
  if (max <= 0) return values.map(() => 0);
  return values.map((v) => (v > 0 ? (v / max) * maxPx : 0));
}

/** One rendered bar of the 7-day active-minutes chart. */
export interface WeekBar {
  /** Local-day label, YYYY-MM-DD. */
  date: string;
  /** Single-letter weekday label (S M T W T F S), derived from `date`. */
  label: string;
  /** Active minutes this day represents. */
  activeMinutes: number;
  /** Bar height in pixels — tallest day maps to `maxPx`, rest scale down. */
  heightPx: number;
}

const DAY_LETTERS = ["S", "M", "T", "W", "T", "F", "S"] as const;

/** Weekday letter for a YYYY-MM-DD label, parsed as a LOCAL date. */
function weekdayLetter(dateLabel: string): string {
  const [y, m, d] = dateLabel.split("-").map(Number);
  return DAY_LETTERS[new Date(y, m - 1, d).getDay()];
}

/**
 * Build the 7-day active-minutes bar series for the Stats window. Heights are
 * scaled with `scaleBars` (tallest day → `maxPx`; an all-zero week → all zeros),
 * and each bar carries its local weekday letter. Rendering (SVG/flex) stays in
 * the window; this stays pure and deterministic.
 */
export function weekBars(
  week: Array<{ date: string; activeMinutes: number }>,
  maxPx: number,
): WeekBar[] {
  const heights = scaleBars(week.map((d) => d.activeMinutes), maxPx);
  return week.map((d, i) => ({
    date: d.date,
    label: weekdayLetter(d.date),
    activeMinutes: d.activeMinutes,
    heightPx: heights[i],
  }));
}
