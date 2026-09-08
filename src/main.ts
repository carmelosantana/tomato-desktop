// Tomato v2 "Presence Companion" tray app entry — wires the pure core
// (PresenceMachine, ringVisual, toDomainEvents) to Tauri's tray/menu and a 1 Hz
// loop that reads OS presence (idle seconds) and persists domain events to the
// JSONL log. The companion never blocks or forces a break: past a soft boundary
// it emits a gentle nudge (a quiet OS notification, DND-aware); that's all.
//
// The main window stays hidden (see tauri.conf.json `visible: false`); everything
// the user touches is the tray icon and its menu (plus the Stats / Settings /
// Onboarding webviews it opens). There are no grace/break/boundary windows in v2.

import { TrayIcon } from "@tauri-apps/api/tray";
import { Menu, MenuItem, PredefinedMenuItem } from "@tauri-apps/api/menu";
import { invoke } from "@tauri-apps/api/core";
import { Image } from "@tauri-apps/api/image";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { primaryMonitor } from "@tauri-apps/api/window";
import { listen } from "@tauri-apps/api/event";

import { PresenceMachine } from "./core/presence";
import type { PresenceConfig, PresenceEvent, PresenceState } from "./core/presence";
import { ringVisual } from "./core/ring";
import { toDomainEvents } from "./core/events";
import type { MapContext } from "./core/events";
import { chooseNudgeSurface, decideNudge } from "./core/nudge";
import { loadConfig } from "./native/config";
import type { TomatoConfig } from "./native/config";
import { SETTINGS_SAVED } from "./core/settingsForm";
import { jsonlEventStore } from "./native/eventStore";
import { renderRing, staticIconUrl } from "./native/trayIcon";
import { dndDetector } from "./native/dnd";
import { notify } from "./native/notify";
import { idleSeconds } from "./native/presence";
import type { Theme } from "./core/tokens";

/** Tray icon canvas size (px). Linux panels commonly render around 22–24px. */
const TRAY_SIZE = 32;

/** Presence-companion floor constants (ms), pinned by the plan. */
const ACTIVITY_THRESHOLD_MS = 5000;
const MIN_SPRINT_LOG_MS = 60000;

/** Stats window label — must match capabilities/stats-window.json. */
const STATS_LABEL = "stats";

/** Settings window label — must match capabilities/settings-window.json. */
const SETTINGS_LABEL = "settings";

/** Onboarding window label — must match capabilities/onboarding-window.json. */
const ONBOARDING_LABEL = "onboarding";

/** Hard-nudge overlay window label — must match capabilities/nudge-overlay-window.json. */
const NUDGE_OVERLAY_LABEL = "nudge-overlay";

/** Onboarding window logical size (px), per the design's first-run screen. */
const ONBOARDING_W = 500;
const ONBOARDING_H = 560;

/** Settings window logical size (px), per the design's Settings screen. */
const SETTINGS_W = 560;
const SETTINGS_H = 608;

/** Stats window logical size (px). */
const STATS_W = 720;
const STATS_H = 520;

const systemDark = (): boolean =>
  typeof matchMedia === "function" && matchMedia("(prefers-color-scheme: dark)").matches;
const theme = (): Theme => (systemDark() ? "dark" : "light");

/**
 * Native window background (RGBA, 0–255) matching the current theme's `--bg`
 * token (#f7f3ee / #171310). Set on child windows at creation so the webview
 * paints the themed color on the first frame instead of flashing white before
 * the page's CSS loads.
 */
const windowBg = (): [number, number, number, number] =>
  systemDark() ? [23, 19, 16, 255] : [247, 243, 238, 255];

