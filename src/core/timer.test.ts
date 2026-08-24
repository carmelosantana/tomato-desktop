import { describe, it, expect } from "vitest";
import { TimerMachine } from "./timer";
const cfg = { sprintMs: 900_000, breakMs: 300_000, graceMs: 120_000, earlyGraceMs: 300_000, mode: "enforced" as const };
const types = (es: {type:string}[]) => es.map(e => e.type);

describe("TimerMachine (enforced)", () => {
  it("uses early grace on the first sprint, normal grace after", () => {
    const t = new TimerMachine(cfg);
    t.start(0);
    expect(types(t.tick(cfg.sprintMs))).toEqual(["boundary-reached","grace-started"]);
    expect(t.snapshot(cfg.sprintMs).state).toBe("grace");
    // early grace (5m) not yet elapsed at 2m:
    expect(t.tick(cfg.sprintMs + 120_000)).toEqual([]);
    // elapses at 5m → break:
    expect(types(t.tick(cfg.sprintMs + cfg.earlyGraceMs))).toEqual(["grace-ended","break-started"]);
  });

  it("breakNow ends grace early", () => {
    const t = new TimerMachine(cfg); t.start(0); t.tick(cfg.sprintMs);
    const es = t.breakNow(cfg.sprintMs + 10_000);
    expect(types(es)).toEqual(["grace-ended","break-started"]);
  });

  it("break elapse returns to idle without auto-chaining", () => {
    const t = new TimerMachine(cfg); t.start(0); t.tick(cfg.sprintMs);
    t.tick(cfg.sprintMs + cfg.earlyGraceMs); // break started
    const es = t.tick(cfg.sprintMs + cfg.earlyGraceMs + cfg.breakMs);
    expect(types(es)).toContain("break-completed");
    expect(t.snapshot(cfg.sprintMs + cfg.earlyGraceMs + cfg.breakMs).state).toBe("idle");
  });

  it("accrues activeFocusMs in focus+grace, not break; tracks overRun", () => {
    const t = new TimerMachine(cfg); t.start(0);
    t.tick(cfg.sprintMs + 60_000);         // 60s into grace
    const snap = t.snapshot(cfg.sprintMs + 60_000);
    expect(snap.activeFocusMs).toBe(cfg.sprintMs + 60_000);
    expect(snap.overRunMs).toBe(60_000);
  });
});

describe("TimerMachine setConfig (settings applied on the next sprint)", () => {
  it("exposes lifecycle state and applies a new config to the next sprint", () => {
    const t = new TimerMachine(cfg);
    expect(t.currentState()).toBe("idle");
    // Run one full sprint so streakIndex advances to 1 (past early grace).
    t.start(0);
    t.tick(cfg.sprintMs);                                   // → grace
    t.tick(cfg.sprintMs + cfg.earlyGraceMs);                // → break
    t.tick(cfg.sprintMs + cfg.earlyGraceMs + cfg.breakMs);  // → idle, streak=1
    expect(t.currentState()).toBe("idle");
    expect(t.snapshot(0).streakIndex).toBe(1);

    // Swap to a shorter sprint while idle; streak is preserved (normal grace).
    const shorter = { ...cfg, sprintMs: 60_000, mode: "soft" as const };
    t.setConfig(shorter);
    expect(t.snapshot(0).streakIndex).toBe(1);

    const base = 10_000_000;
    t.start(base);
    // New sprint length + mode: boundary at 60s emits a soft-mode nudge.
    expect(types(t.tick(base + 60_000))).toEqual(["boundary-reached", "nudge"]);
    expect(t.snapshot(base + 60_000).state).toBe("focus");
  });
});

describe("TimerMachine (soft)", () => {
  it("nudges at boundary and stays in focus", () => {
    const t = new TimerMachine({ ...cfg, mode: "soft" }); t.start(0);
    expect(types(t.tick(cfg.sprintMs))).toEqual(["boundary-reached","nudge"]);
    expect(t.snapshot(cfg.sprintMs).state).toBe("focus");
  });
});

describe("TimerMachine transition coverage (paths the event mapper consumes)", () => {
  it("skipBreak from grace returns to idle and counts the streak", () => {
    const t = new TimerMachine(cfg); t.start(0); t.tick(cfg.sprintMs); // → grace
    const es = t.skipBreak(cfg.sprintMs + 1_000);
    expect(types(es)).toEqual(["grace-ended","break-skipped"]);
    const graceEnded = es.find(e => e.type === "grace-ended");
    expect(graceEnded && "ended_by" in graceEnded && graceEnded.ended_by).toBe("user");
    expect(t.snapshot(cfg.sprintMs + 1_000).state).toBe("idle");
    expect(t.snapshot(cfg.sprintMs + 1_000).streakIndex).toBe(1);
  });

  it("stop from focus flushes then emits stopped and resets the streak", () => {
    const t = new TimerMachine(cfg); t.start(0);
    const es = t.stop(60_000);
    expect(types(es)).toEqual(["stopped"]);
    expect(t.snapshot(60_000).state).toBe("stopped");
    expect(t.snapshot(60_000).streakIndex).toBe(0);
  });

  it("beginBreak (soft manual break) from focus goes straight to break", () => {
    const t = new TimerMachine({ ...cfg, mode: "soft" }); t.start(0);
    const es = t.beginBreak(60_000);
    expect(types(es)).toEqual(["break-started"]);
    expect(t.snapshot(60_000).state).toBe("break");
  });

  it("beginBreak from grace closes grace before the break (symmetry fix)", () => {
    const t = new TimerMachine(cfg); t.start(0); t.tick(cfg.sprintMs); // → grace
    const es = t.beginBreak(cfg.sprintMs + 1_000);
    expect(types(es)).toEqual(["grace-ended","break-started"]);
    expect(t.snapshot(cfg.sprintMs + 1_000).state).toBe("break");
  });

  it("breakNow from focus reaches the boundary before the break (symmetry fix)", () => {
    const t = new TimerMachine(cfg); t.start(0);
    const es = t.breakNow(60_000);
    expect(types(es)).toEqual(["boundary-reached","break-started"]);
    expect(t.snapshot(60_000).state).toBe("break");
  });
});
