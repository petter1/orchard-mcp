import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { formatEvents } from "../src/tools/calendar.js";

const event = {
  id: "E1",
  title: "Probe",
  start: "2026-11-18T19:00:00+01:00",
  end: "2026-11-18T21:00:00+01:00",
  isAllDay: false,
  calendar: "Band",
  calendarId: "CAL",
  location: "Studio",
  notes: "x".repeat(5000),
  attendees: [{ name: "A", status: "accepted" }],
};

describe("calendar output detail", () => {
  it("keeps full output unchanged by default", () => {
    assert.equal(formatEvents([event]), JSON.stringify([event], null, 2));
  });

  it("drops heavy fields and indentation in compact mode", () => {
    const text = formatEvents([event], "compact");
    assert.deepEqual(JSON.parse(text), [{
      id: "E1", title: "Probe", start: event.start, end: event.end,
      isAllDay: false, calendar: "Band", location: "Studio",
    }]);
    assert.ok(text.length < 200, `compact output should be small, got ${text.length}`);
  });

  it("passes non-list data through", () => {
    assert.equal(formatEvents({ error: "x" }, "compact"), JSON.stringify({ error: "x" }, null, 2));
  });
});
