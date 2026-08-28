/// <reference types="vite/client" />
// Tray icon rendering — the runtime-drawn ring plus the static kit fallbacks.
//
// IMPURE / webview-only: renderRing uses OffscreenCanvas (a webview API that is
// unavailable under node/vitest), so this module is NOT unit-tested — verify it
// manually inside a running Tauri app. The pure geometry (describeRing) and the
// color tokens it leans on ARE unit-tested in src/core.
//
// - focus / overrun  → renderRing() draws the arc per describeRing().
// - idle             → renderRing() draws an empty (progress 0) muted ring; the
//                      static kit PNG remains available via staticIconUrl().

import { describeRing } from "../core/ring";
import type { RingColorRole } from "../core/ring";
import { ringProgressColor, ringTrackColor } from "../core/tokens";
import type { Theme } from "../core/tokens";

/**
 * Map a v2 ring color role to a theme color token. This is the single place that
 * couples presence roles to design tokens:
 *  - `idle`    → the muted `--ring-track` / neutral border token (empty ring).
 *  - `focus`   → the `--focus` state token.
 *  - `overrun` → the `--overrun` state token.
 */
function roleColor(theme: Theme, role: RingColorRole): string {
  if (role === "idle") return ringTrackColor(theme);
  return ringProgressColor(theme, role);
}

/**
 * Draw the tray ring and return raw RGBA bytes (length = size*size*4), ready for
 * `Image.new(rgba, size, size)`.
 *
 * Geometry comes from describeRing(): the arc starts at −90° (12 o'clock) and
 * fills clockwise with a round cap. The unfilled track is a full circle in the
 * theme's `--ring-track` color; the progress arc uses the role color.
 */
export function renderRing(
  size: number,
  progress: number,
  colorRole: RingColorRole,
  theme: Theme,
): Uint8Array {
  const dims = describeRing(size);
  const canvas = new OffscreenCanvas(size, size);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("OffscreenCanvas 2d context unavailable");

  ctx.clearRect(0, 0, size, size);
  ctx.lineWidth = dims.strokeWidth;
  ctx.lineCap = dims.cap;

  // Track: full circle behind the progress arc.
  ctx.strokeStyle = ringTrackColor(theme);
  ctx.beginPath();
  ctx.arc(dims.center, dims.center, dims.arcRadius, 0, Math.PI * 2);
  ctx.stroke();

  // Progress arc: from −90°, sweeping clockwise by `progress` of a full turn.
  const p = Math.max(0, Math.min(1, progress));
  if (p > 0) {
    const startRad = (dims.startAngleDeg * Math.PI) / 180;
    const sweep = p * Math.PI * 2 * (dims.clockwise ? 1 : -1);
    ctx.strokeStyle = roleColor(theme, colorRole);
    ctx.beginPath();
    ctx.arc(dims.center, dims.center, dims.arcRadius, startRad, startRad + sweep, !dims.clockwise);
    ctx.stroke();
  }

  const { data } = ctx.getImageData(0, 0, size, size);
  return new Uint8Array(data.buffer.slice(0));
}

// Static kit PNGs (color set) for the resting states, bundled by Vite. Keyed by
// their resolved URL so we can pick the nearest available pixel size.
const STATIC_ICONS = import.meta.glob<string>("../assets/tray/tray-*.png", {
  eager: true,
  query: "?url",
  import: "default",
});

const AVAILABLE_SIZES = [16, 22, 24, 32, 44, 48, 64];

/** Smallest kit size ≥ `size`, or the largest available if `size` exceeds all. */
function nearestSize(size: number): number {
  return AVAILABLE_SIZES.find((s) => s >= size) ?? AVAILABLE_SIZES[AVAILABLE_SIZES.length - 1];
}

/**
 * Bundled URL for the static kit icon of a resting state (`idle` or `break`) at
 * the size nearest to `size`. The caller fetches it and builds an Image via
 * `Image.fromBytes(...)`.
 */
export function staticIconUrl(state: "idle" | "break", size: number): string {
  const px = nearestSize(size);
  const suffix = `/tray-${state}-${px}.png`;
  const key = Object.keys(STATIC_ICONS).find((k) => k.endsWith(suffix));
  if (!key) throw new Error(`no static tray icon for ${state}@${px}`);
  return STATIC_ICONS[key];
}
