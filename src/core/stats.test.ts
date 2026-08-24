import { describe, it, expect } from "vitest";
import { aggregate, type DayStats, type Streak } from "./stats";
import type { DomainEvent } from "./events";

const DAY = 86_400;
// A UTC-midnight day boundary — the caller is the authority on "today".
const todayStartS = Math.floor(Date.UTC(2026, 7, 23) / 1000); // 2026-08-23 00:00:00Z
const t = (offset: number): number => todayStartS + offset;

// Fixture: one sprint yesterday (with a taken break), then three today —
// S1 taken break, S2 skipped break, S3 taken break.
const fixture: DomainEvent[] = [
  // --- yesterday ---
  { event: "sprint_started", ts: t(-DAY + 3600), sprint_id: "Y1", planned_s: 900, enforcement_mode: "enforced" },
  { event: "sprint_ended", ts: t(-DAY + 5400), sprint_id: "Y1", actual_focus_s: 1500, over_run_s: 50 },
  { event: "break_started", ts: t(-DAY + 5400), sprint_id: "Y1", break_id: "YB1", planned_s: 300 },
  { event: "break_completed", ts: t(-DAY + 5700), sprint_id: "Y1", break_id: "YB1", actual_s: 300 },
  // --- today: S1 (taken break) ---
  { event: "sprint_started", ts: t(3600), sprint_id: "S1", planned_s: 900, enforcement_mode: "enforced" },
  { event: "sprint_ended", ts: t(5400), sprint_id: "S1", actual_focus_s: 1500, over_run_s: 120 },
  { event: "break_started", ts: t(5400), sprint_id: "S1", break_id: "B1", planned_s: 300 },
  { event: "break_completed", ts: t(5700), sprint_id: "S1", break_id: "B1", actual_s: 300 },
  // --- today: S2 (skipped break) ---
  { event: "sprint_started", ts: t(6000), sprint_id: "S2", planned_s: 900, enforcement_mode: "soft" },
  { event: "sprint_ended", ts: t(7800), sprint_id: "S2", actual_focus_s: 1800, over_run_s: 0 },
  { event: "break_skipped", ts: t(7810), sprint_id: "S2", break_id: "B2", after_s: 60 },
  // --- today: S3 (taken break) ---
  { event: "sprint_started", ts: t(8000), sprint_id: "S3", planned_s: 900, enforcement_mode: "enforced" },
  { event: "sprint_ended", ts: t(9800), sprint_id: "S3", actual_focus_s: 1800, over_run_s: 200 },
  { event: "break_started", ts: t(9800), sprint_id: "S3", break_id: "B3", planned_s: 300 },
  { event: "break_completed", ts: t(10100), sprint_id: "S3", break_id: "B3", actual_s: 300 },
];

const opts = { todayStartS, nowS: t(11000) };

describe("aggregate — today DayStats", () => {
  it("labels the day from todayStartS (UTC)", () => {
    expect(aggregate(fixture, opts).today.date).toBe("2026-08-23");
  });

  it("counts today's sprints (sprint_started within today only)", () => {
    expect(aggregate(fixture, opts).today.sprints).toBe(3);
  });

  it("counts breaks taken vs skipped for today", () => {
    const { breaksTaken, breaksSkipped } = aggregate(fixture, opts).today;
    expect(breaksTaken).toBe(2);
    expect(breaksSkipped).toBe(1);
  });

  it("sums over-run seconds for today only (excludes yesterday's 50)", () => {
    expect(aggregate(fixture, opts).today.overRunS).toBe(320);
  });

  it("builds the day timeline (sprint & break intervals, start-ordered)", () => {
    expect(aggregate(fixture, opts).today.timeline).toEqual<DayStats["timeline"]>([
      { kind: "sprint", startS: t(3600), endS: t(5400) },
      { kind: "break", startS: t(5400), endS: t(5700) },
      { kind: "sprint", startS: t(6000), endS: t(7800) },
      { kind: "sprint", startS: t(8000), endS: t(9800) },
      { kind: "break", startS: t(9800), endS: t(10100) },
    ]);
  });
});

