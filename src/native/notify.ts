// Native OS notifications — a thin wrapper over @tauri-apps/plugin-notification.
//
// IMPURE / webview-only: talks to the notification plugin, so it is NOT
// unit-tested (the Tauri runtime is unavailable under node/vitest). Verify
// manually in-app.
//
// Used by the v2 presence companion's single side effect: the gentle nudge. Once
// a sprint clears the soft boundary the machine emits a nudge, and (when DND
// allows, per decideNudge) we send one quiet OS notification suggesting a break.
// There is no window, no break card, and nothing is ever blocked or forced.

import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from "@tauri-apps/plugin-notification";

/** Ensure notification permission, requesting it once if not yet granted. */
async function ensurePermission(): Promise<boolean> {
  try {
    if (await isPermissionGranted()) return true;
    return (await requestPermission()) === "granted";
  } catch {
    return false;
  }
}

/**
 * Send an OS notification. Best-effort and non-blocking: if permission is
 * denied or the plugin throws, it logs and returns without disrupting the loop.
 */
export async function notify(title: string, body: string): Promise<void> {
  try {
    if (!(await ensurePermission())) return;
    sendNotification({ title, body });
  } catch (err) {
    console.error("tomato notification failed", err);
  }
}
