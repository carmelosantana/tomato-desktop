import { describe, it, expect } from "vitest";
import {
  clamp,
  minutesToSeconds,
  secondsToMinutes,
  minutesToClampedSeconds,
  SPRINT_BOUNDS,
  BREAK_BOUNDS,
  GRACE_BOUNDS,
} from "./settingsForm";

describe("clamp", () => {
  it("passes values inside the range through", () => {
    expect(clamp(5, 0, 10)).toBe(5);
  });
  it("clamps below the low bound", () => {
    expect(clamp(-3, 0, 10)).toBe(0);
  });
  it("clamps above the high bound", () => {
    expect(clamp(99, 0, 10)).toBe(10);
  });
});

describe("minutesToSeconds", () => {
  it("converts whole minutes", () => {
    expect(minutesToSeconds(15)).toBe(900);
  });
  it("rounds fractional minutes to the nearest second", () => {
    expect(minutesToSeconds(0.5)).toBe(30);
    expect(minutesToSeconds(2.005)).toBe(120); // 120.3 → 120
  });
  it("treats non-finite input as 0", () => {
    expect(minutesToSeconds(NaN)).toBe(0);
    expect(minutesToSeconds(Infinity)).toBe(0);
  });
});

describe("secondsToMinutes", () => {
  it("round-trips the defaults", () => {
    expect(secondsToMinutes(900)).toBe(15);
    expect(secondsToMinutes(300)).toBe(5);
    expect(secondsToMinutes(30)).toBe(0.5);
  });
});

describe("minutesToClampedSeconds", () => {
  it("keeps in-bounds sprint durations", () => {
    expect(minutesToClampedSeconds(15, SPRINT_BOUNDS)).toBe(900);
  });
  it("clamps a too-long sprint to 60 min", () => {
    expect(minutesToClampedSeconds(120, SPRINT_BOUNDS)).toBe(3600);
  });
  it("clamps a too-short sprint up to 60 s", () => {
    expect(minutesToClampedSeconds(0.1, SPRINT_BOUNDS)).toBe(60);
  });
  it("clamps break to its 30 s – 30 min window", () => {
    expect(minutesToClampedSeconds(0, BREAK_BOUNDS)).toBe(30);
    expect(minutesToClampedSeconds(45, BREAK_BOUNDS)).toBe(1800);
    expect(minutesToClampedSeconds(0.5, BREAK_BOUNDS)).toBe(30);
  });
  it("allows grace of 0 and clamps its 10 min ceiling", () => {
    expect(minutesToClampedSeconds(0, GRACE_BOUNDS)).toBe(0);
    expect(minutesToClampedSeconds(20, GRACE_BOUNDS)).toBe(600);
    expect(minutesToClampedSeconds(2, GRACE_BOUNDS)).toBe(120);
  });
  it("empty/NaN field falls to the lower bound", () => {
    expect(minutesToClampedSeconds(NaN, SPRINT_BOUNDS)).toBe(60);
    expect(minutesToClampedSeconds(NaN, GRACE_BOUNDS)).toBe(0);
  });
});
