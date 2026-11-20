import { execFile } from "node:child_process";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { OPERATION_PROFILES, runWithOperationProfile } from "../safety.js";
import { ICLOUD_MCP_BIN_ENV, icloudChildEnv, type IcloudCaller } from "./client.js";
import { jsonText } from "./util.js";

const PROFILE = OPERATION_PROFILES.icloudSystem;

/** Run `icloud-mcp -doctor`: bounded, read-only probes against iCloud. */
function runDoctor(bin: string): Promise<unknown> {
  return new Promise((resolve) => {
    execFile(
      bin,
      ["-doctor", "-doctor-format", "json"],
      { env: icloudChildEnv(), timeout: PROFILE.timeoutMs - 5_000, maxBuffer: 1024 * 1024 },
      (error, stdout) => {
        const text = String(stdout ?? "").trim();
        try {
          resolve(JSON.parse(text));
        } catch {
          resolve({ ok: false, error: error?.message ?? "icloud-mcp -doctor returned no JSON", output: text.slice(0, 2_000) });
        }
      }
    );
  });
}

export function registerIcloudSystemTools(server: McpServer, call: IcloudCaller): void {
  server.tool(
    "system.doctor",
    "Check the Linux backend: icloud-mcp binary, enabled iCloud domains and tools, and read-only probes against iCloud.",
    {},
    async () => {
      const bin = process.env[ICLOUD_MCP_BIN_ENV];
      const report: Record<string, unknown> = {
        platform: process.platform,
        backend: "icloud-mcp",
        binary: bin ?? null,
      };
      if (!bin) {
        report.status = "error";
        report.error = `${ICLOUD_MCP_BIN_ENV} is not set.`;
        return jsonText(report);
      }
      try {
        report.capabilities = await call("icloud_capabilities", {}, PROFILE);
      } catch (err) {
        report.status = "error";
        report.error = err instanceof Error ? err.message : String(err);
        return jsonText(report);
      }
      report.probes = await runWithOperationProfile(PROFILE, () => runDoctor(bin));
      report.status = "ok";
      return jsonText(report);
    }
  );
}
