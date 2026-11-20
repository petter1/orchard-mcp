import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerIcloudCalendarTools } from "./calendar.js";
import { IcloudBackend, type IcloudCaller } from "./client.js";
import { registerIcloudContactsTools } from "./contacts.js";
import { registerIcloudMailTools } from "./mail.js";
import { registerIcloudSystemTools } from "./system.js";

/**
 * Linux tool surface: Calendar, Contacts, and Mail through icloud-mcp, under
 * the same tool names as on macOS. Reminders, Notes, Files, and iWork have no
 * Linux backend and are not registered.
 */
export function registerIcloudTools(
  server: McpServer,
  call: IcloudCaller = new IcloudBackend().call
): void {
  registerIcloudCalendarTools(server, call);
  registerIcloudMailTools(server, call);
  registerIcloudSystemTools(server, call);
  registerIcloudContactsTools(server, call);
}
