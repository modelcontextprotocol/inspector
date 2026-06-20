// The catalog/config → per-server-settings resolution is shared with the CLI in
// `@inspector/core/mcp/node` (see issue #1482). This module just re-exports it
// under the TUI's historical names so the TUI keeps a single import surface.
import type { ResolvedServer } from "@inspector/core/mcp/node/servers.js";

export {
  headersToServerSettings,
  loadServerEntries as loadTuiServers,
} from "@inspector/core/mcp/node/servers.js";

/** A server resolved for the TUI: transport config plus per-server settings. */
export type TuiServer = ResolvedServer;
