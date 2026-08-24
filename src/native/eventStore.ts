// Native JSONL event store — the file-backed EventSink implementation.
//
// IMPURE: depends on Tauri's fs + path plugins, so it is NOT unit-tested (the
// Tauri runtime is unavailable under node/vitest). The pure serialization it
// leans on (serializeEvent / parseEvents) lives in src/core/jsonl.ts and IS
// unit-tested. Verify this module manually inside a running Tauri app.
//
// Events land at $XDG_DATA_HOME/tomato/events.jsonl (i.e. ~/.local/share/tomato/
// events.jsonl on Linux), one compact JSON object per line, opened in APPEND
// mode so each event is durably tacked onto the log.

import { mkdir, writeTextFile, readTextFile, exists } from "@tauri-apps/plugin-fs";
import { dataDir, join } from "@tauri-apps/api/path";
import type { DomainEvent, EventSink } from "../core/events";
import { serializeEvent, parseEvents } from "../core/jsonl";

/** Subdirectory (under the XDG data dir) that holds Tomato's local state. */
const APP_DIR = "tomato";
const EVENTS_FILE = "events.jsonl";

/** Absolute path to the events log, ensuring its parent directory exists. */
async function eventsPath(): Promise<string> {
  const dir = await join(await dataDir(), APP_DIR);
  await mkdir(dir, { recursive: true });
  return join(dir, EVENTS_FILE);
}

/**
 * File-backed EventSink. `append` opens events.jsonl in append mode and writes
 * one serialized event + "\n"; `readAllEvents` reads the whole log back through
 * the tolerant JSONL parser (missing file → []).
 */
export const jsonlEventStore: EventSink & {
  readAllEvents(): Promise<DomainEvent[]>;
} = {
  async append(e: DomainEvent): Promise<void> {
    const path = await eventsPath();
    await writeTextFile(path, serializeEvent(e) + "\n", { append: true });
  },

  async readAllEvents(): Promise<DomainEvent[]> {
    const dir = await join(await dataDir(), APP_DIR);
    const path = await join(dir, EVENTS_FILE);
    if (!(await exists(path))) return [];
    return parseEvents(await readTextFile(path));
  },
};
