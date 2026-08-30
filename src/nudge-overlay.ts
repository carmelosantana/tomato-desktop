// Hard-nudge overlay window script — the escalation surface shown on re-nudges
// (nudge index >= 1) when the soft desktop notification is missed.
//
// IMPURE / webview-only: DOM + Tauri window API, so NOT unit-tested. The
// soft/hard decision it serves IS unit-tested in core/nudge.ts (escalateNudge).
//
// It reads how long you've been focused from its own ?focused=<seconds> query
// param and offers a single action: Dismiss (button, Esc, or clicking the dim).
// Dismiss closes the window; main.ts reopens it on the next re-nudge.
import { getCurrentWindow } from "@tauri-apps/api/window";

const focusedS = Number(new URLSearchParams(location.search).get("focused")) || 0;
const mins = Math.max(1, Math.round(focusedS / 60));
const line = document.getElementById("nudge-line");
if (line) {
  line.textContent = `You've been focused for ${mins} minute${
    mins === 1 ? "" : "s"
  } — take a short break.`;
}

function dismiss(): void {
  void getCurrentWindow().close();
}

document.getElementById("dismiss")?.addEventListener("click", dismiss);
// Clicking the dim backdrop (but not the card) dismisses.
document.getElementById("backdrop")?.addEventListener("click", (e) => {
  if (e.target === e.currentTarget) dismiss();
});
window.addEventListener("keydown", (e) => {
  if (e.key === "Escape") dismiss();
});
