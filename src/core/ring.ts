// Ring geometry & progress — pure math for the tray ring. No Tauri/DOM/canvas
// here; Task 9 consumes these values to actually stroke the arc.
//
// Geometry constants mirror docs/design/tomato-tokens.json `ring` group
// byte-for-byte so the runtime ring matches the design kit exactly.

import type { PresenceState } from "./presence";

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

/**
 * Presence-companion ring roles (v2). The ring is a passive read-out of the
 * PresenceMachine, so there are exactly three visual states:
 *  - `idle`    — no active sprint (away/paused): empty ring, muted.
 *  - `focus`   — active sprint below the soft boundary: arc fills to progress.
 *  - `overrun` — active sprint at/past the boundary: full arc, over-run color.
 */
export type RingColorRole = "idle" | "focus" | "overrun";

export interface RingVisual {
  /** clamped [0,1] fill fraction of the arc */
  progress: number;
  colorRole: RingColorRole;
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
 * Project the presence state + active span onto the ring's visual pair.
 *
 * The ring only ever reflects an ACTIVE sprint:
 *  - `away` / `paused`            → `{ progress: 0, colorRole: "idle" }` — the ring
 *                                    rests empty; `activeMs` is ignored.
 *  - `active`, `activeMs < sprintMs`  → `{ progress: clamp01(activeMs/sprintMs),
 *                                    colorRole: "focus" }` — the arc fills toward
 *                                    the soft boundary.
 *  - `active`, `activeMs >= sprintMs` → `{ progress: 1, colorRole: "overrun" }` —
 *                                    at/past the boundary the ring is full and the
 *                                    companion is gently nudging.
 */
export function ringVisual(state: PresenceState, activeMs: number, sprintMs: number): RingVisual {
  if (state !== "active") {
    return { progress: 0, colorRole: "idle" };
  }
  if (activeMs >= sprintMs) {
    return { progress: 1, colorRole: "overrun" };
  }
  return { progress: ringProgress(activeMs, sprintMs), colorRole: "focus" };
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

/**
 * The overrun "pulse": while the ring is red the tray icon alternates between
 * the plain ring and a ring with a filled center on each redraw, so the icon
 * catches the eye. Off (plain ring) in every other role.
 */
export function nextPulse(role: RingColorRole, prevOn: boolean): boolean {
  return role === "overrun" ? !prevOn : false;
}
