/**
 * InspectorClientProtocol: the minimal surface that state managers (core/mcp/state/)
 * and React hooks (core/react/) consume.
 *
 * v1.5 has a single concrete `InspectorClient` class (~2k LOC) bundling the transport,
 * SDK client, OAuth flow, pending-request queues, and fetch tracking. Porting the full
 * class requires first porting the auth subsystem (core/auth/, ~12 files) — that's
 * deferred to a follow-up issue.
 *
 * This interface captures just what the state+hooks layer needs to function,
 * so the layer is decoupled from how (or whether) the runtime is wired up.
 * The real `InspectorClient` will implement this interface in the follow-up port.
 */

import type {
  ConnectionStatus,
  ResourceReadInvocation,
  ResourceTemplateReadInvocation,
  PromptGetInvocation,
  ToolCallInvocation,
} from "./types.js";
import type {
  Implementation,
  LoggingLevel,
  Prompt,
  Resource,
  ResourceTemplate,
  ServerCapabilities,
  Task,
  Tool,
} from "@modelcontextprotocol/sdk/types.js";
import type { JsonValue } from "../json/jsonUtils.js";
import type { InspectorClientEventTarget } from "./inspectorClientEventTarget.js";

/**
 * Opaque type representing the AppRendererClient surface used by @mcp-ui.
 * v1.5 aliases this to the SDK `Client` type; v2 leaves it opaque until the
 * real InspectorClient (or a focused App-renderer port) lands.
 */
export type AppRendererClient = unknown;

/**
 * The contract every state manager and hook depends on. Anything that holds
 * a reference to "an Inspector client" — including tests and fixtures —
 * should depend on this protocol rather than the concrete class.
 */
export interface InspectorClientProtocol extends InspectorClientEventTarget {
  // Connection state accessors
  getStatus(): ConnectionStatus;
  getCapabilities(): ServerCapabilities | undefined;
  getServerInfo(): Implementation | undefined;
  getInstructions(): string | undefined;
  getAppRendererClient(): AppRendererClient | null;

  // Connection control
  connect(): Promise<void>;
  disconnect(safeDisconnectTimeout?: number): Promise<void>;

  // Paginated list methods used by managed/paged state stores
  listTools(
    cursor?: string,
    metadata?: Record<string, string>,
  ): Promise<{ tools: Tool[]; nextCursor?: string }>;
  listPrompts(
    cursor?: string,
    metadata?: Record<string, string>,
  ): Promise<{ prompts: Prompt[]; nextCursor?: string }>;
  listResources(
    cursor?: string,
    metadata?: Record<string, string>,
  ): Promise<{ resources: Resource[]; nextCursor?: string }>;
  listResourceTemplates(
    cursor?: string,
    metadata?: Record<string, string>,
  ): Promise<{ resourceTemplates: ResourceTemplate[]; nextCursor?: string }>;
  listRequestorTasks(
    cursor?: string,
  ): Promise<{ tasks: Task[]; nextCursor?: string }>;

  // Invocation methods used by paged result panels
  callTool(
    tool: Tool,
    args: Record<string, JsonValue>,
    generalMetadata?: Record<string, string>,
    toolSpecificMetadata?: Record<string, string>,
  ): Promise<ToolCallInvocation>;
  readResource(
    uri: string,
    metadata?: Record<string, string>,
  ): Promise<ResourceReadInvocation>;
  readResourceFromTemplate(
    uriTemplate: string,
    params: Record<string, string>,
    metadata?: Record<string, string>,
  ): Promise<ResourceTemplateReadInvocation>;
  getPrompt(
    name: string,
    params?: Record<string, string>,
    metadata?: Record<string, string>,
  ): Promise<PromptGetInvocation>;

  // Misc surface required by hooks/state
  setLoggingLevel(level: LoggingLevel): Promise<void>;
  getSessionId(): string | undefined;
}
