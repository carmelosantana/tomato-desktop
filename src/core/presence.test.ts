import { describe, it, expect } from "vitest";
import { PresenceMachine, type PresenceConfig, type PresenceEvent } from "./presence";

// Concrete config for the tests. sprintMs is the "gentle boundary"; minSprintLogMs
// is the noise floor below which a sprint is never logged. All units are ms.
const cfg: PresenceConfig = {
  sprintMs: 1_500_000, // 25m
  idleResetMs: 300_000, // 5m of idle ends a sprint
  renudgeEveryMs: 300_000, // re-nudge every 5m past the boundary
  activityThresholdMs: 5_000, // <=5s idle counts as "active"
  minSprintLogMs: 60_000, // <1m sprints are noise, never logged
};

const types = (es: { type: string }[]) => es.map((e) => e.type);
const only = <T extends PresenceEvent["type"]>(es: PresenceEvent[], type: T) =>
  es.filter((e) => e.type === type);

describe("PresenceMachine — sprint start with noise floor (case 1)", () => {
  it("starts away and stays quiet until the sprint clears minSprintLogMs", () => {
    const p = new PresenceMachine(cfg);
    expect(p.currentState()).toBe("away");

    // First activity: sprint begins internally, but nothing is emitted yet.
    expect(p.tick(1_000, 1_000)).toEqual([]);
    expect(p.currentState()).toBe("active");

    // Still under the floor a few ticks later → silence.
    expect(p.tick(30_000, 1_000)).toEqual([]);

    // Once (now - sprintStartAt) >= minSprintLogMs, sprint-started fires once.
    const es = p.tick(61_000, 1_000);
    expect(types(es)).toEqual(["sprint-started"]);
    const started = es[0];
    expect(started.type === "sprint-started" && started.trigger).toBe("activity");
    // Anchored at the first activity instant (now - idleMs on the starting tick).
    expect(started.type === "sprint-started" && started.at).toBe(0);

    // Not re-emitted on subsequent in-sprint ticks.
    expect(p.tick(120_000, 1_000)).toEqual([]);
  });

  it("a short blip that goes idle before the floor emits NOTHING", () => {
    const p = new PresenceMachine(cfg);
    p.tick(1_000, 1_000); // sprint starts internally (sprintStartAt = 0)
    // Goes idle long enough to reset before ever clearing the floor.
    const es = p.tick(301_000, 300_000); // lastActivityAt = 1_000, activeMs = 1_000
    expect(es).toEqual([]);
    expect(p.currentState()).toBe("away");
  });
});

describe("PresenceMachine — nudge loop at and past the boundary (case 2)", () => {
  it("emits nudge index 0 at sprintMs with activeMs ~= sprintMs, then index 1 at +renudge", () => {
    const p = new PresenceMachine(cfg);
    p.tick(0, 0); // sprintStartAt = 0
    // Reaching the boundary in one tick clears the floor AND fires nudge 0.
    const es = p.tick(cfg.sprintMs, 1_000);
    expect(types(es)).toEqual(["sprint-started", "nudge"]);
    const n0 = es.find((e) => e.type === "nudge")!;
    expect(n0.type === "nudge" && n0.index).toBe(0);
    expect(n0.type === "nudge" && n0.activeMs).toBe(cfg.sprintMs);
    expect(n0.type === "nudge" && n0.at).toBe(cfg.sprintMs);

    // Next nudge one renudge interval later.
    const es2 = p.tick(cfg.sprintMs + cfg.renudgeEveryMs, 1_000);
    expect(types(es2)).toEqual(["nudge"]);
    expect(es2[0].type === "nudge" && es2[0].index).toBe(1);
    expect(es2[0].type === "nudge" && es2[0].activeMs).toBe(cfg.sprintMs + cfg.renudgeEveryMs);
  });

  it("a single large tick delta emits catch-up nudges deterministically", () => {
    const p = new PresenceMachine(cfg);
    p.tick(0, 0);
    // Jump well past two renudge intervals in one tick.
    const at = cfg.sprintMs + 2 * cfg.renudgeEveryMs;
    const es = p.tick(at, 1_000);
    expect(only(es, "sprint-started").length).toBe(1);
    const nudges = only(es, "nudge");
    expect(nudges.map((n) => (n.type === "nudge" ? n.index : -1))).toEqual([0, 1, 2]);
    expect(nudges.map((n) => (n.type === "nudge" ? n.at : -1))).toEqual([
      cfg.sprintMs,
      cfg.sprintMs + cfg.renudgeEveryMs,
      cfg.sprintMs + 2 * cfg.renudgeEveryMs,
    ]);
  });
});

