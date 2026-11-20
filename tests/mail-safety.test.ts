import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  appendMailLocatorArgs,
  MAIL_BATCH_MAX_IDS,
  normalizeMailboxPath,
  requireMailLocator,
} from "../src/mailSafety.js";

const repoRoot = new URL("../", import.meta.url);

function readRepoFile(path: string): string {
  return readFileSync(new URL(path, repoRoot), "utf8");
}

function swiftFunctionBody(name: string): string {
  const source = readRepoFile("swift/Sources/AppleBridge/Mail.swift");
  const start = source.indexOf(`static func ${name}`);
  assert.notEqual(start, -1, `${name} should exist`);
  const next = source.indexOf("\n    ///", start + 1);
  return source.slice(start, next === -1 ? source.length : next);
}

describe("mail locator safety", () => {
  it("requires account and mailbox before saving an attachment", () => {
    assert.throws(
      () => requireMailLocator("mail.save_attachment", {}),
      /requires account and mailbox/
    );
    assert.throws(
      () => requireMailLocator("mail.save_attachment", { account: "Proton" }),
      /requires account and mailbox/
    );
    assert.doesNotThrow(() =>
      requireMailLocator("mail.save_attachment", {
        account: "Proton",
        mailbox: "INBOX",
      })
    );
  });

  it("passes account and mailbox locators through to the Swift bridge", () => {
    const args = ["mail-save-attachment", "--id", "abc", "--index", "0"];
    appendMailLocatorArgs(args, { account: "Proton", mailbox: "INBOX" });
    assert.deepEqual(args, [
      "mail-save-attachment",
      "--id",
      "abc",
      "--index",
      "0",
      "--account",
      "Proton",
      "--mailbox",
      "INBOX",
    ]);
  });

  it("does not let message lookup fall back to every mailbox of every account", () => {
    assert.doesNotMatch(swiftFunctionBody("readMessage"), /repeat with acct in every account/);
    assert.doesNotMatch(swiftFunctionBody("saveAttachment"), /repeat with acct in every account/);
  });

  it("keeps account listing bounded and metadata-only", () => {
    const body = swiftFunctionBody("listAccounts");

    assert.match(body, /set mailboxLimit to 50/);
    assert.doesNotMatch(body, /on listMailboxes/);
    assert.doesNotMatch(body, /unread count of mbox/);
  });
});

describe("mail.create_mailbox path validation", () => {
  it("accepts plain and nested names and trims whitespace", () => {
    assert.equal(normalizeMailboxPath("  Receipts "), "Receipts");
    assert.equal(normalizeMailboxPath("Projects/2026"), "Projects/2026");
  });

  it("rejects empty names and empty path segments", () => {
    for (const bad of ["", "   ", "/Projects", "Projects/", "Projects//2026", "Projects/ /2026"]) {
      assert.throws(() => normalizeMailboxPath(bad), /must not be empty/, JSON.stringify(bad));
    }
  });

  it("rejects control characters and overlong names", () => {
    assert.throws(() => normalizeMailboxPath("a\nb"), /control characters/);
    assert.throws(() => normalizeMailboxPath("x".repeat(201)), /at most 200/);
  });
});

describe("mail.move bridge contract", () => {
  it("keeps the batch bounded", () => {
    assert.equal(MAIL_BATCH_MAX_IDS, 25);
  });

  it("looks messages up only in the given source mailbox and checks both mailboxes first", () => {
    const body = swiftFunctionBody("moveMessages");
    assert.match(body, /whose message id is theId/);
    assert.doesNotMatch(body, /every mailbox/);
    assert.ok(body.indexOf("ERROR_TARGET_NOT_FOUND") < body.indexOf("move targetMsg"));
    assert.ok(body.indexOf("ERROR_SOURCE_NOT_FOUND") < body.indexOf("move targetMsg"));
  });
});
