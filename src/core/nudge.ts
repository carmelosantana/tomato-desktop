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

/**
 * Which nudge surface a batch warrants, by its HIGHEST nudge index.
 *  - index 0 (the sprint boundary) → "soft" (a quiet desktop notification).
 *  - index >= 1 (any re-nudge) → "hard" (the on-screen overlay).
 * Pure and total; the DND gate (decideNudge) is applied separately by the shell.
 */
export function escalateNudge(maxIndex: number): "soft" | "hard" {
  return maxIndex >= 1 ? "hard" : "soft";
}
