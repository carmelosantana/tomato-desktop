// Tomato tray app entry — wires the pure core (TimerMachine, ringVisual,
// toDomainEvents) to Tauri's tray/menu and a 1 Hz timer loop that persists Spec 1
// domain events to the JSONL log, and drives the boundary UX (grace toast,
// break card, notifications, DND-aware degrade).
//
// The main window stays hidden (see tauri.conf.json `visible: false`); everything
// the user touches is the tray icon, its menu, and — at a boundary — the grace
// toast / break card webview windows (or an OS notification when appropriate).

import { TrayIcon } from "@tauri-apps/api/tray";
import { Menu, MenuItem, PredefinedMenuItem } from "@tauri-apps/api/menu";
import { invoke } from "@tauri-apps/api/core";
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
import { SETTINGS_SAVED } from "./core/settingsForm";
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

/** Stats window label — must match capabilities/stats-window.json. */
const STATS_LABEL = "stats";

/** Settings window label — must match capabilities/settings-window.json. */
const SETTINGS_LABEL = "settings";

/** Onboarding window label — must match capabilities/onboarding-window.json. */
const ONBOARDING_LABEL = "onboarding";

/** Onboarding window logical size (px), per the design's first-run screen. */
const ONBOARDING_W = 500;
const ONBOARDING_H = 560;

/** Settings window logical size (px), per the design's Settings screen. */
const SETTINGS_W = 560;
const SETTINGS_H = 480;

