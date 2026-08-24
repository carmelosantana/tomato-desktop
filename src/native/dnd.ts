// Native DND detector — the file-backed DndDetector implementation.
//
// IMPURE / webview-only: invokes the Rust `dnd_state` command, so it is NOT
// unit-tested (the Tauri runtime is unavailable under node/vitest). The pure
// decision it feeds — decideNudge(dnd) — IS unit-tested in src/core/nudge.ts.
//
// The Rust side reads GNOME's `show-banners` setting and returns one of
// "active" | "inactive" | "unknown". Anything unexpected (including an invoke
// failure or a non-GNOME desktop) maps to "unknown" so the boundary UX degrades
// to the quiet path rather than guessing.

import { invoke } from "@tauri-apps/api/core";
import type { DndDetector, DndState } from "../core/nudge";

function normalize(raw: unknown): DndState {
  return raw === "active" || raw === "inactive" ? raw : "unknown";
}

/** DndDetector backed by the Rust `dnd_state` command. */
export const dndDetector: DndDetector = {
  async current(): Promise<DndState> {
    try {
      return normalize(await invoke<string>("dnd_state"));
    } catch {
      // gsettings missing, command errored, non-GNOME desktop, etc.
      return "unknown";
    }
  },
};
