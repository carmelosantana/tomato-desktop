import { describe, it, expect } from "vitest";
import { formatMMSS } from "./format";

describe("formatMMSS", () => {
  it("zero-pads seconds and leaves minutes uncapped", () => {
    expect(formatMMSS(0)).toBe("0:00");
    expect(formatMMSS(5000)).toBe("0:05");
    expect(formatMMSS(65000)).toBe("1:05");
    expect(formatMMSS(120000)).toBe("2:00");
    expect(formatMMSS(600000)).toBe("10:00");
  });

  it("rounds up to the next whole second (ceiling of remaining)", () => {
    expect(formatMMSS(1)).toBe("0:01");
    expect(formatMMSS(1999)).toBe("0:02");
    expect(formatMMSS(59001)).toBe("1:00");
  });

  it("clamps negatives to 0:00", () => {
    expect(formatMMSS(-1)).toBe("0:00");
    expect(formatMMSS(-5000)).toBe("0:00");
  });
});
