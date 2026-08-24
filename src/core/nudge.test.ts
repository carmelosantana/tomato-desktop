import { describe, it, expect } from "vitest";
import { decideNudge } from "./nudge";

describe("decideNudge", () => {
  it("shows a card when DND is inactive", () => {
    expect(decideNudge("inactive")).toBe("card");
  });
  it("falls back to a notification when DND is active", () => {
    expect(decideNudge("active")).toBe("notification");
  });
  it("shows a quiet card when DND is unknown", () => {
    expect(decideNudge("unknown")).toBe("card-quiet");
  });
});
