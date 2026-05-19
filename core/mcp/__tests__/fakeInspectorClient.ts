/**
 * Test-only fake InspectorClient: an InspectorClientEventTarget subclass
 * implementing InspectorClientProtocol with stubbed methods. State and hook
 * tests inject this so they can drive events, queue paginated list responses,
 * and assert subscriber wiring without a real transport or SDK client.
 */

import { vi } from "vitest";
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
import { InspectorClientEventTarget } from "../inspectorClientEventTarget.js";
import type {
  AppRendererClient,
  InspectorClientProtocol,
} from "../inspectorClientProtocol.js";
import type {
  ConnectionStatus,
  PromptGetInvocation,
  ResourceReadInvocation,
  ResourceTemplateReadInvocation,
  ToolCallInvocation,
} from "../types.js";
import type { JsonValue } from "../../json/jsonUtils.js";

type ListResult<TKey extends string, TItem> = {
  [K in TKey]: TItem[];
} & { nextCursor?: string };

export interface FakeInspectorClientOptions {
  status?: ConnectionStatus;
  capabilities?: ServerCapabilities;
  serverInfo?: Implementation;
  instructions?: string;
}

export class FakeInspectorClient
  extends InspectorClientEventTarget
  implements InspectorClientProtocol
{
  private status: ConnectionStatus;
  private capabilities: ServerCapabilities | undefined;
  private serverInfo: Implementation | undefined;
  private instructions: string | undefined;
  private appRendererClient: AppRendererClient | null = null;
  private sessionId: string | undefined;

  // Each paginated method pulls from a queue of pre-canned pages. Tests push
  // pages with `queueToolPages(...)` etc. so they can assert pagination
  // accumulation without wiring a real server.
  toolPages: Array<ListResult<"tools", Tool>> = [];
  promptPages: Array<ListResult<"prompts", Prompt>> = [];
  resourcePages: Array<ListResult<"resources", Resource>> = [];
  resourceTemplatePages: Array<
    ListResult<"resourceTemplates", ResourceTemplate>
  > = [];
  taskPages: Array<ListResult<"tasks", Task>> = [];

  listTools = vi.fn(async () => this.toolPages.shift() ?? { tools: [] });
  listPrompts = vi.fn(async () => this.promptPages.shift() ?? { prompts: [] });
  listResources = vi.fn(
    async () => this.resourcePages.shift() ?? { resources: [] },
  );
  listResourceTemplates = vi.fn(
    async () =>
      this.resourceTemplatePages.shift() ?? { resourceTemplates: [] },
  );
  listRequestorTasks = vi.fn(
    async () => this.taskPages.shift() ?? { tasks: [] },
  );

  callTool = vi.fn(
    async (
      tool: Tool,
      params: Record<string, JsonValue>,
    ): Promise<ToolCallInvocation> => ({
      toolName: tool.name,
      params,
      result: null,
      timestamp: new Date(),
      success: true,
    }),
  );

  readResource = vi.fn(
    async (uri: string): Promise<ResourceReadInvocation> => ({
      result: { contents: [] },
      timestamp: new Date(),
      uri,
    }),
  );

  readResourceFromTemplate = vi.fn(
    async (
      uriTemplate: string,
      params: Record<string, string>,
    ): Promise<ResourceTemplateReadInvocation> => ({
      uriTemplate,
      expandedUri: uriTemplate,
      result: { contents: [] },
      timestamp: new Date(),
      params,
    }),
  );

  getPrompt = vi.fn(
    async (name: string): Promise<PromptGetInvocation> => ({
      result: { messages: [] },
      timestamp: new Date(),
      name,
    }),
  );

  setLoggingLevel = vi.fn(async (_level: LoggingLevel) => {});

  getCompletions = vi.fn(
    async (
      _ref:
        | { type: "ref/resource"; uri: string }
        | { type: "ref/prompt"; name: string },
      _argumentName: string,
      _argumentValue: string,
      _context?: Record<string, string>,
      _metadata?: Record<string, string>,
    ): Promise<{ values: string[]; total?: number; hasMore?: boolean }> => ({
      values: [],
    }),
  );

  constructor(options: FakeInspectorClientOptions = {}) {
    super();
    this.status = options.status ?? "disconnected";
    this.capabilities = options.capabilities;
    this.serverInfo = options.serverInfo;
    this.instructions = options.instructions;
  }

  getStatus(): ConnectionStatus {
    return this.status;
  }

  getCapabilities(): ServerCapabilities | undefined {
    return this.capabilities;
  }

  getServerInfo(): Implementation | undefined {
    return this.serverInfo;
  }

  getInstructions(): string | undefined {
    return this.instructions;
  }

  getAppRendererClient(): AppRendererClient | null {
    return this.appRendererClient;
  }

  async connect(): Promise<void> {
    this.setStatus("connecting");
    this.setStatus("connected");
    this.dispatchTypedEvent("connect");
  }

  async disconnect(): Promise<void> {
    this.setStatus("disconnected");
    this.dispatchTypedEvent("disconnect");
  }

  getSessionId(): string | undefined {
    return this.sessionId;
  }

  // ---- test helpers ----

  setStatus(status: ConnectionStatus): void {
    this.status = status;
    this.dispatchTypedEvent("statusChange", status);
  }

  setCapabilities(capabilities: ServerCapabilities | undefined): void {
    this.capabilities = capabilities;
    this.dispatchTypedEvent("capabilitiesChange", capabilities);
  }

  setServerInfo(info: Implementation | undefined): void {
    this.serverInfo = info;
    this.dispatchTypedEvent("serverInfoChange", info);
  }

  setInstructions(instructions: string | undefined): void {
    this.instructions = instructions;
    this.dispatchTypedEvent("instructionsChange", instructions);
  }

  setAppRendererClient(client: AppRendererClient | null): void {
    this.appRendererClient = client;
  }

  setSessionId(id: string | undefined): void {
    this.sessionId = id;
  }

  queueToolPages(...pages: Array<ListResult<"tools", Tool>>): void {
    this.toolPages.push(...pages);
  }

  queuePromptPages(...pages: Array<ListResult<"prompts", Prompt>>): void {
    this.promptPages.push(...pages);
  }

  queueResourcePages(
    ...pages: Array<ListResult<"resources", Resource>>
  ): void {
    this.resourcePages.push(...pages);
  }

  queueResourceTemplatePages(
    ...pages: Array<ListResult<"resourceTemplates", ResourceTemplate>>
  ): void {
    this.resourceTemplatePages.push(...pages);
  }

  queueTaskPages(...pages: Array<ListResult<"tasks", Task>>): void {
    this.taskPages.push(...pages);
  }
}
