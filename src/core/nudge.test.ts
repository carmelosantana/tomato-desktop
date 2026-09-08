import { describe, it, expect } from "vitest";
import { chooseNudgeSurface, decideNudge, dismissLockLabel, isNudgeMode } from "./nudge";

describe("decideNudge", () => {
  it("suppresses the nudge when DND is active", () => {
    expect(decideNudge("active")).toBe("suppress");
  });
  it("notifies when DND is inactive", () => {
    expect(decideNudge("inactive")).toBe("notify");
  });
  it("notifies (quietly, handled elsewhere) when DND is unknown", () => {
    expect(decideNudge("unknown")).toBe("notify");
  });
});

describe("chooseNudgeSurface", () => {
  it("soft mode is soft at the boundary and at every re-nudge", () => {
    expect(chooseNudgeSurface("soft", 0)).toBe("soft");
    expect(chooseNudgeSurface("soft", 1)).toBe("soft");
    expect(chooseNudgeSurface("soft", 7)).toBe("soft");
  });

  it("hard mode is hard from the boundary onward", () => {
    expect(chooseNudgeSurface("hard", 0)).toBe("hard");
    expect(chooseNudgeSurface("hard", 1)).toBe("hard");
    expect(chooseNudgeSurface("hard", 7)).toBe("hard");
  });

  it("escalating mode is soft at the boundary, hard from the first re-nudge", () => {
    expect(chooseNudgeSurface("escalating", 0)).toBe("soft");
    expect(chooseNudgeSurface("escalating", 1)).toBe("hard");
    expect(chooseNudgeSurface("escalating", 7)).toBe("hard");
  });

  it("treats a negative or fractional index as the boundary in escalating mode", () => {
    expect(chooseNudgeSurface("escalating", -1)).toBe("soft");
    expect(chooseNudgeSurface("escalating", 0.5)).toBe("soft");
  });
});

describe("isNudgeMode", () => {
  it("accepts the three modes", () => {
    expect(isNudgeMode("soft")).toBe(true);
    expect(isNudgeMode("hard")).toBe(true);
    expect(isNudgeMode("escalating")).toBe(true);
  });

  it("rejects anything else", () => {
    expect(isNudgeMode("Escalating")).toBe(false);
    expect(isNudgeMode("gentle")).toBe(false);
    expect(isNudgeMode("")).toBe(false);
    expect(isNudgeMode(undefined)).toBe(false);
    expect(isNudgeMode(null)).toBe(false);
    expect(isNudgeMode(1)).toBe(false);
  });
});

describe("dismissLockLabel", () => {
  it("rounds up to whole seconds so a fresh lock reads its full duration", () => {
    expect(dismissLockLabel(10000)).toBe("Dismiss in 10");
    expect(dismissLockLabel(9001)).toBe("Dismiss in 10");
    expect(dismissLockLabel(9000)).toBe("Dismiss in 9");
  });

  it("counts down to one, never showing a zero", () => {
    expect(dismissLockLabel(1000)).toBe("Dismiss in 1");
    expect(dismissLockLabel(1)).toBe("Dismiss in 1");
  });

  it("unlocks at zero and below", () => {
    expect(dismissLockLabel(0)).toBe("Dismiss");
    expect(dismissLockLabel(-500)).toBe("Dismiss");
  });
});
