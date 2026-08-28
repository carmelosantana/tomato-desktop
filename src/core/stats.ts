// Tomato v2 "Presence Companion" stats aggregator — the pure fold from the
// persisted DomainEvent log into today's presence summary plus a 7-day active
// series. No native/DOM/network access: the caller supplies `nowS` (UNIX
// seconds) and, optionally, the adherence window; "today" and the week buckets
// are derived by LOCAL calendar day (same approach the stats window uses).

import type { DomainEvent } from "./events";

type SprintEnded = Extract<DomainEvent, { event: "sprint_ended" }>;
type SprintStarted = Extract<DomainEvent, { event: "sprint_started" }>;
type Nudge = Extract<DomainEvent, { event: "nudge" }>;

export interface DayStats {
  /** Local-day label of today, YYYY-MM-DD. */
  date: string;
  /** Sum of today's sprint_ended.active_s. */
  activeS: number;
  /** Count of today's sprint_ended. */
  sprints: number;
  /** Max active_s among today's sprint_ended (0 if none). */
  longestStretchS: number;
  /** Count of gaps between a sprint_ended and the next sprint_started, same local day. */
  breaks: number;
  /** Sum of those gap durations. */
  totalBreakS: number;
  /** totalBreakS / breaks, or 0 when there are no breaks. */
  avgBreakS: number;
  /** Count of today's nudge events (boundary + re-nudges). */
  nudges: number;
  /**
   * Fraction of today's boundary nudges (index 0) — that belong to a sprint with
   * a sprint_ended — whose sprint ended via `idle_reset` within `adherenceWindowS`
   * of the nudge. 0 when the denominator is 0 (no divide-by-zero).
   */
  nudgeAdherence: number;
}

export interface WeekDay {
  /** Local-day label, YYYY-MM-DD. */
  date: string;
  /** Sum of that day's sprint_ended.active_s. */
  activeS: number;
  /** activeS expressed in minutes (for the bar chart). */
  activeMinutes: number;
}

export interface Stats {
  today: DayStats;
  /** 7 buckets ending today (index 6 = today), oldest first. */
  week: WeekDay[];
}

const DEFAULT_ADHERENCE_WINDOW_S = 600;
const WEEK_DAYS = 7;

const pad2 = (n: number): string => String(n).padStart(2, "0");

/** UNIX-seconds of local midnight for the day containing `ts`. */
function startOfLocalDayS(ts: number): number {
  const d = new Date(ts * 1000);
  return Math.floor(new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() / 1000);
}

/** Local-day label (YYYY-MM-DD) for the day containing `ts`. */
function localDateLabel(ts: number): string {
  const d = new Date(ts * 1000);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/**
 * Fold the DomainEvent log into today's presence summary and a 7-day active
 * series. Pure over the in-memory `events`; "today" and the week are bucketed by
 * local calendar day relative to `nowS`.
 */
export function computeStats(
  events: DomainEvent[],
  nowS: number,
  opts?: { adherenceWindowS?: number },
): Stats {
  const adherenceWindowS = opts?.adherenceWindowS ?? DEFAULT_ADHERENCE_WINDOW_S;
  const todayStartS = startOfLocalDayS(nowS);
  const isToday = (ts: number): boolean => startOfLocalDayS(ts) === todayStartS;

  const ended = events.filter((e): e is SprintEnded => e.event === "sprint_ended");
  const started = events.filter((e): e is SprintStarted => e.event === "sprint_started");
  const nudgeEvents = events.filter((e): e is Nudge => e.event === "nudge");

  // --- today's sprint_ended-derived tiles ---
  const endedToday = ended.filter((e) => isToday(e.ts));
  const activeS = endedToday.reduce((sum, e) => sum + e.active_s, 0);
  const sprints = endedToday.length;
  const longestStretchS = endedToday.reduce((max, e) => Math.max(max, e.active_s), 0);

  // --- breaks: gap from a today sprint_ended to the next sprint_started (same day) ---
  const startsAsc = [...started].sort((a, b) => a.ts - b.ts);
  let breaks = 0;
  let totalBreakS = 0;
  for (const end of endedToday) {
    const next = startsAsc.find((s) => s.ts > end.ts);
    if (next && startOfLocalDayS(next.ts) === startOfLocalDayS(end.ts)) {
      breaks++;
      totalBreakS += next.ts - end.ts;
    }
  }
  const avgBreakS = breaks > 0 ? totalBreakS / breaks : 0;

  // --- nudges (today) ---
  const nudgesToday = nudgeEvents.filter((n) => isToday(n.ts));
  const nudges = nudgesToday.length;

  // --- nudge adherence: boundary (index 0) nudges paired to their sprint_ended ---
  const endBySprint = new Map<string, SprintEnded>();
  for (const e of ended) endBySprint.set(e.sprint_id, e); // last end for a sprint id wins
  let denom = 0;
  let numer = 0;
  for (const n of nudgesToday) {
    if (n.index !== 0) continue; // only boundary nudges; re-nudges ignored
    const end = endBySprint.get(n.sprint_id);
    if (!end) continue; // sprint never ended → not in the denominator
    denom++;
    if (end.ended_by === "idle_reset" && end.ts >= n.ts && end.ts - n.ts <= adherenceWindowS) {
      numer++;
    }
  }
  const nudgeAdherence = denom > 0 ? numer / denom : 0;

  // --- 7-day active series (local days, DST-safe via the Date constructor) ---
  const now = new Date(nowS * 1000);
  const week: WeekDay[] = [];
  for (let offset = -(WEEK_DAYS - 1); offset <= 0; offset++) {
    const dayStartS = Math.floor(
      new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset).getTime() / 1000,
    );
    const dayEndS = Math.floor(
      new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset + 1).getTime() / 1000,
    );
    let dayActiveS = 0;
    for (const e of ended) {
      if (e.ts >= dayStartS && e.ts < dayEndS) dayActiveS += e.active_s;
    }
    week.push({ date: localDateLabel(dayStartS), activeS: dayActiveS, activeMinutes: dayActiveS / 60 });
  }

  return {
    today: {
      date: localDateLabel(todayStartS),
      activeS,
      sprints,
      longestStretchS,
      breaks,
      totalBreakS,
      avgBreakS,
      nudges,
      nudgeAdherence,
    },
    week,
  };
}
