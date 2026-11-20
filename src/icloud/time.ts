/**
 * Date helpers for the iCloud backend. Orchard reads a time without an offset
 * as local time; icloud-mcp does the same when ICLOUD_MCP_DEFAULT_TZ is the
 * local zone (the client sets it), so local stamps pass through unchanged.
 */

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const HAS_OFFSET = /(Z|[+-]\d{2}:?\d{2})$/i;

export function isDateOnly(value: string): boolean {
  return DATE_ONLY.test(value);
}

export function hasOffset(value: string): boolean {
  return HAS_OFFSET.test(value);
}

/** A date alone means local midnight, as on macOS. */
export function rangeBound(value: string): string {
  return isDateOnly(value) ? `${value}T00:00:00` : value;
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/** Local wall-clock stamp without offset, e.g. 2026-11-20T09:30:00. */
export function localStamp(date: Date): string {
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
  );
}

export function localDay(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Shift a YYYY-MM-DD date by whole days (calendar arithmetic, no DST). */
export function addDays(day: string, days: number): string {
  if (!isDateOnly(day)) throw new Error(`Expected a date (YYYY-MM-DD), got "${day}".`);
  const [y, m, d] = day.split("-").map(Number);
  const shifted = new Date(Date.UTC(y, m - 1, d + days));
  return shifted.toISOString().slice(0, 10);
}

export function daysBetween(fromDay: string, toDay: string): number {
  const ms = Date.parse(`${toDay}T00:00:00Z`) - Date.parse(`${fromDay}T00:00:00Z`);
  return Math.round(ms / 86_400_000);
}

function parse(value: string, label: string): Date {
  const date = new Date(isDateOnly(value) ? `${value}T00:00:00` : value);
  if (Number.isNaN(date.getTime())) throw new Error(`Invalid ${label}: "${value}".`);
  return date;
}

/**
 * Add milliseconds to a start value and keep its form: a local stamp stays
 * local, a value with an offset becomes UTC (Z).
 */
export function shiftTime(start: string, ms: number): string {
  const shifted = new Date(parse(start, "start").getTime() + ms);
  return hasOffset(start) ? shifted.toISOString() : localStamp(shifted);
}

export function durationMs(start: string, end: string): number {
  return parse(end, "end").getTime() - parse(start, "start").getTime();
}

/** Day part of an all-day value; a timed value is refused. */
export function dayOf(value: string, label: string): string {
  if (isDateOnly(value)) return value;
  throw new Error(`${label} must be a date (YYYY-MM-DD) for all-day events, got "${value}".`);
}

/** Day granularity for IMAP SINCE/BEFORE: keep the local calendar day. */
export function imapDay(value: string, label: string): string {
  if (isDateOnly(value)) return value;
  return localDay(parse(value, label));
}
