// Spec 1 domain events — the persisted event vocabulary and the pure mapper from
// the timer's lightweight TimerEvents. This is the seam Spec 2 (and the local
// JSONL store + stats) consume. No native/DOM/network dependency here.
//
// Envelope: { event, ts, sprint_id, ... }; `ts` is UNIX SECONDS; a break carries
// its parent sprint_id. See docs/design/uploads/2026-08-23-agentic-15min-window-spec.md.

import type { TimerEvent } from "./timer";

interface Envelope {
  ts: number;
  sprint_id: string;
}

export type DomainEvent =
  | (Envelope & { event: "sprint_started"; planned_s: number; enforcement_mode: "enforced" | "soft" })
  | (Envelope & { event: "boundary_reached" })
  | (Envelope & { event: "grace_started"; grace_s: number; streak_index: number })
  | (Envelope & { event: "grace_ended"; actual_grace_s: number; ended_by: "user" | "timeout" })
  | (Envelope & { event: "break_started"; break_id: string; planned_s: number })
  | (Envelope & { event: "break_completed"; break_id: string; actual_s: number })
  | (Envelope & { event: "break_skipped"; break_id?: string; after_s: number })
  | (Envelope & { event: "sprint_ended"; actual_focus_s: number; over_run_s: number });

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
 * Context threaded into the pure mapper. Ids and the timer-state–derived numeric
 * fields (durations, over-run) are passed IN by the caller — the mapper never
 * generates uuids or reads the clock, so mapping is deterministic. `ts` is derived
 * per event from the TimerEvent's own `at` (ms → seconds), not from a live clock.
 */
export interface MapContext {
  /** Per-sprint id; a break carries its parent sprint_id. */
  sprintId: string;
  /** Per-break id; absent when no break was in play (e.g. skipped before start). */
  breakId?: string;
  enforcementMode: "enforced" | "soft";
  /** planned_s for sprint_started. */
  plannedFocusS: number;
  /** planned_s for break_started. */
  plannedBreakS: number;
  /** streak_index for grace_started. */
  streakIndex: number;
  /** actual_grace_s for grace_ended. */
  actualGraceS?: number;
  /** actual_s for break_completed. */
  actualBreakS?: number;
  /** after_s for break_skipped. */
  afterS?: number;
  /** actual_focus_s for sprint_ended. */
  actualFocusS?: number;
  /** over_run_s for sprint_ended. */
  overRunS?: number;
}

const toSeconds = (ms: number): number => Math.floor(ms / 1000);

/**
 * Pure mapping from the timer's lightweight events to persisted DomainEvents.
 * TOTAL over the TimerEvent union: every variant is handled. `nudge` is a UI-only
 * boundary hint with no Spec 1 domain event, so it maps to nothing.
 */
export function toDomainEvents(raw: TimerEvent[], ctx: MapContext): DomainEvent[] {
  const out: DomainEvent[] = [];
  for (const e of raw) {
    const ts = toSeconds(e.at);
    const sprint_id = ctx.sprintId;
    switch (e.type) {
      case "focus-started":
        out.push({ event: "sprint_started", ts, sprint_id, planned_s: ctx.plannedFocusS, enforcement_mode: ctx.enforcementMode });
        break;
      case "boundary-reached":
        out.push({ event: "boundary_reached", ts, sprint_id });
        break;
      case "grace-started":
        out.push({ event: "grace_started", ts, sprint_id, grace_s: toSeconds(e.graceMs), streak_index: ctx.streakIndex });
        break;
      case "grace-ended":
        out.push({ event: "grace_ended", ts, sprint_id, actual_grace_s: ctx.actualGraceS ?? 0, ended_by: e.ended_by });
        break;
      case "break-started":
        out.push({ event: "break_started", ts, sprint_id, break_id: ctx.breakId ?? "", planned_s: ctx.plannedBreakS });
        break;
      case "break-completed":
        out.push({ event: "break_completed", ts, sprint_id, break_id: ctx.breakId ?? "", actual_s: ctx.actualBreakS ?? 0 });
        break;
      case "break-skipped": {
        const skipped: DomainEvent = { event: "break_skipped", ts, sprint_id, after_s: ctx.afterS ?? 0 };
        if (ctx.breakId !== undefined) skipped.break_id = ctx.breakId;
        out.push(skipped);
        break;
      }
      case "stopped":
        out.push({ event: "sprint_ended", ts, sprint_id, actual_focus_s: ctx.actualFocusS ?? 0, over_run_s: ctx.overRunS ?? 0 });
        break;
      case "nudge":
        // UI-only boundary hint; no Spec 1 domain event.
        break;
      default: {
        const _exhaustive: never = e;
        return _exhaustive;
      }
    }
  }
  return out;
}
