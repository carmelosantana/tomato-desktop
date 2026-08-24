// Spec 1 stats aggregator — the "test instrument" that folds the persisted event
// log into the adherence view. Pure function, no native/DOM/network/clock access:
// the caller supplies the day boundary (`todayStartS`) and `nowS`, so bucketing is
// deterministic and testable. See docs/design/uploads/2026-08-23-agentic-15min-window-spec.md.

import type { DomainEvent } from "./events";

export interface DayStats {
  date: string;
  sprints: number;
  breaksTaken: number;
  breaksSkipped: number;
  overRunS: number;
  timeline: Array<{ kind: "sprint" | "break"; startS: number; endS: number }>;
}

export interface Streak {
  current: number;
}

const DAY_S = 86_400;

/** Label a UTC-midnight day boundary as YYYY-MM-DD. Dates are labeled in UTC; the
 *  caller decides which second is "midnight" via todayStartS. */
const dateLabel = (startOfDayS: number): string =>
  new Date(startOfDayS * 1000).toISOString().slice(0, 10);

/**
 * Fold the event log into today's adherence stats, the current streak, and a
 * 7-day sprints-per-day array. Pure over the in-memory `events`.
 *
 * - sprints (today): `sprint_started` events falling within [todayStartS, +1 day).
 * - breaksTaken / breaksSkipped: `break_completed` / `break_skipped` counts (today).
 * - overRunS: sum of `sprint_ended.over_run_s` (today only).
 * - timeline: sprint/break intervals whose START falls today, paired start↔end by
 *   id (sprint_id / break_id) and ordered by start. In-progress intervals (no end)
 *   are omitted.
 * - streak.current: the trailing run of sprints (whole log, chronological) that were
 *   each followed by a TAKEN (completed) break. A skipped or absent break resets it,
 *   so a still-in-progress final sprint contributes 0 until its break completes.
 * - week: 7 buckets ending today; each `sprints` = `sprint_started` count that day.
 */
export function aggregate(
  events: DomainEvent[],
  opts: { todayStartS: number; nowS: number },
): { today: DayStats; streak: Streak; week: Array<{ date: string; sprints: number }> } {
  const { todayStartS } = opts;
  const todayEndS = todayStartS + DAY_S;
  const isToday = (ts: number): boolean => ts >= todayStartS && ts < todayEndS;

  // --- today counts ---
  let sprints = 0;
  let breaksTaken = 0;
  let breaksSkipped = 0;
  let overRunS = 0;
  for (const e of events) {
    if (!isToday(e.ts)) continue;
    switch (e.event) {
      case "sprint_started":
        sprints++;
        break;
      case "break_completed":
        breaksTaken++;
        break;
      case "break_skipped":
        breaksSkipped++;
        break;
      case "sprint_ended":
        overRunS += e.over_run_s;
        break;
    }
  }

  // --- today timeline: pair start↔end by id, keep intervals starting today ---
  const sprintStart = new Map<string, number>();
  const breakStart = new Map<string, number>();
  const timeline: DayStats["timeline"] = [];
  for (const e of events) {
    switch (e.event) {
      case "sprint_started":
        sprintStart.set(e.sprint_id, e.ts);
        break;
      case "sprint_ended": {
        const s = sprintStart.get(e.sprint_id);
        if (s !== undefined && isToday(s)) timeline.push({ kind: "sprint", startS: s, endS: e.ts });
        break;
      }
      case "break_started":
        breakStart.set(e.break_id, e.ts);
        break;
      case "break_completed": {
        const s = breakStart.get(e.break_id);
        if (s !== undefined && isToday(s)) timeline.push({ kind: "break", startS: s, endS: e.ts });
        break;
      }
    }
  }
  timeline.sort((a, b) => a.startS - b.startS);

  // --- streak: trailing run of sprints each followed by a taken break ---
  const takenBySprint = new Set<string>();
  for (const e of events) if (e.event === "break_completed") takenBySprint.add(e.sprint_id);
  let current = 0;
  for (const e of events) {
    if (e.event !== "sprint_started") continue;
    current = takenBySprint.has(e.sprint_id) ? current + 1 : 0;
  }

  // --- week: sprints per day, 7 buckets ending today ---
  const week: Array<{ date: string; sprints: number }> = [];
  for (let offset = -6; offset <= 0; offset++) {
    const dayStart = todayStartS + offset * DAY_S;
    const dayEnd = dayStart + DAY_S;
    let count = 0;
    for (const e of events) {
      if (e.event === "sprint_started" && e.ts >= dayStart && e.ts < dayEnd) count++;
    }
    week.push({ date: dateLabel(dayStart), sprints: count });
  }

  return {
    today: { date: dateLabel(todayStartS), sprints, breaksTaken, breaksSkipped, overRunS, timeline },
    streak: { current },
    week,
  };
}
