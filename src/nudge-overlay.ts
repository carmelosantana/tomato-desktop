// Hard-nudge overlay window script — the escalation surface shown on re-nudges
// (nudge index >= 1) when the soft desktop notification is missed.
//
// IMPURE / webview-only: DOM + Tauri window API, so NOT unit-tested. The
// soft/hard decision it serves IS unit-tested in core/nudge.ts (escalateNudge).
//
// It reads how long you've been focused from its own ?focused=<seconds> query
// param. EVERY dismissal path — the Dismiss button, Esc, and click-anywhere — is
// LOCKED for the rest period (REST_MS), with a countdown on the button, so the
// overlay cannot be cleared until you have actually paused. The lock then lifts
// and any of the three dismisses. Dismiss closes the window; main.ts reopens it
// on the next qualifying nudge.
import { emit } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";

import { dismissLockLabel, NUDGE_RESET } from "./core/nudge";

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

// Label the button from the constant so markup and code cannot drift.
const dismissBtn = document.getElementById("dismiss") as HTMLButtonElement | null;
if (dismissBtn) dismissBtn.textContent = dismissLockLabel(REST_MS);

// One-shot: after the lock lifts, a single click reaches both the element's own
// handler and the bubbled document handler — guard so we only close once (a
// second close() on a closing window can reject).
let dismissed = false;
// The lock holds EVERY dismissal path — button, Esc and backdrop click — for the
// full rest period. A lock that leaves the button live delays nobody.
let locked = true;

function dismiss(): void {
  if (locked || dismissed) return;
  dismissed = true;
  void getCurrentWindow().close().catch(() => {});
}

dismissBtn?.addEventListener("click", dismiss);

// "Dismiss & reset timer": tell main to end the sprint (it closes this window
// as the sprint leaves `active`), and close ourselves too in case it doesn't.
const resetBtn = document.getElementById("reset") as HTMLButtonElement | null;
resetBtn?.addEventListener("click", (e) => {
  e.stopPropagation(); // not also a backdrop click
  if (locked || dismissed) return;
  void emit(NUDGE_RESET).finally(dismiss);
});
window.addEventListener("keydown", (e) => {
  if (e.key === "Escape") dismiss();
});

// Tick the button's countdown once a second while the lock holds.
const lockStartedAt = Date.now();
const ticker = window.setInterval(() => {
  const remaining = REST_MS - (Date.now() - lockStartedAt);
  if (dismissBtn) dismissBtn.textContent = dismissLockLabel(remaining);
}, 1000);

// Lock lifts: enable the button, allow Esc, reveal the hint, and attach
// click-anywhere-to-dismiss.
window.setTimeout(() => {
  window.clearInterval(ticker);
  locked = false;
  if (dismissBtn) {
    dismissBtn.disabled = false;
    dismissBtn.textContent = dismissLockLabel(0);
  }
  if (resetBtn) resetBtn.disabled = false;
  document.getElementById("hint")?.classList.add("shown");
  document.addEventListener("click", dismiss);
}, REST_MS);
