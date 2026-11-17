// Tomato v2 "Presence Companion" — the persisted event vocabulary and the pure
// mapper from the PresenceMachine's lightweight PresenceEvents. This is the seam
// the local JSONL store + stats consume. No native/DOM/network dependency here.
//
// Envelope: { event, ts, sprint_id, ... }; `ts` is UNIX SECONDS. All PresenceEvent
// millisecond fields are converted to seconds by flooring.

import type { PresenceEvent } from "./presence";

interface Envelope {
  ts: number;
  sprint_id: string;
}

export type DomainEvent =
  | (Envelope & { event: "sprint_started"; trigger: "activity" | "manual" })
  | (Envelope & { event: "nudge"; active_s: number; index: number })
  | (Envelope & {
      event: "sprint_ended";
      active_s: number;
      over_s: number;
      ended_by: "idle_reset" | "paused" | "manual" | "reset";
    });

/** Sink for persisting domain events. The JSONL impl lands in a later task. */
export interface EventSink {
  append(e: DomainEvent): Promise<void>;
}

/** In-memory fake for tests and later composition. */
export class InMemoryEventSink implements EventSink {
  readonly events: DomainEvent[] = [];
  async append(e: DomainEvent): Promise<void> {
    this.events.push(e);
  }
}

/**
 * Context threaded into the pure mapper. The sprint id is passed IN by the caller
 * — the mapper never generates uuids or reads the clock, so mapping is
 * deterministic. `ts` is derived per event from the PresenceEvent's own `at`
 * (ms → seconds). `trigger` is a fallback for sprint_started; the event's own
 * trigger wins when present (which it always is on `sprint-started`).
 */
export interface MapContext {
  /** Per-sprint id stamped onto every mapped event's envelope. */
  sprintId: string;
  /** Fallback trigger for sprint_started; the event's own trigger takes priority. */
  trigger: "activity" | "manual";
}

const toSeconds = (ms: number): number => Math.floor(ms / 1000);

/**
 * Pure mapping from the PresenceMachine's lightweight events to persisted
 * DomainEvents. TOTAL over the PresenceEvent union: every variant is handled.
 */
export function toDomainEvents(raw: PresenceEvent[], ctx: MapContext): DomainEvent[] {
  const out: DomainEvent[] = [];
  for (const e of raw) {
    const ts = toSeconds(e.at);
    const sprint_id = ctx.sprintId;
    switch (e.type) {
      case "sprint-started":
        out.push({ event: "sprint_started", ts, sprint_id, trigger: e.trigger ?? ctx.trigger });
        break;
      case "nudge":
        out.push({ event: "nudge", ts, sprint_id, active_s: toSeconds(e.activeMs), index: e.index });
        break;
      case "sprint-ended":
        out.push({
          event: "sprint_ended",
          ts,
          sprint_id,
          active_s: toSeconds(e.activeMs),
          over_s: toSeconds(e.overMs),
          ended_by: e.endedBy,
        });
        break;
      default: {
        const _exhaustive: never = e;
        return _exhaustive;
      }
    }
  }
  return out;
}
