import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createOrchardServer } from "../src/server.js";
import { IcloudBackend, icloudChildEnv, unwrapToolResult } from "../src/icloud/client.js";
import {
  decodeContactId,
  decodeEventId,
  decodeMessageId,
  encodeContactId,
  encodeEventId,
  encodeMessageId,
} from "../src/icloud/ids.js";
import { addDays, rangeBound, shiftTime } from "../src/icloud/time.js";
import { OPERATION_PROFILES } from "../src/safety.js";

type Handler = (args: Record<string, unknown>) => unknown;

/** Fake icloud-mcp: records every call and answers from per-tool handlers. */
function fakeBackend(handlers: Record<string, Handler>) {
  const calls: Array<{ tool: string; args: Record<string, unknown> }> = [];
  const call = async (tool: string, args: Record<string, unknown>) => {
    calls.push({ tool, args });
    const handler = handlers[tool];
    if (!handler) throw new Error(`unexpected icloud-mcp tool ${tool}`);
    return handler(args);
  };
  return { call, calls };
}

async function linuxClient(handlers: Record<string, Handler>) {
  const backend = fakeBackend(handlers);
  const server = createOrchardServer({ platform: "linux", icloudCaller: backend.call });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: "test", version: "0" });
  await client.connect(clientTransport);
  const tool = async (name: string, args: Record<string, unknown> = {}) => {
    const result = (await client.callTool({ name, arguments: args })) as {
      isError?: boolean;
      content: Array<{ text: string }>;
    };
    if (result.isError) throw new Error(result.content[0]?.text);
    return { data: JSON.parse(result.content[0].text), content: result.content };
  };
  return { client, tool, calls: backend.calls };
}

const CAL = "/123/calendars/home/";

describe("icloud ids", () => {
  it("round-trips event, contact, and message ids", () => {
    const event = { calendar: CAL, uid: "a#b/c" };
    assert.deepEqual(decodeEventId(encodeEventId(event)), event);
    const contact = { addressBook: "card/abc", uid: "u-1" };
    assert.deepEqual(decodeContactId(encodeContactId(contact)), contact);
    const message = { mailbox: "Archive/2026", uidValidity: 7, uid: 42 };
    assert.deepEqual(decodeMessageId(encodeMessageId(message)), message);
  });

  it("rejects foreign or damaged ids with a usable message", () => {
    assert.throws(() => decodeEventId("ABC-123"), /Invalid event id/);
    assert.throws(() => decodeMessageId(encodeEventId({ calendar: CAL, uid: "x" })), /Invalid message id/);
    assert.throws(() => decodeMessageId("icm1.!!!"), /Invalid message id/);
  });
});

describe("icloud time helpers", () => {
  it("reads a bare date as local midnight and shifts local stamps locally", () => {
    assert.equal(rangeBound("2026-11-18"), "2026-11-18T00:00:00");
    assert.equal(rangeBound("2026-11-18T09:00:00Z"), "2026-11-18T09:00:00Z");
    assert.equal(shiftTime("2026-11-18T09:30:00", 3_600_000), "2026-11-18T10:30:00");
    assert.equal(shiftTime("2026-11-18T09:30:00Z", 3_600_000), "2026-11-18T10:30:00.000Z");
    assert.equal(addDays("2026-12-31", 1), "2027-01-01");
  });
});

describe("linux tool surface", () => {
  it("registers only Calendar, Mail, Contacts, and system tools", async () => {
    const { client } = await linuxClient({});
    const names = (await client.listTools()).tools.map((t) => t.name).sort();
    assert.deepEqual(names, [
      "calendar_create_event",
      "calendar_delete_event",
      "calendar_list_calendars",
      "calendar_list_events",
      "calendar_search",
      "calendar_today",
      "calendar_update_event",
      "contacts_list_groups",
      "contacts_read_contact",
      "contacts_search",
      "mail_create_mailbox",
      "mail_flagged",
      "mail_list_accounts",
      "mail_list_messages",
      "mail_mark_read",
      "mail_move",
      "mail_read_message",
      "mail_search",
      "mail_set_flag",
      "mail_unread_summary",
      "system_doctor",
    ]);
  });
});

