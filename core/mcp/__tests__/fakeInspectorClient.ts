/**
 * Test-only fake InspectorClient: an InspectorClientEventTarget subclass
 * implementing InspectorClientProtocol with stubbed methods. State and hook
 * tests inject this so they can drive events, queue paginated list responses,
 * and assert subscriber wiring without a real transport or SDK client.
 */

import { vi } from "vitest";
import type {
  CacheMode,
  ClientCapabilities,
  DiscoverResult,
  Implementation,
  LoggingLevel,
  Prompt,
  ProtocolEra,
  Resource,
  ResourceTemplateType as ResourceTemplate,
  ServerCapabilities,
  Task,
  Tool,
} from "@modelcontextprotocol/client";
import { InspectorClientEventTarget } from "../inspectorClientEventTarget.js";
import type {
  AppRendererClient,
  InspectorClientProtocol,
} from "../inspectorClientProtocol.js";
import type { SamplingCreateMessage } from "../samplingCreateMessage.js";
import type { ElicitationCreateMessage } from "../elicitationCreateMessage.js";
import type {
  ConnectionStatus,
  InspectorServerSettings,
  PromptGetInvocation,
  ResourceReadInvocation,
  ResourceTemplateReadInvocation,
  ResourceSubscriptionStreamState,
  ToolCallInvocation,
} from "../types.js";
import { INACTIVE_SUBSCRIPTION_STREAM_STATE } from "../types.js";
import type { JsonValue } from "../../json/jsonUtils.js";

type ListResult<TKey extends string, TItem> = {
  [K in TKey]: TItem[];
} & { nextCursor?: string };

/**
 * Drain the entire queue of pre-canned pages for a list key and return the
 * flattened items — the aggregate `listAll*` mocks consume every queued page in
 * one call, mirroring the SDK's all-page walk (the single-page `list*` mocks
 * shift one page per call instead).
 */
function drainPages<TKey extends string, TItem>(
  pages: Array<ListResult<TKey, TItem>>,
  key: TKey,
): TItem[] {
  const items: TItem[] = [];
  while (pages.length > 0) {
    const page = pages.shift();
    if (page) items.push(...page[key]);
  }
  return items;
}

export interface FakeInspectorClientOptions {
  status?: ConnectionStatus;
  capabilities?: ServerCapabilities;
  clientCapabilities?: ClientCapabilities;
  serverInfo?: Implementation;
  instructions?: string;
  protocolVersion?: string;
  protocolEra?: ProtocolEra;
  discoverResult?: DiscoverResult;
  serverSettings?: InspectorServerSettings;
}

