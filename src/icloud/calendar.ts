import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { assertIsoDateRangeWithinDays } from "../resourceGuards.js";
import { OPERATION_PROFILES } from "../safety.js";
import { MAX_CALENDAR_RANGE_DAYS, detailSchema, formatEvents } from "../tools/calendar.js";
import type { IcloudCaller } from "./client.js";
import { decodeEventId, encodeEventId } from "./ids.js";
import {
  addDays,
  dayOf,
  daysBetween,
  durationMs,
  localDay,
  rangeBound,
  shiftTime,
} from "./time.js";
import { jsonText } from "./util.js";

const READ = OPERATION_PROFILES.icloudCalendarRead;
const WRITE = OPERATION_PROFILES.icloudCalendarWrite;

interface IcloudEvent {
  uid: string;
  calendar?: string;
  title?: string;
  start: string;
  end: string;
  allDay?: boolean;
  location?: string;
  notes?: string;
  url?: string;
  status?: string;
  recurrence?: string;
  recurrenceId?: string;
  isRecurring?: boolean;
  etag?: string;
}

interface SearchEventsResult {
  events?: IcloudEvent[] | null;
  truncated?: boolean;
  partialFailure?: boolean;
  multiCalendarCapped?: boolean;
  warnings?: string[] | null;
}

/** Orchard event shape: same keys as on macOS where they exist. */
export function toOrchardEvent(event: IcloudEvent, calendar?: string): Record<string, unknown> {
  const cal = event.calendar ?? calendar ?? "";
  const out: Record<string, unknown> = {
    id: encodeEventId({ calendar: cal, uid: event.uid }),
    title: event.title ?? "",
    start: event.start,
    end: event.end,
    isAllDay: Boolean(event.allDay),
    calendar: cal,
    isRecurring: Boolean(event.isRecurring || event.recurrence || event.recurrenceId),
  };
  if (event.recurrenceId) out.occurrenceStart = event.recurrenceId;
  for (const key of ["location", "notes", "url", "status", "recurrence", "etag"] as const) {
    if (event[key]) out[key] = event[key];
  }
  if (event.allDay) {
    // Reason: iCloud ends all-day events on the following day (exclusive);
    // Orchard documents the last day, inclusive.
    out.end = addDays(dayOf(event.end, "end"), -1);
  }
  return out;
}

function eventsResponse(data: unknown, detail: "full" | "compact" | undefined) {
  const result = (data ?? {}) as SearchEventsResult;
  const events = (result.events ?? []).map((e) => toOrchardEvent(e));
  const content = [{ type: "text" as const, text: formatEvents(events, detail) }];
  const notes: string[] = [];
  if (result.truncated) notes.push("The result is truncated; narrow the date range.");
  if (result.partialFailure) notes.push("Some calendars could not be read.");
  if (result.multiCalendarCapped) notes.push("Only the first calendars were searched.");
  for (const w of result.warnings ?? []) notes.push(w);
  if (notes.length) content.push({ type: "text", text: `Warning: ${notes.join(" ")}` });
  return { content };
}

async function searchEvents(
  call: IcloudCaller,
  args: { start: string; end: string; calendar?: string; query?: string; compact?: boolean }
): Promise<unknown> {
  const request: Record<string, unknown> = {
    start: rangeBound(args.start),
    end: rangeBound(args.end),
    limit: 400,
  };
  if (args.calendar) request.calendar = args.calendar;
  if (args.query) request.query = args.query;
  if (args.compact) request.compact = true;
  return call("search_events", request, READ);
}

/**
 * Load an event and refuse ambiguous recurring changes, like the macOS
 * bridge: a series needs occurrenceStart (one occurrence) or span
 * futureEvents without occurrenceStart (the whole series).
 */
