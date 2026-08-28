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
