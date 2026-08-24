// Break card window script — large mono break countdown with Skip and, only
// while still in grace, Break now.
//
// IMPURE / webview-only: uses Tauri's event bus + the DOM. Not unit-tested; the
// pure countdown formatting (formatMMSS) IS unit-tested in core.
//
// Copy is intentionally NEUTRAL. The card listens for BREAK_UPDATE ticks and
// emits SKIP_BREAK / BREAK_NOW back to the main loop. Break now stays hidden
// unless an update reports the machine is still in grace (inGrace), per spec.

import { emit, listen } from "@tauri-apps/api/event";
import { formatMMSS } from "./core/format";
import { BREAK_UPDATE, SKIP_BREAK, BREAK_NOW } from "./core/boundaryEvents";
import type { BreakUpdate } from "./core/boundaryEvents";

// Progress-ring circumference for r=52 (matches the SVG below): 2·π·52.
const ARC_CIRCUMFERENCE = 2 * Math.PI * 52;

const timeEl = document.getElementById("break-time");
const totalEl = document.getElementById("break-total");
const arcEl = document.getElementById("arc");
const skipEl = document.getElementById("skip");
const breakNowEl = document.getElementById("break-now") as HTMLButtonElement | null;

void listen<BreakUpdate>(BREAK_UPDATE, (e) => {
  const { remainingMs, totalMs, inGrace } = e.payload;
  if (timeEl) timeEl.textContent = formatMMSS(remainingMs);
  if (totalEl) totalEl.textContent = formatMMSS(totalMs);
  if (arcEl && totalMs > 0) {
    const fraction = Math.max(0, Math.min(1, remainingMs / totalMs));
    arcEl.setAttribute("stroke-dasharray", String(ARC_CIRCUMFERENCE));
    arcEl.setAttribute("stroke-dashoffset", String(ARC_CIRCUMFERENCE * (1 - fraction)));
  }
  if (breakNowEl) breakNowEl.hidden = !inGrace;
});

skipEl?.addEventListener("click", () => {
  void emit(SKIP_BREAK);
});

breakNowEl?.addEventListener("click", () => {
  void emit(BREAK_NOW);
});
