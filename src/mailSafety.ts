export interface MailLocator {
  account?: string;
  mailbox?: string;
}

export function appendMailLocatorArgs(args: string[], locator: MailLocator): void {
  if (locator.account) {
    args.push("--account", locator.account);
  }
  if (locator.mailbox) {
    args.push("--mailbox", locator.mailbox);
  }
}

export function requireMailLocator(toolName: string, locator: MailLocator): void {
  if (!locator.account || !locator.mailbox) {
    throw new Error(
      `${toolName} requires account and mailbox from a recent mail.search, mail.unread_summary, or mail.flagged result. ` +
      "Refusing a bare message-id lookup because scanning every mailbox can make Mail.app unresponsive."
    );
  }
}

/** Upper bound for one mail.move call; larger batches go in several calls. */
export const MAIL_MOVE_MAX_IDS = 25;

/**
 * Validate a mailbox path for mail.create_mailbox. Nested mailboxes use "/".
 * Returns the trimmed path or throws with a reason the caller can act on.
 */
export function normalizeMailboxPath(raw: string): string {
  const path = raw.trim();
  if (!path) throw new Error("Mailbox name must not be empty.");
  if (path.length > 200) throw new Error("Mailbox name must be at most 200 characters.");
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(path)) {
    throw new Error("Mailbox name must not contain control characters.");
  }
  if (path.split("/").some((segment) => segment.trim() === "")) {
    throw new Error('Mailbox path segments must not be empty (check for leading, trailing, or double "/").');
  }
  return path;
}
