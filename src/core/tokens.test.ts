import { describe, it, expect } from "vitest";
import { RING_TOKENS, ringTrackColor, ringProgressColor } from "./tokens";
// The design-kit source of truth; pinning a few values here guards tokens.ts
// against silently drifting away from tomato-tokens.json.
import kit from "../../docs/design/tomato-tokens.json";

describe("RING_TOKENS mirrors tomato-tokens.json", () => {
  for (const mode of ["light", "dark"] as const) {
    it(`${mode}: track = neutral.border, focus/overrun = state.*`, () => {
      expect(RING_TOKENS[mode].track).toBe(kit.color[mode].neutral.border.$value);
      expect(RING_TOKENS[mode].focus).toBe(kit.color[mode].state.focus.$value);
      expect(RING_TOKENS[mode].overrun).toBe(kit.color[mode].state.overrun.$value);
    });
  }

  it("pins the exact hex values (drift guard)", () => {
    expect(RING_TOKENS.light.focus).toBe("#128a7a");
    expect(RING_TOKENS.dark.overrun).toBe("#eb5a4d");
    expect(RING_TOKENS.light.track).toBe("#e6ddd2");
  });

  it("accessors resolve the same values", () => {
    expect(ringTrackColor("dark")).toBe(RING_TOKENS.dark.track);
    expect(ringProgressColor("light", "overrun")).toBe(RING_TOKENS.light.overrun);
    expect(ringProgressColor("dark", "focus")).toBe(RING_TOKENS.dark.focus);
  });
});
