// Spec 1 timer state machine — pure logic, no Tauri/DOM/network dependency.
//
// States advance forward only: focus → grace → break → idle. Durations are
// injected via TimerConfig so the same machine serves enforced and soft modes.

export type TimerState = "idle" | "focus" | "grace" | "break" | "stopped";

export interface TimerConfig {
  sprintMs: number;
  breakMs: number;
  graceMs: number;
  earlyGraceMs: number;
  mode: "enforced" | "soft";
}

export interface TimerSnapshot {
  state: TimerState;
  sprintElapsedMs: number;
  graceElapsedMs: number;
  breakElapsedMs: number;
  activeFocusMs: number;
  overRunMs: number;
  streakIndex: number;
}

// Lightweight events returned from actions/tick. Task 4 maps these to persisted
// DomainEvents; the timer itself stays free of persistence concerns.
export type TimerEvent =
  | { type: "focus-started"; at: number }
  | { type: "boundary-reached"; at: number }
  | { type: "grace-started"; at: number; graceMs: number }
  | { type: "grace-ended"; at: number; ended_by: "timeout" | "user" }
  | { type: "break-started"; at: number }
  | { type: "break-completed"; at: number }
  | { type: "break-skipped"; at: number }
  | { type: "nudge"; at: number }
  | { type: "stopped"; at: number };

export class TimerMachine {
  private readonly config: TimerConfig;

  private state: TimerState = "idle";
  private lastTick = 0;

  private sprintElapsedMs = 0;
  private graceElapsedMs = 0;
  private breakElapsedMs = 0;
  private activeFocusMs = 0;
  private streakIndex = 0;

  // Guards single boundary emission per sprint (matters in soft mode, where we
  // stay in focus and would otherwise re-emit the nudge every tick past boundary).
  private boundaryEmitted = false;

  constructor(config: TimerConfig) {
    this.config = config;
  }

  /** Effective grace for the current sprint: early grace on the first of a streak. */
  effectiveGraceMs(): number {
    return this.streakIndex === 0 ? this.config.earlyGraceMs : this.config.graceMs;
  }

  /** idle/stopped → focus. streakIndex is preserved across a streak (reset on stop/cold idle). */
  start(now: number): TimerEvent[] {
    if (this.state !== "idle" && this.state !== "stopped") return [];
    this.state = "focus";
    this.lastTick = now;
    this.sprintElapsedMs = 0;
    this.graceElapsedMs = 0;
    this.breakElapsedMs = 0;
    this.activeFocusMs = 0;
    this.boundaryEmitted = false;
    return [{ type: "focus-started", at: now }];
  }

  /** Advance the machine to `now`, emitting any boundary/transition events crossed. */
  tick(now: number): TimerEvent[] {
    const events: TimerEvent[] = [];
    let remaining = now - this.lastTick;
    this.lastTick = now;
    if (remaining <= 0) return events;

    // FOCUS: accumulate toward the sprint boundary.
    if (this.state === "focus") {
      if (!this.boundaryEmitted && this.sprintElapsedMs + remaining >= this.config.sprintMs) {
        const toBoundary = Math.max(0, this.config.sprintMs - this.sprintElapsedMs);
        this.sprintElapsedMs += toBoundary;
        this.activeFocusMs += toBoundary;
        remaining -= toBoundary;
        this.boundaryEmitted = true;
        events.push({ type: "boundary-reached", at: now });
        if (this.config.mode === "enforced") {
          this.state = "grace";
          this.graceElapsedMs = 0;
          events.push({ type: "grace-started", at: now, graceMs: this.effectiveGraceMs() });
        } else {
          events.push({ type: "nudge", at: now });
        }
      }
      // Any delta not consumed by a transition keeps accruing focus time (soft
      // mode past boundary, or ordinary sub-boundary ticks).
      if (this.state === "focus" && remaining > 0) {
        this.sprintElapsedMs += remaining;
        this.activeFocusMs += remaining;
        remaining = 0;
      }
    }

    // GRACE: accumulate toward the effective grace limit, then start the break.
    if (this.state === "grace" && remaining > 0) {
      const limit = this.effectiveGraceMs();
      const toEnd = limit - this.graceElapsedMs;
      if (remaining < toEnd) {
        this.graceElapsedMs += remaining;
        this.activeFocusMs += remaining;
        remaining = 0;
      } else {
        this.graceElapsedMs += toEnd;
        this.activeFocusMs += toEnd;
        remaining -= toEnd;
        this.state = "break";
        this.breakElapsedMs = 0;
        events.push({ type: "grace-ended", at: now, ended_by: "timeout" });
        events.push({ type: "break-started", at: now });
      }
    }

    // BREAK: accumulate toward the break limit, then return to idle (no auto-chain).
    if (this.state === "break" && remaining > 0) {
      const toEnd = this.config.breakMs - this.breakElapsedMs;
      if (remaining < toEnd) {
        this.breakElapsedMs += remaining;
        remaining = 0;
      } else {
        this.breakElapsedMs += toEnd;
        remaining -= toEnd;
        this.state = "idle";
        this.streakIndex += 1;
        events.push({ type: "break-completed", at: now });
      }
    }

    return events;
  }

