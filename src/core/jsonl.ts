// Pure JSONL (newline-delimited JSON) serializer for the domain event log.
// One compact JSON object per line — no embedded newlines — so events can be
// appended to a file one at a time and read back by splitting on "\n". No
// native/DOM/network dependency here; the file I/O lives in src/native.

import type { DomainEvent } from "./events";

/**
 * Serialize one event to a single compact JSON line. JSON.stringify never emits
 * a literal newline inside a string (control chars are escaped), so the result
 * is guaranteed newline-free and safe as one JSONL record.
 */
export function serializeEvent(e: DomainEvent): string {
  return JSON.stringify(e);
}

/**
 * Parse JSONL text back into events: one object per line. Tolerant of a trailing
 * newline, interior blank / whitespace-only lines, and empty input (→ []).
 */
export function parseEvents(text: string): DomainEvent[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as DomainEvent);
}
