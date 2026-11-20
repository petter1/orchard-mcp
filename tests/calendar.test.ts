import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { eventFieldArgs } from "../src/tools/calendar.js";

const calendarSwift = readFileSync(
  new URL("../swift/Sources/AppleBridge/Calendar.swift", import.meta.url),
  "utf8"
);

describe("calendar write args", () => {
  it("passes only given fields, keeping empty strings to clear values", () => {
    assert.deepEqual(eventFieldArgs({ title: "Probe", allDay: false, notes: "" }), [
      "--title", "Probe", "--all-day", "false", "--notes", "",
    ]);
    assert.deepEqual(eventFieldArgs({}), []);
  });
});

describe("calendar write bridge contract", () => {
  it("refuses to change a recurring series implicitly", () => {
    assert.match(calendarSwift, /base\.hasRecurrenceRules && span == \.thisEvent/);
  });

  it("refuses read-only calendars before writing", () => {
    const writes = calendarSwift.match(/allowsContentModifications/g) ?? [];
    assert.ok(writes.length >= 3, "create, locate and list should check allowsContentModifications");
  });
});