describe("linux calendar mapping", () => {
  const events = {
    events: [
      { uid: "e1", calendar: CAL, title: "Standup", start: "2026-11-18T09:00:00+01:00", end: "2026-11-18T09:15:00+01:00", recurrence: "FREQ=DAILY", recurrenceId: "2026-11-18T09:00:00+01:00", notes: "long" },
      { uid: "e2", calendar: CAL, title: "Trip", start: "2026-11-18", end: "2026-11-21", allDay: true },
    ],
  };

  it("lists events with Orchard ids, inclusive all-day ends, and local day bounds", async () => {
    const { tool, calls } = await linuxClient({ search_events: () => events });
    const { data } = await tool("calendar_list_events", { start: "2026-11-18", end: "2026-11-19" });
    assert.deepEqual(calls[0].args, { start: "2026-11-18T00:00:00", end: "2026-11-19T00:00:00", limit: 400 });
    assert.deepEqual(decodeEventId(data[0].id), { calendar: CAL, uid: "e1" });
    assert.equal(data[0].isRecurring, true);
    assert.equal(data[0].occurrenceStart, "2026-11-18T09:00:00+01:00");
    assert.equal(data[1].isAllDay, true);
    assert.equal(data[1].end, "2026-11-20");
  });

  it("keeps the 31-day range guard", async () => {
    const { tool } = await linuxClient({ search_events: () => events });
    await assert.rejects(tool("calendar_list_events", { start: "2026-01-01", end: "2026-03-01" }), /31 days/);
  });

  it("compact detail drops notes and asks icloud-mcp for compact output", async () => {
    const { tool, calls } = await linuxClient({ search_events: () => events });
    const { data } = await tool("calendar_search", { query: "Standup", start: "2026-11-18", end: "2026-11-19", detail: "compact" });
    assert.equal(calls[0].args.compact, true);
    assert.equal(calls[0].args.query, "Standup");
    assert.equal(data[0].notes, undefined);
  });

  it("creates all-day events with an exclusive iCloud end and timed events with a 1 h default", async () => {
    const { tool, calls } = await linuxClient({ create_event: (a) => ({ uid: "new-1", title: a.title }) });
    const allDay = await tool("calendar_create_event", { calendarId: CAL, title: "Off", start: "2026-12-24", end: "2026-12-26", allDay: true });
    assert.deepEqual(calls[0].args, { calendar: CAL, title: "Off", all_day: true, start: "2026-12-24", end: "2026-12-27" });
    assert.deepEqual(decodeEventId(allDay.data.id), { calendar: CAL, uid: "new-1" });
    await tool("calendar_create_event", { calendarId: CAL, title: "Call", start: "2026-12-01T10:00" });
    assert.equal(calls[1].args.end, "2026-12-01T11:00:00");
  });

  it("refuses an ambiguous change to a recurring event", async () => {
    const { tool, calls } = await linuxClient({
      get_event: () => ({ uid: "e1", start: "2026-11-18T09:00:00+01:00", end: "2026-11-18T09:15:00+01:00", recurrence: "FREQ=DAILY", etag: '"1"' }),
    });
    const eventId = encodeEventId({ calendar: CAL, uid: "e1" });
    await assert.rejects(tool("calendar_delete_event", { eventId }), /recurring event/);
    await assert.rejects(
      tool("calendar_update_event", { eventId, occurrenceStart: "2026-11-18T09:00:00+01:00", span: "futureEvents", title: "x" }),
      /not supported by iCloud/
    );
    assert.ok(calls.every((c) => c.tool === "get_event"));
  });

  it("moves an occurrence and keeps its duration", async () => {
    const { tool, calls } = await linuxClient({
      get_event: () => ({ uid: "e1", start: "2026-11-18T09:00:00+01:00", end: "2026-11-18T09:15:00+01:00", recurrence: "FREQ=DAILY", etag: '"1"' }),
      update_event: (a) => a,
    });
    const eventId = encodeEventId({ calendar: CAL, uid: "e1" });
    await tool("calendar_update_event", { eventId, occurrenceStart: "2026-11-19T09:00:00+01:00", start: "2026-11-19T10:00:00" });
    assert.deepEqual(calls[1].args, {
      calendar: CAL,
      uid: "e1",
      scope: "occurrence",
      recurrence_id: "2026-11-19T09:00:00+01:00",
      etag: '"1"',
      start: "2026-11-19T10:00:00",
      end: "2026-11-19T10:15:00",
    });
  });

  it("deletes a whole series only with span futureEvents", async () => {
    const { tool, calls } = await linuxClient({
      get_event: () => ({ uid: "e1", start: "2026-11-18", end: "2026-11-19", allDay: true, isRecurring: true }),
      delete_event: (a) => ({ deleted: true, ...a }),
    });
    await tool("calendar_delete_event", { eventId: encodeEventId({ calendar: CAL, uid: "e1" }), span: "futureEvents" });
    assert.deepEqual(calls[1].args, { calendar: CAL, uid: "e1", scope: "series" });
  });
});