/** Stats window logical size (px). */
const STATS_W = 720;
const STATS_H = 520;

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
  const toTimerConfig = (c: TomatoConfig): TimerConfig => ({
    sprintMs: c.sprint_s * 1000,
    breakMs: c.break_s * 1000,
    graceMs: c.grace_s * 1000,
    earlyGraceMs: c.early_grace_s * 1000,
    mode: c.mode,
  });

  // `config` + `timerConfig` are re-read when the settings window saves. A save
  // during an in-progress sprint is deferred (see `pendingConfig`) so durations
  // and mode only ever change on the NEXT sprint, never mid-sprint.
  let config: TomatoConfig = await loadConfig();
  let timerConfig: TimerConfig = toTimerConfig(config);
  const machine = new TimerMachine(timerConfig);

  // A config saved while a sprint is running, held until the machine is idle.
  let pendingConfig: TomatoConfig | null = null;

  // Per-lifecycle ids threaded into the event mapper; minted on the boundaries.
  let sprintId = "";
  let breakId: string | undefined;

  // Open boundary windows (null when closed). Only ever one of each.
  let graceToast: WebviewWindow | null = null;
  let breakCard: WebviewWindow | null = null;

  // Tray Start/Stop items, held so they can be enabled/disabled by state.
  let startItem: MenuItem | null = null;
  let stopItem: MenuItem | null = null;

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

  // --- Stats window ----------------------------------------------------------

  // The stats window (null when closed). Reused/focused if already open.
  let statsWindow: WebviewWindow | null = null;

  /**
   * Open the stats window, or focus it if it is already open. The window reads
   * the event log itself and computes the adherence view on load. Its ref is
   * cleared when the user closes it, so the next open recreates it fresh.
   */
  async function openStats(): Promise<void> {
    if (statsWindow) {
      await statsWindow.show().catch(() => {});
      await statsWindow.setFocus().catch(() => {});
      return;
    }
    const win = new WebviewWindow(STATS_LABEL, {
      url: "src/stats.html",
      title: "Tomato — stats",
      width: STATS_W,
      height: STATS_H,
      resizable: true,
      center: true,
      focus: true,
    });
    statsWindow = win;
    win.once("tauri://error", (e) => console.error("stats window failed", e));
    win.once("tauri://destroyed", () => {
      statsWindow = null;
    });
  }

  // --- Settings window + live config reload ----------------------------------

  // The settings window (null when closed). Reused/focused if already open.
  let settingsWindow: WebviewWindow | null = null;

  /** Open the settings window, or focus it if it is already open. */
  async function openSettings(): Promise<void> {
    if (settingsWindow) {
      await settingsWindow.show().catch(() => {});
      await settingsWindow.setFocus().catch(() => {});
      return;
    }
    const win = new WebviewWindow(SETTINGS_LABEL, {
      url: "src/settings.html",
      title: "Tomato — settings",
      width: SETTINGS_W,
      height: SETTINGS_H,
      resizable: false,
      center: true,
      focus: true,
    });
    settingsWindow = win;
    win.once("tauri://error", (e) => console.error("settings window failed", e));
    win.once("tauri://destroyed", () => {
      settingsWindow = null;
    });
  }

  // --- First-run onboarding --------------------------------------------------

  // The onboarding window (null when closed). Reused/focused if already open.
  let onboardingWindow: WebviewWindow | null = null;

  /**
   * Open the first-run onboarding window, or focus it if already open. The window
   * persists `onboarded: true` (+ any durations the user set) and emits
   * SETTINGS_SAVED on finish, which main already handles by reloading config.
   */
  async function openOnboarding(): Promise<void> {
    if (onboardingWindow) {
      await onboardingWindow.show().catch(() => {});
      await onboardingWindow.setFocus().catch(() => {});
      return;
    }
    const win = new WebviewWindow(ONBOARDING_LABEL, {
      url: "src/onboarding.html",
      title: "Tomato — welcome",
      width: ONBOARDING_W,
      height: ONBOARDING_H,
      resizable: false,
      center: true,
      focus: true,
    });
    onboardingWindow = win;
    win.once("tauri://error", (e) => console.error("onboarding window failed", e));
    win.once("tauri://destroyed", () => {
      onboardingWindow = null;
    });
  }

  /**
   * Apply a pending config swap, but ONLY when the machine is between sprints
   * (idle/stopped) so an in-progress sprint is never disturbed. The new
   * durations + mode then take effect on the next start(). Streak is preserved.
   */
  function applyPendingConfig(): void {
    if (!pendingConfig) return;
    const state = machine.currentState();
    if (state !== "idle" && state !== "stopped") return;
    config = pendingConfig;
    pendingConfig = null;
    timerConfig = toTimerConfig(config);
    machine.setConfig(timerConfig);
  }

  // Settings saved → re-read config. Applied immediately if idle, otherwise
  // deferred so the change lands on the next sprint without interrupting this one.
  await listen(SETTINGS_SAVED, () => {
    void (async () => {
      try {
        pendingConfig = await loadConfig();
        applyPendingConfig();
      } catch (err) {
        console.error("settings reload failed", err);
      }
    })();
  });

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

  // The static idle/break tray icons never change, so decode each once and reuse
  // it — the 1 Hz loop would otherwise re-fetch + re-decode a PNG every tick.
  const staticIconCache = new Map<string, Image>();
  async function staticTrayIcon(state: "idle" | "break"): Promise<Image> {
    const key = `${state}:${TRAY_SIZE}`;
    const cached = staticIconCache.get(key);
    if (cached) return cached;
    const bytes = await (await fetch(staticIconUrl(state, TRAY_SIZE))).arrayBuffer();
    const image = await Image.fromBytes(bytes);
    staticIconCache.set(key, image);
    return image;
  }

  // Draw (or fetch) the icon for the current state and push it to the tray.
  async function refreshIcon(): Promise<void> {
    const snap = machine.snapshot(Date.now());
    const v = ringVisual(snap.state, snap.sprintElapsedMs, timerConfig.sprintMs, snap.state === "grace");

    let image: Image;
    if (snap.state === "idle" || snap.state === "stopped" || snap.state === "break") {
      image = await staticTrayIcon(snap.state === "break" ? "break" : "idle");
    } else {
      const rgba = renderRing(TRAY_SIZE, v.progress, v.colorRole, theme());
      image = await Image.new(rgba, TRAY_SIZE, TRAY_SIZE);
    }
    await tray.setIcon(image);
  }

  // Enable Start only when between sprints (idle/stopped) and Stop only when a
  // sprint is running — clearer than two always-active items. Only touches the
  // menu when the running/idle distinction actually flips (not every 1 Hz tick).
  let menuRunning: boolean | null = null;
  async function syncMenu(): Promise<void> {
    if (!startItem || !stopItem) return;
    const s = machine.currentState();
    const running = s === "focus" || s === "grace" || s === "break";
    if (running === menuRunning) return;
    menuRunning = running;
    await startItem.setEnabled(!running).catch(() => {});
    await stopItem.setEnabled(running).catch(() => {});
  }

  // Single pipeline for every batch of raw events: persist → react → redraw →
  // refresh the open window's countdown → reflect state in the tray menu.
  async function apply(raw: TimerEvent[]): Promise<void> {
    await persist(raw);
    await react(raw);
    await refreshIcon();
    await pushBoundaryUpdates();
    await syncMenu();
  }

  async function onStart(): Promise<void> {
    // Pick up any config saved during the previous sprint before this one begins.
    applyPendingConfig();
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

  // Build items as instances so Start/Stop can be toggled by state. Quit invokes
  // the Rust `quit` command (reliable exit on every platform; the predefined
  // Quit item does not exit on some Linux trays).
  startItem = await MenuItem.new({ id: "start", text: "Start", action: () => void onStart() });
  stopItem = await MenuItem.new({ id: "stop", text: "Stop", enabled: false, action: () => void onStop() });
  const menu = await Menu.new({
    items: [
      startItem,
      stopItem,
      await PredefinedMenuItem.new({ item: "Separator" }),
      await MenuItem.new({ id: "stats", text: "Stats…", action: () => void openStats() }),
      await MenuItem.new({ id: "settings", text: "Settings…", action: () => void openSettings() }),
      await PredefinedMenuItem.new({ item: "Separator" }),
      await MenuItem.new({ id: "quit", text: "Quit", action: () => void invoke("quit") }),
    ],
  });
  await syncMenu();

  const tray = await TrayIcon.new({
    id: "tomato",
    tooltip: "Tomato",
    menu,
    // Show the menu on right-click only, so a left-click can open Stats. (On
    // some Linux panels the tray only ever opens the menu and click events may
    // not fire; the Stats menu item is the always-available fallback.)
    showMenuOnLeftClick: false,
    action: (event) => {
      if (event.type === "Click" && event.button === "Left" && event.buttonState === "Up") {
        void openStats();
      }
    },
  });

  await refreshIcon();

  // First run only: the tray is up either way, but if the user hasn't been
  // through onboarding yet, show it once. Finishing it persists `onboarded: true`
  // and emits SETTINGS_SAVED (handled above), so every subsequent run skips this.
  if (!config.onboarded) {
    await openOnboarding().catch((err) => console.error("onboarding open failed", err));
  }

  // 1 Hz loop: advance the machine, persist whatever it emitted, react, redraw.
  // A re-entrancy guard skips a tick if the previous one's async IO (persist /
  // window / icon work) hasn't finished, so slow IO can never overlap runs.
  let ticking = false;
  setInterval(() => {
    if (ticking) return;
    ticking = true;
    void (async () => {
      try {
        await apply(machine.tick(Date.now()));
      } catch (err) {
        console.error("tomato tick failed", err);
      } finally {
        ticking = false;
      }
    })();
  }, 1000);
}

void main().catch((err) => console.error("tomato failed to start", err));
