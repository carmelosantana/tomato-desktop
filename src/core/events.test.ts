import { describe, it, expect } from "vitest";
import { toDomainEvents, InMemoryEventSink, type DomainEvent, type MapContext } from "./events";
import type { TimerEvent } from "./timer";

const ctx: MapContext = {
  sprintId: "S1",
  breakId: "B1",
  enforcementMode: "enforced",
  plannedFocusS: 900,
  plannedBreakS: 300,
  streakIndex: 0,
};

describe("toDomainEvents mapping", () => {
  it("maps focus-started → sprint_started (planned_s, enforcement_mode, ts in seconds)", () => {
    const raw: TimerEvent[] = [{ type: "focus-started", at: 5_000 }];
    expect(toDomainEvents(raw, ctx)).toEqual<DomainEvent[]>([
      { event: "sprint_started", ts: 5, sprint_id: "S1", planned_s: 900, enforcement_mode: "enforced" },
    ]);
  });

  it("maps boundary-reached → boundary_reached (no extra fields)", () => {
    const raw: TimerEvent[] = [{ type: "boundary-reached", at: 900_000 }];
    expect(toDomainEvents(raw, ctx)).toEqual<DomainEvent[]>([
      { event: "boundary_reached", ts: 900, sprint_id: "S1" },
    ]);
  });

  it("maps grace-started → grace_started (grace_s from event, streak_index from ctx)", () => {
    const raw: TimerEvent[] = [{ type: "grace-started", at: 900_000, graceMs: 300_000 }];
    expect(toDomainEvents(raw, { ...ctx, streakIndex: 2 })).toEqual<DomainEvent[]>([
      { event: "grace_started", ts: 900, sprint_id: "S1", grace_s: 300, streak_index: 2 },
    ]);
  });

  it("maps grace-ended → grace_ended (actual_grace_s from ctx, ended_by from event)", () => {
    const raw: TimerEvent[] = [{ type: "grace-ended", at: 960_000, ended_by: "user" }];
    expect(toDomainEvents(raw, { ...ctx, actualGraceS: 60 })).toEqual<DomainEvent[]>([
      { event: "grace_ended", ts: 960, sprint_id: "S1", actual_grace_s: 60, ended_by: "user" },
    ]);
  });

  it("maps break-started → break_started (break_id + planned_s)", () => {
    const raw: TimerEvent[] = [{ type: "break-started", at: 960_000 }];
    expect(toDomainEvents(raw, ctx)).toEqual<DomainEvent[]>([
      { event: "break_started", ts: 960, sprint_id: "S1", break_id: "B1", planned_s: 300 },
    ]);
  });

  it("maps break-completed → break_completed (break_id + actual_s from ctx)", () => {
    const raw: TimerEvent[] = [{ type: "break-completed", at: 1_260_000 }];
    expect(toDomainEvents(raw, { ...ctx, actualBreakS: 300 })).toEqual<DomainEvent[]>([
      { event: "break_completed", ts: 1260, sprint_id: "S1", break_id: "B1", actual_s: 300 },
    ]);
  });

  it("maps break-skipped → break_skipped (after_s from ctx; break_id present)", () => {
    const raw: TimerEvent[] = [{ type: "break-skipped", at: 1_000_000 }];
    expect(toDomainEvents(raw, { ...ctx, afterS: 40 })).toEqual<DomainEvent[]>([
      { event: "break_skipped", ts: 1000, sprint_id: "S1", break_id: "B1", after_s: 40 },
    ]);
  });

  it("maps break-skipped without a break_id (break never started)", () => {
    const raw: TimerEvent[] = [{ type: "break-skipped", at: 1_000_000 }];
    const { breakId, ...noBreak } = ctx;
    expect(toDomainEvents(raw, { ...noBreak, afterS: 40 })).toEqual<DomainEvent[]>([
      { event: "break_skipped", ts: 1000, sprint_id: "S1", after_s: 40 },
    ]);
  });

  it("maps sprint-ended → sprint_ended (actual_focus_s + over_run_s from ctx)", () => {
    const raw: TimerEvent[] = [{ type: "sprint-ended", at: 960_000 }];
    expect(toDomainEvents(raw, { ...ctx, actualFocusS: 960, overRunS: 60 })).toEqual<DomainEvent[]>([
      { event: "sprint_ended", ts: 960, sprint_id: "S1", actual_focus_s: 960, over_run_s: 60 },
    ]);
  });

  it("drops stopped (UI-only lifecycle signal; the sprint close rides on sprint-ended)", () => {
    const raw: TimerEvent[] = [{ type: "stopped", at: 960_000 }];
    expect(toDomainEvents(raw, ctx)).toEqual([]);
  });

  it("drops nudge (UI-only; no domain event in the Spec 1 vocabulary)", () => {
    const raw: TimerEvent[] = [{ type: "nudge", at: 900_000 }];
    expect(toDomainEvents(raw, ctx)).toEqual([]);
  });

  it("preserves order and threads ids across a multi-event batch", () => {
    const raw: TimerEvent[] = [
      { type: "grace-ended", at: 960_000, ended_by: "timeout" },
      { type: "break-started", at: 960_000 },
    ];
    expect(toDomainEvents(raw, { ...ctx, actualGraceS: 120 })).toEqual<DomainEvent[]>([
      { event: "grace_ended", ts: 960, sprint_id: "S1", actual_grace_s: 120, ended_by: "timeout" },
      { event: "break_started", ts: 960, sprint_id: "S1", break_id: "B1", planned_s: 300 },
    ]);
  });

  it("defaults derived numeric fields to 0 when the ctx omits them", () => {
    const raw: TimerEvent[] = [{ type: "sprint-ended", at: 900_000 }];
    expect(toDomainEvents(raw, ctx)).toEqual<DomainEvent[]>([
      { event: "sprint_ended", ts: 900, sprint_id: "S1", actual_focus_s: 0, over_run_s: 0 },
    ]);
  });
});

describe("InMemoryEventSink", () => {
  it("appends events in order for later inspection", async () => {
    const sink = new InMemoryEventSink();
    const a: DomainEvent = { event: "boundary_reached", ts: 1, sprint_id: "S1" };
    const b: DomainEvent = { event: "sprint_ended", ts: 2, sprint_id: "S1", actual_focus_s: 2, over_run_s: 0 };
    await sink.append(a);
    await sink.append(b);
    expect(sink.events).toEqual([a, b]);
  });
});
