import {
  CompatibilityCallToolResult,
  CreateMessageResult,
  EmptyResultSchema,
  Resource,
  ResourceReference,
  PromptReference,
  Root,
  ServerNotification,
  Tool,
  LoggingLevel,
} from "@modelcontextprotocol/sdk/types.js";
import { OAuthTokensSchema } from "@modelcontextprotocol/sdk/shared/auth.js";
import { SESSION_KEYS, getServerSpecificKey } from "./lib/constants";
import {
  hasValidMetaName,
  hasValidMetaPrefix,
  isReservedMetaKey,
} from "@/utils/metaUtils";
import { AuthGuidedState, EMPTY_GUIDED_STATE } from "./lib/auth-types";
import { OAuthStateMachine } from "./lib/oauth-state-machine";
import { cacheToolOutputSchemas } from "./utils/schemaUtils";
import { cleanParams } from "./utils/paramUtils";
import type { JsonSchemaType } from "./utils/jsonUtils";
import type { JsonValue } from "@modelcontextprotocol/inspector-shared/json/jsonUtils.js";
import React, {
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useInspectorClient } from "@modelcontextprotocol/inspector-shared/react/useInspectorClient.js";
import { InspectorClient } from "@modelcontextprotocol/inspector-shared/mcp/index.js";
import { createWebEnvironment } from "./lib/adapters/environmentFactory";
import { webConfigToMcpServerConfig } from "./lib/adapters/configAdapter";
import {
  useDraggablePane,
  useDraggableSidebar,
} from "./lib/hooks/useDraggablePane";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import {
  Bell,
  Files,
  FolderTree,
  Hammer,
  Hash,
  Key,
  MessageSquare,
  Settings,
  Terminal,
} from "lucide-react";

