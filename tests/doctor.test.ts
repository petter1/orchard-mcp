import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { callBridge } from "../src/bridge.js";
import { doctorNeedsAppBundle } from "../src/tools/system.js";

const deniedReport = {
  status: "ok",
  data: {
    calendar: { status: "denied", granted: false },
    reminders: { status: "fullAccess", granted: true },
    contacts: { status: "authorized", granted: true },
  },
};

const appReport = {
  status: "ok",
  data: {
    calendar: { status: "fullAccess", granted: true },
    reminders: { status: "fullAccess", granted: true },
    contacts: { status: "authorized", granted: true },
    source: "app",
  },
};

describe("doctorNeedsAppBundle", () => {
  it("is true when calendar, reminders or contacts are not granted", () => {
    assert.equal(doctorNeedsAppBundle(deniedReport as never), true);
    assert.equal(
      doctorNeedsAppBundle({
        status: "ok",
        data: { contacts: { status: "notDetermined", granted: false } },
      }),
      true
    );
  });

  it("is false when every TCC service is granted or the data is not a report", () => {
    assert.equal(doctorNeedsAppBundle(appReport as never), false);
    assert.equal(doctorNeedsAppBundle({ status: "ok", data: null }), false);
    assert.equal(doctorNeedsAppBundle({ status: "ok", data: [1, 2] }), false);
    // Mail/Notes are Automation-gated, not TCC services the .app holds.
    assert.equal(
      doctorNeedsAppBundle({ status: "ok", data: { mail: { accessible: false } } }),
      false
    );
  });
});

describe("callBridge retryViaApp", () => {
  let tmpDir: string;
  const saved: Record<string, string | undefined> = {};

  before(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "orchard-doctor-"));
    for (const key of ["APPLE_BRIDGE_BIN", "APPLE_BRIDGE_APP", "PATH"]) {
      saved[key] = process.env[key];
    }

    const stubBin = join(tmpDir, "apple-bridge");
    await writeFile(
      stubBin,
      `#!/bin/sh\ncat <<'JSON'\n${JSON.stringify(deniedReport)}\nJSON\n`,
      { mode: 0o755 }
    );
    process.env.APPLE_BRIDGE_BIN = stubBin;

    // Fake macOS `open`: write the .app report to the --output file.
    const binDir = join(tmpDir, "bin");
    await mkdir(binDir);
    await writeFile(
      join(binDir, "open"),
      [
        "#!/bin/sh",
        'out=""',
        'while [ $# -gt 0 ]; do',
        '  if [ "$1" = "--output" ]; then out="$2"; shift; fi',
        "  shift",
        "done",
        `cat > "$out" <<'JSON'`,
        JSON.stringify(appReport),
        "JSON",
      ].join("\n") + "\n",
      { mode: 0o755 }
    );
    process.env.PATH = `${binDir}:${saved.PATH ?? ""}`;
  });

  after(async () => {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("returns the direct report when no retry predicate is given", async () => {
    const result = await callBridge(["doctor"]);
    assert.deepEqual(result, deniedReport);
  });

  it("re-runs doctor through the .app bundle when the predicate asks for it", async () => {
    const appDir = join(tmpDir, "AppleBridge.app");
    await mkdir(appDir, { recursive: true });
    process.env.APPLE_BRIDGE_APP = appDir;

    const result = await callBridge(["doctor"], { retryViaApp: doctorNeedsAppBundle });
    assert.deepEqual(result, appReport);
  });

  it("falls back to the direct report when the .app bundle is missing", async () => {
    process.env.APPLE_BRIDGE_APP = join(tmpDir, "missing.app");
    const result = await callBridge(["doctor"], { retryViaApp: doctorNeedsAppBundle });
    assert.deepEqual(result, deniedReport);
  });
});
