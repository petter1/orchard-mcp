import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { assertIsoDateRangeWithinDays } from "../resourceGuards.js";
import { OPERATION_PROFILES, safeBridgeData } from "../safety.js";

const MAX_CALENDAR_RANGE_DAYS = 31;

const COMPACT_EVENT_FIELDS = ["id", "title", "start", "end", "isAllDay", "calendar", "location", "isRecurring"];

const detailSchema = z
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
    "List calendar events in a date range. Recurring events are properly expanded. Optionally filter by calendar ID.",
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
}