describe("linux mail mapping", () => {
  const msg = (uid: number, flags: string[] = []) => ({
    mailbox: "INBOX",
    uid,
    uidValidity: 9,
    subject: `S${uid}`,
    from: [{ name: "Ann", address: "ann@example.invalid" }],
    flags,
    internalDate: "2026-11-20T08:00:00Z",
    modSeq: 100 + uid,
  });

  it("maps searchIn and pages with the UID cursor for offsets", async () => {
    const pages = [
      { messages: [msg(50), msg(49)], nextBeforeUid: 49, uidValidity: 9 },
      { messages: [msg(48), msg(47)], nextBeforeUid: 47, uidValidity: 9 },
    ];
    const { tool, calls } = await linuxClient({ search_messages: () => pages.shift() });
    const { data } = await tool("mail_search", { query: "Ann", searchIn: "sender", limit: 2, offset: 2 });
    assert.equal(calls[0].args.from, "Ann");
    assert.equal(calls[0].args.mailbox, "INBOX");
    assert.deepEqual(calls[1].args, { mailbox: "INBOX", from: "Ann", limit: 2, before_uid: 49, uid_validity: 9 });
    assert.deepEqual(data.messages.map((m: { subject: string }) => m.subject), ["S48", "S47"]);
    assert.equal(data.messages[0].sender, "Ann <ann@example.invalid>");
    assert.deepEqual(decodeMessageId(data.messages[0].id), { mailbox: "INBOX", uidValidity: 9, uid: 48 });
    assert.equal(data.hasMore, true);
  });

  it("refuses other accounts and all-mailbox searches", async () => {
    const { tool } = await linuxClient({});
    await assert.rejects(tool("mail_search", { query: "x", account: "Work" }), /only account is "iCloud"/);
    await assert.rejects(tool("mail_search", { query: "x", mailbox: "all" }), /not supported on Linux/);
  });

  it("moves a batch and returns the new ids", async () => {
    const { tool, calls } = await linuxClient({
      move_messages: () => ({ moved: [{ uid: 5, destinationUid: 900, destinationUidValidity: 3 }], complete: true }),
    });
    const id = encodeMessageId({ mailbox: "INBOX", uidValidity: 9, uid: 5 });
    const { data } = await tool("mail_move", { messageIds: [id], account: "iCloud", mailbox: "INBOX", targetMailbox: "Archive" });
    assert.deepEqual(calls[0].args, { mailbox: "INBOX", uid_validity: 9, uids: [5], destination: "Archive" });
    assert.deepEqual(decodeMessageId(data.moved[0].newId), { mailbox: "Archive", uidValidity: 3, uid: 900 });
  });

  it("refuses ids from another mailbox in one batch", async () => {
    const { tool } = await linuxClient({});
    const id = encodeMessageId({ mailbox: "Archive", uidValidity: 9, uid: 5 });
    await assert.rejects(
      tool("mail_move", { messageIds: [id], account: "iCloud", mailbox: "INBOX", targetMailbox: "Old" }),
      /not in "INBOX"/
    );
  });

  it("marks read with the MODSEQ it just read and skips messages already in that state", async () => {
    const state: Record<number, string[]> = { 1: [], 2: ["seen"] };
    const { tool, calls } = await linuxClient({
      get_message: (a) => msg(a.uid as number, state[a.uid as number]),
      set_message_flags: () => ({ ok: true }),
    });
    const ids = [1, 2].map((uid) => encodeMessageId({ mailbox: "INBOX", uidValidity: 9, uid }));
    const { data } = await tool("mail_mark_read", { messageIds: ids, account: "iCloud", mailbox: "INBOX", read: true });
    const writes = calls.filter((c) => c.tool === "set_message_flags");
    assert.equal(writes.length, 1);
    assert.deepEqual(writes[0].args, { mailbox: "INBOX", uid_validity: 9, uid: 1, operation: "add", flags: ["seen"], expected_modseq: 101 });
    assert.deepEqual(data.updated, ids);
  });

  it("converts list_messages dates to IMAP days", async () => {
    const { tool, calls } = await linuxClient({ search_messages: () => ({ messages: [] }) });
    await tool("mail_list_messages", { account: "iCloud", mailbox: "Archive", since: "2026-11-01", before: "2026-11-20T15:00:00" });
    assert.deepEqual(calls[0].args, { mailbox: "Archive", since: "2026-11-01", before: "2026-11-20", limit: 20 });
  });
});

