// Shared event vocabulary for the boundary webview windows (grace toast + break
// card) and the main loop. Pure constants + payload types, no Tauri/DOM import,
// so both sides depend on one source of truth for channel names.

/** Main → grace toast: current grace time remaining. */
export const GRACE_UPDATE = "tomato://grace-update";
/** Main → break card: current break time remaining + whether grace is still on. */
export const BREAK_UPDATE = "tomato://break-update";
/** Toast/card → main: end grace and start the break now (drives breakNow). */
export const BREAK_NOW = "tomato://break-now";
/** Card → main: skip the break entirely (drives skipBreak). */
export const SKIP_BREAK = "tomato://skip-break";

export interface GraceUpdate {
  /** Grace time remaining, milliseconds. */
  remainingMs: number;
}

export interface BreakUpdate {
  /** Break time remaining, milliseconds. */
  remainingMs: number;
  /** Total planned break length, milliseconds. */
  totalMs: number;
  /** True only while the machine is still in grace (gates the card's Break now). */
  inGrace: boolean;
}
