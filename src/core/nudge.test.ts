import { describe, it, expect } from "vitest";
import { decideNudge } from "./nudge";

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