async function main(): Promise<void> {
  const toPresenceConfig = (c: TomatoConfig): PresenceConfig => ({
    sprintMs: c.sprint_s * 1000,
    idleResetMs: c.idle_reset_s * 1000,
    renudgeEveryMs: c.renudge_every_s * 1000,
    activityThresholdMs: ACTIVITY_THRESHOLD_MS,
    minSprintLogMs: MIN_SPRINT_LOG_MS,
  });

  // `config` + `presenceConfig` are re-read when the settings window saves. A save
  // during an active sprint is deferred (see `pendingConfig`) so durations only
  // ever change between sprints (state away/paused), never mid-sprint.
  let config: TomatoConfig = await loadConfig();
  let presenceConfig: PresenceConfig = toPresenceConfig(config);
  const machine = new PresenceMachine(presenceConfig);

  // A config saved while a sprint is active, held until the machine is between
  // sprints (away/paused).
  let pendingConfig: TomatoConfig | null = null;

  // Per-sprint id threaded into the event mapper; minted on sprint-started.
  let sprintId = "";

  // Whether the OS presence provider is available. Seeded at startup, then kept in
  // sync with the LIVE per-tick idle reading (see the 1 Hz loop), so if a provider
  // flips availability mid-session (e.g. a startup D-Bus race) the tray menu and
  // tooltip follow it. When unavailable we run in MANUAL mode: the user starts/stops
  // sprints from the tray and the loop passes idleMs = null.
  const firstIdle = await idleSeconds();
  let available = firstIdle !== null;

  // Tray menu items, held so they can be enabled/disabled by state.
  let pauseItem: MenuItem | null = null;
  let resumeItem: MenuItem | null = null;
  let startItem: MenuItem | null = null;
  let stopItem: MenuItem | null = null;

  // Persist a batch of raw presence events. Mint a fresh sprint id on each
  // sprint-started, then map through the pure mapper and append every domain
  // event. Sub-floor sprints never reach here — the machine withholds them.
  async function persist(raw: PresenceEvent[]): Promise<void> {
    if (raw.length === 0) return;
    for (const e of raw) {
      if (e.type === "sprint-started") sprintId = crypto.randomUUID();
      // `trigger` rides on the sprint-started event itself; the ctx value is only
      // a fallback the mapper uses when the event carries none (it always does).
      const ctx: MapContext = { sprintId, trigger: "activity" };
      for (const d of toDomainEvents([e], ctx)) {
        await jsonlEventStore.append(d);
      }
    }
  }

  // React to raw presence events. The boundary nudge (index 0) is a quiet,
  // DND-aware desktop notification (soft). Every re-nudge (index >= 1) escalates
  // to the on-screen overlay (hard) — the soft one is easy to miss.
  async function react(raw: PresenceEvent[]): Promise<void> {
    // Coalesce: a single batch may carry catch-up nudges (index 0,1,2…). Fire at
    // most ONE surface for the whole batch and check DND only once, so a burst
    // can never become a storm. The batch's HIGHEST index picks the surface.
    const nudges = raw.filter(
      (e): e is Extract<PresenceEvent, { type: "nudge" }> => e.type === "nudge",
    );
    if (nudges.length === 0) return;
    // DND gates BOTH surfaces: a center overlay during Focus/DND is the rudest
    // possible violation, so it's suppressed exactly like the soft notification.
    if (decideNudge(await dndDetector.current()) !== "notify") return;
    const top = nudges.reduce((a, b) => (b.index > a.index ? b : a));
    if (chooseNudgeSurface("escalating", top.index) === "soft") {
      await notify(
        "Tomato",
        "You've been focused a while — a good moment to step away.",
      );
    } else {
      await openNudgeOverlay(top.activeMs);
    }
  }

  // The static idle tray icon never changes, so decode it once and reuse it —
  // the 1 Hz loop would otherwise re-fetch + re-decode a PNG every away tick.
  let idleIcon: Image | null = null;
  async function staticIdleIcon(): Promise<Image> {
    if (idleIcon) return idleIcon;
    const bytes = await (await fetch(staticIconUrl("idle", TRAY_SIZE))).arrayBuffer();
    idleIcon = await Image.fromBytes(bytes);
    return idleIcon;
  }

  // Draw (or fetch) the icon for the current state and push it to the tray. The
  // ring reflects an ACTIVE sprint; away/paused show the static idle icon.
  async function refreshIcon(): Promise<void> {
    const snap = machine.snapshot(Date.now());
    const v = ringVisual(snap.state, snap.activeMs, presenceConfig.sprintMs);

    let image: Image;
    if (snap.state === "active") {
      const rgba = renderRing(TRAY_SIZE, v.progress, v.colorRole, theme());
      image = await Image.new(rgba, TRAY_SIZE, TRAY_SIZE);
    } else {
      image = await staticIdleIcon();
    }
    await tray.setIcon(image);
  }

  // Reflect the machine's state AND the live presence availability in the tray
  // menu's enabled items (plus the tooltip). Only touches the menu when the state
  // or availability actually changes (not every 1 Hz tick). Start/Stop always
  // exist; they're enabled only in manual mode, so no menu rebuild is ever needed
  // if availability flips.
  let lastMenuState: PresenceState | null = null;
  let lastAvailable: boolean | null = null;
  async function syncMenu(): Promise<void> {
    const s = machine.currentState();
    if (s === lastMenuState && available === lastAvailable) return;
    const availabilityChanged = available !== lastAvailable;
    lastMenuState = s;
    lastAvailable = available;
    // Pause is available while tracking (away/active); Resume only while paused.
    if (pauseItem) await pauseItem.setEnabled(s !== "paused").catch(() => {});
    if (resumeItem) await resumeItem.setEnabled(s === "paused").catch(() => {});
    // Manual Start/Stop only when no presence provider is live: Start needs away,
    // Stop needs an active sprint. When presence is available they stay disabled
    // (presence auto-starts/stops sprints).
    if (startItem) await startItem.setEnabled(!available && s === "away").catch(() => {});
    if (stopItem) await stopItem.setEnabled(!available && s === "active").catch(() => {});
    // Tooltip reflects the live mode; rewrite it only when availability flips.
    if (availabilityChanged) {
      await tray
        .setTooltip(
          available ? "Tomato" : "Tomato — presence detection unavailable (manual mode)",
        )
        .catch(() => {});
    }
  }

  // Single pipeline for every batch of raw events: persist → react → redraw →
  // reflect state in the tray menu → close the overlay if we've left a sprint.
  async function apply(raw: PresenceEvent[]): Promise<void> {
    await persist(raw);
    await react(raw);
    await refreshIcon();
    await syncMenu();
    // The overlay is a live "step away" prompt: once the sprint is no longer
    // active (you stepped away, or paused) it must not linger. Going idle IS the
    // break.
    if (machine.currentState() !== "active") await closeNudgeOverlay();
  }

  /**
   * Apply a pending config swap, but ONLY when the machine is between sprints
   * (away/paused) so an active sprint is never disturbed. The new durations then
   * take effect on the next sprint.
   */
  function applyPendingConfig(): void {
    if (!pendingConfig) return;
    const s = machine.currentState();
    if (s !== "away" && s !== "paused") return;
    config = pendingConfig;
    pendingConfig = null;
    presenceConfig = toPresenceConfig(config);
    machine.setConfig(presenceConfig);
  }

  // Settings saved → re-read config. Applied immediately when between sprints,
  // otherwise deferred so the change lands on the next sprint (see the tick loop,
  // which also retries applyPendingConfig each tick).
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

  // --- Stats window ----------------------------------------------------------

  // The stats window (null when closed). Reused/focused if already open.
  let statsWindow: WebviewWindow | null = null;

  /**
   * Open the stats window, or focus it if it is already open. The window reads
   * the event log itself and computes its view on load. Its ref is cleared when
   * the user closes it, so the next open recreates it fresh.
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
      backgroundColor: windowBg(),
    });
    statsWindow = win;
    win.once("tauri://error", (e) => console.error("stats window failed", e));
    win.once("tauri://destroyed", () => {
      statsWindow = null;
    });
  }

  // --- Hard-nudge overlay -----------------------------------------------------

  // The hard-nudge overlay (null when closed). Opened on a re-nudge (index >= 1),
  // auto-closed when the sprint leaves `active` (see apply), and reopened on the
  // next re-nudge if still active.
  let nudgeOverlayWindow: WebviewWindow | null = null;

  /**
   * Open the hard-nudge overlay (or focus it if already open). Full-screen,
   * transparent, always-on-top, decorationless: a dimmed backdrop with a centered
   * card. It takes focus so Esc/click can dismiss it. `activeMs` fills the
   * "focused for N" copy via a query param.
   */
  async function openNudgeOverlay(activeMs: number): Promise<void> {
    if (nudgeOverlayWindow) {
      await nudgeOverlayWindow.show().catch(() => {});
      await nudgeOverlayWindow.setFocus().catch(() => {});
      return;
    }
    const focusedS = Math.round(activeMs / 1000);
    // The `fullscreen` flag is unreliable for a transparent, decorationless
    // window on GNOME/mutter (it silently falls back to the default 800×600 in a
    // corner). Size the window to the primary monitor at the origin instead so the
    // dim covers the whole screen deterministically. Monitor size is PHYSICAL px;
    // WebviewWindow width/height are LOGICAL, so divide by the scale factor.
    const mon = await primaryMonitor().catch(() => null);
    const scale = mon?.scaleFactor ?? 1;
    const width = mon ? Math.ceil(mon.size.width / scale) : 1920;
    const height = mon ? Math.ceil(mon.size.height / scale) : 1080;
    const win = new WebviewWindow(NUDGE_OVERLAY_LABEL, {
      url: `src/nudge-overlay.html?focused=${focusedS}`,
      x: 0,
      y: 0,
      width,
      height,
      transparent: true,
      alwaysOnTop: true,
      decorations: false,
      skipTaskbar: true,
      resizable: false,
      focus: true,
    });
    nudgeOverlayWindow = win;
    win.once("tauri://error", (e) => {
      console.error("nudge overlay failed", e);
      nudgeOverlayWindow = null;
    });
    win.once("tauri://destroyed", () => {
      nudgeOverlayWindow = null;
    });
  }

  /** Close the overlay if open (idempotent). */
  async function closeNudgeOverlay(): Promise<void> {
    const win = nudgeOverlayWindow;
    if (!win) return;
    nudgeOverlayWindow = null;
    await win.close().catch(() => {});
  }

  // --- Settings window -------------------------------------------------------

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
      backgroundColor: windowBg(),
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
      backgroundColor: windowBg(),
    });
    onboardingWindow = win;
    win.once("tauri://error", (e) => console.error("onboarding window failed", e));
    win.once("tauri://destroyed", () => {
      onboardingWindow = null;
    });
  }

  // --- Tray menu -------------------------------------------------------------

  // Pause/Resume toggle by state. Quit invokes the Rust `quit` command (reliable
  // exit on every platform; the predefined Quit item does not exit on some Linux
  // trays).
  pauseItem = await MenuItem.new({
    id: "pause",
    text: "Pause tracking",
    action: () => void apply(machine.pause(Date.now())),
  });
  resumeItem = await MenuItem.new({
    id: "resume",
    text: "Resume",
    enabled: false,
    action: () => void apply(machine.resume(Date.now())),
  });

  const items: (MenuItem | PredefinedMenuItem)[] = [];

  // Start/Stop always exist (manual mode drives sprints by hand). They're enabled
  // only when no presence provider is live — syncMenu keeps that in sync with the
  // live availability, so a mid-session flip never needs a menu rebuild.
  startItem = await MenuItem.new({
    id: "start",
    text: "Start",
    enabled: !available,
    action: () => void apply(machine.manualStart(Date.now())),
  });
  stopItem = await MenuItem.new({
    id: "stop",
    text: "Stop",
    enabled: false,
    action: () => void apply(machine.manualStop(Date.now())),
  });
  items.push(startItem, stopItem, await PredefinedMenuItem.new({ item: "Separator" }));

  items.push(
    pauseItem,
    resumeItem,
    await PredefinedMenuItem.new({ item: "Separator" }),
    await MenuItem.new({ id: "stats", text: "Stats…", action: () => void openStats() }),
    await MenuItem.new({ id: "settings", text: "Settings…", action: () => void openSettings() }),
    await PredefinedMenuItem.new({ item: "Separator" }),
    await MenuItem.new({ id: "quit", text: "Quit", action: () => void invoke("quit") }),
  );

  const menu = await Menu.new({ items });

  const tray = await TrayIcon.new({
    id: "tomato",
    tooltip: available
      ? "Tomato"
      : "Tomato — presence detection unavailable (manual mode)",
    menu,
    // Show the menu on right-click only, so a left-click can open Stats. (On some
    // Linux panels the tray only ever opens the menu and click events may not
    // fire; the Stats menu item is the always-available fallback.)
    showMenuOnLeftClick: false,
    action: (event) => {
      if (event.type === "Click" && event.button === "Left" && event.buttonState === "Up") {
        void openStats();
      }
    },
  });

  await syncMenu();
  await refreshIcon();

  // First run only: the tray is up either way, but if the user hasn't been
  // through onboarding yet, show it once. Finishing it persists `onboarded: true`
  // and emits SETTINGS_SAVED (handled above), so every subsequent run skips this.
  if (!config.onboarded) {
    await openOnboarding().catch((err) => console.error("onboarding open failed", err));
  }

  // No auto-start: presence auto-starts a sprint on activity. In manual mode the
  // user starts a sprint from the tray.

  // 1 Hz loop: read presence, advance the machine, persist/react/redraw. A
  // re-entrancy guard skips a tick if the previous one's async IO hasn't finished,
  // so slow IO can never overlap runs.
  let ticking = false;
  setInterval(() => {
    if (ticking) return;
    ticking = true;
    void (async () => {
      try {
        // Pick up any deferred config once the machine is between sprints, before
        // the next sprint could begin.
        applyPendingConfig();
        const idle = await idleSeconds();
        const idleMs = idle === null ? null : Math.round(idle * 1000);
        // Track live availability so syncMenu can reshape the menu/tooltip if a
        // provider flips mid-session. Updated before apply() (which runs syncMenu).
        available = idleMs !== null;
        await apply(machine.tick(Date.now(), idleMs));
      } catch (err) {
        console.error("tomato tick failed", err);
      } finally {
        ticking = false;
      }
    })();
  }, 1000);
}

void main().catch((err) => console.error("tomato failed to start", err));