import "./App.css";
import AuthDebugger from "./components/AuthDebugger";
import ConsoleTab from "./components/ConsoleTab";
import HistoryAndNotifications from "./components/HistoryAndNotifications";
import PingTab from "./components/PingTab";
import PromptsTab, { Prompt } from "./components/PromptsTab";
import ResourcesTab from "./components/ResourcesTab";
import RootsTab from "./components/RootsTab";
import SamplingTab, { PendingRequest } from "./components/SamplingTab";
import Sidebar from "./components/Sidebar";
import ToolsTab from "./components/ToolsTab";
import { InspectorConfig } from "./lib/configurationTypes";
import {
  getInitialSseUrl,
  getInitialTransportType,
  getInitialCommand,
  getInitialArgs,
  initializeInspectorConfig,
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
  const [transportType, setTransportType] = useState<
    "stdio" | "sse" | "streamable-http"
  >(getInitialTransportType);
  const [logLevel, setLogLevel] = useState<LoggingLevel>("debug");
  const [notifications, setNotifications] = useState<ServerNotification[]>([]);
  const [roots, setRoots] = useState<Root[]>([]);
  const [env, setEnv] = useState<Record<string, string>>({});

  const [config, setConfig] = useState<InspectorConfig>(() =>
    initializeInspectorConfig(CONFIG_LOCAL_STORAGE_KEY),
  );
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

  const [authState, setAuthState] =
    useState<AuthGuidedState>(EMPTY_GUIDED_STATE);

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

  const updateAuthState = (updates: Partial<AuthGuidedState>) => {
    setAuthState((prev) => ({ ...prev, ...updates }));
  };

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

  // Get auth token from config (which reads from URL params via initializeInspectorConfig)
  const authToken = useMemo(() => {
    const token = config.MCP_INSPECTOR_API_TOKEN.value as string;
    return token || undefined;
  }, [config]);

  // Create InspectorClient instance (for testing - not wired to UI yet)
  const inspectorClient = useMemo(() => {
    // Can't create without config
    if (!command && !sseUrl) {
      return null;
    }

    // Need auth token for Inspector API
    if (!authToken) {
      return null;
    }

    try {
      const config = webConfigToMcpServerConfig(
        transportType,
        command,
        args,
        sseUrl,
        env,
        customHeaders,
      );

      const redirectUrlProvider = {
        getRedirectUrl: (_mode: "normal" | "guided") =>
          `${window.location.origin}/oauth/callback`,
      };

      const environment = createWebEnvironment(authToken, redirectUrlProvider);

      const client = new InspectorClient(config, {
        environment,
        autoSyncLists: false,
        maxMessages: 1000,
        maxStderrLogEvents: 1000,
        maxFetchRequests: 1000,
        oauth: {
          clientId: oauthClientId || undefined,
          clientSecret: oauthClientSecret || undefined,
          scope: oauthScope || undefined,
        },
      });

      return client;
    } catch (error) {
      console.error("[InspectorClient] Failed to create:", error);
      return null;
    }
  }, [
    transportType,
    command,
    args,
    sseUrl,
    // Use JSON.stringify for objects/arrays to prevent unnecessary re-creation
    // Only recreate if the actual content changes, not just the reference
    JSON.stringify(env),
    JSON.stringify(customHeaders),
    oauthClientId,
    oauthClientSecret,
    oauthScope,
    authToken,
  ]);

  // Use InspectorClient hook
  const {
    status: connectionStatus,
    capabilities: serverCapabilities,
    serverInfo: serverImplementation,
    client: mcpClient,
    messages: inspectorMessages,
    stderrLogs,
    tools: inspectorTools,
    resources: inspectorResources,
    resourceTemplates: inspectorResourceTemplates,
    prompts: inspectorPrompts,
    connect: connectMcpServer,
    disconnect: disconnectMcpServer,
  } = useInspectorClient(inspectorClient);

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

      setPendingElicitationRequests((prev) => [
        ...prev,
        {
          id: numericId,
          request: {
            id: numericId,
            message: elicitation.request.params.message,
            requestedSchema: elicitation.request.params.requestedSchema,
          },
          originatingTab: currentTab,
          resolve: async (result: any) => {
            await elicitation.respond(result);
          },
          decline: async (error: Error) => {
            elicitation.remove();
            console.error("Elicitation request rejected:", error);
          },
        },
      ]);

      setActiveTab("elicitations");
      window.location.hash = "elicitations";
    };

    inspectorClient.addEventListener(
      "newPendingSample",
      handleNewPendingSample,
    );
    inspectorClient.addEventListener(
      "newPendingElicitation",
      handleNewPendingElicitation,
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
    };
  }, [inspectorClient]);

  // Expose InspectorClient to window for debugging
  useEffect(() => {
    if (!inspectorClient) {
      if ((window as any).__inspectorClient) {
        delete (window as any).__inspectorClient;
      }
      return;
    }

    (window as any).__inspectorClient = inspectorClient;
  }, [inspectorClient]);

  const handleCompletion = useCallback(
    async (
      ref: ResourceReference | PromptReference,
      argName: string,
      value: string,
      context?: Record<string, string>,
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
    saveInspectorConfig(CONFIG_LOCAL_STORAGE_KEY, config);
  }, [config]);

  const onOAuthConnect = useCallback(
    (serverUrl: string) => {
      setSseUrl(serverUrl);
      setIsAuthDebuggerVisible(false);
      void connectMcpServer();
    },
    [connectMcpServer],
  );

  const onOAuthDebugConnect = useCallback(
    async ({
      authorizationCode,
      errorMsg,
      restoredState,
    }: {
      authorizationCode?: string;
      errorMsg?: string;
      restoredState?: AuthGuidedState;
    }) => {
      setIsAuthDebuggerVisible(true);

      if (errorMsg) {
        updateAuthState({
          latestError: new Error(errorMsg),
        });
        return;
      }

      if (restoredState && authorizationCode) {
        let currentState: AuthGuidedState = {
          ...restoredState,
          authorizationCode,
          oauthStep: "token_request",
          isInitiatingAuth: true,
          statusMessage: null,
          latestError: null,
        };

        try {
          const stateMachine = new OAuthStateMachine(sseUrl, (updates) => {
            currentState = { ...currentState, ...updates };
          });

          while (
            currentState.oauthStep !== "complete" &&
            currentState.oauthStep !== "authorization_code"
          ) {
            await stateMachine.executeStep(currentState);
          }

          if (currentState.oauthStep === "complete") {
            updateAuthState({
              ...currentState,
              statusMessage: {
                type: "success",
                message: "Authentication completed successfully",
              },
              isInitiatingAuth: false,
            });
          }
        } catch (error) {
          console.error("OAuth continuation error:", error);
          updateAuthState({
            latestError:
              error instanceof Error ? error : new Error(String(error)),
            statusMessage: {
              type: "error",
              message: `Failed to complete OAuth flow: ${error instanceof Error ? error.message : String(error)}`,
            },
            isInitiatingAuth: false,
          });
        }
      } else if (authorizationCode) {
        updateAuthState({
          authorizationCode,
          oauthStep: "token_request",
        });
      }
    },
    [sseUrl],
  );

  useEffect(() => {
    const loadOAuthTokens = async () => {
      try {
        if (sseUrl) {
          const key = getServerSpecificKey(SESSION_KEYS.TOKENS, sseUrl);
          const tokens = sessionStorage.getItem(key);
          if (tokens) {
            const parsedTokens = await OAuthTokensSchema.parseAsync(
              JSON.parse(tokens),
            );
            updateAuthState({
              oauthTokens: parsedTokens,
              oauthStep: "complete",
            });
          }
        }
      } catch (error) {
        console.error("Error loading OAuth tokens:", error);
      }
    };

    loadOAuthTokens();
  }, [sseUrl]);

  useEffect(() => {
    // Read initial config from HTML injection (window.__INITIAL_CONFIG__)
    // This replaces the previous /config endpoint fetch
    const initialConfig = (window as any).__INITIAL_CONFIG__;
    if (initialConfig) {
      if (initialConfig.defaultEnvironment) {
        setEnv(initialConfig.defaultEnvironment);
      }
      if (initialConfig.defaultCommand) {
        setCommand(initialConfig.defaultCommand);
      }
      if (initialConfig.defaultArgs) {
        // Convert array to space-separated string if needed
        // Server injects defaultArgs as array, but args state expects string
        const argsValue = Array.isArray(initialConfig.defaultArgs)
          ? initialConfig.defaultArgs.join(" ")
          : initialConfig.defaultArgs;
        setArgs(argsValue);
      }
      if (initialConfig.defaultTransport) {
        setTransportType(
          initialConfig.defaultTransport as "stdio" | "sse" | "streamable-http",
        );
      }
      if (initialConfig.defaultServerUrl) {
        setSseUrl(initialConfig.defaultServerUrl);
      }
    }
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
    if (mcpClient && !window.location.hash) {
      const defaultTab = serverCapabilities?.resources
        ? "resources"
        : serverCapabilities?.prompts
          ? "prompts"
          : serverCapabilities?.tools
            ? "tools"
            : "ping";
      window.location.hash = defaultTab;
    } else if (!mcpClient && window.location.hash) {
      // Clear hash when disconnected - completely remove the fragment
      window.history.replaceState(
        null,
        "",
        window.location.pathname + window.location.search,
      );
    }
  }, [mcpClient, serverCapabilities]);

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

  const callTool = async (
    name: string,
    params: Record<string, unknown>,
    toolMetadata?: Record<string, unknown>,
  ) => {
    lastToolCallOriginTabRef.current = currentTabRef.current;

    if (!inspectorClient) {
      throw new Error("InspectorClient is not connected");
    }

    try {
      // Find the tool schema to clean parameters properly
      const tool = inspectorTools.find((t) => t.name === name);
      const cleanedParams = tool?.inputSchema
        ? cleanParams(params, tool.inputSchema as JsonSchemaType)
        : params;

      // Merge general metadata with tool-specific metadata
      // Tool-specific metadata takes precedence over general metadata
      const generalMetadata = {
        ...metadata, // General metadata
        progressToken: String(progressTokenRef.current++),
      };
      const toolSpecificMetadata = toolMetadata
        ? Object.fromEntries(
            Object.entries(toolMetadata).map(([k, v]) => [k, String(v)]),
          )
        : undefined;

      const invocation = await inspectorClient.callTool(
        name,
        cleanedParams as Record<string, JsonValue>,
        generalMetadata,
        toolSpecificMetadata,
      );

      // Convert ToolCallInvocation to CompatibilityCallToolResult
      const compatibilityResult: CompatibilityCallToolResult = invocation.result
        ? {
            content: invocation.result.content || [],
            isError: false,
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
      // Clear any validation errors since tool execution completed
      setErrors((prev) => ({ ...prev, tools: null }));
    } catch (e) {
      const toolResult: CompatibilityCallToolResult = {
        content: [
          {
            type: "text",
            text: (e as Error).message ?? String(e),
          },
        ],
        isError: true,
      };
      setToolResult(toolResult);
      // Clear validation errors - tool execution errors are shown in ToolResults
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
        serverUrl={sseUrl}
        onBack={() => setIsAuthDebuggerVisible(false)}
        authState={authState}
        updateAuthState={updateAuthState}
      />
    </TabsContent>
  );

  if (window.location.pathname === "/oauth/callback") {
    const OAuthCallback = React.lazy(
      () => import("./components/OAuthCallback"),
    );
    return (
      <Suspense fallback={<div>Loading...</div>}>
        <OAuthCallback onConnect={onOAuthConnect} />
      </Suspense>
    );
  }

  if (window.location.pathname === "/oauth/callback/debug") {
    const OAuthDebugCallback = React.lazy(
      () => import("./components/OAuthDebugCallback"),
    );
    return (
      <Suspense fallback={<div>Loading...</div>}>
        <OAuthDebugCallback onConnect={onOAuthDebugConnect} />
      </Suspense>
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
          sseUrl={sseUrl}
          setSseUrl={setSseUrl}
          env={env}
          setEnv={setEnv}
          config={config}
          setConfig={setConfig}
          customHeaders={customHeaders}
          setCustomHeaders={setCustomHeaders}
          oauthClientId={oauthClientId}
          setOauthClientId={setOauthClientId}
          oauthClientSecret={oauthClientSecret}
          setOauthClientSecret={setOauthClientSecret}
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
        <div className="flex-1 overflow-auto">
          {mcpClient ? (
            <Tabs
              value={activeTab}
              className="w-full p-4"
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
                <TabsTrigger value="ping">
                  <Bell className="w-4 h-4 mr-2" />
                  Ping
                </TabsTrigger>
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

              <div className="w-full">
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
                        if (!mcpClient) {
                          throw new Error("MCP client is not connected");
                        }
                        try {
                          await mcpClient.request(
                            { method: "ping" },
                            EmptyResultSchema,
                          );
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
                      ) => {
                        clearError("tools");
                        setToolResult(null);
                        await callTool(name, params, metadata);
                      }}
                      selectedTool={selectedTool}
                      setSelectedTool={(tool) => {
                        clearError("tools");
                        setSelectedTool(tool);
                        setToolResult(null);
                      }}
                      toolResult={toolResult}
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
                        if (!mcpClient) {
                          throw new Error("MCP client is not connected");
                        }
                        try {
                          await mcpClient.request(
                            { method: "ping" },
                            EmptyResultSchema,
                          );
                        } catch (e) {
                          console.error("Ping failed:", e);
                          throw e;
                        }
                      }}
                    />
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
