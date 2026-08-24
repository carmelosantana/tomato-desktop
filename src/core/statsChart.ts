// Pure chart geometry for the Stats window. NO DOM / SVG / clock access — these
// helpers only turn numbers into the coordinates a hand-rolled SVG/flex chart
// needs, so they are deterministic and unit-tested. DOM rendering lives in
// src/stats.ts; keep it out of here.

/** One wedge of a donut, as SVG stroke-dash geometry (apply rotate(-90) in the
 *  SVG so the first wedge starts at 12 o'clock). */
export interface DonutSegment {
  /** Index into the input values array. */
  index: number;
  /** The raw value this wedge represents. */
  value: number;
  /** Arc length of the wedge (stroke-dasharray first number). */
  length: number;
  /** Remaining circumference (stroke-dasharray second number). */
  gap: number;
  /** stroke-dashoffset: negative cumulative length of preceding wedges. */
  offset: number;
}

export interface Donut {
  /** 2·π·r for the given radius. */
  circumference: number;
  /** One entry per NON-ZERO value, in input order. Empty when total is 0. */
  segments: DonutSegment[];
}

/**
 * Split `values` into donut wedges around a circle of the given radius. Wedges
 * are proportional to each value over the total; zero values are omitted (no
 * zero-length stroke artifacts). Total 0 → no segments (caller draws an empty
 * track). Negative values are clamped to 0.
 */
export function donutSegments(values: number[], radius: number): Donut {
  const circumference = 2 * Math.PI * radius;
  const safe = values.map((v) => (v > 0 ? v : 0));
  const total = safe.reduce((a, b) => a + b, 0);
  if (total <= 0) return { circumference, segments: [] };

  const segments: DonutSegment[] = [];
  let cumulative = 0;
  for (let i = 0; i < safe.length; i++) {
    const v = safe[i];
    if (v <= 0) continue;
    const length = (v / total) * circumference;
    segments.push({
      index: i,
      value: v,
      length,
      gap: circumference - length,
      offset: -cumulative,
    });
    cumulative += length;
  }
  return { circumference, segments };
}

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

/** One placed segment of the day timeline, as percentages of the window width. */
export interface TimelineSeg {
  kind: "sprint" | "break";
  /** Left edge, 0–100 (% of the window). */
  leftPct: number;
  /** Width, 0–100 (% of the window). */
  widthPct: number;
}

const HOUR_S = 3600;

/**
 * Choose the timeline's time window. With intervals present it spans the first
 * start to the last end, each rounded OUT to the hour for a clean axis. With no
 * intervals it falls back to [fallbackStartS, fallbackEndS] (also hour-rounded).
 */
export function timelineWindow(
  intervals: Array<{ startS: number; endS: number }>,
  fallbackStartS: number,
  fallbackEndS: number,
): { startS: number; endS: number } {
  let startS = fallbackStartS;
  let endS = fallbackEndS;
  if (intervals.length > 0) {
    startS = Math.min(...intervals.map((i) => i.startS));
    endS = Math.max(...intervals.map((i) => i.endS));
  }
  const flooredStart = Math.floor(startS / HOUR_S) * HOUR_S;
  const ceiledEnd = Math.ceil(endS / HOUR_S) * HOUR_S;
  // Guard against a degenerate (or inverted) window: give it at least one hour.
  if (ceiledEnd <= flooredStart) return { startS: flooredStart, endS: flooredStart + HOUR_S };
  return { startS: flooredStart, endS: ceiledEnd };
}

/**
 * Place intervals along the window as left/width percentages, clamped to
 * [0,100]. Intervals fully outside the window (or of non-positive placed width)
 * are dropped. A non-positive window returns [].
 */
export function timelineSegments(
  intervals: Array<{ kind: "sprint" | "break"; startS: number; endS: number }>,
  windowStartS: number,
  windowEndS: number,
): TimelineSeg[] {
  const span = windowEndS - windowStartS;
  if (span <= 0) return [];
  const clamp = (p: number): number => Math.max(0, Math.min(100, p));
  const out: TimelineSeg[] = [];
  for (const iv of intervals) {
    const left = clamp(((iv.startS - windowStartS) / span) * 100);
    const right = clamp(((iv.endS - windowStartS) / span) * 100);
    const widthPct = right - left;
    if (widthPct <= 0) continue;
    out.push({ kind: iv.kind, leftPct: left, widthPct });
  }
  return out;
}
