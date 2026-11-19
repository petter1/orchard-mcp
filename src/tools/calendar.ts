import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  calendarJson,
  normalizeCalendarWindow,
  shapeCalendarEvents,
  todayWindow,
} from "../calendarTime.js";
import { assertIsoDateRangeWithinDays } from "../resourceGuards.js";
import { OPERATION_PROFILES, safeBridgeData } from "../safety.js";

const MAX_CALENDAR_RANGE_DAYS = 31;

const WINDOW_NOTE =
  "Date-only values mean local midnight and end is exclusive (one day: start=2026-02-17, end=2026-02-18; the same date twice also means that whole day). Times without an offset are local. Events include startLocal/endLocal in the host timezone.";

const compactSchema = z
  .boolean()
  .optional()
  .describe(
    "Return a compact list (id, title, startLocal, endLocal, isAllDay, calendar, location, isRecurring) without notes, attendees, URLs or UTC fields. Use for multi-day overviews."
  );

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
    `List calendar events in a date range. Recurring events are properly expanded. Optionally filter by calendar ID. ${WINDOW_NOTE}`,
    {
      start: z
        .string()
        .describe("Start date in ISO 8601 format (e.g. 2026-02-17 or 2026-02-17T00:00:00Z)"),
      end: z
        .string()
        .describe("End date in ISO 8601 format"),
      calendarId: z
        .string()
        .optional()
        .describe("Optional calendar ID to filter by (from calendar.list_calendars)"),
      compact: compactSchema,
    },
    async ({ start, end, calendarId, compact }) => {
      const window = normalizeCalendarWindow(start, end);
      assertIsoDateRangeWithinDays(
        window.start,
        window.end,
        MAX_CALENDAR_RANGE_DAYS,
        "calendar.list_events"
      );
      const args = ["events", "--start", window.start, "--end", window.end];
      if (calendarId) {
        args.push("--calendar", calendarId);
      }
      const data = await safeBridgeData(args, OPERATION_PROFILES.calendarRead);
      const events = shapeCalendarEvents(data, window, { compact });
      return {
        content: [{ type: "text", text: calendarJson(events, compact) }],
      };
    }
  );

  server.tool(
    "calendar.today",
    "Get all calendar events for today (local timezone) across all calendars. Events include startLocal/endLocal.",
    {
      compact: compactSchema,
    },
    async ({ compact }) => {
      const window = todayWindow();
      const data = await safeBridgeData(
        ["events", "--start", window.start, "--end", window.end],
        OPERATION_PROFILES.calendarRead
      );
      const events = shapeCalendarEvents(data, window, { compact });
      return {
        content: [{ type: "text", text: calendarJson(events, compact) }],
      };
    }
  );

  server.tool(
    "calendar.search",
    `Search calendar events by title, notes, or location within a date range. ${WINDOW_NOTE}`,
    {
      query: z.string().describe("Search term to match against event title, notes, or location"),
      start: z.string().describe("Start date in ISO 8601 format"),
      end: z.string().describe("End date in ISO 8601 format"),
      compact: compactSchema,
    },
    async ({ query, start, end, compact }) => {
      const window = normalizeCalendarWindow(start, end);
      assertIsoDateRangeWithinDays(
        window.start,
        window.end,
        MAX_CALENDAR_RANGE_DAYS,
        "calendar.search"
      );
      const data = await safeBridgeData([
        "search",
        query,
        "--start",
        window.start,
        "--end",
        window.end,
      ], OPERATION_PROFILES.calendarRead);
      const events = shapeCalendarEvents(data, window, { compact });
      return {
        content: [{ type: "text", text: calendarJson(events, compact) }],
      };
    }
  );
}
