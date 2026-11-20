# App Safety Audit

orchard-mcp must protect the user's Mac first. A tool call is allowed to return less data or refuse an unsafe scope; it must not make Mail.app, Notes, Numbers, Pages, Keynote, Contacts, Calendar, Reminders, Spotlight, OCR, or the rest of the system unresponsive.

## Safety Policy

- All TypeScript tool handlers call `safeBridgeData(args, OPERATION_PROFILES.<profile>)`, never `bridgeData` directly.
- `OPERATION_PROFILES` in `src/safety.ts` assigns each operation to a lane, timeout, queue budget, and output-byte budget.
- GUI app lanes are serialized. Mail.app, Notes, Numbers, Pages, and Keynote each get one in-flight operation per lane.
- If an app lane is already busy past its queue budget, orchard-mcp refuses the new call before it touches the host app.
- Broad scopes are rejected before AppleScript/JXA, EventKit, Contacts, Spotlight, OCR, or file subprocesses start.
- `src/bridge.ts` enforces both timeout and output-size budgets when running `apple-bridge`.

## Current Risk Inventory

| Area | Host dependency | Guardrail |
| --- | --- | --- |
| Mail | Mail.app via AppleScript | `mail.save_attachment` requires account and mailbox locators. `mail.read_message` no longer scans every mailbox by default. `mail.list_accounts` returns bounded mailbox metadata without recursive unread counts. Broad body/all-field all-account all-mailbox search is refused. `mail.list_messages` requires one account and mailbox, reads headers only, and returns at most 200 messages per page. `mail.move` requires the source account and mailbox, looks up each message only in that mailbox, accepts at most 25 IDs per call, and verifies source and target mailboxes before moving anything. `mail.create_mailbox` validates the path before Mail.app is touched and is idempotent. `mail.set_flag` and `mail.mark_read` require account and mailbox, look up each message only in that mailbox, and accept at most 25 IDs per call. |
| Notes | Notes via AppleScript | Notes search defaults to title-only. Body/all search is refused because it scans every note plaintext. |
| Numbers | Numbers via AppleScript/JXA | `numbers.read` and `numbers.get_formulas` require an explicit cell range. Full-table reads are refused. |
| Pages | Pages via AppleScript | Calls are serialized through the Pages lane and bounded by timeout/output budgets. Large writes/tables are capped by schema. |
| Keynote | Keynote via AppleScript | PNG/JPEG export requires a slide index. All-slide image export is refused. Calls are serialized through the Keynote lane. |
| Calendar | EventKit | `calendar.list_events` and `calendar.search` refuse ranges over 31 days; the native bridge also caps date ranges and result counts. `calendar.create_event`/`update_event`/`delete_event` touch one event per call, refuse read-only calendars, and refuse to change a recurring series implicitly (an occurrence start or `span: futureEvents` is required). |
| Reminders | EventKit | List calls have bounded result limits in the schema and native bridge, and run through the Reminders lane. `reminders.update_reminder` changes one reminder by ID via EventKit (no list scan). |
| Contacts | Contacts.framework | Calls run through the Contacts lane and output budget. Phone substring fallback stops after a native scan budget. |
| Files | FileManager, Spotlight, PDFKit, Vision, textutil | Calls run through the Files lane. `files.move` accepts at most 50 items per call. `mdfind`, `mdls`, and `textutil` use native subprocess timeouts. PDF, OCR, directory listing, and textutil extraction have native size/page/item budgets. |

## Linux backend (icloud-mcp)

On Linux, Orchard has no host apps to protect; Calendar, Contacts, and Mail go
to iCloud through an `icloud-mcp` child process. The same guardrails apply:

- Every call runs through `runWithOperationProfile` with the `icloudCalendarRead`,
  `icloudCalendarWrite`, `icloudContactsRead`, `icloudMailRead`, `icloudMailWrite`,
  and `icloudSystem` entries in `OPERATION_PROFILES` (lane, timeout, queue, and
  output-size budget). Oversized results are refused.
- Calendar list/search ranges stay capped at 31 days; mail paging is bounded
  (at most 500 scanned summaries per call, 25 ids per batch).
- Ambiguous recurring changes are refused, as on macOS. Flag changes pass the
  MODSEQ just read so a concurrent change is detected, not overwritten.
- icloud-mcp itself is read-only unless `ICLOUD_MCP_PERMISSIONS` grants writes;
  Orchard forwards only `ICLOUD_*` variables and never reads credential values.

## Known Follow-Ups

- Add deeper iWork document-size checks where AppleScript can read metadata before expensive text extraction.

## Manual Smoke Checks

- Mail.app remains responsive while `mail.search` refuses a broad body/all-mailbox/all-account query.
- `mail.save_attachment` with only `messageId` is refused before Mail.app is touched.
- Notes refuses `searchIn: "body"` and still allows title search.
- Numbers refuses `numbers.read` without `range`.
- Keynote refuses PNG/JPEG export without `slide`.
- `files.move` refuses batches over 50 operations.
