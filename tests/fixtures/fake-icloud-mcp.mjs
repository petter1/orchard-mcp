// Fake icloud-mcp for the Linux backend client test: a real stdio MCP server
// with three tools. No network, no credentials.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

const server = new McpServer({ name: "fake-icloud-mcp", version: "0.0.0" });

server.registerTool("list_calendars", { description: "fake" }, async () => ({
  content: [{ type: "text", text: "{}" }],
  structuredContent: {
    calendars: [{ path: "/1/calendars/home/", name: "Home" }],
    count: 1,
  },
}));

server.registerTool("env_probe", { description: "fake" }, async () => ({
  content: [
    {
      type: "text",
      text: JSON.stringify({
        icloudValue: process.env.ICLOUD_TEST_VALUE ?? null,
        tz: process.env.ICLOUD_MCP_DEFAULT_TZ ?? null,
        leaked: process.env.ORCHARD_SECRET_PROBE ?? null,
      }),
    },
  ],
}));

server.registerTool("always_fails", { description: "fake" }, async () => ({
  isError: true,
  content: [{ type: "text", text: "permission_denied: calendar.write is not granted" }],
}));

await server.connect(new StdioServerTransport());
