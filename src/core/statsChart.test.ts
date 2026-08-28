import { describe, it, expect } from "vitest";
import { scaleBars, weekBars, type WeekBar } from "./statsChart";

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