describe("PresenceMachine — idle reset ends the sprint (case 3)", () => {
  it("ends with idle_reset, activeMs measured to lastActivityAt (trailing idle excluded)", () => {
    const p = new PresenceMachine(cfg);
    p.tick(0, 0); // sprintStartAt = 0
    p.tick(100_000, 1_000); // clears floor → sprint-started emitted
    // Last real activity was at 200_000; then 300_000ms idle → reset at now=500_000.
    const es = p.tick(500_000, 300_000);
    expect(types(es)).toEqual(["sprint-ended"]);
    const ended = es[0];
    expect(ended.type === "sprint-ended" && ended.endedBy).toBe("idle_reset");
    expect(ended.type === "sprint-ended" && ended.activeMs).toBe(200_000); // to lastActivityAt, not now
    expect(ended.type === "sprint-ended" && ended.at).toBe(200_000);
    expect(ended.type === "sprint-ended" && ended.overMs).toBe(0);
    expect(p.currentState()).toBe("away");
  });

  it("reports overMs when the active span ran past sprintMs", () => {
    const p = new PresenceMachine(cfg);
    p.tick(0, 0);
    p.tick(100_000, 1_000); // floor cleared
    // Active until 1_800_000 (300k over the boundary), then idle reset.
    const es = p.tick(2_100_000, 300_000); // lastActivityAt = 1_800_000
    const ended = es.find((e) => e.type === "sprint-ended")!;
    expect(ended.type === "sprint-ended" && ended.activeMs).toBe(1_800_000);
    expect(ended.type === "sprint-ended" && ended.overMs).toBe(300_000);
  });
});

describe("PresenceMachine — micro-idle does not reset (case 4)", () => {
  it("idle between threshold and reset keeps the sprint alive", () => {
    const p = new PresenceMachine(cfg);
    p.tick(0, 0);
    p.tick(100_000, 1_000); // sprint-started
    // 100s idle: above activityThreshold (5s) but below idleReset (300s).
    const es = p.tick(150_000, 100_000);
    expect(es).toEqual([]);
    expect(p.currentState()).toBe("active");
  });
});

describe("PresenceMachine — pause / resume (case 5)", () => {
  it("pause ends the active sprint (paused), paused ticks are silent, resume → away", () => {
    const p = new PresenceMachine(cfg);
    p.tick(0, 0);
    p.tick(100_000, 1_000); // sprint-started
    const es = p.pause(120_000);
    expect(types(es)).toEqual(["sprint-ended"]);
    const ended = es[0];
    expect(ended.type === "sprint-ended" && ended.endedBy).toBe("paused");
    expect(ended.type === "sprint-ended" && ended.activeMs).toBe(120_000);
    expect(p.currentState()).toBe("paused");

    // Ticks while paused do nothing (no auto-start, no nudges).
    expect(p.tick(130_000, 1_000)).toEqual([]);
    expect(p.currentState()).toBe("paused");

    p.resume(140_000);
    expect(p.currentState()).toBe("away");
  });

  it("pause below the noise floor transitions to paused without emitting an end", () => {
    const p = new PresenceMachine(cfg);
    p.tick(0, 0); // active but sprint-started not yet emitted
    const es = p.pause(10_000);
    expect(es).toEqual([]);
    expect(p.currentState()).toBe("paused");
  });
});

