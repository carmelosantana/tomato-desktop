// Tomato tray app entry — wires the pure core (TimerMachine, ringVisual,
// toDomainEvents) to Tauri's tray/menu and a 1 Hz timer loop that persists Spec 1
// domain events to the JSONL log, and drives the boundary UX (grace toast,
// break card, notifications, DND-aware degrade).
//
// The main window stays hidden (see tauri.conf.json `visible: false`); everything
// the user touches is the tray icon, its menu, and — at a boundary — the grace
// toast / break card webview windows (or an OS notification when appropriate).

import { TrayIcon } from "@tauri-apps/api/tray";
import { Menu } from "@tauri-apps/api/menu";
import { Image } from "@tauri-apps/api/image";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { emit, listen } from "@tauri-apps/api/event";
import { primaryMonitor } from "@tauri-apps/api/window";
import { LogicalPosition } from "@tauri-apps/api/dpi";

import { TimerMachine } from "./core/timer";
import type { TimerConfig, TimerEvent } from "./core/timer";
import { ringVisual } from "./core/ring";
import { toDomainEvents } from "./core/events";
import type { MapContext } from "./core/events";
import { decideNudge } from "./core/nudge";
import {
  GRACE_UPDATE,
  BREAK_UPDATE,
  BREAK_NOW,
  SKIP_BREAK,
} from "./core/boundaryEvents";
import type { GraceUpdate, BreakUpdate } from "./core/boundaryEvents";
import { loadConfig } from "./native/config";
import type { TomatoConfig } from "./native/config";
import { jsonlEventStore } from "./native/eventStore";
import { renderRing, staticIconUrl } from "./native/trayIcon";
import { dndDetector } from "./native/dnd";
import { notify } from "./native/notify";
import type { Theme } from "./core/tokens";

/** Tray icon canvas size (px). Linux panels commonly render around 22–24px. */
const TRAY_SIZE = 32;

/** A fresh start() after a gap this long (seconds) resets the streak → early grace. */
const COLD_IDLE_THRESHOLD_S = 30 * 60;

/** Boundary window labels — must match capabilities/boundary-windows.json. */
const GRACE_TOAST_LABEL = "grace-toast";
const BREAK_CARD_LABEL = "break-card";

