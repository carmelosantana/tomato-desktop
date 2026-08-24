// Tomato tray app entry — wires the pure core (TimerMachine, ringVisual,
// toDomainEvents) to Tauri's tray/menu and a 1 Hz timer loop that persists Spec 1
// domain events to the JSONL log. This is the app's first runnable milestone.
//
// The main window stays hidden (see tauri.conf.json `visible: false`); everything
// the user touches is the tray icon and its menu.

import { TrayIcon } from "@tauri-apps/api/tray";
import { Menu } from "@tauri-apps/api/menu";
import { Image } from "@tauri-apps/api/image";

import { TimerMachine } from "./core/timer";
import type { TimerConfig, TimerEvent } from "./core/timer";
import { ringVisual } from "./core/ring";
import { toDomainEvents } from "./core/events";
import type { MapContext } from "./core/events";
import { loadConfig } from "./native/config";
import type { TomatoConfig } from "./native/config";
import { jsonlEventStore } from "./native/eventStore";
import { renderRing, staticIconUrl } from "./native/trayIcon";
import type { Theme } from "./core/tokens";

/** Tray icon canvas size (px). Linux panels commonly render around 22–24px. */
const TRAY_SIZE = 32;

/** A fresh start() after a gap this long (seconds) resets the streak → early grace. */
const COLD_IDLE_THRESHOLD_S = 30 * 60;

const toS = (ms: number): number => Math.floor(ms / 1000);
const systemDark = (): boolean =>
  typeof matchMedia === "function" && matchMedia("(prefers-color-scheme: dark)").matches;
const theme = (): Theme => (systemDark() ? "dark" : "light");

async function main(): Promise<void> {
  const config: TomatoConfig = await loadConfig();
  const timerConfig: TimerConfig = {
    sprintMs: config.sprint_s * 1000,
    breakMs: config.break_s * 1000,
    graceMs: config.grace_s * 1000,
    earlyGraceMs: config.early_grace_s * 1000,
    mode: config.mode,
  };
  const machine = new TimerMachine(timerConfig);

  // Per-lifecycle ids threaded into the event mapper; minted on the boundaries.
  let sprintId = "";
  let breakId: string | undefined;

  // Wall-clock ts (seconds) of the last persisted event, seeded from the log so
  // cold-idle detection survives an app restart.
  let lastEventTs = 0;
  try {
    const existing = await jsonlEventStore.readAllEvents();
    if (existing.length > 0) lastEventTs = existing[existing.length - 1].ts;
  } catch {
    // Missing/unreadable log — treat as no prior activity.
  }

  // Persist a batch of raw timer events: mint ids on lifecycle boundaries, build
  // the map context from the post-action snapshot, then append each domain event.
  async function persist(raw: TimerEvent[]): Promise<void> {
    if (raw.length === 0) return;
    for (const e of raw) {
      if (e.type === "focus-started") sprintId = crypto.randomUUID();
      if (e.type === "break-started") breakId = crypto.randomUUID();
    }
    const snap = machine.snapshot(Date.now());
    const ctx: MapContext = {
      sprintId,
      breakId,
      enforcementMode: config.mode,
      plannedFocusS: config.sprint_s,
      plannedBreakS: config.break_s,
      streakIndex: snap.streakIndex,
      actualGraceS: toS(snap.graceElapsedMs),
      actualBreakS: toS(snap.breakElapsedMs),
      afterS: toS(snap.graceElapsedMs),
      actualFocusS: toS(snap.activeFocusMs),
      overRunS: toS(snap.overRunMs),
    };
    for (const d of toDomainEvents(raw, ctx)) {
      await jsonlEventStore.append(d);
      lastEventTs = d.ts;
    }
  }

  // Draw (or fetch) the icon for the current state and push it to the tray.
  async function refreshIcon(): Promise<void> {
    const snap = machine.snapshot(Date.now());
    const v = ringVisual(snap.state, snap.sprintElapsedMs, timerConfig.sprintMs, snap.state === "grace");

    let image: Image;
    if (snap.state === "idle" || snap.state === "stopped" || snap.state === "break") {
      const state = snap.state === "break" ? "break" : "idle";
      const bytes = await (await fetch(staticIconUrl(state, TRAY_SIZE))).arrayBuffer();
      image = await Image.fromBytes(bytes);
    } else {
      const rgba = renderRing(TRAY_SIZE, v.progress, v.colorRole, theme());
      image = await Image.new(rgba, TRAY_SIZE, TRAY_SIZE);
    }
    await tray.setIcon(image);
  }

  async function onStart(): Promise<void> {
    // Cold-idle reset: a long gap since the last event begins a fresh streak so
    // the next sprint gets early grace (Task 3 carry-forward).
    const nowS = toS(Date.now());
    if (lastEventTs > 0 && nowS - lastEventTs > COLD_IDLE_THRESHOLD_S) {
      machine.resetStreak();
    }
    await persist(machine.start(Date.now()));
    await refreshIcon();
  }

  async function onStop(): Promise<void> {
    await persist(machine.stop(Date.now()));
    await refreshIcon();
  }

  const menu = await Menu.new({
    items: [
      { id: "start", text: "Start", action: () => void onStart() },
      { id: "stop", text: "Stop", action: () => void onStop() },
      { item: "Separator" },
      // Settings UI lands in a later task; stub for now.
      { id: "settings", text: "Settings…", enabled: false, action: () => {} },
      { item: "Separator" },
      { item: "Quit", text: "Quit" },
    ],
  });

  const tray = await TrayIcon.new({
    id: "tomato",
    tooltip: "Tomato",
    menu,
  });

  await refreshIcon();

  // 1 Hz loop: advance the machine, persist whatever it emitted, redraw.
  setInterval(() => {
    void (async () => {
      try {
        await persist(machine.tick(Date.now()));
        await refreshIcon();
      } catch (err) {
        console.error("tomato tick failed", err);
      }
    })();
  }, 1000);
}

void main().catch((err) => console.error("tomato failed to start", err));
