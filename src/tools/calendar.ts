import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { assertIsoDateRangeWithinDays } from "../resourceGuards.js";
import { OPERATION_PROFILES, safeBridgeData } from "../safety.js";

export const MAX_CALENDAR_RANGE_DAYS = 31;

const COMPACT_EVENT_FIELDS = ["id", "title", "start", "end", "isAllDay", "calendar", "location", "isRecurring"];

export const detailSchema = z
  .enum(["full", "compact"])
  .optional()
  .describe("full (default): all fields, pretty-printed. compact: id, title, start, end, isAllDay, calendar, location, isRecurring only, unindented JSON. Use compact for ranges over a few days.");

/**
 * Shape a bridge event list for the client. Compact mode keeps the fields an
 * overview needs and drops notes/attendees, which made multi-week answers
 * exceed 100 KB.
 */
export function formatEvents(data: unknown, detail: "full" | "compact" = "full"): string {
  if (detail === "full" || !Array.isArray(data)) {
    return JSON.stringify(data, null, 2);
  }
  const compact = data.map((event) => {
    const out: Record<string, unknown> = {};
    for (const key of COMPACT_EVENT_FIELDS) {
      const value = (event as Record<string, unknown>)[key];
      if (value !== undefined) out[key] = value;
    }
    return out;
  });
  return JSON.stringify(compact);
}

const eventFieldSchema = {
  title: z.string().min(1).optional().describe("Event title"),
  start: z
    .string()
    .optional()
    .describe("Start in ISO 8601. Without offset = local time. For all-day events a date (2026-11-18)."),
  end: z
    .string()
    .optional()
    .describe("End in ISO 8601. For all-day events the last day, inclusive. Default: 1 hour after start (new timed events), same day (new all-day events), or unchanged duration (updates)."),
  allDay: z.boolean().optional().describe("All-day event"),
  location: z.string().optional().describe("Location (empty string clears it)"),
  notes: z.string().optional().describe("Notes (empty string clears them)"),
  url: z.string().optional().describe("URL (empty string clears it)"),
};

const occurrenceSchema = {
  eventId: z.string().min(1).describe("Event ID from calendar.list_events or calendar.search"),
  occurrenceStart: z
    .string()
    .optional()
    .describe("For recurring events: the occurrence's start exactly as returned by calendar.list_events"),
  span: z
    .enum(["thisEvent", "futureEvents"])
    .optional()
    .describe("thisEvent (default): only this event/occurrence. futureEvents: this and all following occurrences (without occurrenceStart: the whole series)."),
};

type EventFields = {
  title?: string;
  start?: string;
  end?: string;
  allDay?: boolean;
  location?: string;
  notes?: string;
  url?: string;
};

export function eventFieldArgs(fields: EventFields): string[] {
  const args: string[] = [];
  const pairs: Array<[string, string | undefined]> = [
    ["--title", fields.title],
    ["--start", fields.start],
    ["--end", fields.end],
    ["--all-day", fields.allDay === undefined ? undefined : String(fields.allDay)],
    ["--location", fields.location],
    ["--notes", fields.notes],
    ["--url", fields.url],
  ];
  for (const [flag, value] of pairs) {
    if (value !== undefined) args.push(flag, value);
  }
  return args;
}

function occurrenceArgs(occurrenceStart?: string, span?: string): string[] {
  const args: string[] = [];
  if (occurrenceStart) args.push("--occurrence-start", occurrenceStart);
  if (span) args.push("--span", span);
  return args;
}

