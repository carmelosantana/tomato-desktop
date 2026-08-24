// Stats window script — the adherence "test instrument". On open it reads the
// whole event log, folds it with the pure `aggregate` (Task 7), and renders
// today's numbers plus three hand-rolled inline-SVG/flex charts.
//
// IMPURE / webview-only: uses Tauri's fs (via jsonlEventStore) + the DOM + the
// real clock. Not unit-tested; the pure pieces it leans on (aggregate,
// donutSegments/scaleBars/timelineWindow/timelineSegments, formatMMSS) ARE
// unit-tested in core. As a UI entry point, using the local clock here is fine.

import { aggregate } from "./core/stats";
import type { DayStats } from "./core/stats";
import type { DomainEvent } from "./core/events";
import { jsonlEventStore } from "./native/eventStore";
import { formatMMSS } from "./core/format";
import {
  donutSegments,
  scaleBars,
  timelineWindow,
  timelineSegments,
} from "./core/statsChart";
import { applyTheme, resolveTheme } from "./core/theme";

const SVGNS = "http://www.w3.org/2000/svg";
const DAY_LETTERS = ["S", "M", "T", "W", "T", "F", "S"];

/** Start of the local day, as UNIX seconds — the day boundary for aggregate. */
function localTodayStartS(now = new Date()): number {
  const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.floor(midnight.getTime() / 1000);
}

const $ = (id: string): HTMLElement => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`missing #${id}`);
  return el;
};

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
function renderTiles(today: DayStats, streak: number): void {
  $("sprints").textContent = String(today.sprints);

  $("breaks").innerHTML = `<span class="taken">${today.breaksTaken}</span><span class="sub"> / ${today.breaksSkipped} skip</span>`;

  const overTile = $("overrun").closest(".tile");
  const overS = today.overRunS;
  $("overrun").innerHTML =
    overS > 0
      ? `+${formatMMSS(overS * 1000)} <span class="glyph">▲</span>`
      : `0:00`;
  overTile?.classList.toggle("zero", overS <= 0);

  $("streak").textContent = String(streak);
}

// --- day timeline ----------------------------------------------------------
function renderTimeline(today: DayStats, todayStartS: number, nowS: number): void {
  const strip = $("timeline");
  const axis = $("timeline-axis");
  strip.replaceChildren();
  axis.replaceChildren();

  if (today.timeline.length === 0) {
    const empty = document.createElement("div");
    empty.className = "timeline-empty";
    empty.textContent = "No sprints yet today";
    strip.appendChild(empty);
    return;
  }

  const win = timelineWindow(today.timeline, todayStartS, nowS);
  for (const seg of timelineSegments(today.timeline, win.startS, win.endS)) {
    const el = document.createElement("div");
    el.className = `seg ${seg.kind}`;
    el.style.left = `${seg.leftPct}%`;
    el.style.width = `${seg.widthPct}%`;
    strip.appendChild(el);
  }

  // Axis: ~5 evenly spaced hour ticks across the window, labeled 9a / 1p style.
  const ticks = 5;
  for (let i = 0; i < ticks; i++) {
    const t = win.startS + ((win.endS - win.startS) * i) / (ticks - 1);
    const span = document.createElement("span");
    span.textContent = hourLabel(new Date(t * 1000));
    axis.appendChild(span);
  }
}

function hourLabel(d: Date): string {
  let h = d.getHours();
  const suffix = h >= 12 ? "p" : "a";
  h = h % 12;
  if (h === 0) h = 12;
  return `${h}${suffix}`;
}

// --- donut (breaks taken vs skipped) ---------------------------------------
function renderDonut(today: DayStats): void {
  $("legend-taken").textContent = String(today.breaksTaken);
  $("legend-skipped").textContent = String(today.breaksSkipped);

  const R = 46;
  const size = 88;
  const svg = document.createElementNS(SVGNS, "svg");
  svg.setAttribute("width", String(size));
  svg.setAttribute("height", String(size));
  svg.setAttribute("viewBox", "0 0 120 120");

  const { circumference, segments } = donutSegments(
    [today.breaksTaken, today.breaksSkipped],
    R,
  );
  // taken → --break, skipped → --chart-5 (paired with ✕ label for CVD safety).
  const colors = ["var(--break)", "var(--chart-5)"];

  if (segments.length === 0) {
    // Empty state: a single neutral track ring.
    svg.appendChild(ring(R, "var(--border)", `${circumference} 0`, 0));
  } else {
    for (const seg of segments) {
      svg.appendChild(
        ring(R, colors[seg.index], `${seg.length} ${seg.gap}`, seg.offset),
      );
    }
  }
  $("donut").replaceChildren(svg);
}

function ring(r: number, stroke: string, dashArray: string, dashOffset: number): SVGElement {
  const c = document.createElementNS(SVGNS, "circle");
  c.setAttribute("cx", "60");
  c.setAttribute("cy", "60");
  c.setAttribute("r", String(r));
  c.setAttribute("fill", "none");
  c.setAttribute("stroke", stroke);
  c.setAttribute("stroke-width", "16");
  c.setAttribute("stroke-dasharray", dashArray);
  c.setAttribute("stroke-dashoffset", String(dashOffset));
  c.setAttribute("transform", "rotate(-90 60 60)");
  return c;
}

// --- 7-day sprints-per-day bars --------------------------------------------
function renderBars(week: Array<{ date: string; sprints: number }>, now: Date): void {
  const host = $("bars");
  host.replaceChildren();
  const values = week.map((w) => w.sprints);
  const heights = scaleBars(values, 54);

  week.forEach((_day, i) => {
    const isToday = i === week.length - 1;
    // Day letter from the LOCAL weekday of this bucket (offset back from today),
    // rather than aggregate's UTC date label — robust in any timezone.
    const offset = i - (week.length - 1);
    const dow = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate() + offset,
    ).getDay();

    const col = document.createElement("div");
    col.className = "bar-col";

    const count = document.createElement("div");
    count.className = "bar-count";
    count.textContent = values[i] > 0 ? String(values[i]) : "";
    col.appendChild(count);

    const track = document.createElement("div");
    track.className = "bar-track";
    const bar = document.createElement("div");
    if (values[i] <= 0) {
      bar.className = "bar empty";
    } else {
      bar.className = isToday ? "bar today" : "bar";
      bar.style.height = `${heights[i]}px`;
    }
    track.appendChild(bar);
    col.appendChild(track);

    const label = document.createElement("span");
    label.className = isToday ? "bar-label today" : "bar-label";
    label.textContent = DAY_LETTERS[dow];
    col.appendChild(label);

    host.appendChild(col);
  });
}

// --- entry -----------------------------------------------------------------
async function render(): Promise<void> {
  syncTheme();
  const now = new Date();
  renderDate(now);

  const todayStartS = localTodayStartS(now);
  const nowS = Math.floor(now.getTime() / 1000);

  let events: DomainEvent[];
  try {
    events = await jsonlEventStore.readAllEvents();
  } catch (err) {
    console.error("stats: failed to read events", err);
    events = [];
  }

  const { today, streak, week } = aggregate(events, { todayStartS, nowS });
  renderTiles(today, streak.current);
  renderTimeline(today, todayStartS, nowS);
  renderDonut(today);
  renderBars(week, now);
}

if (typeof matchMedia === "function") {
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", syncTheme);
}

void render().catch((err) => console.error("stats failed to render", err));
