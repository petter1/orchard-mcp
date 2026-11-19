// Reason: apple-bridge parses date-only strings as UTC midnight and returns
// event times in UTC. In any non-UTC timezone that shifts day windows by the
// UTC offset, and EventKit's overlap predicate also returns events that end
// exactly at the window start (e.g. yesterday's all-day events). This module
// normalizes window bounds to absolute instants in the host's local timezone,
// drops events outside the half-open window, and adds local-time fields so
// clients do not have to convert UTC themselves.

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

export interface CalendarWindow {
  start: string;
  end: string;
}

function parseLocalDate(value: string): Date | null {
  const match = DATE_ONLY.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]) - 1;
  const day = Number(match[3]);
  const date = new Date(year, month, day);
  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month ||
    date.getDate() !== day
  ) {
    return null;
  }
  return date;
}

/**
 * Convert one window bound to an absolute ISO 8601 instant.
 * - `YYYY-MM-DD` means local midnight of that day.
 * - `YYYY-MM-DDTHH:MM[:SS]` without offset means local wall-clock time.
 * - Values with `Z` or an offset are kept as the instant they describe.
 * Unparseable values are returned unchanged so the bridge reports the error.
 */
export function normalizeCalendarBound(value: string): string {
  const trimmed = value.trim();
  const localDate = parseLocalDate(trimmed);
  if (localDate) return localDate.toISOString();
  if (DATE_ONLY.test(trimmed)) return value; // e.g. 2026-02-30

  // ECMAScript parses date-time strings without an offset as local time.
  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toISOString();
}

/**
 * Normalize a start/end pair. When both are the same date-only value the
 * caller means that whole local day, so the end moves to the next midnight.
 */
export function normalizeCalendarWindow(start: string, end: string): CalendarWindow {
  const normalizedStart = normalizeCalendarBound(start);
  let normalizedEnd = normalizeCalendarBound(end);
  const startDay = parseLocalDate(start.trim());
  if (startDay && start.trim() === end.trim()) {
    normalizedEnd = new Date(
      startDay.getFullYear(),
      startDay.getMonth(),
      startDay.getDate() + 1
    ).toISOString();
  }
  return { start: normalizedStart, end: normalizedEnd };
}

/** Local window for "today" in the host timezone. */
export function todayWindow(now: Date = new Date()): CalendarWindow {
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const endOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  return { start: startOfDay.toISOString(), end: endOfDay.toISOString() };
}

function pad(value: number, width = 2): string {
  return String(Math.abs(value)).padStart(width, "0");
}

/** Format an instant as local ISO 8601 with offset, e.g. 2026-11-18T09:00:00+01:00. */
export function formatLocalIso(date: Date): string {
  const offsetMinutes = -date.getTimezoneOffset();
  const sign = offsetMinutes >= 0 ? "+" : "-";
  const offset = `${sign}${pad(Math.trunc(Math.abs(offsetMinutes) / 60))}:${pad(Math.abs(offsetMinutes) % 60)}`;
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}` +
    offset
  );
}

type EventRecord = Record<string, unknown>;

const COMPACT_FIELDS = [
  "id",
  "title",
  "startLocal",
  "endLocal",
  "isAllDay",
  "calendar",
  "location",
  "isRecurring",
] as const;

function timeOf(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const time = new Date(value).getTime();
  return Number.isNaN(time) ? null : time;
}

/**
 * Keep events that overlap the half-open window [start, end), add
 * `startLocal`/`endLocal`, and optionally reduce each event to the fields in
 * COMPACT_FIELDS. Non-array data is returned unchanged.
 */
export function shapeCalendarEvents(
  data: unknown,
  window: CalendarWindow,
  options: { compact?: boolean } = {}
): unknown {
  if (!Array.isArray(data)) return data;
  const windowStart = timeOf(window.start);
  const windowEnd = timeOf(window.end);

  const shaped: EventRecord[] = [];
  for (const item of data) {
    if (item === null || typeof item !== "object") continue;
    const event = item as EventRecord;
    const start = timeOf(event.start);
    const end = timeOf(event.end);

    if (windowStart !== null && windowEnd !== null && start !== null) {
      const effectiveEnd = end ?? start;
      const zeroLength = effectiveEnd <= start;
      const overlaps = zeroLength
        ? start >= windowStart && start < windowEnd
        : start < windowEnd && effectiveEnd > windowStart;
      if (!overlaps) continue;
    }

    const enriched: EventRecord = { ...event };
    if (start !== null) enriched.startLocal = formatLocalIso(new Date(start));
    if (end !== null) enriched.endLocal = formatLocalIso(new Date(end));

    if (options.compact) {
      const compact: EventRecord = {};
      for (const field of COMPACT_FIELDS) {
        if (enriched[field] !== undefined) compact[field] = enriched[field];
      }
      shaped.push(compact);
    } else {
      shaped.push(enriched);
    }
  }
  return shaped;
}

/** Serialize tool output; compact output skips indentation to save context. */
export function calendarJson(data: unknown, compact: boolean | undefined): string {
  return compact ? JSON.stringify(data) : JSON.stringify(data, null, 2);
}
