import { describe, it, expect } from "vitest";
import { computeStats, type DayStats, type WeekDay } from "./stats";
import type { DomainEvent } from "./events";

// Build a UNIX-seconds timestamp at a LOCAL wall-clock time. Using the local
// Date constructor guarantees the event lands on the intended local calendar day
// regardless of the machine's timezone — matching computeStats's local-day
// bucketing (the same approach the stats window uses).
const at = (y: number, mo: number, d: number, h: number, mi = 0, s = 0): number =>
  Math.floor(new Date(y, mo, d, h, mi, s).getTime() / 1000);

// "Now" = 6pm local on 2026-08-23. mo is 0-based (7 = August).
const nowS = at(2026, 7, 23, 18, 0);

// Fixture — one sprint YESTERDAY, three TODAY:
//   S1: boundary nudge (index 0) then idle_reset 180s later  → adherent
//   S2: boundary nudge + a re-nudge (index 1), ends "paused"  → in denom, not numer
//   S3: boundary nudge then idle_reset 900s later (> window)  → in denom, not numer
// Two same-day breaks: S1_end→S2_start (720s) and S2_end→S3_start (480s).
const fixture: DomainEvent[] = [
  // --- yesterday (2026-08-22) ---
  { event: "sprint_started", ts: at(2026, 7, 22, 10, 0), sprint_id: "Y1", trigger: "activity" },
  { event: "sprint_ended", ts: at(2026, 7, 22, 10, 25), sprint_id: "Y1", active_s: 1500, over_s: 50, ended_by: "idle_reset" },

  // --- today: S1 (adherent) ---
  { event: "sprint_started", ts: at(2026, 7, 23, 9, 0), sprint_id: "S1", trigger: "activity" },
  { event: "nudge", ts: at(2026, 7, 23, 9, 15), sprint_id: "S1", active_s: 900, index: 0 },
  { event: "sprint_ended", ts: at(2026, 7, 23, 9, 18), sprint_id: "S1", active_s: 1080, over_s: 180, ended_by: "idle_reset" },

  // --- today: S2 (ends paused; has a re-nudge) ---
  { event: "sprint_started", ts: at(2026, 7, 23, 9, 30), sprint_id: "S2", trigger: "activity" },
  { event: "nudge", ts: at(2026, 7, 23, 9, 45), sprint_id: "S2", active_s: 900, index: 0 },
  { event: "nudge", ts: at(2026, 7, 23, 9, 50), sprint_id: "S2", active_s: 1200, index: 1 },
  { event: "sprint_ended", ts: at(2026, 7, 23, 9, 52), sprint_id: "S2", active_s: 1320, over_s: 420, ended_by: "paused" },

  // --- today: S3 (idle_reset but outside the window) ---
  { event: "sprint_started", ts: at(2026, 7, 23, 10, 0), sprint_id: "S3", trigger: "activity" },
  { event: "nudge", ts: at(2026, 7, 23, 10, 10), sprint_id: "S3", active_s: 600, index: 0 },
  { event: "sprint_ended", ts: at(2026, 7, 23, 10, 25), sprint_id: "S3", active_s: 1500, over_s: 0, ended_by: "idle_reset" },
];

describe("computeStats — today DayStats", () => {
  it("labels today from nowS's local day", () => {
    expect(computeStats(fixture, nowS).today.date).toBe("2026-08-23");
  });

  it("sums today's sprint_ended.active_s (excludes yesterday)", () => {
    expect(computeStats(fixture, nowS).today.activeS).toBe(1080 + 1320 + 1500);
  });

  it("counts today's sprint_ended", () => {
    expect(computeStats(fixture, nowS).today.sprints).toBe(3);
  });

  it("longestStretchS picks the max active_s today", () => {
    expect(computeStats(fixture, nowS).today.longestStretchS).toBe(1500);
  });

  it("counts same-day breaks (gaps sprint_ended→next sprint_started) and sums them", () => {
    const { breaks, totalBreakS, avgBreakS } = computeStats(fixture, nowS).today;
    expect(breaks).toBe(2); // S1→S2 (720s) and S2→S3 (480s); S3 has no following start
    expect(totalBreakS).toBe(720 + 480);
    expect(avgBreakS).toBe(600);
  });

  it("does NOT count a cross-day gap as a break (yesterday's end → today's first start)", () => {
    // Only yesterday's sprint + today's first sprint; the gap spans days → 0 breaks.
    const evs: DomainEvent[] = [
      { event: "sprint_started", ts: at(2026, 7, 22, 23, 0), sprint_id: "A", trigger: "activity" },
      { event: "sprint_ended", ts: at(2026, 7, 22, 23, 30), sprint_id: "A", active_s: 1800, over_s: 0, ended_by: "idle_reset" },
      { event: "sprint_started", ts: at(2026, 7, 23, 0, 30), sprint_id: "B", trigger: "activity" },
      { event: "sprint_ended", ts: at(2026, 7, 23, 1, 0), sprint_id: "B", active_s: 1800, over_s: 0, ended_by: "idle_reset" },
    ];
    expect(computeStats(evs, nowS).today.breaks).toBe(0);
  });

  it("counts today's nudge events (boundary + re-nudges)", () => {
    expect(computeStats(fixture, nowS).today.nudges).toBe(4);
  });
});

