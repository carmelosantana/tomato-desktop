// Stats window script — the v2 "presence" summary. On open it reads the whole
// event log and folds it with the pure `computeStats` (Task 5), rendering
// today's presence metrics plus a hand-rolled 7-day active-minutes bar chart.
//
// IMPURE / webview-only: uses Tauri's fs (via jsonlEventStore) + the DOM + the
// real clock. Not unit-tested; the pure pieces it leans on (computeStats,
// weekBars/scaleBars) ARE unit-tested in core. As a UI entry point, using the
// local clock here is fine.

import { computeStats } from "./core/stats";
import type { DayStats, WeekDay } from "./core/stats";
import type { DomainEvent } from "./core/events";
import { jsonlEventStore } from "./native/eventStore";
import { weekBars } from "./core/statsChart";
import { applyTheme, resolveTheme } from "./core/theme";

const $ = (id: string): HTMLElement => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`missing #${id}`);
  return el;
};

/** Format a non-negative seconds duration as compact h/m (e.g. "1h 23m", "9m",
 *  "0m"). Sub-minute durations round down to whole minutes. */
function formatHM(totalS: number): string {
  const s = Math.max(0, Math.floor(totalS));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h > 0) return m > 0 ? `${h}h ${m}m` : `${h}h`;
  return `${m}m`;
}

// --- theme (light/dark via tokens) -----------------------------------------
function syncTheme(): void {
  const dark =
    typeof matchMedia === "function" && matchMedia("(prefers-color-scheme: dark)").matches;
  applyTheme(document, resolveTheme("system", dark));
}

// --- header ----------------------------------------------------------------
function renderDate(now: Date): void {
  $("date").textContent = now.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

// --- stat tiles ------------------------------------------------------------
function renderTiles(today: DayStats): void {
  // Active time today.
  $("active").textContent = formatHM(today.activeS);

  // Sprints completed today.
  $("sprints").textContent = String(today.sprints);

  // Longest single stretch today.
  $("longest").textContent = formatHM(today.longestStretchS);

  // Breaks taken + average length.
  const avg = today.breaks > 0 ? `avg ${formatHM(today.avgBreakS)}` : "no breaks";
  $("breaks").innerHTML = `${today.breaks}<span class="sub"> ${avg}</span>`;

  // Nudge adherence as a %. With no nudges today there is no meaningful ratio,
  // so show an em dash rather than a misleading 0%.
  $("adherence").textContent =
    today.nudges > 0 ? `${Math.round(today.nudgeAdherence * 100)}%` : "—";
}

// --- 7-day active-minutes bars ---------------------------------------------
function renderBars(week: WeekDay[]): void {
  const host = $("bars");
  host.replaceChildren();
  const bars = weekBars(week, 54);

  bars.forEach((bar, i) => {
    const isToday = i === bars.length - 1;
    const minutes = Math.round(bar.activeMinutes);

    const col = document.createElement("div");
    col.className = "bar-col";

    const count = document.createElement("div");
    count.className = "bar-count";
    count.textContent = minutes > 0 ? String(minutes) : "";
    col.appendChild(count);

    const track = document.createElement("div");
    track.className = "bar-track";
    const el = document.createElement("div");
    if (bar.activeMinutes <= 0) {
      el.className = "bar empty";
    } else {
      el.className = isToday ? "bar today" : "bar";
      el.style.height = `${bar.heightPx}px`;
    }
    track.appendChild(el);
    col.appendChild(track);

    const label = document.createElement("span");
    label.className = isToday ? "bar-label today" : "bar-label";
    label.textContent = bar.label;
    col.appendChild(label);

    host.appendChild(col);
  });
}

// --- entry -----------------------------------------------------------------
async function render(): Promise<void> {
  syncTheme();
  const now = new Date();
  renderDate(now);

  const nowS = Math.floor(now.getTime() / 1000);

  let events: DomainEvent[];
  try {
    events = await jsonlEventStore.readAllEvents();
  } catch (err) {
    console.error("stats: failed to read events", err);
    events = [];
  }

  const { today, week } = computeStats(events, nowS);

  // Empty state: nothing recorded yet.
  const isEmpty = events.length === 0;
  $("empty").hidden = !isEmpty;
  $("content").hidden = isEmpty;
  if (isEmpty) return;

  renderTiles(today);
  renderBars(week);
}

if (typeof matchMedia === "function") {
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", syncTheme);
}

void render().catch((err) => console.error("stats failed to render", err));
