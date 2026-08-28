import { describe, it, expect } from "vitest";
import {
  donutSegments,
  scaleBars,
  timelineWindow,
  timelineSegments,
  weekBars,
  type WeekBar,
} from "./statsChart";

describe("donutSegments", () => {
  it("splits two values proportionally and chains offsets", () => {
    const r = 46;
    const C = 2 * Math.PI * r;
    const { circumference, segments } = donutSegments([5, 2], r);
    expect(circumference).toBeCloseTo(C, 6);
    expect(segments).toHaveLength(2);
    // 5/7 and 2/7 of the circle.
    expect(segments[0].length).toBeCloseTo((5 / 7) * C, 6);
    expect(segments[0].offset).toBe(-0); // first wedge starts at 0
    expect(segments[1].length).toBeCloseTo((2 / 7) * C, 6);
    // second wedge offset = -(first length)
    expect(segments[1].offset).toBeCloseTo(-(5 / 7) * C, 6);
    // dasharray length + gap == full circumference
    expect(segments[0].length + segments[0].gap).toBeCloseTo(C, 6);
  });

  it("omits zero values (no zero-length wedge)", () => {
    const { segments } = donutSegments([3, 0], 46);
    expect(segments).toHaveLength(1);
    expect(segments[0].index).toBe(0);
  });

  it("returns no segments when the total is zero", () => {
    const { segments } = donutSegments([0, 0], 46);
    expect(segments).toEqual([]);
  });

  it("clamps negatives to zero", () => {
    const { segments } = donutSegments([-4, 4], 46);
    expect(segments).toHaveLength(1);
    expect(segments[0].index).toBe(1);
  });
});

describe("scaleBars", () => {
  it("scales the tallest to maxPx and the rest proportionally", () => {
    expect(scaleBars([1, 2, 4], 100)).toEqual([25, 50, 100]);
  });

  it("maps zeros to 0 height", () => {
    expect(scaleBars([0, 3, 0], 60)).toEqual([0, 60, 0]);
  });

  it("returns all zeros for an all-zero week", () => {
    expect(scaleBars([0, 0, 0], 70)).toEqual([0, 0, 0]);
  });
});

describe("timelineWindow", () => {
  it("spans first start to last end, rounded out to the hour", () => {
    // 09:15 -> 09:00, 10:40 -> 11:00
    const nineFifteen = 9 * 3600 + 15 * 60;
    const tenForty = 10 * 3600 + 40 * 60;
    const w = timelineWindow(
      [{ startS: nineFifteen, endS: tenForty }],
      0,
      24 * 3600,
    );
    expect(w.startS).toBe(9 * 3600);
    expect(w.endS).toBe(11 * 3600);
  });

  it("uses the fallback window when there are no intervals", () => {
    const w = timelineWindow([], 8 * 3600, 17 * 3600);
    expect(w.startS).toBe(8 * 3600);
    expect(w.endS).toBe(17 * 3600);
  });

  it("guarantees at least a one-hour window", () => {
    const w = timelineWindow([{ startS: 100, endS: 200 }], 0, 0);
    expect(w.endS - w.startS).toBeGreaterThanOrEqual(3600);
  });
});

describe("weekBars", () => {
  // 2026-08-19 is a Wednesday, 08-20 Thursday, 08-23 Sunday.
  const week = [
    { date: "2026-08-19", activeMinutes: 0 },
    { date: "2026-08-20", activeMinutes: 30 },
    { date: "2026-08-23", activeMinutes: 60 },
  ];

  it("scales the tallest bar to maxPx and the rest proportionally", () => {
    const bars = weekBars(week, 100);
    expect(bars.map((b) => b.heightPx)).toEqual([0, 50, 100]);
  });

  it("labels each bar with its local weekday letter", () => {
    const bars = weekBars(week, 100);
    expect(bars.map((b) => b.label)).toEqual(["W", "T", "S"]);
  });

  it("carries the date and active minutes through", () => {
    const bars = weekBars(week, 100);
    expect(bars[1]).toEqual<WeekBar>({
      date: "2026-08-20",
      label: "T",
      activeMinutes: 30,
      heightPx: 50,
    });
  });

  it("returns all-zero heights for an empty (all-zero) week", () => {
    const bars = weekBars(
      [
        { date: "2026-08-22", activeMinutes: 0 },
        { date: "2026-08-23", activeMinutes: 0 },
      ],
      54,
    );
    expect(bars.map((b) => b.heightPx)).toEqual([0, 0]);
  });
});

describe("timelineSegments", () => {
  it("places intervals as left/width percentages of the window", () => {
    // window 0..100s; interval 25..75 -> left 25%, width 50%
    const segs = timelineSegments(
      [{ kind: "sprint", startS: 25, endS: 75 }],
      0,
      100,
    );
    expect(segs).toEqual([{ kind: "sprint", leftPct: 25, widthPct: 50 }]);
  });

  it("clamps to the window and drops empties", () => {
    const segs = timelineSegments(
      [
        { kind: "sprint", startS: -50, endS: 50 }, // clamps left to 0
        { kind: "break", startS: 200, endS: 300 }, // fully outside -> dropped
      ],
      0,
      100,
    );
    expect(segs).toEqual([{ kind: "sprint", leftPct: 0, widthPct: 50 }]);
  });

  it("returns [] for a non-positive window", () => {
    expect(timelineSegments([{ kind: "break", startS: 0, endS: 1 }], 5, 5)).toEqual([]);
  });
});