describe("linux contacts mapping", () => {
  it("adds Orchard ids to search results and reads by id", async () => {
    const { tool, calls } = await linuxClient({
      search_contacts: () => ({ contacts: [{ addressBook: "card", uid: "c1", displayName: "Ann" }] }),
      get_contact: (a) => ({ addressBook: a.address_book, uid: a.uid, displayName: "Ann" }),
    });
    const { data } = await tool("contacts_search", { query: "Ann" });
    await tool("contacts_read_contact", { id: data[0].id });
    assert.deepEqual(calls[1].args, { address_book: "card", uid: "c1" });
  });
});

describe("icloud backend client", () => {
  const fixture = fileURLToPath(new URL("./fixtures/fake-icloud-mcp.mjs", import.meta.url));
  const env = icloudChildEnv({ ICLOUD_TEST_VALUE: "forwarded", ORCHARD_SECRET_PROBE: "must-not-leak", ICLOUD_MCP_DEFAULT_TZ: "Europe/Zurich" });
  const backend = new IcloudBackend(process.execPath, [fixture], env);
  after(() => backend.close());

  it("starts the child lazily and returns structured content", async () => {
    const data = await backend.call("list_calendars", {}, OPERATION_PROFILES.icloudCalendarRead);
    assert.deepEqual(data, { calendars: [{ path: "/1/calendars/home/", name: "Home" }], count: 1 });
  });

  it("forwards only ICLOUD_* variables", async () => {
    const data = await backend.call("env_probe", {}, OPERATION_PROFILES.icloudCalendarRead);
    assert.deepEqual(data, { icloudValue: "forwarded", tz: "Europe/Zurich", leaked: null });
  });

  it("turns tool errors into exceptions", async () => {
    await assert.rejects(
      backend.call("always_fails", {}, OPERATION_PROFILES.icloudCalendarRead),
      /icloud-mcp always_fails failed: permission_denied/
    );
  });

  it("explains a tool the permissions hide and keeps the connection", async () => {
    await assert.rejects(
      backend.call("create_event", {}, OPERATION_PROFILES.icloudCalendarWrite),
      /does not offer create_event.*ICLOUD_MCP_PERMISSIONS/
    );
    const data = await backend.call("list_calendars", {}, OPERATION_PROFILES.icloudCalendarRead);
    assert.equal((data as { count: number }).count, 1);
  });

  it("explains a missing ICLOUD_MCP_BIN", async () => {
    const missing = new IcloudBackend(undefined);
    await assert.rejects(missing.call("list_calendars", {}, OPERATION_PROFILES.icloudCalendarRead), /ICLOUD_MCP_BIN is not set/);
  });

  it("falls back to text when there is no structured content", () => {
    assert.deepEqual(unwrapToolResult("t", { content: [{ type: "text", text: '{"a":1}' }] }), { a: 1 });
  });
});
