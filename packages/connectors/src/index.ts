/**
 * @steward/connectors: what Steward reaches outside itself with.
 *
 * - `createDemoGoogleApp` serves an invented Gmail and Calendar, so everything works with no account.
 * - `createGoogleMailCalendar` speaks Gmail v1 and Calendar v3, to the demo or to real Google.
 * - `createMcpManager` connects the MCP servers the person added and offers their granted tools.
 * - `createWebTools` reads public pages and searches the web, refusing private addresses.
 *
 * None of these decide whether anything may run. That is the gateway's job; these only act.
 */

export {
  createGoogleMailCalendar,
  type GmailEmail,
  type GmailEmailSummary,
  GoogleApiError,
  type GoogleMailCalendarOptions,
} from "./google/client.ts";

export { createDemoGoogleApp } from "./google/demo-app.ts";
export { DEMO_ACCOUNT, DEMO_LABEL, DEMO_TIME_ZONE } from "./google/demo-constants.ts";
export {
  createMcpManager,
  McpCallError,
  type McpManagerOptions,
  type McpServerConfig,
  type StewardMcpManager,
} from "./mcp/manager.ts";
export type { McpCallOutput } from "./mcp/result.ts";
export { migrations } from "./migrations.ts";
export {
  type AddressClass,
  BlockedAddressError,
  checkWebAddress,
  classifyHostname,
  type LookupFn,
} from "./net/address.ts";
export { createGuardedFetch, type FetchLike } from "./net/guarded-fetch.ts";
export { WebFetchError } from "./web/fetch-page.ts";
export { htmlToText } from "./web/html-to-text.ts";
export { WebSearchError } from "./web/search.ts";
export { createWebTools, STEWARD_USER_AGENT, type WebToolsOptions } from "./web/web-tools.ts";