describe("PresenceMachine — manual mode, idleMs === null (case 6)", () => {
  it("manualStart emits immediately, ticks nudge on wall time, manualStop ends manual", () => {
    const p = new PresenceMachine(cfg);
    const startEs = p.manualStart(0);
    expect(types(startEs)).toEqual(["sprint-started"]);
    expect(startEs[0].type === "sprint-started" && startEs[0].trigger).toBe("manual");
    expect(p.currentState()).toBe("active");

    // Nudge fires on wall time at the boundary.
    const es = p.tick(cfg.sprintMs, null);
    expect(types(es)).toEqual(["nudge"]);
    expect(es[0].type === "nudge" && es[0].index).toBe(0);
    expect(es[0].type === "nudge" && es[0].activeMs).toBe(cfg.sprintMs);

    const stopEs = p.manualStop(2_000_000);
    expect(types(stopEs)).toEqual(["sprint-ended"]);
    const ended = stopEs[0];
    expect(ended.type === "sprint-ended" && ended.endedBy).toBe("manual");
    expect(ended.type === "sprint-ended" && ended.activeMs).toBe(2_000_000);
    expect(ended.type === "sprint-ended" && ended.overMs).toBe(500_000);
    expect(p.currentState()).toBe("away");
  });

  it("manual-mode ticks emit catch-up nudges over a large delta", () => {
    const p = new PresenceMachine(cfg);
    p.manualStart(0);
    const at = cfg.sprintMs + 2 * cfg.renudgeEveryMs;
    const nudges = only(p.tick(at, null), "nudge");
    expect(nudges.map((n) => (n.type === "nudge" ? n.index : -1))).toEqual([0, 1, 2]);
  });

  it("manual-mode ticks (null) never auto-reset the sprint, only nudge on wall time", () => {
    const p = new PresenceMachine(cfg);
    p.manualStart(0);
    // Far past any idleReset window, but manual ticks carry no idle signal — the
    // sprint stays active and only nudges accrue; it never self-ends.
    const es = p.tick(cfg.sprintMs + cfg.renudgeEveryMs, null);
    expect(only(es, "sprint-ended")).toEqual([]);
    expect(types(es).every((t) => t === "nudge")).toBe(true);
    expect(p.currentState()).toBe("active");
  });

  it("a null (manual) tick from away never auto-starts a sprint", () => {
    const p = new PresenceMachine(cfg);
    expect(p.tick(10_000, null)).toEqual([]);
    expect(p.currentState()).toBe("away");
  });
});

describe("PresenceMachine — degenerate renudge cadence (M1a: no infinite loop)", () => {
  it("a zero renudge cadence emits a BOUNDED number of nudges over a finite tick (does not hang)", () => {
    // renudgeEveryMs: 0 would make `nextNudgeAt += 0` spin forever without the
    // guarded step. One tick spanning the boundary must return a finite array.
    const p = new PresenceMachine({ ...cfg, renudgeEveryMs: 0 });
    p.tick(0, 0); // sprintStartAt = 0
    // One tick crossing the boundary. With the guarded step (>= 1ms) the loop
    // must terminate; assert a finite, bounded result rather than hanging.
    const es = p.tick(cfg.sprintMs, 1_000);
    expect(Array.isArray(es)).toBe(true);
    expect(es.length).toBeLessThanOrEqual(cfg.sprintMs + 2);
    // The boundary nudge (index 0) is present.
    expect(only(es, "nudge").length).toBeGreaterThanOrEqual(1);
    expect(es.find((e) => e.type === "nudge")!.type === "nudge" && (es.find((e) => e.type === "nudge") as PresenceEvent & { type: "nudge" }).index).toBe(0);
  });
});

describe("PresenceMachine — snapshot projection", () => {
  it("projects activeMs/overMs while active and zeroes them otherwise", () => {
    const p = new PresenceMachine(cfg);
    expect(p.snapshot(0)).toEqual({ state: "away", activeMs: 0, overMs: 0 });

    p.tick(0, 0); // sprintStartAt = 0
    expect(p.snapshot(600_000)).toEqual({ state: "active", activeMs: 600_000, overMs: 0 });
    expect(p.snapshot(1_800_000)).toEqual({
      state: "active",
      activeMs: 1_800_000,
      overMs: 300_000,
    });
  });
});

describe("PresenceMachine — setConfig between sprints", () => {
  it("applies a new config to the next sprint's timing", () => {
    const p = new PresenceMachine(cfg);
    // While away, shorten the sprint.
    p.setConfig({ ...cfg, sprintMs: 120_000 });
    p.tick(0, 0);
    // Boundary now at 120s → nudge 0 fires there (also clears the 60s floor).
    const es = p.tick(120_000, 1_000);
    expect(types(es)).toEqual(["sprint-started", "nudge"]);
    // Prove setConfig actually drove the boundary: the nudge lands at the NEW
    // 120s sprintMs (not the original 1_500_000ms), with matching at/activeMs.
    const n0 = es.find((e) => e.type === "nudge")!;
    expect(n0.type === "nudge" && n0.index).toBe(0);
    expect(n0.type === "nudge" && n0.at).toBe(120_000);
    expect(n0.type === "nudge" && n0.activeMs).toBe(120_000);
  });
});
