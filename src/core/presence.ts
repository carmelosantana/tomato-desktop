// Tomato v2 "Presence Companion" — pure core, no Tauri/DOM/network dependency.
//
// The machine is a companion, not an enforcer: it watches OS presence and, once a
// stretch of focus clears a noise floor, logs a "sprint" and gently nudges past a
// soft boundary. It never blocks or forces a break.
//
// It is fed `tick(now, idleMs)` at ~1 Hz. `idleMs` is milliseconds since the last
// OS input event; `idleMs === null` means the presence provider is unavailable, so
// the machine runs in MANUAL mode (start/stop/nudge on wall time only). All units
// are milliseconds throughout.

export type PresenceState = "away" | "active" | "paused";

export interface PresenceConfig {
  /** Soft boundary: first nudge fires when the active span reaches this. */
  sprintMs: number;
  /** Idle (ms since last input) at or above this ends the active sprint. */
  idleResetMs: number;
  /** After the boundary, re-nudge on this cadence. */
  renudgeEveryMs: number;
  /** Idle at or below this counts as "present" and can begin a sprint. */
  activityThresholdMs: number;
  /** Noise floor: sprints shorter than this are never logged (no start/end). */
  minSprintLogMs: number;
}

// Lightweight events returned from actions/tick. A later task maps these to
// persisted DomainEvents; the machine itself stays free of persistence concerns.
export type PresenceEvent =
  | { type: "sprint-started"; at: number; trigger: "activity" | "manual" }
  | { type: "nudge"; at: number; activeMs: number; index: number }
  | {
      type: "sprint-ended";
      at: number;
      activeMs: number;
      overMs: number;
      endedBy: "idle_reset" | "paused" | "manual";
    };

export interface PresenceSnapshot {
  state: PresenceState;
  activeMs: number;
  overMs: number;
}

export class PresenceMachine {
  private config: PresenceConfig;

  private state: PresenceState = "away";

  // Wall-clock instant the current sprint began (the last-activity instant that
  // triggered it, so the timeline reflects when focus actually started).
  private sprintStartAt = 0;

  // Deferred-start guard: a sprint is tracked internally the moment activity
  // begins, but `sprint-started` is withheld until the sprint clears the noise
  // floor. If it ends first, nothing is ever emitted.
  private sprintStartedEmitted = false;

  // Nudge cursor: next nudge's ordinal and the instant it is due.
  private nudgeIndex = 0;
  private nextNudgeAt = 0;

  constructor(config: PresenceConfig) {
    this.config = config;
  }

  /**
   * Replace the config. Intended for use BETWEEN sprints (state away/paused) so a
   * settings change takes effect on the next sprint without disturbing one in
   * progress — callers must gate on state. Internal sprint tracking is untouched.
   */
  setConfig(config: PresenceConfig): void {
    this.config = config;
  }

  /** Read-only view of the machine's current state (no mutation). */
  currentState(): PresenceState {
    return this.state;
  }

