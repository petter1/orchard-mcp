import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { MAIL_BATCH_MAX_IDS, normalizeMailboxPath } from "../mailSafety.js";
import { OPERATION_PROFILES } from "../safety.js";
import type { IcloudCaller } from "./client.js";
import { decodeMessageId, encodeMessageId, type MessageRef } from "./ids.js";
import { imapDay } from "./time.js";
import { jsonText } from "./util.js";

const READ = OPERATION_PROFILES.icloudMailRead;
const WRITE = OPERATION_PROFILES.icloudMailWrite;

/** The iCloud backend serves exactly one mail account. */
export const ICLOUD_ACCOUNT = "iCloud";
const INBOX = "INBOX";
/** icloud-mcp returns at most 50 summaries per page. */
const PAGE_MAX = 50;
/** Bound for offset paging: never walk more than this many summaries. */
const SCAN_MAX = 500;

interface Address {
  name?: string;
  address?: string;
}

interface IcloudMessage {
  mailbox: string;
  uid: number;
  uidValidity: number;
  subject?: string;
  from?: Address[] | null;
  to?: Address[] | null;
  cc?: Address[] | null;
  flags?: string[] | null;
  headerDate?: string | null;
  internalDate?: string;
  messageId?: string;
  size?: number;
  modSeq?: number;
}

interface SearchMessagesResult {
  messages?: IcloudMessage[] | null;
  nextBeforeUid?: number;
  uidValidity?: number;
  truncated?: boolean;
  scanLimitReached?: boolean;
}

function checkAccount(account: string | undefined): void {
  if (account && account !== ICLOUD_ACCOUNT) {
    throw new Error(`Unknown mail account "${account}". On Linux the only account is "${ICLOUD_ACCOUNT}".`);
  }
}

function formatAddresses(list: Address[] | null | undefined): string {
  return (list ?? [])
    .map((a) => (a.name ? `${a.name} <${a.address ?? ""}>` : a.address ?? ""))
    .filter(Boolean)
    .join(", ");
}

function hasFlag(flags: string[] | null | undefined, flag: "seen" | "flagged"): boolean {
  return (flags ?? []).some((f) => f.replace(/^\\/, "").toLowerCase() === flag);
}

export function toOrchardMessage(m: IcloudMessage): Record<string, unknown> {
  const out: Record<string, unknown> = {
    id: encodeMessageId({ mailbox: m.mailbox, uidValidity: m.uidValidity, uid: m.uid }),
    subject: m.subject ?? "",
    sender: formatAddresses(m.from),
    to: formatAddresses(m.to),
    date: m.headerDate ?? m.internalDate ?? "",
    read: hasFlag(m.flags, "seen"),
    flagged: hasFlag(m.flags, "flagged"),
    account: ICLOUD_ACCOUNT,
    mailbox: m.mailbox,
  };
  const cc = formatAddresses(m.cc);
  if (cc) out.cc = cc;
  if (m.messageId) out.messageId = m.messageId;
  if (m.size !== undefined) out.size = m.size;
  return out;
}

/**
 * Orchard pages with limit/offset; icloud-mcp with a descending UID cursor.
 * Walk cursor pages until offset + limit summaries are collected.
 */
export async function pageMessages(
  call: IcloudCaller,
  criteria: Record<string, unknown>,
  limit: number,
  offset: number
): Promise<{ messages: Record<string, unknown>[]; hasMore: boolean }> {
  const wanted = offset + limit;
  if (wanted > SCAN_MAX) {
    throw new Error(`offset + limit must be at most ${SCAN_MAX} on Linux; narrow the search with since/before.`);
  }
  const collected: IcloudMessage[] = [];
  let cursor: { before_uid: number; uid_validity: number } | undefined;
  let hasMore = false;
  while (collected.length < wanted) {
    const page = (await call(
      "search_messages",
      { ...criteria, limit: Math.min(PAGE_MAX, wanted - collected.length), ...cursor },
      READ
    )) as SearchMessagesResult;
    const messages = page?.messages ?? [];
    collected.push(...messages);
    hasMore = Boolean(page?.nextBeforeUid);
    if (!page?.nextBeforeUid || !page.uidValidity || messages.length === 0) break;
    cursor = { before_uid: page.nextBeforeUid, uid_validity: page.uidValidity };
  }
  return {
    messages: collected.slice(offset, wanted).map(toOrchardMessage),
    hasMore: hasMore || collected.length > wanted,
  };
}

