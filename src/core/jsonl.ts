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
 *
 * Also tolerant of a malformed line: the event log is append-only, so a crash
 * mid-append can leave a torn/partial final line. An unparseable line is SKIPPED
 * (dropped) rather than throwing, so the valid events still return. Dropping torn
 * lines is correct for an append-only log; we do not attempt recovery.
 */
export function parseEvents(text: string): DomainEvent[] {
  const events: DomainEvent[] = [];
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (line.length === 0) continue;
    try {
      events.push(JSON.parse(line) as DomainEvent);
    } catch {
      // Torn/partial line from an interrupted append — skip it.
    }
  }
  return events;
}
