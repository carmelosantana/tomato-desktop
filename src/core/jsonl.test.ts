import { describe, it, expect } from "vitest";
import { serializeEvent, parseEvents } from "./jsonl";
import type { DomainEvent } from "./events";

const sprintStarted: DomainEvent = {
  event: "sprint_started",
  ts: 5,
  sprint_id: "S1",
  planned_s: 900,
  enforcement_mode: "enforced",
};
const boundary: DomainEvent = { event: "boundary_reached", ts: 900, sprint_id: "S1" };
const ended: DomainEvent = {
  event: "sprint_ended",
  ts: 960,
  sprint_id: "S1",
  actual_focus_s: 960,
  over_run_s: 60,
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
    const events = [sprintStarted, boundary, ended];
    const text = events.map(serializeEvent).join("\n") + "\n";
    expect(parseEvents(text)).toEqual(events);
  });

  it("ignores a blank trailing line", () => {
    const text = serializeEvent(boundary) + "\n\n";
    expect(parseEvents(text)).toEqual([boundary]);
  });

  it("tolerates missing trailing newline", () => {
    const text = serializeEvent(boundary);
    expect(parseEvents(text)).toEqual([boundary]);
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
      '{"event":"boundary_reached","ts":900,"sprint',
      serializeEvent(ended),
    ].join("\n");
    expect(() => parseEvents(text)).not.toThrow();
    expect(parseEvents(text)).toEqual([sprintStarted, ended]);
  });
});