export function registerCalendarTools(server: McpServer): void {
  server.tool(
    "calendar.list_calendars",
    "List all Apple Calendar calendars with account name, type, color, and read-only status.",
    {},
    async () => {
      const data = await safeBridgeData(["calendars"], OPERATION_PROFILES.calendarRead);
      return {
        content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
      };
    }
  );

  server.tool(
    "calendar.list_events",
    "List calendar events in a date range. Recurring events are properly expanded. Dates without an offset are local time; returned times carry the local offset (e.g. +01:00). Optionally filter by calendar ID.",
    {
      start: z
        .string()
        .describe("Start in ISO 8601 (e.g. 2026-02-17 = local midnight, 2026-02-17T09:00 = local time, or with Z/offset)"),
      end: z
        .string()
        .describe("End date in ISO 8601 format"),
      calendarId: z
        .string()
        .optional()
        .describe("Optional calendar ID to filter by (from calendar.list_calendars)"),
      detail: detailSchema,
    },
    async ({ start, end, calendarId, detail }) => {
      assertIsoDateRangeWithinDays(
        start,
        end,
        MAX_CALENDAR_RANGE_DAYS,
        "calendar.list_events"
      );
      const args = ["events", "--start", start, "--end", end];
      if (calendarId) {
        args.push("--calendar", calendarId);
      }
      const data = await safeBridgeData(args, OPERATION_PROFILES.calendarRead);
      return {
        content: [{ type: "text", text: formatEvents(data, detail) }],
      };
    }
  );

  server.tool(
    "calendar.today",
    "Get all calendar events for today across all calendars.",
    { detail: detailSchema },
    async ({ detail }) => {
      // Reason: Build today's date range in local timezone for the bridge.
      const now = new Date();
      const startOfDay = new Date(
        now.getFullYear(),
        now.getMonth(),
        now.getDate()
      );
      const endOfDay = new Date(
        now.getFullYear(),
        now.getMonth(),
        now.getDate() + 1
      );
      const start = startOfDay.toISOString();
      const end = endOfDay.toISOString();

      const data = await safeBridgeData(
        ["events", "--start", start, "--end", end],
        OPERATION_PROFILES.calendarRead
      );
      return {
        content: [{ type: "text", text: formatEvents(data, detail) }],
      };
    }
  );

  server.tool(
    "calendar.search",
    "Search calendar events by title, notes, or location within a date range.",
    {
      query: z.string().describe("Search term to match against event title, notes, or location"),
      start: z.string().describe("Start date in ISO 8601 format"),
      end: z.string().describe("End date in ISO 8601 format"),
      detail: detailSchema,
    },
    async ({ query, start, end, detail }) => {
      assertIsoDateRangeWithinDays(
        start,
        end,
        MAX_CALENDAR_RANGE_DAYS,
        "calendar.search"
      );
      const data = await safeBridgeData([
        "search",
        query,
        "--start",
        start,
        "--end",
        end,
      ], OPERATION_PROFILES.calendarRead);
      return {
        content: [{ type: "text", text: formatEvents(data, detail) }],
      };
    }
  );

  server.tool(
    "calendar.create_event",
    "Create a calendar event (EventKit). Uses the default calendar unless calendarId is given. Returns the new event including its id.",
    {
      calendarId: z.string().optional().describe("Calendar ID from calendar.list_calendars (default: default calendar for new events)"),
      ...eventFieldSchema,
      title: z.string().min(1).describe("Event title"),
      start: eventFieldSchema.start.unwrap(),
    },
    async ({ calendarId, ...fields }) => {
      const args = ["event-create"];
      if (calendarId) args.push("--calendar", calendarId);
      args.push(...eventFieldArgs(fields));
      const data = await safeBridgeData(args, OPERATION_PROFILES.calendarWrite);
      return {
        content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
      };
    }
  );

  server.tool(
    "calendar.update_event",
    "Change an event's title, time, all-day flag, location, notes, or URL. Only given fields change; moving the start without an end keeps the duration. Recurring events need occurrenceStart (one occurrence) or span futureEvents; otherwise the call is refused.",
    {
      ...occurrenceSchema,
      ...eventFieldSchema,
    },
    async ({ eventId, occurrenceStart, span, ...fields }) => {
      const fieldArgs = eventFieldArgs(fields);
      if (fieldArgs.length === 0) {
        throw new Error("calendar.update_event needs at least one field to change.");
      }
      const args = ["event-update", "--id", eventId, ...occurrenceArgs(occurrenceStart, span), ...fieldArgs];
      const data = await safeBridgeData(args, OPERATION_PROFILES.calendarWrite);
      return {
        content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
      };
    }
  );

  server.tool(
    "calendar.delete_event",
    "Delete an event. Recurring events need occurrenceStart (delete one occurrence) or span futureEvents (this and following; without occurrenceStart the whole series); otherwise the call is refused. Returns the deleted event.",
    occurrenceSchema,
    async ({ eventId, occurrenceStart, span }) => {
      const args = ["event-delete", "--id", eventId, ...occurrenceArgs(occurrenceStart, span)];
      const data = await safeBridgeData(args, OPERATION_PROFILES.calendarWrite);
      return {
        content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
      };
    }
  );
}
