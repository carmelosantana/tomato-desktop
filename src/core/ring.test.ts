import { describe, it, expect } from "vitest";
import { ringProgress, ringVisual, describeRing, nextPulse, RING_GEOMETRY } from "./ring";


describe("ringProgress", () => {
  it("is 0 at the start", () => {
    expect(ringProgress(0, 1000)).toBe(0);
  });

  it("is 0.5 at the halfway point", () => {
    expect(ringProgress(500, 1000)).toBe(0.5);
  });

  it("clamps overflow to 1", () => {
    expect(ringProgress(1500, 1000)).toBe(1);
  });

  it("guards totalMs <= 0 by returning 0", () => {
    expect(ringProgress(500, 0)).toBe(0);
    expect(ringProgress(500, -10)).toBe(0);
  });

  it("never returns a negative value", () => {
    expect(ringProgress(-100, 1000)).toBe(0);
  });
});

describe("ringVisual presence → progress + colorRole", () => {
  const sprintMs = 1000;

  it("away → { progress: 0, colorRole: idle }", () => {
    expect(ringVisual("away", 0, sprintMs)).toEqual({ progress: 0, colorRole: "idle" });
    // activeMs is meaningless while away; it must not leak into progress.
    expect(ringVisual("away", 500, sprintMs)).toEqual({ progress: 0, colorRole: "idle" });
  });

  it("paused → { progress: 0, colorRole: idle }", () => {
    expect(ringVisual("paused", 0, sprintMs)).toEqual({ progress: 0, colorRole: "idle" });
    expect(ringVisual("paused", 800, sprintMs)).toEqual({ progress: 0, colorRole: "idle" });
  });

  it("active at the very start → progress 0, focus", () => {
    expect(ringVisual("active", 0, sprintMs)).toEqual({ progress: 0, colorRole: "focus" });
  });

  it("active mid-sprint → progress ~0.5, focus", () => {
    const v = ringVisual("active", 500, sprintMs);
    expect(v.colorRole).toBe("focus");
    expect(v.progress).toBeCloseTo(0.5, 5);
  });

  it("active just below the boundary → focus, progress < 1", () => {
    const v = ringVisual("active", 999, sprintMs);
    expect(v.colorRole).toBe("focus");
    expect(v.progress).toBeCloseTo(0.999, 5);
    expect(v.progress).toBeLessThan(1);
  });

  it("active exactly at the boundary (activeMs === sprintMs) → progress 1, overrun", () => {
    expect(ringVisual("active", sprintMs, sprintMs)).toEqual({ progress: 1, colorRole: "overrun" });
  });

  it("active past the boundary → progress clamps to 1, overrun", () => {
    expect(ringVisual("active", sprintMs + 60_000, sprintMs)).toEqual({
      progress: 1,
      colorRole: "overrun",
    });
  });

  it("progress is always within [0, 1]", () => {
    for (const activeMs of [0, 250, 500, 999, 1000, 5000]) {
      const p = ringVisual("active", activeMs, sprintMs).progress;
      expect(p).toBeGreaterThanOrEqual(0);
      expect(p).toBeLessThanOrEqual(1);
    }
  });
});

describe("RING_GEOMETRY matches tomato-tokens.json ring group", () => {
  it("mirrors the token values exactly", () => {
    expect(RING_GEOMETRY.diameterRatio).toBe(0.84);
    expect(RING_GEOMETRY.strokeRatio).toBe(0.15);
    expect(RING_GEOMETRY.startAngleDeg).toBe(-90);
    expect(RING_GEOMETRY.clockwise).toBe(true);
    expect(RING_GEOMETRY.cap).toBe("round");
    expect(RING_GEOMETRY.innerGapPx).toBe(2);
  });
});

describe("describeRing", () => {
  it("computes pixel dims for a 32px canvas", () => {
    const d = describeRing(32);
    expect(d.size).toBe(32);
    expect(d.center).toBe(16);
    expect(d.diameter).toBeCloseTo(26.88, 5); // 32 * 0.84
    expect(d.radius).toBeCloseTo(13.44, 5);
    expect(d.strokeWidth).toBeCloseTo(4.032, 5); // 26.88 * 0.15
    expect(d.arcRadius).toBeCloseTo(11.424, 5); // radius - strokeWidth/2
    expect(d.startAngleDeg).toBe(-90);
    expect(d.clockwise).toBe(true);
    expect(d.cap).toBe("round");
    expect(d.innerGapPx).toBe(2);
  });

  it("scales linearly with canvas size", () => {
    const d = describeRing(16);
    expect(d.diameter).toBeCloseTo(13.44, 5); // 16 * 0.84
    expect(d.strokeWidth).toBeCloseTo(2.016, 5);
  });
});

describe("nextPulse — draw attention while the ring is red", () => {
  it("alternates on each redraw while overrun", () => {
    expect(nextPulse("overrun", false)).toBe(true);
    expect(nextPulse("overrun", true)).toBe(false);
  });

  it("is off in every other role", () => {
    expect(nextPulse("focus", true)).toBe(false);
    expect(nextPulse("idle", true)).toBe(false);
  });
});
