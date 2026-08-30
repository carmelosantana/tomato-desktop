import { describe, it, expect } from "vitest";
import { decideNudge, escalateNudge } from "./nudge";

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

describe("escalateNudge", () => {
  it("the boundary nudge (index 0) is soft", () => {
    expect(escalateNudge(0)).toBe("soft");
  });

  it("every re-nudge (index >= 1) is hard", () => {
    expect(escalateNudge(1)).toBe("hard");
    expect(escalateNudge(2)).toBe("hard");
    expect(escalateNudge(10)).toBe("hard");
  });
});
