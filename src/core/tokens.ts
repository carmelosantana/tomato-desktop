// Ring/state color tokens — a typed, PURE mirror of the `ring` + `state` groups
// in docs/design/tomato-tokens.json. The runtime tray-ring renderer consumes
// these so the drawn ring matches the design kit exactly. tokens.test.ts guards
// against drift by pinning a few values to the tokens.json source.
//
// No Tauri/DOM/canvas here — keep this importable from both node (tests) and the
// webview (renderer).

/** Resolved color theme for the tray (system → one of these two). */
export type Theme = "light" | "dark";

/**
 * Progress-arc token names in the `state` group. Kept independent of the ring's
 * `RingColorRole` (roles no longer map 1:1 to token names — e.g. the `idle` role
 * resolves to the track/border token, not a `state` token — so the color-role →
 * token mapping lives in native/trayIcon.ts).
 */
export type RingProgressToken = "focus" | "grace" | "overrun";

/** The four colors the ring renderer needs, per theme. */
export interface RingTokens {
  /** Unfilled ring track — mirrors color.<mode>.neutral.border. */
  track: string;
  /** Focus arc — mirrors color.<mode>.state.focus (glyph ●). */
  focus: string;
  /** Grace arc — mirrors color.<mode>.state.grace (glyph ◑). */
  grace: string;
  /** Over-run arc — mirrors color.<mode>.state.overrun (glyph ▲). */
  overrun: string;
}

/**
 * Light + dark ring colors, copied byte-for-byte from tomato-tokens.json:
 *  - track   ← color.<mode>.neutral.border
 *  - focus   ← color.<mode>.state.focus
 *  - grace   ← color.<mode>.state.grace
 *  - overrun ← color.<mode>.state.overrun
 */
export const RING_TOKENS: Record<Theme, RingTokens> = {
  light: {
    track: "#e6ddd2",
    focus: "#128a7a",
    grace: "#c98420",
    overrun: "#cf3b30",
  },
  dark: {
    track: "#39312a",
    focus: "#2bb6a2",
    grace: "#e5a23e",
    overrun: "#eb5a4d",
  },
};

/** Track (unfilled ring) color for a theme. */
export function ringTrackColor(theme: Theme): string {
  return RING_TOKENS[theme].track;
}

/** Progress-arc color for a `state`-group token name in a theme. */
export function ringProgressColor(theme: Theme, token: RingProgressToken): string {
  return RING_TOKENS[theme][token];
}