const limitSchema = (max: number) =>
  z.number().int().min(1).max(max).optional().describe(`Max messages (default: 20, max: ${max})`);
const offsetSchema = z.number().int().min(0).optional().describe("Messages to skip (default: 0)");

function decodeBatch(ids: string[], mailbox: string): MessageRef[] {
  const refs = [...new Set(ids)].map(decodeMessageId);
  for (const ref of refs) {
    if (ref.mailbox !== mailbox) {
      throw new Error(`Message ${ref.uid} is in "${ref.mailbox}", not in "${mailbox}". One call handles one mailbox.`);
    }
  }
  return refs;
}

async function setStatus(
  call: IcloudCaller,
  ids: string[],
  account: string,
  mailbox: string,
  flag: "seen" | "flagged",
  on: boolean
) {
  checkAccount(account);
  const refs = decodeBatch(ids, mailbox);
  const updated: string[] = [];
  const notFound: string[] = [];
  const failed: Array<{ id: string; error: string }> = [];
  for (const ref of refs) {
    const id = encodeMessageId(ref);
    try {
      const current = (await call(
        "get_message",
        { mailbox: ref.mailbox, uid_validity: ref.uidValidity, uid: ref.uid, max_body_bytes: 1 },
        READ
      )) as IcloudMessage;
      if (hasFlag(current.flags, flag) !== on) {
        const request: Record<string, unknown> = {
          mailbox: ref.mailbox,
          uid_validity: ref.uidValidity,
          uid: ref.uid,
          operation: on ? "add" : "remove",
          flags: [flag],
        };
        // Reason: icloud-mcp requires the MODSEQ it just read when the server
        // supports CONDSTORE, so a concurrent change is detected, not overwritten.
        if (current.modSeq) request.expected_modseq = current.modSeq;
        await call("set_message_flags", request, WRITE);
      }
      updated.push(id);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (/not[_ ]found/i.test(message)) notFound.push(id);
      else failed.push({ id, error: message });
    }
  }
  return jsonText({ account: ICLOUD_ACCOUNT, mailbox, updated, notFound, failed });
}

const batchLocator = {
  messageIds: z
    .array(z.string().min(1))
    .min(1)
    .max(MAIL_BATCH_MAX_IDS)
    .describe(`Message ids (from mail_search etc.), 1 to ${MAIL_BATCH_MAX_IDS}, all from one mailbox`),
  account: z.string().min(1).describe(`Mail account ("${ICLOUD_ACCOUNT}" on Linux)`),
  mailbox: z.string().min(1).describe("Mailbox name from the search/list result"),
};