async function locate(
  call: IcloudCaller,
  eventId: string,
  occurrenceStart: string | undefined,
  span: "thisEvent" | "futureEvents" | undefined,
  tool: string
) {
  const ref = decodeEventId(eventId);
  const event = (await call("get_event", { calendar: ref.calendar, uid: ref.uid }, READ)) as IcloudEvent;
  const recurring = Boolean(event.isRecurring || event.recurrence);
  if (occurrenceStart && span === "futureEvents") {
    throw new Error(
      `${tool}: "this and following occurrences" is not supported by iCloud (CalDAV). Change one occurrence or the whole series.`
    );
  }
  if (recurring && !occurrenceStart && span !== "futureEvents") {
    throw new Error(
      `${tool}: this is a recurring event. Pass occurrenceStart for one occurrence, or span "futureEvents" without occurrenceStart for the whole series.`
    );
  }
  const scope: Record<string, unknown> = occurrenceStart
    ? { scope: "occurrence", recurrence_id: occurrenceStart }
    : { scope: "series" };
  const target: Record<string, unknown> = { calendar: ref.calendar, uid: ref.uid, ...scope };
  if (event.etag) target.etag = event.etag;
  return { ref, event, target };
}

const eventFields = {
  title: z.string().min(1).optional().describe("Event title"),
  start: z
    .string()
    .optional()
    .describe("Start in ISO 8601. Without offset = local time. For all-day events a date (2026-11-18)."),
  end: z
    .string()
    .optional()
    .describe("End in ISO 8601. For all-day events the last day, inclusive. Default: 1 hour after start (new timed events), same day (new all-day events), or unchanged duration (updates)."),
  location: z.string().optional().describe("Location (empty string clears it)"),
  notes: z.string().optional().describe("Notes (empty string clears them)"),
  url: z.string().optional().describe("URL (empty string clears it)"),
};

const occurrenceFields = {
  eventId: z.string().min(1).describe("Event id from calendar_list_events or calendar_search"),
  occurrenceStart: z
    .string()
    .optional()
    .describe("For recurring events: the occurrence's occurrenceStart exactly as returned by calendar_list_events"),
  span: z
    .enum(["thisEvent", "futureEvents"])
    .optional()
    .describe("thisEvent (default): only this event/occurrence. futureEvents without occurrenceStart: the whole series (iCloud cannot split a series)."),
};

