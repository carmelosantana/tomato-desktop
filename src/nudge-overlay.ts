// Hard-nudge overlay window script — the escalation surface shown on re-nudges
// (nudge index >= 1) when the soft desktop notification is missed.
//
// IMPURE / webview-only: DOM + Tauri window API, so NOT unit-tested. The
// soft/hard decision it serves IS unit-tested in core/nudge.ts (escalateNudge).
//
// It reads how long you've been focused from its own ?focused=<seconds> query
// param. Dismiss via the button or Esc works immediately; clicking anywhere else
// (the dim) is LOCKED for a short rest period so the overlay can't be reflexively
// swiped away the instant it appears, then unlocks (with a hint).
// Dismiss closes the window; main.ts reopens it on the next re-nudge.
import { getCurrentWindow } from "@tauri-apps/api/window";

/** Rest period (ms) before click-anywhere-to-dismiss unlocks. */
const REST_MS = 10000;

const focusedS = Number(new URLSearchParams(location.search).get("focused")) || 0;
const mins = Math.max(1, Math.round(focusedS / 60));
const line = document.getElementById("nudge-line");
if (line) {
  line.textContent = `You've been focused for ${mins} minute${
    mins === 1 ? "" : "s"
  } — take a short break.`;
}

// One-shot: after the lock lifts, a single click reaches both the element's own
// handler and the bubbled document handler — guard so we only close once (a
// second close() on a closing window can reject).
let dismissed = false;
function dismiss(): void {
  if (dismissed) return;
  dismissed = true;
  void getCurrentWindow().close().catch(() => {});
}

// The button and Esc always dismiss.
document.getElementById("dismiss")?.addEventListener("click", dismiss);
window.addEventListener("keydown", (e) => {
  if (e.key === "Escape") dismiss();
});

// After the rest period, unlock click-anywhere-to-dismiss and reveal the hint.
window.setTimeout(() => {
  document.getElementById("hint")?.classList.add("shown");
  document.addEventListener("click", dismiss);
}, REST_MS);
