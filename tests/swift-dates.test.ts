import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("../", import.meta.url));

function hasSwiftc(): boolean {
  try {
    execFileSync("swiftc", ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

// Reason: regression for calendar day windows (#11). ISO8601DateFormatter
// defaults to GMT, which shifted local all-day events and date-only queries.
describe("Swift date helpers use local time", { skip: !hasSwiftc() && "swiftc not available" }, () => {
  it("formats and parses ISO 8601 in Europe/Zurich", () => {
    const dir = mkdtempSync(join(tmpdir(), "orchard-dates-"));
    try {
      const bin = join(dir, "dates_check");
      const env = { ...process.env, TZ: "Europe/Zurich" };
      execFileSync(
        "swiftc",
        ["-o", bin, join(repoRoot, "swift/Sources/AppleBridge/JSON.swift"), join(repoRoot, "tests/swift/dates/main.swift")],
        { env, stdio: "pipe" }
      );
      const out = execFileSync(bin, { env, encoding: "utf8" });
      assert.doesNotMatch(out, /FAIL/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