describe("aggregate — streak", () => {
  it("counts the trailing run of sprints each followed by a taken break", () => {
    // Y1✓ S1✓ S2✗(skipped) S3✓ → trailing run is just S3 = 1
    expect(aggregate(fixture, opts).streak).toEqual<Streak>({ current: 1 });
  });

  it("grows across consecutive taken-break sprints", () => {
    const evs: DomainEvent[] = [
      { event: "sprint_started", ts: t(100), sprint_id: "A", planned_s: 900, enforcement_mode: "enforced" },
      { event: "break_completed", ts: t(200), sprint_id: "A", break_id: "a", actual_s: 300 },
      { event: "sprint_started", ts: t(300), sprint_id: "B", planned_s: 900, enforcement_mode: "enforced" },
      { event: "break_completed", ts: t(400), sprint_id: "B", break_id: "b", actual_s: 300 },
    ];
    expect(aggregate(evs, opts).streak.current).toBe(2);
  });
});

describe("aggregate — week", () => {
  it("returns 7 day buckets ending today with sprint counts", () => {
    expect(aggregate(fixture, opts).week).toEqual([
      { date: "2026-08-17", sprints: 0 },
      { date: "2026-08-18", sprints: 0 },
      { date: "2026-08-19", sprints: 0 },
      { date: "2026-08-20", sprints: 0 },
      { date: "2026-08-21", sprints: 0 },
      { date: "2026-08-22", sprints: 1 },
      { date: "2026-08-23", sprints: 3 },
    ]);
  });
});

describe("aggregate — enforced cycle without a manual Stop (FIX 1 regression lock)", () => {
  // The event stream a normal enforced cycle now produces: sprint_ended is
  // emitted at the focus→break transition, BEFORE break_started — never a Stop.
  const cycle: DomainEvent[] = [
    { event: "sprint_started", ts: t(100), sprint_id: "C1", planned_s: 900, enforcement_mode: "enforced" },
    { event: "boundary_reached", ts: t(1000), sprint_id: "C1" },
    { event: "grace_started", ts: t(1000), sprint_id: "C1", grace_s: 300, streak_index: 0 },
    { event: "grace_ended", ts: t(1300), sprint_id: "C1", actual_grace_s: 300, ended_by: "timeout" },
    { event: "sprint_ended", ts: t(1300), sprint_id: "C1", actual_focus_s: 1200, over_run_s: 300 },
    { event: "break_started", ts: t(1300), sprint_id: "C1", break_id: "CB1", planned_s: 300 },
    { event: "break_completed", ts: t(1600), sprint_id: "C1", break_id: "CB1", actual_s: 300 },
  ];

  it("draws the sprint timeline bar and sums the over-run tile", () => {
    const { today } = aggregate(cycle, opts);
    expect(today.timeline).toContainEqual({ kind: "sprint", startS: t(100), endS: t(1300) });
    expect(today.timeline).toContainEqual({ kind: "break", startS: t(1300), endS: t(1600) });
    expect(today.overRunS).toBeGreaterThan(0);
    expect(today.overRunS).toBe(300);
  });
});

describe("aggregate — empty log", () => {
  it("yields all zeros, empty timeline, and a zeroed week", () => {
    const { today, streak, week } = aggregate([], opts);
    expect(today).toEqual<DayStats>({
      date: "2026-08-23",
      sprints: 0,
      breaksTaken: 0,
      breaksSkipped: 0,
      overRunS: 0,
      timeline: [],
    });
    expect(streak).toEqual<Streak>({ current: 0 });
    expect(week).toHaveLength(7);
    expect(week.every((d) => d.sprints === 0)).toBe(true);
    expect(week[6]).toEqual({ date: "2026-08-23", sprints: 0 });
  });
});
