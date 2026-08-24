// Pure onboarding step-navigation logic: a clamped cursor over a fixed number of
// steps, answering isFirst/isLast so the (impure) onboarding window can render
// Back/Next/Get-started without re-deriving the boundaries. No DOM/Tauri
// dependency, so it is unit-tested here.

/** A cursor over `count` steps, currently on `index` (0-based). */
export interface StepState {
  readonly index: number;
  readonly count: number;
}

/** Create a stepper of `count` steps positioned on the first step. */
export function makeSteps(count: number): StepState {
  const n = Math.max(1, Math.floor(count));
  return { index: 0, count: n };
}

/** Advance one step, clamped to the last step. */
export function nextStep(s: StepState): StepState {
  return { ...s, index: Math.min(s.index + 1, s.count - 1) };
}

/** Retreat one step, clamped to the first step. */
export function prevStep(s: StepState): StepState {
  return { ...s, index: Math.max(s.index - 1, 0) };
}

/** True when the cursor is on the first step (Back is a no-op / hidden). */
export function isFirst(s: StepState): boolean {
  return s.index <= 0;
}

/** True when the cursor is on the last step (Next becomes Get started). */
export function isLast(s: StepState): boolean {
  return s.index >= s.count - 1;
}
