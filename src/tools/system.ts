import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  OPERATION_PROFILES,
  safeBridgeData,
  type BridgeResponse,
} from "../safety.js";

const TCC_SERVICES = ["calendar", "reminders", "contacts"] as const;

/**
 * True when a direct `doctor` run reports a TCC-gated service as not granted.
 * The bare CLI binary does not hold the grants that macOS gives to
 * AppleBridge.app, so the other tools (which fall back to the .app bundle)
 * work while a direct doctor run says "denied". Re-run doctor through the
 * .app bundle in that case so it reports what the tools actually see.
 */
export function doctorNeedsAppBundle(response: BridgeResponse): boolean {
  const data = response.data;
  if (data === null || typeof data !== "object") return false;
  const report = data as Record<string, unknown>;
  return TCC_SERVICES.some((service) => {
    const entry = report[service];
    return (
      entry !== null &&
      typeof entry === "object" &&
      (entry as Record<string, unknown>).granted === false
    );
  });
}

export function registerSystemTools(server: McpServer): void {
  server.tool(
    "system.doctor",
    "Check orchard-mcp permissions status, list accessible Calendar accounts, Mail accounts, and Reminders status. Run this first to diagnose access issues.",
    {},
    async () => {
      const data = await safeBridgeData(
        ["doctor"],
        OPERATION_PROFILES.systemDoctor,
        { retryViaApp: doctorNeedsAppBundle }
      );
      return {
        content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
      };
    }
  );
}
