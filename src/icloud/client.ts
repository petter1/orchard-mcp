import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import {
  StdioClientTransport,
  getDefaultEnvironment,
} from "@modelcontextprotocol/sdk/client/stdio.js";
import { runWithOperationProfile, type OperationProfile } from "../safety.js";

/**
 * Calls one icloud-mcp tool and returns its structured result.
 * Tool modules depend on this signature only, so tests can inject a fake.
 */
export type IcloudCaller = (
  tool: string,
  args: Record<string, unknown>,
  profile: OperationProfile
) => Promise<unknown>;

/** Environment variable that points to the icloud-mcp binary. */
export const ICLOUD_MCP_BIN_ENV = "ICLOUD_MCP_BIN";

/**
 * Build the child environment: the SDK's safe defaults plus every ICLOUD_*
 * variable. Values are forwarded unread; credentials stay icloud-mcp's concern.
 */
export function icloudChildEnv(
  source: NodeJS.ProcessEnv = process.env
): Record<string, string> {
  const env: Record<string, string> = { ...getDefaultEnvironment() };
  for (const [key, value] of Object.entries(source)) {
    if (key.startsWith("ICLOUD_") && key !== ICLOUD_MCP_BIN_ENV && value !== undefined) {
      env[key] = value;
    }
  }
  // Reason: Orchard reads times without an offset as local time; icloud-mcp
  // defaults to UTC unless told the zone.
  if (!env.ICLOUD_MCP_DEFAULT_TZ) {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (zone) env.ICLOUD_MCP_DEFAULT_TZ = zone;
  }
  return env;
}

export class IcloudToolError extends Error {}

/**
 * icloud-mcp registers only the tools its permissions allow, so "tool not
 * found" almost always means a missing ICLOUD_MCP_PERMISSIONS token.
 */
export function explainCallError(tool: string, err: unknown): Error {
  const message = err instanceof Error ? err.message : String(err);
  if (/not found/i.test(message) && message.includes(tool)) {
    return new IcloudToolError(
      `icloud-mcp does not offer ${tool}. Enable the domain and permission in icloud-mcp ` +
        "(ICLOUD_MCP_ENABLE_CONTACTS / ICLOUD_MCP_ENABLE_MAIL, ICLOUD_MCP_PERMISSIONS such as calendar.write or mail.mutate)."
    );
  }
  return err instanceof Error ? err : new Error(message);
}

/**
 * Turn a CallTool result into data. icloud-mcp returns structuredContent for
 * every tool with an output schema; text is the fallback.
 */
export function unwrapToolResult(tool: string, result: unknown): unknown {
  const r = result as {
    isError?: boolean;
    structuredContent?: unknown;
    content?: Array<{ type: string; text?: string }>;
  };
  const text = (r.content ?? [])
    .filter((c) => c.type === "text" && typeof c.text === "string")
    .map((c) => c.text)
    .join("\n");
  if (r.isError) {
    throw explainCallError(tool, new IcloudToolError(`icloud-mcp ${tool} failed: ${text || "unknown error"}`));
  }
  if (r.structuredContent !== undefined) return r.structuredContent;
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/**
 * One lazily started icloud-mcp child process per Orchard server. A closed or
 * failed connection is dropped so the next call starts a fresh process.
 */
export class IcloudBackend {
  private client?: Promise<Client>;

  constructor(
    private readonly command: string | undefined = process.env[ICLOUD_MCP_BIN_ENV],
    private readonly args: string[] = [],
    private readonly env: Record<string, string> = icloudChildEnv()
  ) {}

  readonly call: IcloudCaller = (tool, args, profile) =>
    runWithOperationProfile(profile, async () => {
      const client = await this.connect();
      let result: unknown;
      try {
        result = await client.callTool({ name: tool, arguments: args }, undefined, {
          timeout: profile.timeoutMs,
        });
      } catch (err) {
        // Reason: a protocol error leaves the connection usable; a dead child
        // is dropped through client.onclose. Dropping it here would orphan it.
        throw explainCallError(tool, err);
      }
      const data = unwrapToolResult(tool, result);
      const limit = profile.maxOutputBytes;
      if (limit && Buffer.byteLength(JSON.stringify(data) ?? "") > limit) {
        throw new IcloudToolError(
          `icloud-mcp ${tool} returned more than ${limit} bytes; narrow the request.`
        );
      }
      return data;
    });

  async close(): Promise<void> {
    const pending = this.client;
    this.client = undefined;
    if (pending) await (await pending.catch(() => undefined))?.close();
  }

  private connect(): Promise<Client> {
    if (!this.command) {
      return Promise.reject(
        new IcloudToolError(
          `${ICLOUD_MCP_BIN_ENV} is not set. On Linux, Orchard needs the path to the icloud-mcp binary.`
        )
      );
    }
    if (!this.client) {
      const transport = new StdioClientTransport({
        command: this.command,
        args: this.args,
        env: this.env,
        stderr: "inherit",
      });
      const client = new Client({ name: "orchard-mcp", version: "icloud-backend" });
      client.onclose = () => this.reset();
      this.client = client.connect(transport).then(() => client);
      this.client.catch(() => {
        this.reset();
        void transport.close().catch(() => undefined);
      });
    }
    return this.client;
  }

  private reset(): void {
    this.client = undefined;
  }
}