/** Boundary window logical sizes (px) + screen-edge margin. */
const TOAST_W = 404;
const TOAST_H = 108;
const CARD_W = 460;
const CARD_H = 400;
const EDGE_MARGIN = 16;

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

  // Open boundary windows (null when closed). Only ever one of each.
  let graceToast: WebviewWindow | null = null;
  let breakCard: WebviewWindow | null = null;

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

  // --- Boundary windows ------------------------------------------------------

  /** Position the grace toast in the screen's bottom-right corner. */
  async function positionToast(win: WebviewWindow): Promise<void> {
    try {
      const mon = await primaryMonitor();
      if (!mon) return;
      const logicalW = mon.size.width / mon.scaleFactor;
      const logicalH = mon.size.height / mon.scaleFactor;
      await win.setPosition(
        new LogicalPosition(
          Math.max(EDGE_MARGIN, logicalW - TOAST_W - EDGE_MARGIN),
          Math.max(EDGE_MARGIN, logicalH - TOAST_H - EDGE_MARGIN - 48),
        ),
      );
    } catch {
      // Monitor lookup unavailable — let the WM place it.
    }
  }

  /** Show the grace toast (enforced grace). Non-focus-stealing. Idempotent. */
  async function showGraceToast(): Promise<void> {
    if (graceToast) return;
    const win = new WebviewWindow(GRACE_TOAST_LABEL, {
      url: "src/grace-toast.html",
      title: "Tomato — wrap up",
      width: TOAST_W,
      height: TOAST_H,
      resizable: false,
      decorations: false,
      alwaysOnTop: true,
      skipTaskbar: true,
      transparent: true,
      shadow: false,
      focus: false,
    });
    graceToast = win;
    win.once("tauri://error", (e) => console.error("grace toast failed", e));
    await positionToast(win);
    await pushBoundaryUpdates();
  }

  /**
   * Present the break at the moment it begins. The grace toast (if any) is closed
   * first, then the presentation is chosen from the live DND state:
   *   - "card"        → show the break card AND focus it,
   *   - "card-quiet"  → show the break card WITHOUT focus/sound (DND unknown),
   *   - "notification"→ suppress the card, send a quiet OS notification (DND on).
   */
  async function presentBreak(): Promise<void> {
    await closeGraceToast();
    const kind = decideNudge(await dndDetector.current());
    if (kind === "notification") {
      await closeBreakCard();
      await notify("Tomato — break", "Time for your break.");
      return;
    }
    const focus = kind === "card";
    await showBreakCard(focus);
  }

  /** Show the centered break card. `focus` follows the decideNudge branch. */
  async function showBreakCard(focus: boolean): Promise<void> {
    if (breakCard) {
      if (focus) await breakCard.setFocus().catch(() => {});
      await pushBoundaryUpdates();
      return;
    }
    const win = new WebviewWindow(BREAK_CARD_LABEL, {
      url: "src/break-card.html",
      title: "Tomato — break",
      width: CARD_W,
      height: CARD_H,
      resizable: false,
      decorations: false,
      alwaysOnTop: true,
      skipTaskbar: true,
      transparent: true,
      shadow: false,
      center: true,
      focus,
    });
    breakCard = win;
    win.once("tauri://error", (e) => console.error("break card failed", e));
    await pushBoundaryUpdates();
  }

  async function closeGraceToast(): Promise<void> {
    const win = graceToast;
    graceToast = null;
    if (win) await win.close().catch(() => {});
  }

  async function closeBreakCard(): Promise<void> {
    const win = breakCard;
    breakCard = null;
    if (win) await win.close().catch(() => {});
  }

  async function closeBoundaryWindows(): Promise<void> {
    await closeGraceToast();
    await closeBreakCard();
  }

  /** Push the current countdown to whichever boundary window is open. */
  async function pushBoundaryUpdates(): Promise<void> {
    const snap = machine.snapshot(Date.now());
    if (graceToast && snap.state === "grace") {
      const remainingMs = Math.max(0, machine.effectiveGraceMs() - snap.graceElapsedMs);
      const payload: GraceUpdate = { remainingMs };
      await emit(GRACE_UPDATE, payload);
    }
    if (breakCard && snap.state === "break") {
      const remainingMs = Math.max(0, timerConfig.breakMs - snap.breakElapsedMs);
      const payload: BreakUpdate = {
        remainingMs,
        totalMs: timerConfig.breakMs,
        inGrace: false,
      };
      await emit(BREAK_UPDATE, payload);
    }
  }

  // React to the timer's raw events: drive the boundary windows/notifications.
  async function react(raw: TimerEvent[]): Promise<void> {
    for (const e of raw) {
      switch (e.type) {
        case "grace-started":
          // Only enforced mode enters grace; show the wrap-up toast.
          await showGraceToast();
          break;
        case "break-started":
          // The break begins now — decide card vs card-quiet vs notification.
          await presentBreak();
          break;
        case "nudge":
          // Soft mode boundary: notify only, never a window, never blocking.
          await notify("Tomato — soft mode", "Sprint's up. Break when it suits you.");
          break;
        case "break-completed":
        case "break-skipped":
        case "stopped":
          await closeBoundaryWindows();
          break;
        default:
          break;
      }
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

  // Single pipeline for every batch of raw events: persist → react → redraw →
  // refresh the open window's countdown.
  async function apply(raw: TimerEvent[]): Promise<void> {
    await persist(raw);
    await react(raw);
    await refreshIcon();
    await pushBoundaryUpdates();
  }

  async function onStart(): Promise<void> {
    // Cold-idle reset: a long gap since the last event begins a fresh streak so
    // the next sprint gets early grace (Task 3 carry-forward).
    const nowS = toS(Date.now());
    if (lastEventTs > 0 && nowS - lastEventTs > COLD_IDLE_THRESHOLD_S) {
      machine.resetStreak();
    }
    await apply(machine.start(Date.now()));
  }

  async function onStop(): Promise<void> {
    await apply(machine.stop(Date.now()));
  }

  // Boundary window buttons → drive the machine, then run the same pipeline.
  await listen(BREAK_NOW, () => {
    void apply(machine.breakNow(Date.now())).catch((err) =>
      console.error("break-now failed", err),
    );
  });
  await listen(SKIP_BREAK, () => {
    void apply(machine.skipBreak(Date.now())).catch((err) =>
      console.error("skip-break failed", err),
    );
  });

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

  // 1 Hz loop: advance the machine, persist whatever it emitted, react, redraw.
  setInterval(() => {
    void (async () => {
      try {
        await apply(machine.tick(Date.now()));
      } catch (err) {
        console.error("tomato tick failed", err);
      }
    })();
  }, 1000);
}

void main().catch((err) => console.error("tomato failed to start", err));
