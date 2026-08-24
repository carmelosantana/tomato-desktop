export type DndState = "active" | "inactive" | "unknown";
export type NudgeKind = "card" | "card-quiet" | "notification";

export function decideNudge(dnd: DndState): NudgeKind {
  switch (dnd) {
    case "inactive":
      return "card";
    case "active":
      return "notification";
    case "unknown":
      return "card-quiet";
    default: {
      const _exhaustive: never = dnd;
      return _exhaustive;
    }
  }
}

export interface DndDetector {
  current(): Promise<DndState>;
}
