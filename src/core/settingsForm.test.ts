import { describe, it, expect } from "vitest";
import {
  clamp,
  minutesToSeconds,
  secondsToMinutes,
  minutesToClampedSeconds,
  sanitizeNumericField,
  SPRINT_BOUNDS,
  IDLE_RESET_BOUNDS,
  RENUDGE_BOUNDS,
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
  it("keeps in-bounds idle-reset durations", () => {
    expect(minutesToClampedSeconds(5, IDLE_RESET_BOUNDS)).toBe(300);
  });
  it("clamps idle-reset to its 1 min – 30 min window", () => {
    expect(minutesToClampedSeconds(45, IDLE_RESET_BOUNDS)).toBe(1800);
    expect(minutesToClampedSeconds(0.5, IDLE_RESET_BOUNDS)).toBe(60);
  });
  it("keeps in-bounds renudge durations", () => {
    expect(minutesToClampedSeconds(15, RENUDGE_BOUNDS)).toBe(900);
  });
  it("clamps renudge to its 1 min – 60 min window", () => {
    expect(minutesToClampedSeconds(120, RENUDGE_BOUNDS)).toBe(3600);
    expect(minutesToClampedSeconds(0.1, RENUDGE_BOUNDS)).toBe(60);
  });
  it("empty/NaN field falls to the lower bound", () => {
    expect(minutesToClampedSeconds(NaN, SPRINT_BOUNDS)).toBe(60);
    expect(minutesToClampedSeconds(NaN, IDLE_RESET_BOUNDS)).toBe(60);
    expect(minutesToClampedSeconds(NaN, RENUDGE_BOUNDS)).toBe(60);
  });
});

describe("sanitizeNumericField", () => {
  it("passes plain digits through", () => {
    expect(sanitizeNumericField("15")).toBe("15");
  });
  it("keeps a single decimal point", () => {
    expect(sanitizeNumericField("0.5")).toBe("0.5");
  });
  it("strips letters and punctuation", () => {
    expect(sanitizeNumericField("1a2b")).toBe("12");
    expect(sanitizeNumericField("12,5")).toBe("125");
    expect(sanitizeNumericField("-3")).toBe("3");
  });
  it("drops decimal points after the first but keeps the digits", () => {
    expect(sanitizeNumericField("1.2.3")).toBe("1.23");
    expect(sanitizeNumericField("..5")).toBe(".5");
  });
  it("returns empty for input with no digits or dot", () => {
    expect(sanitizeNumericField("abc")).toBe("");
    expect(sanitizeNumericField("")).toBe("");
  });
});
