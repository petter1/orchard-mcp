process.env.TZ = "Europe/Zurich";

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  calendarJson,
  formatLocalIso,
  normalizeCalendarBound,
  normalizeCalendarWindow,
  shapeCalendarEvents,
  todayWindow,
} from "../src/calendarTime.js";

describe("calendar window normalization (Europe/Zurich)", () => {
  it("treats date-only values as local midnight, not UTC midnight", () => {
    assert.equal(normalizeCalendarBound("2026-11-18"), "2026-11-17T23:00:00.000Z");
    // Summer time (UTC+2)
    assert.equal(normalizeCalendarBound("2026-07-01"), "2026-06-30T22:00:00.000Z");
  });

  it("treats date-times without offset as local wall-clock time", () => {
    assert.equal(normalizeCalendarBound("2026-11-18T09:30"), "2026-11-18T08:30:00.000Z");
    assert.equal(normalizeCalendarBound("2026-11-18T09:30:15"), "2026-11-18T08:30:15.000Z");
  });

  it("keeps explicit UTC and offsets as the instant they describe", () => {
    assert.equal(normalizeCalendarBound("2026-11-18T00:00:00Z"), "2026-11-18T00:00:00.000Z");
    assert.equal(normalizeCalendarBound("2026-11-18T00:00:00+01:00"), "2026-11-17T23:00:00.000Z");
  });

  it("passes unparseable or impossible values through for the bridge to reject", () => {
    assert.equal(normalizeCalendarBound("next tuesday"), "next tuesday");
    assert.equal(normalizeCalendarBound("2026-02-30"), "2026-02-30");
  });

  it("expands the same date twice to that whole local day", () => {
    assert.deepEqual(normalizeCalendarWindow("2026-11-18", "2026-11-18"), {
      start: "2026-11-17T23:00:00.000Z",
      end: "2026-11-18T23:00:00.000Z",
    });
  });

  it("keeps date-only end exclusive for multi-day windows", () => {
    assert.deepEqual(normalizeCalendarWindow("2026-11-18", "2026-11-20"), {
      start: "2026-11-17T23:00:00.000Z",
      end: "2026-11-19T23:00:00.000Z",
    });
  });

  it("builds today's window from local midnight to local midnight", () => {
    const window = todayWindow(new Date("2026-11-18T22:30:00Z")); // 23:30 local
    assert.deepEqual(window, {
      start: "2026-11-17T23:00:00.000Z",
      end: "2026-11-18T23:00:00.000Z",
    });
  });

  it("formats local times with the current offset", () => {
    assert.equal(formatLocalIso(new Date("2026-11-18T08:00:00Z")), "2026-11-18T09:00:00+01:00");
    assert.equal(formatLocalIso(new Date("2026-07-01T08:00:00Z")), "2026-07-01T10:00:00+02:00");
  });
});

describe("calendar event shaping", () => {
  const window = normalizeCalendarWindow("2026-11-18", "2026-11-18");

  const events = [
    {
      id: "prev-all-day",
      title: "Yesterday all-day",
      start: "2026-11-16T23:00:00Z",
      end: "2026-11-17T23:00:00Z",
      isAllDay: true,
      calendar: "Home",
    },
    {
      id: "meeting",
      title: "Meeting",
      start: "2026-11-18T08:00:00Z",
      end: "2026-11-18T09:00:00Z",
      isAllDay: false,
      calendar: "Work",
      calendarId: "cal-1",
      location: "Room 1",
      notes: "long notes",
      attendees: [{ name: "A", status: "accepted" }],
      isRecurring: true,
    },
    {
      id: "late-yesterday",
      title: "Overlaps midnight",
      start: "2026-11-17T22:30:00Z",
      end: "2026-11-17T23:30:00Z",
      isAllDay: false,
      calendar: "Home",
    },
    {
      id: "next-day",
      title: "Tomorrow",
      start: "2026-11-18T23:00:00Z",
      end: "2026-11-19T00:00:00Z",
      isAllDay: false,
      calendar: "Home",
    },
    {
      id: "zero-at-start",
      title: "Marker",
      start: "2026-11-17T23:00:00Z",
      end: "2026-11-17T23:00:00Z",
      isAllDay: false,
      calendar: "Home",
    },
  ];

  it("drops events that only touch the window edges", () => {
    const shaped = shapeCalendarEvents(events, window) as Array<{ id: string }>;
    assert.deepEqual(
      shaped.map((e) => e.id),
      ["meeting", "late-yesterday", "zero-at-start"]
    );
  });

  it("adds local start and end times", () => {
    const shaped = shapeCalendarEvents(events, window) as Array<Record<string, unknown>>;
    const meeting = shaped.find((e) => e.id === "meeting");
    assert.equal(meeting?.startLocal, "2026-11-18T09:00:00+01:00");
    assert.equal(meeting?.endLocal, "2026-11-18T10:00:00+01:00");
    assert.equal(meeting?.notes, "long notes");
    assert.equal(meeting?.start, "2026-11-18T08:00:00Z");
  });

  it("reduces events to the compact field set", () => {
    const shaped = shapeCalendarEvents(events, window, { compact: true }) as Array<
      Record<string, unknown>
    >;
    const meeting = shaped.find((e) => e.id === "meeting");
    assert.deepEqual(meeting, {
      id: "meeting",
      title: "Meeting",
      startLocal: "2026-11-18T09:00:00+01:00",
      endLocal: "2026-11-18T10:00:00+01:00",
      isAllDay: false,
      calendar: "Work",
      location: "Room 1",
      isRecurring: true,
    });
    assert.ok(calendarJson(shaped, true).length < calendarJson(events, false).length);
    assert.ok(!calendarJson(shaped, true).includes("\n"));
  });

  it("returns non-array bridge data unchanged", () => {
    const data = { message: "nothing" };
    assert.equal(shapeCalendarEvents(data, window), data);
  });
});
