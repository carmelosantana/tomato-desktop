import { describe, it, expect } from "vitest";
import { APP_VERSION } from "./version";
describe("APP_VERSION", () => {
  it("is 0.1.0", () => { expect(APP_VERSION).toBe("0.1.0"); });
});
