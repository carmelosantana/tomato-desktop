// Ring geometry & progress — pure math for the tray ring. No Tauri/DOM/canvas
// here; Task 9 consumes these values to actually stroke the arc.
//
// Geometry constants mirror docs/design/tomato-tokens.json `ring` group
// byte-for-byte so the runtime ring matches the design kit exactly.

import type { TimerState } from "./timer";

/** Static ring geometry, mirroring the `ring` group in tomato-tokens.json. */
export interface RingGeometry {
  /** ring diameter / canvas size (tokens: ring.diameter-ratio) */
  diameterRatio: 0.84;
  /** stroke width / ring diameter (tokens: ring.stroke-ratio) */
  strokeRatio: 0.15;
  /** arc start, -90deg = 12 o'clock (tokens: ring.start-angle-deg) */
  startAngleDeg: -90;
  /** fill direction (tokens: ring.clockwise) */
  clockwise: true;
  /** stroke line cap (tokens: ring.cap) */
  cap: "round";
  /** inner gap in px (tokens: ring.inner-gap-px = "2px") */
  innerGapPx: 2;
}

export const RING_GEOMETRY: RingGeometry = {
  diameterRatio: 0.84,
  strokeRatio: 0.15,
  startAngleDeg: -90,
  clockwise: true,
  cap: "round",
  innerGapPx: 2,
};

export type RingColorRole = "focus" | "grace" | "overrun";
export type RingGlyph = "●" | "◑" | "◼" | "▲";

export interface RingVisual {
  /** clamped [0,1] fill fraction of the arc */
  progress: number;
  colorRole: RingColorRole;
  glyph: RingGlyph;
}

/** Resolved pixel dimensions for a given canvas size, ready for the renderer. */
export interface RingDimensions {
  size: number;
  /** canvas centre (size / 2) */
  center: number;
  /** ring diameter (size * diameterRatio) */
  diameter: number;
  /** ring radius (diameter / 2) */
  radius: number;
  /** stroke width (diameter * strokeRatio) */
  strokeWidth: number;
  /** radius of the stroke centre-line the arc is drawn on (radius - strokeWidth/2) */
  arcRadius: number;
  startAngleDeg: number;
  clockwise: boolean;
  cap: "round";
  innerGapPx: number;
}

/**
 * Fraction of the sprint elapsed, clamped to [0,1].
 * Returns 0 when totalMs <= 0; overflow (elapsed > total) clamps to 1.
 */
export function ringProgress(elapsedMs: number, totalMs: number): number {
  if (totalMs <= 0) return 0;
  const raw = elapsedMs / totalMs;
  if (raw <= 0) return 0;
  if (raw >= 1) return 1;
  return raw;
}

/**
 * Map timer state + sprint progress to the ring's visual triplet.
 *
 * Precedence:
 *  - break            → ◼ (fallback colorRole "focus"; the ring group has no
 *                          break progress colour, so break reuses the base role)
 *  - over-run (>1)    → ▲ / overrun  (soft mode carrying focus past the boundary)
 *  - grace            → ◑ / grace    (state === "grace" or graceActive flag)
 *  - focus            → ● / focus
 *  - idle | stopped   → ● / focus    (resting default)
 */
export function ringVisual(
  state: TimerState,
  sprintElapsedMs: number,
  sprintMs: number,
  graceActive: boolean,
): RingVisual {
  const progress = ringProgress(sprintElapsedMs, sprintMs);
  const rawRatio = sprintMs > 0 ? sprintElapsedMs / sprintMs : 0;

  if (state === "break") {
    return { progress, colorRole: "focus", glyph: "◼" };
  }

  // Over-run: focus carried past the boundary (soft mode) shows the overrun cue.
  if (rawRatio > 1) {
    return { progress, colorRole: "overrun", glyph: "▲" };
  }

  if (state === "grace" || graceActive) {
    return { progress, colorRole: "grace", glyph: "◑" };
  }

  // focus, idle, stopped → resting/active focus dot.
  return { progress, colorRole: "focus", glyph: "●" };
}

/** Resolve the ring's pixel dimensions for a canvas of `size` px. */
export function describeRing(size: number): RingDimensions {
  const diameter = size * RING_GEOMETRY.diameterRatio;
  const radius = diameter / 2;
  const strokeWidth = diameter * RING_GEOMETRY.strokeRatio;
  return {
    size,
    center: size / 2,
    diameter,
    radius,
    strokeWidth,
    arcRadius: radius - strokeWidth / 2,
    startAngleDeg: RING_GEOMETRY.startAngleDeg,
    clockwise: RING_GEOMETRY.clockwise,
    cap: RING_GEOMETRY.cap,
    innerGapPx: RING_GEOMETRY.innerGapPx,
  };
}
