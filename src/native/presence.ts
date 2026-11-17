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

/** A completed idle stretch the native sampler saw between ticks (epoch ms). */
export interface IdleGap {
  startAt: number;
  lenMs: number;
}

/**
 * Idle seconds now, plus the longest idle stretch that ended since the last call
 * (null when none) — so a break that falls between two sparse ticks still ends
 * the sprint.
 */
export async function idleSample(): Promise<{ idleSeconds: number | null; gap: IdleGap | null }> {
  const v = await invoke<{ idleSeconds: number | null; gap: IdleGap | null }>("idle_sample");
  return {
    idleSeconds: typeof v?.idleSeconds === "number" ? v.idleSeconds : null,
    gap: v?.gap && typeof v.gap.startAt === "number" && typeof v.gap.lenMs === "number" ? v.gap : null,
  };
}

/** Whether a Steam game is running (false when the probe fails). */
export async function gameRunning(): Promise<boolean> {
  try {
    return (await invoke<boolean>("game_running")) === true;
  } catch {
    return false;
  }
}