  /** End grace early and begin the break now (enforced flow). */
  breakNow(now: number): TimerEvent[] {
    const events = this.tick(now);
    if (this.state === "grace") {
      this.state = "break";
      this.breakElapsedMs = 0;
      events.push({ type: "grace-ended", at: now, ended_by: "user" });
      events.push({ type: "break-started", at: now });
    } else if (this.state === "focus") {
      // No grace was in play; go straight to the break.
      this.state = "break";
      this.breakElapsedMs = 0;
      this.boundaryEmitted = true;
      events.push({ type: "break-started", at: now });
    }
    return events;
  }

  /** Soft-mode manual break: leave focus and begin the break. */
  beginBreak(now: number): TimerEvent[] {
    const events = this.tick(now);
    if (this.state === "focus" || this.state === "grace") {
      this.state = "break";
      this.breakElapsedMs = 0;
      events.push({ type: "break-started", at: now });
    }
    return events;
  }

  /** Skip the break entirely and return to idle, counting the sprint. */
  skipBreak(now: number): TimerEvent[] {
    const events = this.tick(now);
    if (this.state === "grace" || this.state === "break" || this.state === "focus") {
      this.state = "idle";
      this.streakIndex += 1;
      events.push({ type: "break-skipped", at: now });
    }
    return events;
  }

  /** Stop from any active state; streakIndex resets (cold start next time). */
  stop(now: number): TimerEvent[] {
    if (this.state === "stopped" || this.state === "idle") {
      this.state = "stopped";
      this.streakIndex = 0;
      this.lastTick = now;
      return [{ type: "stopped", at: now }];
    }
    const events = this.tick(now);
    this.state = "stopped";
    this.streakIndex = 0;
    events.push({ type: "stopped", at: now });
    return events;
  }

  /** Read-only projection of the machine as of `now` (no mutation). */
  snapshot(now: number): TimerSnapshot {
    const delta = Math.max(0, now - this.lastTick);
    let sprintElapsedMs = this.sprintElapsedMs;
    let graceElapsedMs = this.graceElapsedMs;
    let breakElapsedMs = this.breakElapsedMs;
    let activeFocusMs = this.activeFocusMs;

    if (this.state === "focus") {
      sprintElapsedMs += delta;
      activeFocusMs += delta;
    } else if (this.state === "grace") {
      graceElapsedMs += delta;
      activeFocusMs += delta;
    } else if (this.state === "break") {
      breakElapsedMs += delta;
    }

    return {
      state: this.state,
      sprintElapsedMs,
      graceElapsedMs,
      breakElapsedMs,
      activeFocusMs,
      overRunMs: Math.max(0, activeFocusMs - this.config.sprintMs),
      streakIndex: this.streakIndex,
    };
  }
}
