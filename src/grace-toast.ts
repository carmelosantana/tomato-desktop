// Grace toast window script — shows the grace countdown and a Break now button.
//
// IMPURE / webview-only: uses Tauri's event bus + the DOM. Not unit-tested; the
// pure countdown formatting it leans on (formatMMSS) IS unit-tested in core.
//
// It listens for GRACE_UPDATE ticks from the main loop and, on the button,
// emits BREAK_NOW back to main (which drives timer.breakNow). This window is
// non-focus-stealing (focus:false in the shell); it only reflects state.

import { emit, listen } from "@tauri-apps/api/event";
import { formatMMSS } from "./core/format";
import { GRACE_UPDATE, BREAK_NOW } from "./core/boundaryEvents";
import type { GraceUpdate } from "./core/boundaryEvents";

const timeEl = document.getElementById("grace-time");
const buttonEl = document.getElementById("break-now");

void listen<GraceUpdate>(GRACE_UPDATE, (e) => {
  if (timeEl) timeEl.textContent = formatMMSS(e.payload.remainingMs);
});

buttonEl?.addEventListener("click", () => {
  void emit(BREAK_NOW);
});
