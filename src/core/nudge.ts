export type DndState = "active" | "inactive" | "unknown";
export type NudgeDecision = "notify" | "suppress";

export function decideNudge(dnd: DndState): NudgeDecision {
  switch (dnd) {
    case "active":
      return "suppress";
    case "inactive":
    case "unknown":
      return "notify";
    default: {
      const _exhaustive: never = dnd;
      return _exhaustive;
    }
  }
}

export interface DndDetector {
  current(): Promise<DndState>;
}

/** The user's preference for which surface fires at which nudge index. */
export type NudgeMode = "soft" | "hard" | "escalating";

/** How a nudge is delivered. Two surfaces only. */
export type NudgeSurface = "soft" | "hard";

const NUDGE_MODES: readonly NudgeMode[] = ["soft", "hard", "escalating"];

/** Narrow an unknown (a hand-edited config value, a retired key) to a NudgeMode. */
export function isNudgeMode(value: unknown): value is NudgeMode {
  return typeof value === "string" && (NUDGE_MODES as readonly string[]).includes(value);
}

/**
 * Which surface a coalesced batch warrants, given the mode and the batch's
 * HIGHEST nudge index.
 *  - "soft"       → always the quiet desktop notification.
 *  - "hard"       → always the on-screen overlay, boundary included.
 *  - "escalating" → soft at the boundary (index 0), hard from the first
 *                   re-nudge (index >= 1).
 * While a game is running (`ctx.gaming`) the overlay never fires: whatever the
 * mode, the nudge falls back to the quiet notification.
 * Pure and total. The DND gate (decideNudge) is applied separately by the shell
 * and suppresses BOTH surfaces.
 */
export function chooseNudgeSurface(
  mode: NudgeMode,
  maxIndex: number,
  ctx: { gaming: boolean } = { gaming: false },
): NudgeSurface {
  if (ctx.gaming) return "soft";
  switch (mode) {
    case "soft":
      return "soft";
    case "hard":
      return "hard";
    case "escalating":
      return maxIndex >= 1 ? "hard" : "soft";
    default: {
      const _exhaustive: never = mode;
      return _exhaustive;
    }
  }
}

/**
 * Button label for the overlay's dismiss lock. Seconds round UP, so a fresh
 * 10000 ms lock reads "Dismiss in 10" and the display never shows a zero before
 * the lock actually lifts. At or below zero the button is unlocked.
 */
export function dismissLockLabel(remainingMs: number): string {
  if (remainingMs <= 0) return "Dismiss";
  return `Dismiss in ${Math.ceil(remainingMs / 1000)}`;
}

/** Overlay → main: "dismiss and reset the counter" (end the sprint now). */
export const NUDGE_RESET = "tomato://nudge-reset";
