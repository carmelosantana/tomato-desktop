import { describe, it, expect } from "vitest";
import { ringProgress, ringVisual, describeRing, RING_GEOMETRY } from "./ring";

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

describe("ringVisual state → colorRole + glyph mapping", () => {
  it("focus → ● / focus", () => {
    const v = ringVisual("focus", 300, 1000, false);
    expect(v.glyph).toBe("●");
    expect(v.colorRole).toBe("focus");
    expect(v.progress).toBeCloseTo(0.3, 5);
  });

  it("grace → ◑ / grace", () => {
    const v = ringVisual("grace", 1000, 1000, true);
    expect(v.glyph).toBe("◑");
    expect(v.colorRole).toBe("grace");
    expect(v.progress).toBe(1);
  });

  it("break → ◼ (fallback colorRole focus)", () => {
    const v = ringVisual("break", 0, 1000, false);
    expect(v.glyph).toBe("◼");
    expect(v.colorRole).toBe("focus");
  });

  it("over-run (progress > 1 in soft focus) → ▲ / overrun", () => {
    const v = ringVisual("focus", 1500, 1000, false);
    expect(v.glyph).toBe("▲");
    expect(v.colorRole).toBe("overrun");
    expect(v.progress).toBe(1);
  });

  it("idle/stopped → resting ● / focus", () => {
    expect(ringVisual("idle", 0, 1000, false).glyph).toBe("●");
    expect(ringVisual("stopped", 0, 1000, false).glyph).toBe("●");
    expect(ringVisual("idle", 0, 1000, false).colorRole).toBe("focus");
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
