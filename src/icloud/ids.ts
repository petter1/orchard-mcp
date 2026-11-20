/**
 * Orchard tools take one opaque id per object. iCloud needs several parts:
 * events (calendar path, UID), contacts (address book, UID), and messages
 * (mailbox, UIDVALIDITY, UID). These helpers pack the parts into one string.
 */

const PREFIX = { event: "ice1.", contact: "icc1.", message: "icm1." } as const;

type Kind = keyof typeof PREFIX;

function encode(kind: Kind, parts: Array<string | number>): string {
  return PREFIX[kind] + Buffer.from(JSON.stringify(parts), "utf8").toString("base64url");
}

function decode(kind: Kind, id: string, label: string): unknown[] {
  const prefix = PREFIX[kind];
  if (typeof id !== "string" || !id.startsWith(prefix)) {
    throw new Error(`Invalid ${label} id: use an id returned by an Orchard ${label} tool on this machine.`);
  }
  try {
    const parts = JSON.parse(Buffer.from(id.slice(prefix.length), "base64url").toString("utf8"));
    if (Array.isArray(parts)) return parts;
  } catch {
    // fall through to the error below
  }
  throw new Error(`Invalid ${label} id: it is damaged or was not issued by Orchard.`);
}

export interface EventRef {
  calendar: string;
  uid: string;
}

export function encodeEventId(ref: EventRef): string {
  return encode("event", [ref.calendar, ref.uid]);
}

export function decodeEventId(id: string): EventRef {
  const [calendar, uid] = decode("event", id, "event");
  if (typeof calendar !== "string" || typeof uid !== "string" || !calendar || !uid) {
    throw new Error("Invalid event id: missing calendar or UID.");
  }
  return { calendar, uid };
}

export interface ContactRef {
  addressBook: string;
  uid: string;
}

export function encodeContactId(ref: ContactRef): string {
  return encode("contact", [ref.addressBook, ref.uid]);
}

export function decodeContactId(id: string): ContactRef {
  const [addressBook, uid] = decode("contact", id, "contact");
  if (typeof addressBook !== "string" || typeof uid !== "string" || !addressBook || !uid) {
    throw new Error("Invalid contact id: missing address book or UID.");
  }
  return { addressBook, uid };
}

export interface MessageRef {
  mailbox: string;
  uidValidity: number;
  uid: number;
}

export function encodeMessageId(ref: MessageRef): string {
  return encode("message", [ref.mailbox, ref.uidValidity, ref.uid]);
}

export function decodeMessageId(id: string): MessageRef {
  const [mailbox, uidValidity, uid] = decode("message", id, "message");
  const positive = (n: unknown): n is number => Number.isInteger(n) && (n as number) > 0;
  if (typeof mailbox !== "string" || !mailbox || !positive(uidValidity) || !positive(uid)) {
    throw new Error("Invalid message id: missing mailbox, UIDVALIDITY, or UID.");
  }
  return { mailbox, uidValidity, uid };
}
