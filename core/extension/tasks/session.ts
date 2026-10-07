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
 *
 * Accepts the value only in the shape ext-tasks itself accepts — a plain,
 * empty object — because the package starts a 2026-07-28 task session on
 * nothing else; a looser check here would show Tasks for a server the
 * attached session treats as unsupported.
 */
export function isTasksExtensionNegotiated(
  era: ProtocolEra | undefined,
  capabilities: ServerCapabilities | undefined,
): boolean {
  if (era !== "modern") return false;
  // Typed as unknown: the SDK types the value as an object, but a malformed
  // server can still send null, an array, or a scalar on the wire.
  const extension: unknown = capabilities?.extensions?.[TASKS_EXTENSION_KEY];
  return (
    extension !== null &&
    typeof extension === "object" &&
    !Array.isArray(extension) &&
    Object.keys(extension).length === 0
  );
}
