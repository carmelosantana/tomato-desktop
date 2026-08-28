// Native idle/presence probe — a thin wrapper over the Rust `idle_seconds` command.
//
// IMPURE / webview-only: invokes the Rust `idle_seconds` command, so it is NOT
// unit-tested (the Tauri runtime is unavailable under node/vitest). Verify via
// `tsc`; exercise the real behavior manually in-app.
//
// The Rust side returns Option<f64> — seconds since the last input event, or
// None when no idle provider is available on this platform. None arrives here as
// JS `null`, which the caller reads as "no presence signal" and falls back to
// manual mode rather than guessing.

import { invoke } from "@tauri-apps/api/core";

/** Seconds since last input, or null when no provider is available (→ manual mode). */
export async function idleSeconds(): Promise<number | null> {
  const v = await invoke<number | null>("idle_seconds");
  return typeof v === "number" ? v : null;
}
