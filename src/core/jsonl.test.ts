import { describe, it, expect } from "vitest";
import { serializeEvent, parseEvents } from "./jsonl";
import type { DomainEvent } from "./events";

const sprintStarted: DomainEvent = {
  event: "sprint_started",
  ts: 5,
  sprint_id: "S1",
  trigger: "activity",
};
const nudge: DomainEvent = {
  event: "nudge",
  ts: 900,
  sprint_id: "S1",
  active_s: 900,
  index: 0,
};
const ended: DomainEvent = {
  event: "sprint_ended",
  ts: 960,
  sprint_id: "S1",
  active_s: 960,
  over_s: 60,
  ended_by: "idle_reset",
};

describe("serializeEvent", () => {
  it("produces a single-line compact JSON object (no embedded newline)", () => {
    const line = serializeEvent(sprintStarted);
    expect(line).not.toContain("\n");
    expect(JSON.parse(line)).toEqual(sprintStarted);
  });
});

describe("parseEvents", () => {
  it("round-trips serialize → parse for a batch of events", () => {
    const events = [sprintStarted, nudge, ended];
    const text = events.map(serializeEvent).join("\n") + "\n";
    expect(parseEvents(text)).toEqual(events);
  });

  it("ignores a blank trailing line", () => {
    const text = serializeEvent(nudge) + "\n\n";
    expect(parseEvents(text)).toEqual([nudge]);
  });

  it("tolerates missing trailing newline", () => {
    const text = serializeEvent(nudge);
    expect(parseEvents(text)).toEqual([nudge]);
  });

  it("skips interior blank / whitespace-only lines", () => {
    const text = [serializeEvent(sprintStarted), "", "   ", serializeEvent(ended)].join("\n");
    expect(parseEvents(text)).toEqual([sprintStarted, ended]);
  });

  it("returns [] for an empty string", () => {
    expect(parseEvents("")).toEqual([]);
  });

  it("returns [] for whitespace-only input", () => {
    expect(parseEvents("\n\n  \n")).toEqual([]);
  });

  it("skips a malformed line and returns the valid events without throwing", () => {
    // Append-only log torn mid-write: a partial line between two valid records.
    const text = [
      serializeEvent(sprintStarted),
      '{"event":"nudge","ts":900,"sprint',
      serializeEvent(ended),
    ].join("\n");
    expect(() => parseEvents(text)).not.toThrow();
    expect(parseEvents(text)).toEqual([sprintStarted, ended]);
  });
});