  /**
   * Advance the machine to `now`. `idleMs` is ms since last OS input, or null when
   * the presence provider is unavailable (manual mode). Returns any events crossed.
   */
  tick(now: number, idleMs: number | null): PresenceEvent[] {
    if (this.state === "paused") return [];

    // Manual mode: no presence signal. Only an active manual sprint does anything,
    // and only its nudge loop runs (no auto-start, no auto-reset).
    if (idleMs === null) {
      if (this.state !== "active") return [];
      const events: PresenceEvent[] = [];
      this.runNudgeLoop(events, now);
      return events;
    }

    const events: PresenceEvent[] = [];
    const lastActivityAt = now - idleMs;

    if (this.state === "away") {
      if (idleMs <= this.config.activityThresholdMs) {
        // Begin a sprint, anchored at the actual last-activity instant. Emission of
        // sprint-started is deferred until the floor clears; fall through to the
        // active handling below (which cannot fire this same tick, since
        // now - sprintStartAt === idleMs <= activityThresholdMs < minSprintLogMs).
        this.state = "active";
        this.sprintStartAt = lastActivityAt;
        this.sprintStartedEmitted = false;
        this.nudgeIndex = 0;
        this.nextNudgeAt = this.sprintStartAt + this.config.sprintMs;
      } else {
        return events;
      }
    }

    // Active handling (also reached by fall-through from a fresh start above).
    if (this.state === "active") {
      if (idleMs >= this.config.idleResetMs) {
        // Idle long enough to end the sprint. Measure the active span to the LAST
        // activity, so trailing idle is excluded from the logged time.
        const activeMs = Math.max(0, lastActivityAt - this.sprintStartAt);
        if (this.sprintStartedEmitted) {
          events.push({
            type: "sprint-ended",
            at: lastActivityAt,
            activeMs,
            overMs: Math.max(0, activeMs - this.config.sprintMs),
            endedBy: "idle_reset",
          });
        }
        this.state = "away";
        return events;
      }

      // Still present. Release the deferred sprint-started once the floor clears.
      if (!this.sprintStartedEmitted && now - this.sprintStartAt >= this.config.minSprintLogMs) {
        this.sprintStartedEmitted = true;
        events.push({ type: "sprint-started", at: this.sprintStartAt, trigger: "activity" });
      }
      this.runNudgeLoop(events, now);
    }

    return events;
  }

  /**
   * Emit any nudges due at or before `now`. Runs only once the sprint has started
   * (so it is gated by callers). The `while` catches up deterministically when a
   * single tick delta spans several renudge intervals.
   */
  private runNudgeLoop(events: PresenceEvent[], now: number): void {
    if (!this.sprintStartedEmitted) return;
    while (now >= this.nextNudgeAt) {
      events.push({
        type: "nudge",
        at: this.nextNudgeAt,
        activeMs: this.nextNudgeAt - this.sprintStartAt,
        index: this.nudgeIndex,
      });
      this.nudgeIndex += 1;
      this.nextNudgeAt += this.config.renudgeEveryMs;
    }
  }

  /** away → active in manual mode; sprint-started emits immediately (no deferral). */
  manualStart(now: number): PresenceEvent[] {
    if (this.state !== "away") return [];
    this.state = "active";
    this.sprintStartAt = now;
    this.sprintStartedEmitted = true;
    this.nudgeIndex = 0;
    this.nextNudgeAt = now + this.config.sprintMs;
    return [{ type: "sprint-started", at: now, trigger: "manual" }];
  }

  /** active → away in manual mode; ends the sprint with endedBy "manual". */
  manualStop(now: number): PresenceEvent[] {
    if (this.state !== "active") return [];
    const activeMs = now - this.sprintStartAt;
    this.state = "away";
    return [
      {
        type: "sprint-ended",
        at: now,
        activeMs,
        overMs: Math.max(0, activeMs - this.config.sprintMs),
        endedBy: "manual",
      },
    ];
  }

  /** → paused. Ends an in-progress (logged) sprint with endedBy "paused". */
  pause(now: number): PresenceEvent[] {
    const events: PresenceEvent[] = [];
    if (this.state === "active" && this.sprintStartedEmitted) {
      const activeMs = now - this.sprintStartAt;
      events.push({
        type: "sprint-ended",
        at: now,
        activeMs,
        overMs: Math.max(0, activeMs - this.config.sprintMs),
        endedBy: "paused",
      });
    }
    this.state = "paused";
    return events;
  }

  /** paused → away. No event; the next activity begins a fresh sprint. */
  resume(_now: number): PresenceEvent[] {
    if (this.state === "paused") this.state = "away";
    return [];
  }

  /** Read-only projection of the machine as of `now` (no mutation). */
  snapshot(now: number): PresenceSnapshot {
    if (this.state === "active") {
      const activeMs = now - this.sprintStartAt;
      return {
        state: this.state,
        activeMs,
        overMs: Math.max(0, activeMs - this.config.sprintMs),
      };
    }
    return { state: this.state, activeMs: 0, overMs: 0 };
  }
}