export function registerIcloudMailTools(server: McpServer, call: IcloudCaller): void {
  server.tool(
    "mail.list_accounts",
    `List mail accounts with a bounded sample of mailbox names. On Linux there is one account, "${ICLOUD_ACCOUNT}".`,
    {},
    async () => {
      const data = (await call("list_mailboxes", {}, READ)) as {
        mailboxes?: Array<{ name: string }> | null;
        truncated?: boolean;
      };
      const names = (data?.mailboxes ?? []).map((m) => m.name);
      return jsonText([
        {
          name: ICLOUD_ACCOUNT,
          mailboxes: names.slice(0, 50),
          mailboxCount: names.length,
          truncated: Boolean(data?.truncated) || names.length > 50,
        },
      ]);
    }
  );

  server.tool(
    "mail.unread_summary",
    "Unread messages in the iCloud inbox, newest first. On Linux only the inbox is scanned; unreadShown counts the returned page.",
    { limit: limitSchema(PAGE_MAX) },
    async ({ limit }) => {
      const { messages, hasMore } = await pageMessages(call, { mailbox: INBOX, unseen_only: true }, limit ?? 10, 0);
      return jsonText([
        { account: ICLOUD_ACCOUNT, mailbox: INBOX, unreadShown: messages.length, hasMore, messages },
      ]);
    }
  );

  server.tool(
    "mail.search",
    "Search one iCloud mailbox (default: INBOX) by subject, sender, or text. Mailbox 'all' is not supported on Linux.",
    {
      query: z.string().min(1).describe("Search term"),
      account: z.string().optional().describe(`Optional account ("${ICLOUD_ACCOUNT}")`),
      mailbox: z.string().optional().describe("Mailbox to search (default: INBOX)"),
      searchIn: z
        .enum(["subject", "sender", "body", "all"])
        .optional()
        .describe("subject, sender, or body/all (IMAP TEXT: headers and body). Default: all"),
      limit: limitSchema(200),
      offset: offsetSchema,
    },
    async ({ query, account, mailbox, searchIn, limit, offset }) => {
      checkAccount(account);
      if (mailbox?.toLowerCase() === "all") {
        throw new Error("mail_search across all mailboxes is not supported on Linux; search one mailbox at a time.");
      }
      const field = searchIn === "subject" ? "subject" : searchIn === "sender" ? "from" : "query";
      const result = await pageMessages(call, { mailbox: mailbox ?? INBOX, [field]: query }, limit ?? 20, offset ?? 0);
      return jsonText(result);
    }
  );

  server.tool(
    "mail.list_messages",
    "List an iCloud mailbox newest first, with paging and an optional date window (day granularity on Linux).",
    {
      account: z.string().min(1).describe(`Mail account ("${ICLOUD_ACCOUNT}")`),
      mailbox: z.string().min(1).describe('Mailbox name, e.g. "INBOX" or "Archive"'),
      since: z.string().optional().describe("Only messages received on or after this date (ISO 8601; day granularity)"),
      before: z.string().optional().describe("Only messages received before this date (ISO 8601; day granularity)"),
      limit: limitSchema(200),
      offset: offsetSchema,
    },
    async ({ account, mailbox, since, before, limit, offset }) => {
      checkAccount(account);
      const criteria: Record<string, unknown> = { mailbox };
      if (since) criteria.since = imapDay(since, "since");
      if (before) criteria.before = imapDay(before, "before");
      const lim = limit ?? 20;
      const off = offset ?? 0;
      const { messages, hasMore } = await pageMessages(call, criteria, lim, off);
      return jsonText({ account: ICLOUD_ACCOUNT, mailbox, messages, offset: off, limit: lim, hasMore });
    }
  );

  server.tool(
    "mail.read_message",
    "Read an iCloud message by id (from mail_search, mail_list_messages, mail_unread_summary, or mail_flagged). Returns headers, plain-text body, and attachment metadata.",
    {
      messageId: z.string().min(1).describe("Message id from a search/list result"),
      account: z.string().optional().describe(`Optional account ("${ICLOUD_ACCOUNT}")`),
      mailbox: z.string().optional().describe("Optional; the id already contains the mailbox"),
      maxBodyLength: z
        .number()
        .int()
        .min(0)
        .max(204_800)
        .optional()
        .describe("Max body bytes (default: 102400, max: 204800 on Linux)"),
    },
    async ({ messageId, account, maxBodyLength }) => {
      checkAccount(account);
      const ref = decodeMessageId(messageId);
      const request: Record<string, unknown> = { mailbox: ref.mailbox, uid_validity: ref.uidValidity, uid: ref.uid };
      if (maxBodyLength !== undefined) request.max_body_bytes = Math.max(1, maxBodyLength);
      const data = (await call("get_message", request, READ)) as IcloudMessage & Record<string, unknown>;
      return jsonText({ ...toOrchardMessage(data), ...data, id: messageId });
    }
  );

  server.tool(
    "mail.flagged",
    "List flagged messages in the iCloud inbox, newest first. On Linux only the inbox is scanned.",
    { limit: limitSchema(200), offset: offsetSchema },
    async ({ limit, offset }) => {
      const result = await pageMessages(call, { mailbox: INBOX, flagged_only: true }, limit ?? 20, offset ?? 0);
      return jsonText(result);
    }
  );

  server.tool(
    "mail.move",
    `Move up to ${MAIL_BATCH_MAX_IDS} iCloud messages from one mailbox to another. Trash and Junk are refused as targets. Returns each message's new id. Requires the mail.mutate permission in icloud-mcp.`,
    {
      ...batchLocator,
      targetMailbox: z.string().min(1).describe("Target mailbox name from mail_list_accounts"),
      targetAccount: z.string().optional().describe(`Optional; only "${ICLOUD_ACCOUNT}" on Linux`),
    },
    async ({ messageIds, account, mailbox, targetMailbox, targetAccount }) => {
      checkAccount(account);
      checkAccount(targetAccount);
      const refs = decodeBatch(messageIds, mailbox);
      const uidValidity = refs[0].uidValidity;
      if (refs.some((r) => r.uidValidity !== uidValidity)) {
        throw new Error("The mailbox changed its UIDVALIDITY; search again and use the new ids.");
      }
      const data = (await call(
        "move_messages",
        { mailbox, uid_validity: uidValidity, uids: refs.map((r) => r.uid), destination: targetMailbox },
        WRITE
      )) as {
        moved?: Array<{ uid: number; destinationUid?: number; destinationUidValidity?: number }> | null;
        failed?: { uid: number; code?: string; message?: string } | null;
        notAttempted?: number[] | null;
        complete?: boolean;
      };
      const idOf = (uid: number) => encodeMessageId({ mailbox, uidValidity, uid });
      const moved = (data?.moved ?? []).map((m) => ({
        id: idOf(m.uid),
        newId:
          m.destinationUid && m.destinationUidValidity
            ? encodeMessageId({ mailbox: targetMailbox, uidValidity: m.destinationUidValidity, uid: m.destinationUid })
            : undefined,
        account: ICLOUD_ACCOUNT,
        mailbox: targetMailbox,
      }));
      return jsonText({
        source: { account: ICLOUD_ACCOUNT, mailbox },
        target: { account: ICLOUD_ACCOUNT, mailbox: targetMailbox },
        moved,
        failed: data?.failed ? [{ id: idOf(data.failed.uid), error: data.failed.message ?? data.failed.code }] : [],
        notAttempted: (data?.notAttempted ?? []).map(idOf),
        complete: Boolean(data?.complete),
      });
    }
  );

  server.tool(
    "mail.create_mailbox",
    'Create an iCloud mailbox (folder). Nested names use "/" and need an existing parent. Idempotent: an existing mailbox returns created=false. Requires the mail.mutate permission in icloud-mcp.',
    {
      account: z.string().min(1).describe(`Mail account ("${ICLOUD_ACCOUNT}")`),
      name: z.string().describe('Mailbox name or path, e.g. "Receipts" or "Projects/2026"'),
    },
    async ({ account, name }) => {
      checkAccount(account);
      const data = await call("create_mailbox", { name: normalizeMailboxPath(name) }, WRITE);
      return jsonText(data);
    }
  );

  server.tool(
    "mail.set_flag",
    `Flag or unflag up to ${MAIL_BATCH_MAX_IDS} iCloud messages in one mailbox. Reports updated, notFound, and failed ids. Requires the mail.mutate permission in icloud-mcp.`,
    { ...batchLocator, flagged: z.boolean().describe("true to flag, false to remove the flag") },
    async ({ messageIds, account, mailbox, flagged }) => setStatus(call, messageIds, account, mailbox, "flagged", flagged)
  );

  server.tool(
    "mail.mark_read",
    `Mark up to ${MAIL_BATCH_MAX_IDS} iCloud messages in one mailbox as read or unread. Reports updated, notFound, and failed ids. Requires the mail.mutate permission in icloud-mcp.`,
    { ...batchLocator, read: z.boolean().describe("true to mark as read, false to mark as unread") },
    async ({ messageIds, account, mailbox, read }) => setStatus(call, messageIds, account, mailbox, "seen", read)
  );
}
