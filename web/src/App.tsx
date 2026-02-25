import {
  CompatibilityCallToolResult,
  CreateMessageResult,
  Resource,
  ResourceReference,
  PromptReference,
  Root,
  ServerNotification,
  Tool,
  LoggingLevel,
} from "@modelcontextprotocol/sdk/types.js";
import {
  hasValidMetaName,
  hasValidMetaPrefix,
  isReservedMetaKey,
} from "@/utils/metaUtils";
import { cacheToolOutputSchemas } from "./utils/schemaUtils";
import { cleanParams } from "./utils/paramUtils";
import type { JsonSchemaType } from "./utils/jsonUtils";
import type { JsonValue } from "@modelcontextprotocol/inspector-core/json/jsonUtils.js";
import React, {
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useInspectorClient } from "@modelcontextprotocol/inspector-core/react/useInspectorClient.js";
import {
  InspectorClient,
  type InspectorClientOptions,
} from "@modelcontextprotocol/inspector-core/mcp/index.js";
import {
  createWebEnvironment,
  type WebEnvironmentResult,
} from "./lib/adapters/environmentFactory";
import {
  API_SERVER_ENV_VARS,
  LEGACY_AUTH_TOKEN_ENV,
} from "@modelcontextprotocol/inspector-core/mcp/remote/index.js";
import { RemoteInspectorClientStorage } from "@modelcontextprotocol/inspector-core/mcp/remote/index.js";
import { parseOAuthState } from "@modelcontextprotocol/inspector-core/auth/index.js";
import { webConfigToMcpServerConfig } from "./lib/adapters/configAdapter";
import { useToast } from "./lib/hooks/useToast";
import {
  useDraggablePane,
  useDraggableSidebar,
} from "./lib/hooks/useDraggablePane";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import {
  AppWindow,
  Bell,
  Files,
  FolderTree,
  Hammer,
  Hash,
  Key,
  MessageSquare,
  Network,
  Settings,
  Terminal,
} from "lucide-react";

import "./App.css";
import AuthDebugger from "./components/AuthDebugger";
import ConsoleTab from "./components/ConsoleTab";
import HistoryAndNotifications from "./components/HistoryAndNotifications";
import PingTab from "./components/PingTab";
import PromptsTab, { Prompt } from "./components/PromptsTab";
import RequestsTab from "./components/RequestsTab";
import ResourcesTab from "./components/ResourcesTab";
import RootsTab from "./components/RootsTab";
import SamplingTab, { PendingRequest } from "./components/SamplingTab";
import Sidebar from "./components/Sidebar";
import ToolsTab from "./components/ToolsTab";
import AppsTab from "./components/AppsTab";
import { InspectorConfig } from "./lib/configurationTypes";
import {
  getInitialSseUrl,
  getInitialTransportType,
  getInitialCommand,
  getInitialArgs,
  getInspectorApiToken,
  getMCPTaskTtl,
  initializeInspectorConfig,
  removeAuthTokenFromUrl,
  saveInspectorConfig,
} from "./utils/configUtils";
import ElicitationTab, {
  PendingElicitationRequest,
  ElicitationResponse,
} from "./components/ElicitationTab";
import {
  CustomHeaders,
  migrateFromLegacyAuth,
} from "./lib/types/customHeaders";
import MetadataTab from "./components/MetadataTab";
import TokenLoginScreen from "./components/TokenLoginScreen";

const CONFIG_LOCAL_STORAGE_KEY = "inspectorConfig_v1";

const filterReservedMetadata = (
  metadata: Record<string, string>,
): Record<string, string> => {
  return Object.entries(metadata).reduce<Record<string, string>>(
    (acc, [key, value]) => {
      if (
        !isReservedMetaKey(key) &&
        hasValidMetaPrefix(key) &&
        hasValidMetaName(key)
      ) {
        acc[key] = value;
      }
      return acc;
    },
    {},
  );
};

