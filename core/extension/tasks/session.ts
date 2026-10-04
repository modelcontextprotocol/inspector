/**
 * Inputs to an ext-tasks session that the Inspector derives from its own
 * connection: the stable endpoint identity task references are scoped to, and
 * whether the modern Tasks extension was negotiated at all.
 */
import type {
  Implementation,
  ProtocolEra,
  ServerCapabilities,
} from "@modelcontextprotocol/client";
import { createTaskSessionEndpointId } from "@modelcontextprotocol/ext-tasks/client";
import type { TaskSessionEndpointId } from "@modelcontextprotocol/ext-tasks/client";
import type { MCPServerConfig } from "../../mcp/types.js";
import { TASKS_EXTENSION_KEY } from "./constants.js";

/**
 * The endpoint id a task session scopes its serialized task references to:
 * the client identity plus the transport target, so a reference taken against
 * one server is never resumed against another.
 */
export function taskSessionEndpointId(
  config: MCPServerConfig,
  clientInfo: Implementation,
): Promise<TaskSessionEndpointId> {
  return createTaskSessionEndpointId(
    "inspector",
    config.type === "sse" || config.type === "streamable-http"
      ? {
          host: clientInfo,
          transport: { type: config.type, url: new URL(config.url).toString() },
        }
      : {
          host: clientInfo,
          transport: {
            type: "stdio",
            command: config.command,
            args: config.args,
            cwd: config.cwd ?? null,
          },
        },
  );
}

/**
 * True when the connection is modern (2026-07-28) AND the server advertised
 * the `io.modelcontextprotocol/tasks` extension (SEP-2663) in its
 * `server/discover` capabilities. Legacy servers use `capabilities.tasks`.
 */
export function isTasksExtensionNegotiated(
  era: ProtocolEra | undefined,
  capabilities: ServerCapabilities | undefined,
): boolean {
  return (
    era === "modern" &&
    capabilities?.extensions?.[TASKS_EXTENSION_KEY] !== undefined
  );
}
