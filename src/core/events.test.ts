import { describe, it, expect } from "vitest";
import { toDomainEvents, InMemoryEventSink, type DomainEvent, type MapContext } from "./events";
import type { PresenceEvent } from "./presence";

const ctx: MapContext = {
  sprintId: "S1",
  trigger: "activity",
};

describe("toDomainEvents mapping", () => {
  it("maps sprint-started → sprint_started using the event's own trigger (activity)", () => {
    const raw: PresenceEvent[] = [{ type: "sprint-started", at: 5_000, trigger: "activity" }];
    expect(toDomainEvents(raw, ctx)).toEqual<DomainEvent[]>([
      { event: "sprint_started", ts: 5, sprint_id: "S1", trigger: "activity" },
    ]);
  });

  it("maps sprint-started → sprint_started with a manual trigger from the event", () => {
    const raw: PresenceEvent[] = [{ type: "sprint-started", at: 5_000, trigger: "manual" }];
    // ctx.trigger stays "activity" — the event's own trigger must win.
    expect(toDomainEvents(raw, ctx)).toEqual<DomainEvent[]>([
      { event: "sprint_started", ts: 5, sprint_id: "S1", trigger: "manual" },
    ]);
  });

  it("maps nudge → nudge (active_s in seconds + index)", () => {
    const raw: PresenceEvent[] = [{ type: "nudge", at: 900_000, activeMs: 900_000, index: 0 }];
    expect(toDomainEvents(raw, ctx)).toEqual<DomainEvent[]>([
      { event: "nudge", ts: 900, sprint_id: "S1", active_s: 900, index: 0 },
    ]);
  });

  it("maps nudge with a later index and floors sub-second active time", () => {
    const raw: PresenceEvent[] = [{ type: "nudge", at: 1_200_500, activeMs: 1_200_750, index: 3 }];
    expect(toDomainEvents(raw, ctx)).toEqual<DomainEvent[]>([
      { event: "nudge", ts: 1200, sprint_id: "S1", active_s: 1200, index: 3 },
    ]);
  });

  it("maps sprint-ended → sprint_ended with ended_by idle_reset (active_s + over_s in seconds)", () => {
    const raw: PresenceEvent[] = [
      { type: "sprint-ended", at: 960_000, activeMs: 960_000, overMs: 60_000, endedBy: "idle_reset" },
    ];
    expect(toDomainEvents(raw, ctx)).toEqual<DomainEvent[]>([
      { event: "sprint_ended", ts: 960, sprint_id: "S1", active_s: 960, over_s: 60, ended_by: "idle_reset" },
    ]);
  });

  it("maps sprint-ended → sprint_ended with ended_by paused", () => {
    const raw: PresenceEvent[] = [
      { type: "sprint-ended", at: 500_000, activeMs: 500_000, overMs: 0, endedBy: "paused" },
    ];
    expect(toDomainEvents(raw, ctx)).toEqual<DomainEvent[]>([
      { event: "sprint_ended", ts: 500, sprint_id: "S1", active_s: 500, over_s: 0, ended_by: "paused" },
    ]);
  });

  it("maps sprint-ended → sprint_ended with ended_by manual", () => {
    const raw: PresenceEvent[] = [
      { type: "sprint-ended", at: 1_000_000, activeMs: 1_000_000, overMs: 100_000, endedBy: "manual" },
    ];
    expect(toDomainEvents(raw, ctx)).toEqual<DomainEvent[]>([
      { event: "sprint_ended", ts: 1000, sprint_id: "S1", active_s: 1000, over_s: 100, ended_by: "manual" },
    ]);
  });

  it("floors sub-second active/over durations on sprint-ended", () => {
    const raw: PresenceEvent[] = [
      { type: "sprint-ended", at: 960_999, activeMs: 960_999, overMs: 60_999, endedBy: "idle_reset" },
    ];
    expect(toDomainEvents(raw, ctx)).toEqual<DomainEvent[]>([
      { event: "sprint_ended", ts: 960, sprint_id: "S1", active_s: 960, over_s: 60, ended_by: "idle_reset" },
    ]);
  });

  it("preserves order and threads sprint_id across a multi-event batch", () => {
    const raw: PresenceEvent[] = [
      { type: "sprint-started", at: 0, trigger: "activity" },
      { type: "nudge", at: 900_000, activeMs: 900_000, index: 0 },
      { type: "sprint-ended", at: 960_000, activeMs: 960_000, overMs: 60_000, endedBy: "idle_reset" },
    ];
    expect(toDomainEvents(raw, ctx)).toEqual<DomainEvent[]>([
      { event: "sprint_started", ts: 0, sprint_id: "S1", trigger: "activity" },
      { event: "nudge", ts: 900, sprint_id: "S1", active_s: 900, index: 0 },
      { event: "sprint_ended", ts: 960, sprint_id: "S1", active_s: 960, over_s: 60, ended_by: "idle_reset" },
    ]);
  });

  it("returns an empty array for an empty batch", () => {
    expect(toDomainEvents([], ctx)).toEqual([]);
  });
});

describe("InMemoryEventSink", () => {
  it("appends events in order for later inspection", async () => {
    const sink = new InMemoryEventSink();
    const a: DomainEvent = { event: "sprint_started", ts: 1, sprint_id: "S1", trigger: "manual" };
    const b: DomainEvent = { event: "sprint_ended", ts: 2, sprint_id: "S1", active_s: 1, over_s: 0, ended_by: "manual" };
    await sink.append(a);
    await sink.append(b);
    expect(sink.events).toEqual([a, b]);
  });
});
