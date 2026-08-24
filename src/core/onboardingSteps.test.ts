import { describe, it, expect } from "vitest";
import {
  makeSteps,
  nextStep,
  prevStep,
  isFirst,
  isLast,
} from "./onboardingSteps";

describe("makeSteps", () => {
  it("starts on the first step", () => {
    expect(makeSteps(3)).toEqual({ index: 0, count: 3 });
  });
  it("coerces a non-positive/fractional count to at least one step", () => {
    expect(makeSteps(0).count).toBe(1);
    expect(makeSteps(-2).count).toBe(1);
    expect(makeSteps(3.7).count).toBe(3);
  });
});

describe("nextStep / prevStep", () => {
  it("advances and retreats within range", () => {
    const s0 = makeSteps(3);
    const s1 = nextStep(s0);
    expect(s1.index).toBe(1);
    expect(nextStep(s1).index).toBe(2);
    expect(prevStep(s1).index).toBe(0);
  });
  it("clamps at the last step", () => {
    const last = nextStep(nextStep(nextStep(makeSteps(3))));
    expect(last.index).toBe(2);
  });
  it("clamps at the first step", () => {
    expect(prevStep(prevStep(makeSteps(3))).index).toBe(0);
  });
});

describe("isFirst / isLast", () => {
  it("flags the boundaries of a 3-step flow", () => {
    const s0 = makeSteps(3);
    expect(isFirst(s0)).toBe(true);
    expect(isLast(s0)).toBe(false);

    const s2 = nextStep(nextStep(s0));
    expect(isFirst(s2)).toBe(false);
    expect(isLast(s2)).toBe(true);
  });
  it("treats a single-step flow as both first and last", () => {
    const only = makeSteps(1);
    expect(isFirst(only)).toBe(true);
    expect(isLast(only)).toBe(true);
  });
});