const App = () => {
  const [resourceContent, setResourceContent] = useState<string>("");
  const [resourceContentMap, setResourceContentMap] = useState<
    Record<string, string>
  >({});
  const [promptContent, setPromptContent] = useState<string>("");
  const [toolResult, setToolResult] =
    useState<CompatibilityCallToolResult | null>(null);
  const [errors, setErrors] = useState<Record<string, string | null>>({
    resources: null,
    prompts: null,
    tools: null,
  });
  const [command, setCommand] = useState<string>(getInitialCommand);
  const [args, setArgs] = useState<string>(getInitialArgs);

  const [sseUrl, setSseUrl] = useState<string>(getInitialSseUrl);
  const [sandboxUrl, setSandboxUrl] = useState<string | undefined>(undefined);
  const [transportType, setTransportType] = useState<
    "stdio" | "sse" | "streamable-http"
  >(getInitialTransportType);
  const [logLevel, setLogLevel] = useState<LoggingLevel>("debug");
  const [notifications, setNotifications] = useState<ServerNotification[]>([]);
  const [roots, setRoots] = useState<Root[]>([]);
  const [env, setEnv] = useState<Record<string, string>>({});
  const [cwd, setCwd] = useState<string>("");

  const [isPollingTask, setIsPollingTask] = useState(false);
  const [config, setConfig] = useState<InspectorConfig>(() =>
    initializeInspectorConfig(CONFIG_LOCAL_STORAGE_KEY),
  );
  // Config fetch: always fetch on load; 200 → main app, 401 → token screen; retry on token submit
  const [configFetchStatus, setConfigFetchStatus] = useState<
    "loading" | "ok" | "need_token"
  >("loading");
  const [configFetchError, setConfigFetchError] = useState<string | null>(null);
  const [configFetchTrigger, setConfigFetchTrigger] = useState(0);
  const [authAcceptedWithoutToken, setAuthAcceptedWithoutToken] =
    useState(false);
  const [bearerToken, setBearerToken] = useState<string>(() => {
    return localStorage.getItem("lastBearerToken") || "";
  });

  const [headerName, setHeaderName] = useState<string>(() => {
    return localStorage.getItem("lastHeaderName") || "";
  });

  const [oauthClientId, setOauthClientId] = useState<string>(() => {
    return localStorage.getItem("lastOauthClientId") || "";
  });

  const [oauthScope, setOauthScope] = useState<string>(() => {
    return localStorage.getItem("lastOauthScope") || "";
  });

  const [oauthClientSecret, setOauthClientSecret] = useState<string>(() => {
    return localStorage.getItem("lastOauthClientSecret") || "";
  });

  const [oauthClientMetadataUrl, setOauthClientMetadataUrl] = useState<string>(
    () => {
      return localStorage.getItem("lastOauthClientMetadataUrl") || "";
    },
  );

  // Custom headers state with migration from legacy auth
  const [customHeaders, setCustomHeaders] = useState<CustomHeaders>(() => {
    const savedHeaders = localStorage.getItem("lastCustomHeaders");
    if (savedHeaders) {
      try {
        return JSON.parse(savedHeaders);
      } catch (error) {
        console.warn(
          `Failed to parse custom headers: "${savedHeaders}", will try legacy migration`,
          error,
        );
        // Fall back to migration if JSON parsing fails
      }
    }

    // Migrate from legacy auth if available
    const legacyToken = localStorage.getItem("lastBearerToken") || "";
    const legacyHeaderName = localStorage.getItem("lastHeaderName") || "";

    if (legacyToken) {
      return migrateFromLegacyAuth(legacyToken, legacyHeaderName);
    }

    // Default to empty array
    return [
      {
        name: "Authorization",
        value: "Bearer ",
        enabled: false,
      },
    ];
  });

  const [pendingSampleRequests, setPendingSampleRequests] = useState<
    Array<
      PendingRequest & {
        resolve: (result: CreateMessageResult) => void;
        reject: (error: Error) => void;
      }
    >
  >([]);
  const [pendingElicitationRequests, setPendingElicitationRequests] = useState<
    Array<
      PendingElicitationRequest & {
        resolve: (response: ElicitationResponse) => void;
        decline: (error: Error) => void;
      }
    >
  >([]);
  const [isAuthDebuggerVisible, setIsAuthDebuggerVisible] = useState(false);

  // Metadata state - persisted in localStorage
  const [metadata, setMetadata] = useState<Record<string, string>>(() => {
    const savedMetadata = localStorage.getItem("lastMetadata");
    if (savedMetadata) {
      try {
        const parsed = JSON.parse(savedMetadata);
        if (parsed && typeof parsed === "object") {
          return filterReservedMetadata(parsed);
        }
      } catch (error) {
        console.warn("Failed to parse saved metadata:", error);
      }
    }
    return {};
  });

  const handleMetadataChange = (newMetadata: Record<string, string>) => {
    const sanitizedMetadata = filterReservedMetadata(newMetadata);
    setMetadata(sanitizedMetadata);
    localStorage.setItem("lastMetadata", JSON.stringify(sanitizedMetadata));
  };
  const rootsRef = useRef<Root[]>([]);

  const [selectedResource, setSelectedResource] = useState<Resource | null>(
    null,
  );
  const [resourceSubscriptions, setResourceSubscriptions] = useState<
    Set<string>
  >(new Set<string>());

  const [selectedPrompt, setSelectedPrompt] = useState<Prompt | null>(null);
  const [selectedTool, setSelectedTool] = useState<Tool | null>(null);
  const [nextResourceCursor, setNextResourceCursor] = useState<
    string | undefined
  >();
  const [nextResourceTemplateCursor, setNextResourceTemplateCursor] = useState<
    string | undefined
  >();
  const [nextPromptCursor, setNextPromptCursor] = useState<
    string | undefined
  >();
  const [nextToolCursor, setNextToolCursor] = useState<string | undefined>();
  const progressTokenRef = useRef(0);

  const [activeTab, setActiveTab] = useState<string>(() => {
    const hash = window.location.hash.slice(1);
    const initialTab = hash || "resources";
    return initialTab;
  });

  const currentTabRef = useRef<string>(activeTab);
  const lastToolCallOriginTabRef = useRef<string>(activeTab);

  useEffect(() => {
    currentTabRef.current = activeTab;
  }, [activeTab]);

  const { height: historyPaneHeight, handleDragStart } = useDraggablePane(300);
  const {
    width: sidebarWidth,
    isDragging: isSidebarDragging,
    handleDragStart: handleSidebarDragStart,
  } = useDraggableSidebar(320);

  // InspectorClient is created lazily when needed (connect/auth operations)
  const [inspectorClient, setInspectorClient] =
    useState<InspectorClient | null>(null);
  // Same logger passed to InspectorClient (from createWebEnvironment); exposed for AuthDebugger/OAuthCallback
  const [inspectorLogger, setInspectorLogger] = useState<
    WebEnvironmentResult["logger"] | null
  >(null);
  // Track the token used to create the current inspectorClient
  const inspectorClientTokenRef = useRef<string | undefined>(undefined);

  const { toast } = useToast();

  // Helper function to ensure InspectorClient exists and is created with current token
  // We use a ref to always read the latest config value, avoiding stale closure issues
  const configRef = useRef(config);
  // Update ref synchronously whenever config changes (before useEffect runs)
  configRef.current = config;

  // True only when the last config fetch was triggered by the user submitting the token form (so we only show "Token incorrect." for 401 after submit, not on initial load)
  const tokenSubmitCausedLastFetchRef = useRef(false);

  // Ref so the config-fetch callback can apply state to the current mount (avoids Strict Mode unmount dropping updates)
  const applyConfigRef = useRef({
    setConfigFetchStatus,
    setConfigFetchError,
    setAuthAcceptedWithoutToken,
    setEnv,
    setCommand,
    setArgs,
    setTransportType,
    setSseUrl,
    setSandboxUrl,
    setCwd,
  });
  applyConfigRef.current = {
    setConfigFetchStatus,
    setConfigFetchError,
    setAuthAcceptedWithoutToken,
    setEnv,
    setCommand,
    setArgs,
    setTransportType,
    setSseUrl,
    setSandboxUrl,
    setCwd,
  };

  // Helper to check if we can create InspectorClient (without actually creating it)
  const canCreateInspectorClient = useCallback((): boolean => {
    const currentConfig = configRef.current;
    const configItem = currentConfig.MCP_INSPECTOR_API_TOKEN;
    const tokenValue = configItem?.value;
    const tokenString =
      typeof tokenValue === "string" ? tokenValue : String(tokenValue || "");
    const currentToken = tokenString.trim() || undefined;
    return !!currentToken && (!!command || !!sseUrl);
  }, [command, sseUrl]);

  const ensureInspectorClient = useCallback((): InspectorClient | null => {
    // Read current token from config ref to ensure we always get the latest value
    const currentConfig = configRef.current;
    const configItem = currentConfig.MCP_INSPECTOR_API_TOKEN;
    const tokenValue = configItem?.value;

    // Handle different value types (string, number, boolean, etc.)
    const tokenString =
      typeof tokenValue === "string" ? tokenValue : String(tokenValue || "");
    const currentToken = tokenString.trim() || undefined;

    // Allow no token only when server already accepted us without one (e.g. DANGEROUSLY_OMIT_AUTH)
    if (!currentToken && !authAcceptedWithoutToken) {
      toast({
        title: "API Token Required",
        description: "Please set the API Token in Configuration to connect.",
        variant: "destructive",
      });
      return null;
    }

    // Check if server config is set (handle empty strings)
    const hasCommand = command && command.trim().length > 0;
    const hasSseUrl = sseUrl && sseUrl.trim().length > 0;

    if (!hasCommand && !hasSseUrl) {
      toast({
        title: "Server Configuration Required",
        description: "Please configure the server command or URL.",
        variant: "destructive",
      });
      return null;
    }

    // If inspectorClient exists, check if token changed
    if (inspectorClient && inspectorClientTokenRef.current !== currentToken) {
      toast({
        title: "API Token Changed",
        description: "API token has changed. Please disconnect and reconnect.",
        variant: "destructive",
      });
      return null;
    }

    // If inspectorClient exists and token matches, return it
    if (inspectorClient && inspectorClientTokenRef.current === currentToken) {
      return inspectorClient;
    }

    // Extract sessionId from OAuth callback if present
    let sessionId: string | undefined;
    const urlParams = new URLSearchParams(window.location.search);
    const stateParam = urlParams.get("state");
    if (stateParam) {
      const parsedState = parseOAuthState(stateParam);
      if (parsedState?.authId) {
        sessionId = parsedState.authId;
      }
    }

    // Create new InspectorClient
    try {
      const mcpConfig = webConfigToMcpServerConfig(
        transportType,
        command,
        args,
        sseUrl,
        env,
        customHeaders,
        cwd,
      );

      const redirectUrlProvider = {
        getRedirectUrl: () => `${window.location.origin}/oauth/callback`,
      };

      const { environment, logger } = createWebEnvironment(
        currentToken,
        redirectUrlProvider,
      );
      setInspectorLogger(logger !== undefined ? logger : null);

      // Create session storage for persisting state across OAuth redirects
      const baseUrl = `${window.location.protocol}//${window.location.host}`;
      const fetchFn: typeof fetch = (...args) => globalThis.fetch(...args);
      const sessionStorage = new RemoteInspectorClientStorage({
        baseUrl,
        authToken: currentToken,
        fetchFn,
      });

      // Only include oauth config if at least one OAuth field is provided
      // This prevents InspectorClient from initializing OAuth when not needed
      const hasOAuthConfig =
        oauthClientId ||
        oauthClientSecret ||
        oauthScope ||
        oauthClientMetadataUrl;

      const clientOptions: InspectorClientOptions = {
        environment,
        autoSyncLists: false,
        maxMessages: 1000,
        maxStderrLogEvents: 1000,
        maxFetchRequests: 1000,
        sessionStorage,
        sessionId,
        receiverTasks: true,
        receiverTaskTtlMs: getMCPTaskTtl(currentConfig),
        elicit: { form: true, url: true },
      };

      if (hasOAuthConfig) {
        clientOptions.oauth = {
          clientId: oauthClientId || undefined,
          clientSecret: oauthClientSecret || undefined,
          clientMetadataUrl: oauthClientMetadataUrl || undefined,
          scope: oauthScope || undefined,
        };
      }

      const client = new InspectorClient(mcpConfig, clientOptions);
      inspectorClientTokenRef.current = currentToken;
      setInspectorClient(client);
      return client;
    } catch (error) {
      toast({
        title: "Failed to Create Client",
        description: error instanceof Error ? error.message : String(error),
        variant: "destructive",
      });
      return null;
    }
  }, [
    command,
    sseUrl,
    transportType,
    args,
    env,
    customHeaders,
    cwd,
    oauthClientId,
    oauthClientSecret,
    oauthClientMetadataUrl,
    oauthScope,
    inspectorClient,
    toast,
    authAcceptedWithoutToken,
  ]);

  // Use InspectorClient hook
  const {
    status: connectionStatus,
    capabilities: serverCapabilities,
    serverInfo: serverImplementation,
    appRendererClient,
    messages: inspectorMessages,
    stderrLogs,
    fetchRequests,
    tools: inspectorTools,
    resources: inspectorResources,
    resourceTemplates: inspectorResourceTemplates,
    prompts: inspectorPrompts,
    disconnect: disconnectMcpServer,
  } = useInspectorClient(inspectorClient);

  // Server supports task-augmented tools/call per SDK: capabilities.tasks.requests.tools.call
  const serverSupportsTaskToolCalls = useMemo(
    () => !!serverCapabilities?.tasks?.requests?.tools?.call,
    [serverCapabilities?.tasks?.requests?.tools?.call],
  );

  // Wrap connect to ensure InspectorClient exists first; show toast on error
  const connectMcpServer = useCallback(async () => {
    const client = ensureInspectorClient();
    if (!client) return; // Error already shown in ensureInspectorClient

    try {
      await client.connect();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      toast({
        title: "Connection failed",
        description: message,
        variant: "destructive",
      });
      if (client.getStatus() === "connecting") {
        await client.disconnect();
      }
    }
  }, [ensureInspectorClient, toast]);

  // Extract server notifications from messages
  // Use useMemo to stabilize the array reference and prevent infinite loops
  const extractedNotifications = useMemo(() => {
    return inspectorMessages
      .filter((msg) => msg.direction === "notification" && msg.message)
      .map((msg) => msg.message as ServerNotification);
  }, [inspectorMessages]);

  // Use ref to track previous serialized value to prevent infinite loops
  const previousNotificationsRef = useRef<string>("[]");

  useEffect(() => {
    // Compare by serializing to avoid infinite loops from reference changes
    const currentSerialized = JSON.stringify(extractedNotifications);
    if (currentSerialized !== previousNotificationsRef.current) {
      setNotifications(extractedNotifications);
      previousNotificationsRef.current = currentSerialized;
    }
  }, [extractedNotifications]);

  // Set up event listeners for sampling and elicitation
  useEffect(() => {
    if (!inspectorClient) return;

    // Handle sampling requests
    const handleNewPendingSample = (event: CustomEvent) => {
      const sample = event.detail;
      const numericId = getNumericId(sample.id);
      setPendingSampleRequests((prev) => [
        ...prev,
        {
          id: numericId,
          request: sample.request,
          resolve: async (result: CreateMessageResult) => {
            await sample.respond(result);
          },
          reject: async (error: Error) => {
            await sample.reject(error);
          },
        },
      ]);
    };

    // Handle elicitation requests
    const handleNewPendingElicitation = (event: CustomEvent) => {
      const elicitation = event.detail;
      const currentTab = lastToolCallOriginTabRef.current;
      const numericId = getNumericId(elicitation.id);
      const params = elicitation.request.params ?? {};
      const isUrl = params.mode === "url";

      const baseItem = {
        id: numericId,
        elicitationId: elicitation.id as string,
        originatingTab: currentTab,
        resolve: async (result: ElicitationResponse) => {
          await elicitation.respond(result);
        },
        decline: async (error: Error) => {
          elicitation.reject(error);
          elicitation.remove();
          console.error("Elicitation request rejected:", error);
        },
      };

      if (isUrl) {
        setPendingElicitationRequests((prev) => [
          ...prev,
          {
            ...baseItem,
            request: {
              mode: "url",
              id: numericId,
              message: params.message as string,
              url: params.url as string,
              elicitationId: params.elicitationId as string,
            },
          },
        ]);
      } else {
        setPendingElicitationRequests((prev) => [
          ...prev,
          {
            ...baseItem,
            request: {
              mode: "form",
              id: numericId,
              message: params.message as string,
              requestedSchema: params.requestedSchema,
            },
          },
        ]);
      }

      setActiveTab("elicitations");
      window.location.hash = "elicitations";
    };

    const handlePendingElicitationsChange = () => {
      const stillPending = inspectorClient.getPendingElicitations();
      const pendingIds = new Set(stillPending.map((e) => e.id));
      setPendingElicitationRequests((prev) =>
        prev.filter((r) => pendingIds.has(r.elicitationId)),
      );
    };

    inspectorClient.addEventListener(
      "newPendingSample",
      handleNewPendingSample,
    );
    inspectorClient.addEventListener(
      "newPendingElicitation",
      handleNewPendingElicitation,
    );
    inspectorClient.addEventListener(
      "pendingElicitationsChange",
      handlePendingElicitationsChange,
    );

    return () => {
      inspectorClient.removeEventListener(
        "newPendingSample",
        handleNewPendingSample,
      );
      inspectorClient.removeEventListener(
        "newPendingElicitation",
        handleNewPendingElicitation,
      );
      inspectorClient.removeEventListener(
        "pendingElicitationsChange",
        handlePendingElicitationsChange,
      );
    };
  }, [inspectorClient]);

  // Expose InspectorClient to window for debugging
  useEffect(() => {
    const win = window as Window & {
      __inspectorClient?: typeof inspectorClient;
    };
    if (!inspectorClient) {
      if (win.__inspectorClient) {
        delete win.__inspectorClient;
      }
      return;
    }

    win.__inspectorClient = inspectorClient;
  }, [inspectorClient]);

  const handleCompletion = useCallback(
    async (
      ref: ResourceReference | PromptReference,
      argName: string,
      value: string,
      context?: Record<string, string>,
      // eslint-disable-next-line @typescript-eslint/no-unused-vars -- required by handleCompletion signature
      _signal?: AbortSignal,
    ): Promise<string[]> => {
      if (!inspectorClient) return [];
      const result = await inspectorClient.getCompletions(
        ref.type === "ref/resource"
          ? { type: "ref/resource", uri: ref.uri }
          : { type: "ref/prompt", name: ref.name },
        argName,
        value,
        context,
        undefined, // metadata
      );
      return result.values || [];
    },
    [inspectorClient],
  );

  const completionsSupported =
    serverCapabilities?.completions !== undefined &&
    serverCapabilities.completions !== null;

  // Map MCP protocol messages (requests/responses) to requestHistory format
  // Filter out notifications - those go in the Notifications tab
  const requestHistory = useMemo(() => {
    return inspectorMessages
      .filter((msg) => msg.direction === "request")
      .map((msg) => ({
        request: JSON.stringify(msg.message),
        response: msg.response ? JSON.stringify(msg.response) : undefined,
      }));
  }, [inspectorMessages]);

  const clearRequestHistory = useCallback(() => {
    // InspectorClient doesn't have a clear method, so this is a no-op
    // The history is managed internally by InspectorClient
  }, []);

  useEffect(() => {
    if (serverCapabilities) {
      const hash = window.location.hash.slice(1);

      const validTabs = [
        ...(serverCapabilities?.resources ? ["resources"] : []),
        ...(serverCapabilities?.prompts ? ["prompts"] : []),
        ...(serverCapabilities?.tools ? ["tools"] : []),
        ...(serverCapabilities?.tools ? ["apps"] : []),
        "ping",
        "sampling",
        "elicitations",
        "roots",
        "console",
        "auth",
      ];

      const isValidTab = validTabs.includes(hash);

      if (!isValidTab) {
        const defaultTab = serverCapabilities?.resources
          ? "resources"
          : serverCapabilities?.prompts
            ? "prompts"
            : serverCapabilities?.tools
              ? "tools"
              : "ping";

        setActiveTab(defaultTab);
        window.location.hash = defaultTab;
      }
    }
  }, [serverCapabilities]);

  useEffect(() => {
    localStorage.setItem("lastCommand", command);
  }, [command]);

  useEffect(() => {
    localStorage.setItem("lastArgs", args);
  }, [args]);

  useEffect(() => {
    localStorage.setItem("lastSseUrl", sseUrl);
  }, [sseUrl]);

  useEffect(() => {
    localStorage.setItem("lastTransportType", transportType);
  }, [transportType]);

  useEffect(() => {
    if (bearerToken) {
      localStorage.setItem("lastBearerToken", bearerToken);
    } else {
      localStorage.removeItem("lastBearerToken");
    }
  }, [bearerToken]);

  useEffect(() => {
    if (headerName) {
      localStorage.setItem("lastHeaderName", headerName);
    } else {
      localStorage.removeItem("lastHeaderName");
    }
  }, [headerName]);

  useEffect(() => {
    localStorage.setItem("lastCustomHeaders", JSON.stringify(customHeaders));
  }, [customHeaders]);

  // Auto-migrate from legacy auth when custom headers are empty but legacy auth exists
  useEffect(() => {
    if (customHeaders.length === 0 && (bearerToken || headerName)) {
      const migratedHeaders = migrateFromLegacyAuth(bearerToken, headerName);
      if (migratedHeaders.length > 0) {
        setCustomHeaders(migratedHeaders);
        // Clear legacy auth after migration
        setBearerToken("");
        setHeaderName("");
      }
    }
  }, [bearerToken, headerName, customHeaders, setCustomHeaders]);

  useEffect(() => {
    localStorage.setItem("lastOauthClientId", oauthClientId);
  }, [oauthClientId]);

  useEffect(() => {
    localStorage.setItem("lastOauthScope", oauthScope);
  }, [oauthScope]);

  useEffect(() => {
    localStorage.setItem("lastOauthClientSecret", oauthClientSecret);
  }, [oauthClientSecret]);

  useEffect(() => {
    localStorage.setItem("lastOauthClientMetadataUrl", oauthClientMetadataUrl);
  }, [oauthClientMetadataUrl]);

  useEffect(() => {
    saveInspectorConfig(CONFIG_LOCAL_STORAGE_KEY, config);
  }, [config]);

  // Persist immediately when config changes from Sidebar so new tabs (e.g. OAuth callback) have it
  const setConfigAndPersist = useCallback((newConfig: InspectorConfig) => {
    setConfig(newConfig);
    saveInspectorConfig(CONFIG_LOCAL_STORAGE_KEY, newConfig);
  }, []);

  const onOAuthConnect = useCallback(() => {
    setIsAuthDebuggerVisible(false);
    void connectMcpServer();
  }, [connectMcpServer]);

  const handleTokenSubmit = useCallback(
    (token: string) => {
      setConfigFetchError(null);
      tokenSubmitCausedLastFetchRef.current = true;
      setConfig((prev) => ({
        ...prev,
        MCP_INSPECTOR_API_TOKEN: {
          ...prev.MCP_INSPECTOR_API_TOKEN,
          value: token,
        },
      }));
      // Persist immediately so refresh/callback keeps the token
      saveInspectorConfig(CONFIG_LOCAL_STORAGE_KEY, {
        ...config,
        MCP_INSPECTOR_API_TOKEN: {
          ...config.MCP_INSPECTOR_API_TOKEN,
          value: token,
        },
      });
      setConfigFetchStatus("loading");
      setConfigFetchTrigger((k) => k + 1);
    },
    [config],
  );

  // Fetch /api/config once on load and when user submits token (retry). Token from config or URL.
  const doFetchConfig = useCallback(() => {
    const params = new URLSearchParams(window.location.search);
    const tokenFromUrl =
      params.get(API_SERVER_ENV_VARS.AUTH_TOKEN) ??
      params.get(LEGACY_AUTH_TOKEN_ENV) ??
      undefined;
    const token = getInspectorApiToken(config) ?? tokenFromUrl;

    const url = new URL("/api/config", window.location.origin);
    const headers: Record<string, string> = {};
    if (token) headers["x-mcp-remote-auth"] = `Bearer ${token}`;

    fetch(url.toString(), { headers })
      .then((res) => {
        const apply = applyConfigRef.current;
        if (res.status === 401) {
          const showIncorrect =
            !!token && tokenSubmitCausedLastFetchRef.current;
          tokenSubmitCausedLastFetchRef.current = false;
          apply.setConfigFetchError(showIncorrect ? "Token incorrect." : null);
          apply.setConfigFetchStatus("need_token");
          return null;
        }
        if (!res.ok) {
          tokenSubmitCausedLastFetchRef.current = false;
          apply.setConfigFetchError(null);
          apply.setConfigFetchStatus("need_token");
          return null;
        }
        return res.json();
      })
      .then((data: Record<string, unknown> | null) => {
        if (!data) return;
        const apply = applyConfigRef.current;
        tokenSubmitCausedLastFetchRef.current = false;
        apply.setConfigFetchError(null);
        apply.setConfigFetchStatus("ok");
        if (!token) apply.setAuthAcceptedWithoutToken(true);
        if (
          data.defaultEnvironment &&
          typeof data.defaultEnvironment === "object"
        ) {
          apply.setEnv(data.defaultEnvironment as Record<string, string>);
        }
        // Transport config: either all from URL params or all from config, never mixed
        const urlParams = new URLSearchParams(window.location.search);
        const hasTransportUrlParams = [
          "transport",
          "serverUrl",
          "serverCommand",
          "serverArgs",
        ].some((p) => urlParams.has(p));
        if (!hasTransportUrlParams) {
          apply.setCommand((data.defaultCommand as string) ?? "");
          const argsVal = data.defaultArgs;
          apply.setArgs(
            Array.isArray(argsVal)
              ? argsVal.join(" ")
              : typeof argsVal === "string"
                ? argsVal
                : "",
          );
          const transport = data.defaultTransport as
            | "stdio"
            | "sse"
            | "streamable-http"
            | undefined;
          apply.setTransportType(transport || "stdio");
          apply.setSseUrl((data.defaultServerUrl as string) ?? "");
          apply.setCwd((data.defaultCwd as string) ?? "");
        }
        apply.setSandboxUrl(
          typeof data.sandboxUrl === "string" ? data.sandboxUrl : undefined,
        );
      })
      .catch(() => {
        tokenSubmitCausedLastFetchRef.current = false;
        applyConfigRef.current.setConfigFetchError(null);
        applyConfigRef.current.setConfigFetchStatus("need_token");
      });
  }, [config]);

  useEffect(() => {
    doFetchConfig();
  }, [configFetchTrigger, doFetchConfig]);

  // Remove API token from URL after it has been read into config (keeps address bar clean)
  useEffect(() => {
    removeAuthTokenFromUrl();
  }, []);

  // Sync roots with InspectorClient
  // Only run when inspectorClient changes, not when roots changes (to avoid infinite loop)
  // The rootsChange event listener handles updates after initial sync
  useEffect(() => {
    if (!inspectorClient) return;

    // Get initial roots from InspectorClient
    const inspectorRoots = inspectorClient.getRoots();
    setRoots(inspectorRoots);
    rootsRef.current = inspectorRoots;
  }, [inspectorClient]);

  // Listen for roots changes from InspectorClient
  useEffect(() => {
    if (!inspectorClient) return;

    const handleRootsChange = (event: CustomEvent<Root[]>) => {
      setRoots(event.detail);
      rootsRef.current = event.detail;
    };

    inspectorClient.addEventListener("rootsChange", handleRootsChange);
    return () => {
      inspectorClient.removeEventListener("rootsChange", handleRootsChange);
    };
  }, [inspectorClient]);

  useEffect(() => {
    if (connectionStatus === "connected" && !window.location.hash) {
      const defaultTab = serverCapabilities?.resources
        ? "resources"
        : serverCapabilities?.prompts
          ? "prompts"
          : serverCapabilities?.tools
            ? "tools"
            : "ping";
      window.location.hash = defaultTab;
    } else if (connectionStatus !== "connected" && window.location.hash) {
      // Clear hash when disconnected - completely remove the fragment
      window.history.replaceState(
        null,
        "",
        window.location.pathname + window.location.search,
      );
    }
  }, [connectionStatus, serverCapabilities]);

  useEffect(() => {
    const handleHashChange = () => {
      const hash = window.location.hash.slice(1);
      if (hash && hash !== activeTab) {
        setActiveTab(hash);
      }
    };

    window.addEventListener("hashchange", handleHashChange);
    return () => window.removeEventListener("hashchange", handleHashChange);
  }, [activeTab]);

  // When transport is stdio, Requests tab is hidden; switch away if it was selected
  useEffect(() => {
    if (
      connectionStatus === "connected" &&
      transportType === "stdio" &&
      activeTab === "requests"
    ) {
      setActiveTab("ping");
      window.location.hash = "ping";
    }
  }, [connectionStatus, transportType, activeTab]);

  // Map string IDs from InspectorClient to numbers for component compatibility
  const stringIdToNumber = useRef<Map<string, number>>(new Map());
  const nextNumericId = useRef(1);

  const getNumericId = (stringId: string): number => {
    if (!stringIdToNumber.current.has(stringId)) {
      stringIdToNumber.current.set(stringId, nextNumericId.current++);
    }
    return stringIdToNumber.current.get(stringId)!;
  };

  const handleApproveSampling = (id: number, result: CreateMessageResult) => {
    setPendingSampleRequests((prev) => {
      // Find by numeric ID (stored in state)
      const request = prev.find((r) => r.id === id);
      request?.resolve(result);
      return prev.filter((r) => r.id !== id);
    });
  };

  const handleRejectSampling = (id: number) => {
    setPendingSampleRequests((prev) => {
      const request = prev.find((r) => r.id === id);
      request?.reject(new Error("Sampling request rejected"));
      return prev.filter((r) => r.id !== id);
    });
  };

  const handleResolveElicitation = (
    id: number,
    response: ElicitationResponse,
  ) => {
    setPendingElicitationRequests((prev) => {
      const request = prev.find((r) => r.id === id);
      if (request) {
        request.resolve(response);

        if (request.originatingTab) {
          const originatingTab = request.originatingTab;

          const validTabs = [
            ...(serverCapabilities?.resources ? ["resources"] : []),
            ...(serverCapabilities?.prompts ? ["prompts"] : []),
            ...(serverCapabilities?.tools ? ["tools"] : []),
            ...(serverCapabilities?.tools ? ["apps"] : []),
            "ping",
            "sampling",
            "elicitations",
            "roots",
            "auth",
          ];

          if (validTabs.includes(originatingTab)) {
            setActiveTab(originatingTab);
            window.location.hash = originatingTab;

            setTimeout(() => {
              setActiveTab(originatingTab);
              window.location.hash = originatingTab;
            }, 100);
          }
        }
      }
      return prev.filter((r) => r.id !== id);
    });
  };

  const clearError = (tabKey: keyof typeof errors) => {
    setErrors((prev) => ({ ...prev, [tabKey]: null }));
  };

  const listResources = async () => {
    if (!inspectorClient) {
      throw new Error("InspectorClient is not connected");
    }
    try {
      const response = await inspectorClient.listResources(
        nextResourceCursor,
        metadata,
      );
      // InspectorClient now updates resources state automatically (accumulates when cursor provided)
      setNextResourceCursor(response.nextCursor);
      clearError("resources");
    } catch (e) {
      const errorString = (e as Error).message ?? String(e);
      setErrors((prev) => ({
        ...prev,
        resources: errorString,
      }));
      throw e;
    }
  };

  const listResourceTemplates = async () => {
    if (!inspectorClient) {
      throw new Error("InspectorClient is not connected");
    }
    try {
      const response = await inspectorClient.listResourceTemplates(
        nextResourceTemplateCursor,
        metadata,
      );
      // InspectorClient now updates resourceTemplates state automatically (accumulates when cursor provided)
      setNextResourceTemplateCursor(response.nextCursor);
      clearError("resources");
    } catch (e) {
      const errorString = (e as Error).message ?? String(e);
      setErrors((prev) => ({
        ...prev,
        resources: errorString,
      }));
      throw e;
    }
  };

  const getPrompt = async (name: string, args: Record<string, string> = {}) => {
    lastToolCallOriginTabRef.current = currentTabRef.current;

    if (!inspectorClient) {
      throw new Error("InspectorClient is not connected");
    }
    try {
      // Convert string args to JsonValue for InspectorClient
      const jsonArgs: Record<string, JsonValue> = {};
      for (const [key, value] of Object.entries(args)) {
        jsonArgs[key] = value; // strings are valid JsonValue
      }
      const response = await inspectorClient.getPrompt(
        name,
        jsonArgs,
        metadata,
      );
      setPromptContent(JSON.stringify(response, null, 2));
      clearError("prompts");
    } catch (e) {
      const errorString = (e as Error).message ?? String(e);
      setErrors((prev) => ({
        ...prev,
        prompts: errorString,
      }));
      throw e;
    }
  };

  const readResource = async (uri: string) => {
    lastToolCallOriginTabRef.current = currentTabRef.current;

    if (!inspectorClient) {
      throw new Error("InspectorClient is not connected");
    }
    try {
      const response = await inspectorClient.readResource(uri, metadata);
      const content = JSON.stringify(response, null, 2);
      setResourceContent(content);
      setResourceContentMap((prev) => ({
        ...prev,
        [uri]: content,
      }));
      clearError("resources");
    } catch (e) {
      const errorString = (e as Error).message ?? String(e);
      setErrors((prev) => ({
        ...prev,
        resources: errorString,
      }));
      throw e;
    }
  };

  const subscribeToResource = async (uri: string) => {
    if (!inspectorClient) {
      throw new Error("InspectorClient is not connected");
    }
    try {
      await inspectorClient.subscribeToResource(uri);
      // InspectorClient manages subscriptions internally, but we track them for UI
      const clone = new Set(resourceSubscriptions);
      clone.add(uri);
      setResourceSubscriptions(clone);
      clearError("resources");
    } catch (e) {
      const errorString = (e as Error).message ?? String(e);
      setErrors((prev) => ({
        ...prev,
        resources: errorString,
      }));
      throw e;
    }
  };

  const unsubscribeFromResource = async (uri: string) => {
    if (!inspectorClient) {
      throw new Error("InspectorClient is not connected");
    }
    try {
      await inspectorClient.unsubscribeFromResource(uri);
      // InspectorClient manages subscriptions internally, but we track them for UI
      const clone = new Set(resourceSubscriptions);
      clone.delete(uri);
      setResourceSubscriptions(clone);
      clearError("resources");
    } catch (e) {
      const errorString = (e as Error).message ?? String(e);
      setErrors((prev) => ({
        ...prev,
        resources: errorString,
      }));
      throw e;
    }
  };

  const listPrompts = async () => {
    if (!inspectorClient) {
      throw new Error("InspectorClient is not connected");
    }
    try {
      const response = await inspectorClient.listPrompts(
        nextPromptCursor,
        metadata,
      );
      // InspectorClient now updates prompts state automatically (accumulates when cursor provided)
      setNextPromptCursor(response.nextCursor);
      clearError("prompts");
    } catch (e) {
      const errorString = (e as Error).message ?? String(e);
      setErrors((prev) => ({
        ...prev,
        prompts: errorString,
      }));
      throw e;
    }
  };

  const listTools = async () => {
    if (!inspectorClient) {
      throw new Error("InspectorClient is not connected");
    }
    try {
      const response = await inspectorClient.listTools(
        nextToolCursor,
        metadata,
      );
      // InspectorClient now updates tools state automatically (accumulates when cursor provided)
      setNextToolCursor(response.nextCursor);
      cacheToolOutputSchemas(response.tools);
      clearError("tools");
    } catch (e) {
      const errorString = (e as Error).message ?? String(e);
      setErrors((prev) => ({
        ...prev,
        tools: errorString,
      }));
      throw e;
    }
  };

  // When switching to Apps tab, ensure tools are listed so app tools are available
  useEffect(() => {
    if (
      connectionStatus === "connected" &&
      activeTab === "apps" &&
      serverCapabilities?.tools
    ) {
      void listTools();
    }
    // Intentionally omit listTools from deps: we only want to run when tab/capabilities/connection change
    // eslint-disable-next-line react-hooks/exhaustive-deps -- listTools identity is not stable; adding it would re-run every render
  }, [connectionStatus, activeTab, serverCapabilities?.tools]);

  const callTool = async (
    name: string,
    params: Record<string, unknown>,
    toolMetadata?: Record<string, unknown>,
    runAsTask?: boolean,
  ) => {
    lastToolCallOriginTabRef.current = currentTabRef.current;

    if (!inspectorClient) {
      throw new Error("InspectorClient is not connected");
    }

    const tool = inspectorTools.find((t) => t.name === name);
    const taskSupport = tool?.execution?.taskSupport ?? "forbidden";
    const effectiveRunAsTask =
      taskSupport === "required" ||
      (taskSupport === "optional" && runAsTask === true);

    const cleanedParams = tool?.inputSchema
      ? cleanParams(params, tool.inputSchema as JsonSchemaType)
      : params;
    const generalMetadata = {
      ...metadata,
      progressToken: String(progressTokenRef.current++),
    };
    const toolSpecificMetadata = toolMetadata
      ? Object.fromEntries(
          Object.entries(toolMetadata).map(([k, v]) => [k, String(v)]),
        )
      : undefined;
    const taskOptions = effectiveRunAsTask
      ? { ttl: getMCPTaskTtl(config) }
      : undefined;

    try {
      if (effectiveRunAsTask) {
        // Use callToolStream for task-augmented execution (required or optional+checked)
        let currentTaskId: string | undefined;

        const onTaskCreated = (
          e: CustomEvent<{ taskId: string; task: { taskId: string } }>,
        ) => {
          const { taskId } = e.detail;
          currentTaskId = taskId;
          setToolResult({
            content: [
              {
                type: "text",
                text: `Task created: ${taskId}. Polling for status...`,
              },
            ],
            _meta: {
              "io.modelcontextprotocol/related-task": { taskId },
            },
          } as CompatibilityCallToolResult);
        };

        const onTaskStatusChange = (
          e: CustomEvent<{
            taskId: string;
            task: { status: string; statusMessage?: string };
          }>,
        ) => {
          const { taskId, task } = e.detail;
          if (currentTaskId !== taskId) return;
          setToolResult({
            content: [
              {
                type: "text",
                text: `Task status: ${task.status}${task.statusMessage ? ` - ${task.statusMessage}` : ""}. Polling...`,
              },
            ],
            _meta: {
              "io.modelcontextprotocol/related-task": { taskId },
            },
          } as CompatibilityCallToolResult);
          void inspectorClient.listRequestorTasks();
        };

        inspectorClient.addEventListener("taskCreated", onTaskCreated);
        inspectorClient.addEventListener(
          "taskStatusChange",
          onTaskStatusChange,
        );
        setIsPollingTask(true);

        try {
          const invocation = await inspectorClient.callToolStream(
            name,
            cleanedParams as Record<string, JsonValue>,
            generalMetadata,
            toolSpecificMetadata,
            taskOptions,
          );

          const compatibilityResult: CompatibilityCallToolResult =
            invocation.result
              ? {
                  ...invocation.result,
                  content: invocation.result.content ?? [],
                }
              : {
                  content: [
                    {
                      type: "text",
                      text: invocation.error || "Tool call failed",
                    },
                  ],
                  isError: true,
                };
          setToolResult(compatibilityResult);
        } finally {
          inspectorClient.removeEventListener("taskCreated", onTaskCreated);
          inspectorClient.removeEventListener(
            "taskStatusChange",
            onTaskStatusChange,
          );
          setIsPollingTask(false);
        }
      } else {
        // Use callTool for non-task execution
        const invocation = await inspectorClient.callTool(
          name,
          cleanedParams as Record<string, JsonValue>,
          generalMetadata,
          toolSpecificMetadata,
          undefined, // no task options
        );

        const compatibilityResult: CompatibilityCallToolResult =
          invocation.result
            ? {
                ...invocation.result,
                content: invocation.result.content ?? [],
              }
            : {
                content: [
                  {
                    type: "text",
                    text: invocation.error || "Tool call failed",
                  },
                ],
                isError: true,
              };
        setToolResult(compatibilityResult);
      }
      setErrors((prev) => ({ ...prev, tools: null }));
    } catch (e) {
      setIsPollingTask(false);
      setToolResult({
        content: [
          {
            type: "text",
            text: (e as Error).message ?? String(e),
          },
        ],
        isError: true,
      });
      setErrors((prev) => ({ ...prev, tools: null }));
    }
  };

  const handleRootsChange = async () => {
    if (!inspectorClient) {
      throw new Error("InspectorClient is not connected");
    }
    // InspectorClient.setRoots() handles sending the notification internally
    await inspectorClient.setRoots(roots);
  };

  const handleClearNotifications = () => {
    setNotifications([]);
  };

  const sendLogLevelRequest = async (level: LoggingLevel) => {
    if (!inspectorClient) {
      throw new Error("InspectorClient is not connected");
    }
    try {
      await inspectorClient.setLoggingLevel(level);
      setLogLevel(level);
    } catch (e) {
      const errorString = (e as Error).message ?? String(e);
      console.error("Failed to set logging level:", errorString);
      throw e;
    }
  };

  const AuthDebuggerWrapper = () => (
    <TabsContent value="auth">
      <AuthDebugger
        inspectorClient={inspectorClient}
        ensureInspectorClient={ensureInspectorClient}
        canCreateInspectorClient={canCreateInspectorClient}
        logger={inspectorLogger}
        onBack={() => setIsAuthDebuggerVisible(false)}
      />
    </TabsContent>
  );

  // Check for OAuth callback params (even if pathname is wrong - some OAuth servers redirect incorrectly)
  const urlParams = new URLSearchParams(window.location.search);
  const hasOAuthCallbackParams =
    urlParams.has("code") || urlParams.has("error");
  const stateParam = urlParams.get("state");
  const isGuidedOAuthCallback =
    hasOAuthCallbackParams &&
    (window.location.pathname === "/oauth/callback" ||
      window.location.pathname === "/") &&
    stateParam != null &&
    parseOAuthState(stateParam)?.mode === "guided";

  // Guided auth callback in another tab: show callback UI (code to copy) without requiring API token.
  // That tab has its own sessionStorage and won't have the token from the opener tab.
  if (isGuidedOAuthCallback) {
    const OAuthCallback = React.lazy(
      () => import("./components/OAuthCallback"),
    );
    return (
      <Suspense
        fallback={
          <div className="min-h-screen bg-background flex items-center justify-center text-muted-foreground">
            Loading...
          </div>
        }
      >
        <OAuthCallback
          inspectorClient={null}
          ensureInspectorClient={() => null}
          logger={null}
          onConnect={() => {}}
        />
      </Suspense>
    );
  }

  // Config fetch returned 401: show token screen; user submits token then we retry /api/config
  if (configFetchStatus === "loading") {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center text-muted-foreground">
        Loading...
      </div>
    );
  }
  if (configFetchStatus === "need_token") {
    return (
      <TokenLoginScreen
        onTokenSubmit={handleTokenSubmit}
        serverError={configFetchError}
      />
    );
  }

  // Handle OAuth callback - check pathname OR presence of callback params
  // (Some OAuth servers redirect to root instead of /oauth/callback)
  if (
    window.location.pathname === "/oauth/callback" ||
    (hasOAuthCallbackParams && window.location.pathname === "/")
  ) {
    const OAuthCallback = React.lazy(
      () => import("./components/OAuthCallback"),
    );
    return (
      <Suspense fallback={<div>Loading...</div>}>
        <OAuthCallback
          inspectorClient={inspectorClient}
          ensureInspectorClient={ensureInspectorClient}
          logger={inspectorLogger}
          onConnect={onOAuthConnect}
        />
      </Suspense>
    );
  }

  // If we have OAuth callback params but wrong pathname (and not root), log it
  if (
    hasOAuthCallbackParams &&
    window.location.pathname !== "/oauth/callback" &&
    window.location.pathname !== "/"
  ) {
    console.warn(
      "[App] OAuth callback params detected but unexpected pathname:",
      {
        pathname: window.location.pathname,
        search: window.location.search,
        fullUrl: window.location.href,
      },
    );
  }

  return (
    <div className="flex h-screen bg-background">
      <div
        style={{
          width: sidebarWidth,
          minWidth: 200,
          maxWidth: 600,
          transition: isSidebarDragging ? "none" : "width 0.15s",
        }}
        className="bg-card border-r border-border flex flex-col h-full relative"
      >
        <Sidebar
          connectionStatus={
            connectionStatus as "disconnected" | "connected" | "error"
          }
          transportType={transportType}
          setTransportType={setTransportType}
          command={command}
          setCommand={setCommand}
          args={args}
          setArgs={setArgs}
          cwd={cwd}
          setCwd={setCwd}
          sseUrl={sseUrl}
          setSseUrl={setSseUrl}
          env={env}
          setEnv={setEnv}
          config={config}
          setConfig={setConfigAndPersist}
          authAcceptedWithoutToken={authAcceptedWithoutToken}
          customHeaders={customHeaders}
          setCustomHeaders={setCustomHeaders}
          oauthClientId={oauthClientId}
          setOauthClientId={setOauthClientId}
          oauthClientSecret={oauthClientSecret}
          setOauthClientSecret={setOauthClientSecret}
          oauthClientMetadataUrl={oauthClientMetadataUrl}
          setOauthClientMetadataUrl={setOauthClientMetadataUrl}
          oauthScope={oauthScope}
          setOauthScope={setOauthScope}
          onConnect={connectMcpServer}
          onDisconnect={disconnectMcpServer}
          logLevel={logLevel}
          sendLogLevelRequest={sendLogLevelRequest}
          loggingSupported={!!serverCapabilities?.logging || false}
          serverImplementation={serverImplementation}
        />
        <div
          onMouseDown={handleSidebarDragStart}
          style={{
            cursor: "col-resize",
            position: "absolute",
            top: 0,
            right: 0,
            width: 6,
            height: "100%",
            zIndex: 10,
            background: isSidebarDragging ? "rgba(0,0,0,0.08)" : "transparent",
          }}
          aria-label="Resize sidebar"
          data-testid="sidebar-drag-handle"
        />
      </div>
      <div className="flex-1 flex flex-col overflow-hidden">
        <div className="flex-1 flex flex-col min-h-0 overflow-auto">
          {connectionStatus === "connected" ? (
            <Tabs
              value={activeTab}
              className="w-full p-4 flex flex-col flex-1 min-h-0"
              onValueChange={(value) => {
                setActiveTab(value);
                window.location.hash = value;
              }}
            >
              <TabsList className="mb-4 py-0">
                <TabsTrigger
                  value="resources"
                  disabled={!serverCapabilities?.resources}
                >
                  <Files className="w-4 h-4 mr-2" />
                  Resources
                </TabsTrigger>
                <TabsTrigger
                  value="prompts"
                  disabled={!serverCapabilities?.prompts}
                >
                  <MessageSquare className="w-4 h-4 mr-2" />
                  Prompts
                </TabsTrigger>
                <TabsTrigger
                  value="tools"
                  disabled={!serverCapabilities?.tools}
                >
                  <Hammer className="w-4 h-4 mr-2" />
                  Tools
                </TabsTrigger>
                <TabsTrigger value="apps" disabled={!serverCapabilities?.tools}>
                  <AppWindow className="w-4 h-4 mr-2" />
                  Apps
                </TabsTrigger>
                <TabsTrigger value="ping">
                  <Bell className="w-4 h-4 mr-2" />
                  Ping
                </TabsTrigger>
                {transportType !== "stdio" && (
                  <TabsTrigger value="requests">
                    <Network className="w-4 h-4 mr-2" />
                    Requests
                  </TabsTrigger>
                )}
                <TabsTrigger value="sampling" className="relative">
                  <Hash className="w-4 h-4 mr-2" />
                  Sampling
                  {pendingSampleRequests.length > 0 && (
                    <span className="absolute -top-1 -right-1 bg-red-500 text-white text-xs rounded-full h-4 w-4 flex items-center justify-center">
                      {pendingSampleRequests.length}
                    </span>
                  )}
                </TabsTrigger>
                <TabsTrigger value="elicitations" className="relative">
                  <MessageSquare className="w-4 h-4 mr-2" />
                  Elicitations
                  {pendingElicitationRequests.length > 0 && (
                    <span className="absolute -top-1 -right-1 bg-red-500 text-white text-xs rounded-full h-4 w-4 flex items-center justify-center">
                      {pendingElicitationRequests.length}
                    </span>
                  )}
                </TabsTrigger>
                <TabsTrigger value="roots">
                  <FolderTree className="w-4 h-4 mr-2" />
                  Roots
                </TabsTrigger>
                {transportType === "stdio" && (
                  <TabsTrigger value="console">
                    <Terminal className="w-4 h-4 mr-2" />
                    Console
                  </TabsTrigger>
                )}
                <TabsTrigger value="auth">
                  <Key className="w-4 h-4 mr-2" />
                  Auth
                </TabsTrigger>
                <TabsTrigger value="metadata">
                  <Settings className="w-4 h-4 mr-2" />
                  Metadata
                </TabsTrigger>
              </TabsList>

              <div className="w-full flex-1 flex flex-col min-h-0">
                {!serverCapabilities?.resources &&
                !serverCapabilities?.prompts &&
                !serverCapabilities?.tools ? (
                  <>
                    <div className="flex items-center justify-center p-4">
                      <p className="text-lg text-gray-500 dark:text-gray-400">
                        The connected server does not support any MCP
                        capabilities
                      </p>
                    </div>
                    <PingTab
                      onPingClick={async () => {
                        if (!inspectorClient) {
                          throw new Error("MCP client is not connected");
                        }
                        try {
                          await inspectorClient.ping();
                        } catch (e) {
                          console.error("Ping failed:", e);
                          throw e;
                        }
                      }}
                    />
                  </>
                ) : (
                  <>
                    <ResourcesTab
                      resources={inspectorResources}
                      resourceTemplates={inspectorResourceTemplates}
                      listResources={() => {
                        clearError("resources");
                        listResources();
                      }}
                      clearResources={() => {
                        // InspectorClient now has clearResources() method
                        if (inspectorClient) {
                          inspectorClient.clearResources();
                        }
                        setNextResourceCursor(undefined);
                      }}
                      listResourceTemplates={() => {
                        clearError("resources");
                        listResourceTemplates();
                      }}
                      clearResourceTemplates={() => {
                        // InspectorClient now has clearResourceTemplates() method
                        if (inspectorClient) {
                          inspectorClient.clearResourceTemplates();
                        }
                        setNextResourceTemplateCursor(undefined);
                      }}
                      readResource={(uri) => {
                        clearError("resources");
                        readResource(uri);
                      }}
                      selectedResource={selectedResource}
                      setSelectedResource={(resource) => {
                        clearError("resources");
                        setSelectedResource(resource);
                      }}
                      resourceSubscriptionsSupported={
                        serverCapabilities?.resources?.subscribe || false
                      }
                      resourceSubscriptions={resourceSubscriptions}
                      subscribeToResource={(uri) => {
                        clearError("resources");
                        subscribeToResource(uri);
                      }}
                      unsubscribeFromResource={(uri) => {
                        clearError("resources");
                        unsubscribeFromResource(uri);
                      }}
                      handleCompletion={handleCompletion}
                      completionsSupported={completionsSupported}
                      resourceContent={resourceContent}
                      nextCursor={nextResourceCursor}
                      nextTemplateCursor={nextResourceTemplateCursor}
                      error={errors.resources}
                    />
                    <PromptsTab
                      prompts={inspectorPrompts}
                      listPrompts={() => {
                        clearError("prompts");
                        listPrompts();
                      }}
                      clearPrompts={() => {
                        // InspectorClient now has clearPrompts() method
                        if (inspectorClient) {
                          inspectorClient.clearPrompts();
                        }
                        setNextPromptCursor(undefined);
                      }}
                      getPrompt={(name, args) => {
                        clearError("prompts");
                        getPrompt(name, args);
                      }}
                      selectedPrompt={selectedPrompt}
                      setSelectedPrompt={(prompt) => {
                        clearError("prompts");
                        setSelectedPrompt(prompt);
                        setPromptContent("");
                      }}
                      handleCompletion={handleCompletion}
                      completionsSupported={completionsSupported}
                      promptContent={promptContent}
                      nextCursor={nextPromptCursor}
                      error={errors.prompts}
                    />
                    <AppsTab
                      sandboxPath={sandboxUrl}
                      tools={inspectorTools}
                      listTools={() => {
                        clearError("tools");
                        listTools();
                      }}
                      error={errors.tools}
                      appRendererClient={appRendererClient}
                      onNotification={(notification) => {
                        setNotifications((prev) => [...prev, notification]);
                      }}
                    />
                    <ToolsTab
                      tools={inspectorTools}
                      listTools={() => {
                        clearError("tools");
                        listTools();
                      }}
                      clearTools={() => {
                        // InspectorClient now has clearTools() method
                        if (inspectorClient) {
                          inspectorClient.clearTools();
                        }
                        setNextToolCursor(undefined);
                        cacheToolOutputSchemas([]);
                      }}
                      callTool={async (
                        name: string,
                        params: Record<string, unknown>,
                        metadata?: Record<string, unknown>,
                        runAsTask?: boolean,
                      ) => {
                        clearError("tools");
                        setToolResult(null);
                        await callTool(name, params, metadata, runAsTask);
                      }}
                      selectedTool={selectedTool}
                      setSelectedTool={(tool) => {
                        clearError("tools");
                        setSelectedTool(tool);
                        setToolResult(null);
                      }}
                      toolResult={toolResult}
                      isPollingTask={isPollingTask}
                      serverSupportsTaskToolCalls={serverSupportsTaskToolCalls}
                      nextCursor={nextToolCursor}
                      error={errors.tools}
                      resourceContent={resourceContentMap}
                      onReadResource={(uri: string) => {
                        clearError("resources");
                        readResource(uri);
                      }}
                    />
                    <ConsoleTab stderrLogs={stderrLogs} />
                    <PingTab
                      onPingClick={async () => {
                        if (!inspectorClient) {
                          throw new Error("MCP client is not connected");
                        }
                        try {
                          await inspectorClient.ping();
                        } catch (e) {
                          console.error("Ping failed:", e);
                          throw e;
                        }
                      }}
                    />
                    {transportType !== "stdio" && (
                      <RequestsTab fetchRequests={fetchRequests} />
                    )}
                    <SamplingTab
                      pendingRequests={pendingSampleRequests}
                      onApprove={handleApproveSampling}
                      onReject={handleRejectSampling}
                    />
                    <ElicitationTab
                      pendingRequests={pendingElicitationRequests}
                      onResolve={handleResolveElicitation}
                    />
                    <RootsTab
                      roots={roots}
                      setRoots={setRoots}
                      onRootsChange={handleRootsChange}
                    />
                    <AuthDebuggerWrapper />
                    <MetadataTab
                      metadata={metadata}
                      onMetadataChange={handleMetadataChange}
                    />
                  </>
                )}
              </div>
            </Tabs>
          ) : isAuthDebuggerVisible ? (
            <Tabs
              defaultValue={"auth"}
              className="w-full p-4"
              onValueChange={(value) => (window.location.hash = value)}
            >
              <AuthDebuggerWrapper />
            </Tabs>
          ) : (
            <div className="flex flex-col items-center justify-center h-full gap-4">
              <p className="text-lg text-gray-500 dark:text-gray-400">
                Connect to an MCP server to start inspecting
              </p>
              <div className="flex items-center gap-2">
                <p className="text-sm text-muted-foreground">
                  Need to configure authentication?
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setIsAuthDebuggerVisible(true)}
                >
                  Open Auth Settings
                </Button>
              </div>
            </div>
          )}
        </div>
        <div
          className="relative border-t border-border"
          style={{
            height: `${historyPaneHeight}px`,
          }}
        >
          <div
            className="absolute w-full h-4 -top-2 cursor-row-resize flex items-center justify-center hover:bg-accent/50 dark:hover:bg-input/40"
            onMouseDown={handleDragStart}
          >
            <div className="w-8 h-1 rounded-full bg-border" />
          </div>
          <div className="h-full overflow-auto">
            <HistoryAndNotifications
              requestHistory={requestHistory}
              serverNotifications={notifications}
              onClearHistory={clearRequestHistory}
              onClearNotifications={handleClearNotifications}
            />
          </div>
        </div>
      </div>
    </div>
  );
};

export default App;