export class FakeInspectorClient
  extends InspectorClientEventTarget
  implements InspectorClientProtocol
{
  private status: ConnectionStatus;
  private capabilities: ServerCapabilities | undefined;
  private clientCapabilities: ClientCapabilities;
  private serverInfo: Implementation | undefined;
  private instructions: string | undefined;
  private protocolVersion: string | undefined;
  private protocolEra: ProtocolEra | undefined;
  private discoverResult: DiscoverResult | undefined;
  private serverSettings: InspectorServerSettings | undefined;
  private appRendererClient: AppRendererClient | null = null;
  private sessionId: string | undefined;
  private pendingSamples: SamplingCreateMessage[] = [];
  private pendingElicitations: ElicitationCreateMessage[] = [];

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
    async () => this.resourceTemplatePages.shift() ?? { resourceTemplates: [] },
  );
  listRequestorTasks = vi.fn(
    async () => this.taskPages.shift() ?? { tasks: [] },
  );

  // Aggregate variants used by the managed state stores on refresh: drain ALL
  // queued pages (mimicking the SDK's all-page walk) and return the flattened
  // list. The `options` (incl. `cacheMode`) is recorded by the `vi.fn` so tests
  // can assert a user/auto refresh forwarded `cacheMode: "refresh"`.
  listAllTools = vi.fn(
    async (_options?: {
      cacheMode?: CacheMode;
      metadata?: Record<string, string>;
    }) => ({ tools: drainPages(this.toolPages, "tools") }),
  );
  listAllPrompts = vi.fn(
    async (_options?: {
      cacheMode?: CacheMode;
      metadata?: Record<string, string>;
    }) => ({ prompts: drainPages(this.promptPages, "prompts") }),
  );
  listAllResources = vi.fn(
    async (_options?: {
      cacheMode?: CacheMode;
      metadata?: Record<string, string>;
    }) => ({ resources: drainPages(this.resourcePages, "resources") }),
  );
  listAllResourceTemplates = vi.fn(
    async (_options?: {
      cacheMode?: CacheMode;
      metadata?: Record<string, string>;
    }) => ({
      resourceTemplates: drainPages(
        this.resourceTemplatePages,
        "resourceTemplates",
      ),
    }),
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
    this.clientCapabilities = options.clientCapabilities ?? {};
    this.serverInfo = options.serverInfo;
    this.instructions = options.instructions;
    this.protocolVersion = options.protocolVersion;
    this.protocolEra = options.protocolEra;
    this.discoverResult = options.discoverResult;
    this.serverSettings = options.serverSettings;
  }

  getStatus(): ConnectionStatus {
    return this.status;
  }

  getCapabilities(): ServerCapabilities | undefined {
    return this.capabilities;
  }

  getClientCapabilities(): ClientCapabilities {
    return this.clientCapabilities;
  }

  getServerInfo(): Implementation | undefined {
    return this.serverInfo;
  }

  getInstructions(): string | undefined {
    return this.instructions;
  }

  getProtocolVersion(): string | undefined {
    return this.protocolVersion;
  }

  getProtocolEra(): ProtocolEra | undefined {
    return this.protocolEra;
  }

  getDiscoverResult(): DiscoverResult | undefined {
    return this.discoverResult;
  }

  resourceSubscriptionStreamState: ResourceSubscriptionStreamState =
    INACTIVE_SUBSCRIPTION_STREAM_STATE;

  getResourceSubscriptionStreamState(): ResourceSubscriptionStreamState {
    return this.resourceSubscriptionStreamState;
  }

  getServerSettings(): InspectorServerSettings | undefined {
    return this.serverSettings;
  }

  setServerSettings(settings: InspectorServerSettings): void {
    this.serverSettings = settings;
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

  getPendingSamples(): SamplingCreateMessage[] {
    return [...this.pendingSamples];
  }

  getPendingElicitations(): ElicitationCreateMessage[] {
    return [...this.pendingElicitations];
  }

  // ---- test helpers ----

  setPendingSamples(samples: SamplingCreateMessage[]): void {
    this.pendingSamples = [...samples];
    this.dispatchTypedEvent("pendingSamplesChange", this.pendingSamples);
  }

  setPendingElicitations(elicitations: ElicitationCreateMessage[]): void {
    this.pendingElicitations = [...elicitations];
    this.dispatchTypedEvent(
      "pendingElicitationsChange",
      this.pendingElicitations,
    );
  }

  setStatus(status: ConnectionStatus): void {
    this.status = status;
    this.dispatchTypedEvent("statusChange", status);
  }

  setCapabilities(capabilities: ServerCapabilities | undefined): void {
    this.capabilities = capabilities;
    this.dispatchTypedEvent("capabilitiesChange", capabilities);
  }

  setClientCapabilities(clientCapabilities: ClientCapabilities): void {
    this.clientCapabilities = clientCapabilities;
  }

  setServerInfo(info: Implementation | undefined): void {
    this.serverInfo = info;
    this.dispatchTypedEvent("serverInfoChange", info);
  }

  setInstructions(instructions: string | undefined): void {
    this.instructions = instructions;
    this.dispatchTypedEvent("instructionsChange", instructions);
  }

  setProtocolVersion(protocolVersion: string | undefined): void {
    this.protocolVersion = protocolVersion;
    this.dispatchTypedEvent("protocolVersionChange", protocolVersion);
  }

  setProtocolEra(protocolEra: ProtocolEra | undefined): void {
    this.protocolEra = protocolEra;
    this.dispatchTypedEvent("protocolEraChange", protocolEra);
  }

  setDiscoverResult(discoverResult: DiscoverResult | undefined): void {
    this.discoverResult = discoverResult;
    this.dispatchTypedEvent("discoverResultChange", discoverResult);
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

  queueResourcePages(...pages: Array<ListResult<"resources", Resource>>): void {
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