export function registerIcloudCalendarTools(server: McpServer, call: IcloudCaller): void {
  server.tool(
    "calendar.list_calendars",
    "List iCloud calendars (Linux: via icloud-mcp). The id is the calendar path used by the other calendar tools.",
    {},
    async () => {
      const data = (await call("list_calendars", {}, READ)) as {
        calendars?: Array<{ path: string; name?: string; color?: string; description?: string }> | null;
      };
      const calendars = (data?.calendars ?? []).map((c) => ({
        id: c.path,
        title: c.name ?? "",
        account: "iCloud",
        color: c.color,
        description: c.description,
      }));
      return jsonText(calendars);
    }
  );

  server.tool(
    "calendar.list_events",
    "List iCloud calendar events in a date range (recurring events expanded). Dates without an offset are local time. Optionally filter by calendar id.",
    {
      start: z.string().describe("Start in ISO 8601 (2026-02-17 = local midnight, 2026-02-17T09:00 = local time, or with Z/offset)"),
      end: z.string().describe("End in ISO 8601 (exclusive)"),
      calendarId: z.string().optional().describe("Optional calendar id from calendar_list_calendars"),
      detail: detailSchema,
    },
    async ({ start, end, calendarId, detail }) => {
      assertIsoDateRangeWithinDays(rangeBound(start), rangeBound(end), MAX_CALENDAR_RANGE_DAYS, "calendar.list_events");
      const data = await searchEvents(call, { start, end, calendar: calendarId, compact: detail === "compact" });
      return eventsResponse(data, detail);
    }
  );

  server.tool(
    "calendar.today",
    "Get today's iCloud calendar events across all calendars.",
    { detail: detailSchema },
    async ({ detail }) => {
      const today = localDay(new Date());
      const data = await searchEvents(call, { start: today, end: addDays(today, 1), compact: detail === "compact" });
      return eventsResponse(data, detail);
    }
  );

  server.tool(
    "calendar.search",
    "Search iCloud calendar events by title, notes, or location within a date range.",
    {
      query: z.string().min(1).describe("Search term (title, location, notes)"),
      start: z.string().describe("Start in ISO 8601"),
      end: z.string().describe("End in ISO 8601"),
      detail: detailSchema,
    },
    async ({ query, start, end, detail }) => {
      assertIsoDateRangeWithinDays(rangeBound(start), rangeBound(end), MAX_CALENDAR_RANGE_DAYS, "calendar.search");
      const data = await searchEvents(call, { start, end, query, compact: detail === "compact" });
      return eventsResponse(data, detail);
    }
  );

  server.tool(
    "calendar.create_event",
    "Create an iCloud calendar event. calendarId is required on Linux (from calendar_list_calendars). Requires the calendar.write permission in icloud-mcp.",
    {
      calendarId: z.string().min(1).describe("Calendar id from calendar_list_calendars"),
      ...eventFields,
      title: z.string().min(1).describe("Event title"),
      start: eventFields.start.unwrap(),
      allDay: z.boolean().optional().describe("All-day event"),
    },
    async ({ calendarId, title, start, end, allDay, location, notes, url }) => {
      const request: Record<string, unknown> = { calendar: calendarId, title };
      if (allDay) {
        const first = dayOf(start, "start");
        const last = end ? dayOf(end, "end") : first;
        if (daysBetween(first, last) < 0) throw new Error("end must not be before start.");
        Object.assign(request, { all_day: true, start: first, end: addDays(last, 1) });
      } else {
        const from = rangeBound(start);
        Object.assign(request, { start: from, end: end ? rangeBound(end) : shiftTime(from, 3_600_000) });
      }
      if (location) request.location = location;
      if (notes) request.notes = notes;
      if (url) request.url = url;
      const data = (await call("create_event", request, WRITE)) as Record<string, unknown>;
      const uid = typeof data?.uid === "string" ? data.uid : undefined;
      return jsonText(uid ? { id: encodeEventId({ calendar: calendarId, uid }), ...data } : data);
    }
  );

  server.tool(
    "calendar.update_event",
    "Change an iCloud event's title, time, location, notes, or URL. Only given fields change; moving the start without an end keeps the duration. Recurring events need occurrenceStart (one occurrence) or span futureEvents (whole series). Changing allDay is not supported on Linux.",
    { ...occurrenceFields, ...eventFields },
    async ({ eventId, occurrenceStart, span, title, start, end, location, notes, url }) => {
      const changes: Record<string, unknown> = {};
      for (const [key, value] of Object.entries({ title, location, notes, url })) {
        if (value !== undefined) changes[key] = value;
      }
      if (start === undefined && end === undefined && Object.keys(changes).length === 0) {
        throw new Error("calendar.update_event needs at least one field to change.");
      }
      const { event, target } = await locate(call, eventId, occurrenceStart, span, "calendar.update_event");
      if (event.allDay) {
        const oldFirst = dayOf(event.start, "start");
        const oldLastExclusive = dayOf(event.end, "end");
        const first = start !== undefined ? dayOf(start, "start") : undefined;
        if (first) changes.start = first;
        if (end !== undefined) changes.end = addDays(dayOf(end, "end"), 1);
        else if (first) changes.end = addDays(first, daysBetween(oldFirst, oldLastExclusive));
      } else {
        if (start !== undefined) changes.start = rangeBound(start);
        if (end !== undefined) changes.end = rangeBound(end);
        else if (start !== undefined) {
          changes.end = shiftTime(rangeBound(start), durationMs(event.start, event.end));
        }
      }
      const data = await call("update_event", { ...target, ...changes }, WRITE);
      return jsonText(data);
    }
  );

  server.tool(
    "calendar.delete_event",
    "Delete an iCloud event. Recurring events need occurrenceStart (one occurrence) or span futureEvents without occurrenceStart (whole series). Requires the calendar.delete permission in icloud-mcp.",
    occurrenceFields,
    async ({ eventId, occurrenceStart, span }) => {
      const { target } = await locate(call, eventId, occurrenceStart, span, "calendar.delete_event");
      const data = await call("delete_event", target, WRITE);
      return jsonText(data);
    }
  );
}