describe("computeStats — nudgeAdherence", () => {
  it("is the fraction of boundary (index 0) nudges resolved by idle_reset within the window", () => {
    // 3 boundary nudges (S1,S2,S3); only S1 ends idle_reset within 600s → 1/3.
    expect(computeStats(fixture, nowS).today.nudgeAdherence).toBeCloseTo(1 / 3, 10);
  });

  it("honors a custom adherenceWindowS (S3's 900s gap now counts)", () => {
    const { nudgeAdherence } = computeStats(fixture, nowS, { adherenceWindowS: 1000 }).today;
    expect(nudgeAdherence).toBeCloseTo(2 / 3, 10); // S1 and S3 adherent, S2 paused
  });

  it("ignores re-nudges (index !== 0) in the denominator", () => {
    // One sprint, only a re-nudge at boundary index 1 → no boundary nudges → 0.
    const evs: DomainEvent[] = [
      { event: "sprint_started", ts: at(2026, 7, 23, 9, 0), sprint_id: "R", trigger: "activity" },
      { event: "nudge", ts: at(2026, 7, 23, 9, 15), sprint_id: "R", active_s: 900, index: 1 },
      { event: "sprint_ended", ts: at(2026, 7, 23, 9, 16), sprint_id: "R", active_s: 960, over_s: 60, ended_by: "idle_reset" },
    ];
    expect(computeStats(evs, nowS).today.nudgeAdherence).toBe(0);
  });

  it("excludes boundary nudges whose sprint has no sprint_ended (denominator)", () => {
    // S1 adherent (ends idle_reset), S2's sprint never ends → S2's boundary nudge
    // is not in the denominator, so adherence is 1/1, not 1/2.
    const evs: DomainEvent[] = [
      { event: "sprint_started", ts: at(2026, 7, 23, 9, 0), sprint_id: "S1", trigger: "activity" },
      { event: "nudge", ts: at(2026, 7, 23, 9, 15), sprint_id: "S1", active_s: 900, index: 0 },
      { event: "sprint_ended", ts: at(2026, 7, 23, 9, 18), sprint_id: "S1", active_s: 1080, over_s: 180, ended_by: "idle_reset" },
      { event: "sprint_started", ts: at(2026, 7, 23, 10, 0), sprint_id: "S2", trigger: "activity" },
      { event: "nudge", ts: at(2026, 7, 23, 10, 15), sprint_id: "S2", active_s: 900, index: 0 },
      // S2 never ends (in progress).
    ];
    expect(computeStats(evs, nowS).today.nudgeAdherence).toBe(1);
  });

  it("exposes nudgeAdherenceN, the denominator (boundary nudges with an ended sprint)", () => {
    // Fixture: S1, S2, S3 each have a boundary nudge and a sprint_ended → N = 3.
    expect(computeStats(fixture, nowS).today.nudgeAdherenceN).toBe(3);
  });

  it("nudgeAdherenceN is 0 when there is no adherence data (distinguishes from 0%)", () => {
    // A boundary nudge whose sprint never ended is NOT in the denominator.
    const evs: DomainEvent[] = [
      { event: "sprint_started", ts: at(2026, 7, 23, 10, 0), sprint_id: "X", trigger: "activity" },
      { event: "nudge", ts: at(2026, 7, 23, 10, 15), sprint_id: "X", active_s: 900, index: 0 },
      // never ends
    ];
    const { nudgeAdherence, nudgeAdherenceN } = computeStats(evs, nowS).today;
    expect(nudgeAdherenceN).toBe(0);
    expect(nudgeAdherence).toBe(0);
  });

  it("does not count paused/manual ends toward the numerator", () => {
    const evs: DomainEvent[] = [
      { event: "sprint_started", ts: at(2026, 7, 23, 9, 0), sprint_id: "P", trigger: "activity" },
      { event: "nudge", ts: at(2026, 7, 23, 9, 15), sprint_id: "P", active_s: 900, index: 0 },
      { event: "sprint_ended", ts: at(2026, 7, 23, 9, 16), sprint_id: "P", active_s: 960, over_s: 60, ended_by: "manual" },
    ];
    // 1 boundary nudge in denom, 0 in numer → 0.
    expect(computeStats(evs, nowS).today.nudgeAdherence).toBe(0);
  });
});

describe("computeStats — 7-day week series (active minutes)", () => {
  it("returns 7 buckets ending today with active seconds + minutes", () => {
    const { week } = computeStats(fixture, nowS);
    expect(week).toHaveLength(7);
    expect(week[6]).toEqual<WeekDay>({ date: "2026-08-23", activeS: 3900, activeMinutes: 65 });
    expect(week[5]).toEqual<WeekDay>({ date: "2026-08-22", activeS: 1500, activeMinutes: 25 });
    expect(week[0].date).toBe("2026-08-17");
    // Days with no sprints are zeroed.
    expect(week.slice(0, 5).every((d) => d.activeS === 0 && d.activeMinutes === 0)).toBe(true);
  });
});

describe("computeStats — empty log", () => {
  it("yields all zeros (no divide-by-zero) and a zeroed week", () => {
    const { today, week } = computeStats([], nowS);
    expect(today).toEqual<DayStats>({
      date: "2026-08-23",
      activeS: 0,
      sprints: 0,
      longestStretchS: 0,
      breaks: 0,
      totalBreakS: 0,
      avgBreakS: 0,
      nudges: 0,
      nudgeAdherence: 0,
      nudgeAdherenceN: 0,
    });
    expect(week).toHaveLength(7);
    expect(week.every((d) => d.activeS === 0 && d.activeMinutes === 0)).toBe(true);
  });
});
