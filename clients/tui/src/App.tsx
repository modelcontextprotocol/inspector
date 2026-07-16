import React, {
  useState,
  useMemo,
  useEffect,
  useCallback,
  useRef,
} from "react";
import { Box, Text, useInput, useApp, type Key } from "ink";
import type {
  MessageEntry,
  FetchRequestEntry,
  InspectorClientOptions,
  InspectorClientEnvironment,
} from "@inspector/core/mcp/index.js";
import type {
  Tool,
  Resource,
  Prompt,
  PromptArgument,
  GetPromptResult,
} from "@modelcontextprotocol/client";
import { InspectorClient } from "@inspector/core/mcp/index.js";
import {
  ManagedToolsState,
  ManagedResourcesState,
  ManagedResourceTemplatesState,
  ManagedPromptsState,
  MessageLogState,
  FetchRequestLogState,
  StderrLogState,
} from "@inspector/core/mcp/state/index.js";
import { createTransportNode } from "@inspector/core/mcp/node/index.js";
import { useInspectorClient } from "@inspector/core/react/useInspectorClient.js";
import { useManagedTools } from "@inspector/core/react/useManagedTools.js";
import { useManagedResources } from "@inspector/core/react/useManagedResources.js";
import { useManagedResourceTemplates } from "@inspector/core/react/useManagedResourceTemplates.js";
import { useManagedPrompts } from "@inspector/core/react/useManagedPrompts.js";
import { useMessageLog } from "@inspector/core/react/useMessageLog.js";
import { useFetchRequestLog } from "@inspector/core/react/useFetchRequestLog.js";
import { useStderrLog } from "@inspector/core/react/useStderrLog.js";
import {
  CallbackNavigation,
  MutableRedirectUrlProvider,
  isUnauthorizedError,
  AuthRecoveryRequiredError,
} from "@inspector/core/auth/index.js";
import type { AuthChallenge } from "@inspector/core/auth/challenge.js";
import type { TypedEvent } from "@inspector/core/mcp/inspectorClientEventTarget.js";
import { isEmaClientNotConfiguredError } from "@inspector/core/auth/ema/clientConfigError.js";
import type { ClientConfig } from "@inspector/core/client/types.js";
import {
  buildRunnerClientAuthOptions,
  isOAuthCapableServerConfig,
} from "@inspector/core/client/runner.js";
import { formatRunnerOAuthRedirectUrl } from "@inspector/core/auth/node/runner-oauth-callback.js";
import { readInspectorVersion } from "@inspector/core/node/version.js";
import {
  createOAuthCallbackServer,
  type OAuthCallbackServer,
  NodeOAuthStorage,
  runRunnerInteractiveOAuth,
} from "@inspector/core/auth/node/index.js";
import { getTuiLogger } from "./logger.js";
import { openUrl } from "./utils/openUrl.js";
import {
  isStepUpConfirmation,
  stepUpInsufficientScopeMessage,
} from "./utils/tuiOAuth.js";
import { emaStepUpFailureMessage } from "@inspector/core/auth/oauthUx.js";
import { Tabs } from "./components/Tabs.js";
import { type TabType, tabs as tabList } from "./components/tabsConfig.js";
import { InfoTab } from "./components/InfoTab.js";
import { AuthTab } from "./components/AuthTab.js";
import { ResourcesTab } from "./components/ResourcesTab.js";
import { PromptsTab } from "./components/PromptsTab.js";
import { ToolsTab } from "./components/ToolsTab.js";
import { NotificationsTab } from "./components/NotificationsTab.js";
import { HistoryTab } from "./components/HistoryTab.js";
import { RequestsTab } from "./components/RequestsTab.js";
import { ToolTestModal } from "./components/ToolTestModal.js";
import { ResourceTestModal } from "./components/ResourceTestModal.js";
import { PromptTestModal } from "./components/PromptTestModal.js";
import { DetailsModal } from "./components/DetailsModal.js";
import type { TuiServer } from "./tui-servers.js";

// Header branding. The version is the single source of truth — the root
// package.json — read via the shared core reader; the name/description are the
// TUI's own display strings (they live in code, not the npm manifest, which no
// longer carries them per-client).
const APP_NAME = "MCP Inspector TUI";
const APP_DESCRIPTION =
  "Terminal User Interface for the Model Context Protocol Inspector";
const APP_VERSION = readInspectorVersion(import.meta.url);

/** Client identity name the TUI reports to servers. */
const TUI_CLIENT_NAME = "inspector-tui";

// Focus management types
type FocusArea =
  | "serverList"
  | "tabs"
  // Used by Resources/Prompts/Tools - list pane
  | "tabContentList"
  // Used by Resources/Prompts/Tools - details pane
  | "tabContentDetails"
  // Used only when activeTab === 'messages'
  | "messagesList"
  | "messagesDetail"
  // Used only when activeTab === 'requests'
  | "requestsList"
  | "requestsDetail";

interface AppProps {
  mcpServers: Record<string, TuiServer>;
  clientConfig: ClientConfig;
  clientId?: string;
  clientSecret?: string;
  clientMetadataUrl?: string;
  callbackUrlConfig: {
    hostname: string;
    port: number;
    pathname: string;
  };
}

function App({
  mcpServers,
  clientConfig,
  clientId,
  clientSecret,
  clientMetadataUrl,
  callbackUrlConfig,
}: AppProps) {
  const { exit } = useApp();

  useEffect(() => {
    getTuiLogger().info(
      { serverNames: Object.keys(mcpServers) },
      "TUI started",
    );
  }, [mcpServers]);

  const [selectedServer, setSelectedServer] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<TabType>("info");
  const [focus, setFocus] = useState<FocusArea>("serverList");
  const [tabCounts, setTabCounts] = useState<{
    info?: number;
    resources?: number;
    prompts?: number;
    tools?: number;
    messages?: number;
    requests?: number;
    logging?: number;
  }>({});
  const [oauthStatus, setOauthStatus] = useState<
    "idle" | "authenticating" | "error"
  >("idle");
  const [oauthMessage, setOauthMessage] = useState<string | null>(null);
  const [oauthRevision, setOauthRevision] = useState(0);
  const [pendingStepUp, setPendingStepUp] = useState<{
    serverName: string;
    challenge: AuthChallenge;
    authorizationUrl: URL;
    enterpriseManaged?: boolean;
  } | null>(null);
  const pendingStepUpRef = useRef(pendingStepUp);
  useEffect(() => {
    pendingStepUpRef.current = pendingStepUp;
  }, [pendingStepUp]);
  const [connectError, setConnectError] = useState<string | null>(null);
  const oauthInProgressRef = useRef(false);
  const callbackServerRef = useRef<OAuthCallbackServer | null>(null);
  const selectedServerRef = useRef<string | null>(null);
  const mcpServersRef = useRef(mcpServers);
  const inspectorClientsRef = useRef<Record<string, InspectorClient>>({});

  // Tool test modal state
  const [toolTestModal, setToolTestModal] = useState<{
    tool: Tool;
    inspectorClient: InspectorClient | null;
  } | null>(null);

  // Resource test modal state
  const [resourceTestModal, setResourceTestModal] = useState<{
    template: {
      name: string;
      uriTemplate: string;
      description?: string;
    };
    inspectorClient: InspectorClient | null;
  } | null>(null);

  // Prompt test modal state
  const [promptTestModal, setPromptTestModal] = useState<{
    prompt: Prompt;
    inspectorClient: InspectorClient | null;
  } | null>(null);

  // Details modal state
  const [detailsModal, setDetailsModal] = useState<{
    title: string;
    content: React.ReactNode;
  } | null>(null);

  // InspectorClient instances for each server
  const [inspectorClients, setInspectorClients] = useState<
    Record<string, InspectorClient>
  >({});
  // ManagedToolsState per server (tools list from manager, not client)
  const [managedToolsStates, setManagedToolsStates] = useState<
    Record<string, ManagedToolsState>
  >({});
  const [managedResourcesStates, setManagedResourcesStates] = useState<
    Record<string, ManagedResourcesState>
  >({});
  const [managedResourceTemplatesStates, setManagedResourceTemplatesStates] =
    useState<Record<string, ManagedResourceTemplatesState>>({});
  const [managedPromptsStates, setManagedPromptsStates] = useState<
    Record<string, ManagedPromptsState>
  >({});
  const [messageLogStates, setMessageLogStates] = useState<
    Record<string, MessageLogState>
  >({});
  const [fetchRequestLogStates, setFetchRequestLogStates] = useState<
    Record<string, FetchRequestLogState>
  >({});
  const [stderrLogStates, setStderrLogStates] = useState<
    Record<string, StderrLogState>
  >({});
  const [dimensions, setDimensions] = useState({
    width: process.stdout.columns || 80,
    height: process.stdout.rows || 24,
  });

  useEffect(() => {
    const updateDimensions = () => {
      setDimensions({
        width: process.stdout.columns || 80,
        height: process.stdout.rows || 24,
      });
    };

    process.stdout.on("resize", updateDimensions);
    return () => {
      process.stdout.off("resize", updateDimensions);
    };
  }, []);

  const serverNames = Object.keys(mcpServers);
  const selectedServerEntry = selectedServer
    ? mcpServers[selectedServer]
    : null;
  const selectedServerConfig = selectedServerEntry?.config ?? null;

  // Mutable redirect URL providers, keyed by server name (populated before authenticate)
  const redirectUrlProvidersRef = useRef<
    Record<string, MutableRedirectUrlProvider>
  >({});

  // Create InspectorClient and state managers for each server on mount
  useEffect(() => {
    const newClients: Record<string, InspectorClient> = {};
    const newManagers: Record<string, ManagedToolsState> = {};
    const newManagedResourcesStates: Record<string, ManagedResourcesState> = {};
    const newManagedResourceTemplatesStates: Record<
      string,
      ManagedResourceTemplatesState
    > = {};
    const newManagedPromptsStates: Record<string, ManagedPromptsState> = {};
    const newMessageLogStates: Record<string, MessageLogState> = {};
    const newFetchRequestLogStates: Record<string, FetchRequestLogState> = {};
    const newStderrLogStates: Record<string, StderrLogState> = {};
    for (const serverName of serverNames) {
      if (!(serverName in inspectorClients)) {
        const { config: serverConfig, settings: savedSettings } =
          mcpServers[serverName]!;
        const environment: InspectorClientEnvironment = {
          transport: createTransportNode,
          logger: getTuiLogger(),
        };
        const defaultMetadata = savedSettings?.metadata
          ? Object.fromEntries(
              savedSettings.metadata
                .filter((m) => m.key.trim() !== "")
                .map((m) => [m.key, m.value]),
            )
          : undefined;
        const clientAuthOptions = buildRunnerClientAuthOptions(
          clientConfig,
          savedSettings,
          { clientId, clientSecret, clientMetadataUrl },
        );
        const opts: InspectorClientOptions = {
          environment,
          clientIdentity: { name: TUI_CLIENT_NAME, version: APP_VERSION },
          pipeStderr: true,
          ...(savedSettings &&
            savedSettings.requestTimeout > 0 && {
              timeout: savedSettings.requestTimeout,
            }),
          ...(defaultMetadata &&
            Object.keys(defaultMetadata).length > 0 && {
              defaultMetadata,
            }),
          ...(savedSettings && { serverSettings: savedSettings }),
          ...clientAuthOptions,
        };
        if (isOAuthCapableServerConfig(serverConfig)) {
          const redirectUrlProvider =
            redirectUrlProvidersRef.current[serverName] ??
            (redirectUrlProvidersRef.current[serverName] =
              new MutableRedirectUrlProvider());
          redirectUrlProvider.redirectUrl =
            formatRunnerOAuthRedirectUrl(callbackUrlConfig);
          environment.oauth = {
            storage: new NodeOAuthStorage(),
            navigation: new CallbackNavigation(
              async (url) => await openUrl(url),
            ),
            redirectUrlProvider,
          };
        }
        const client = new InspectorClient(serverConfig, opts);
        newClients[serverName] = client;
        newManagers[serverName] = new ManagedToolsState(client);
        newManagedResourcesStates[serverName] = new ManagedResourcesState(
          client,
        );
        newManagedResourceTemplatesStates[serverName] =
          new ManagedResourceTemplatesState(client);
        newManagedPromptsStates[serverName] = new ManagedPromptsState(client);
        newMessageLogStates[serverName] = new MessageLogState(client);
        newFetchRequestLogStates[serverName] = new FetchRequestLogState(client);
        newStderrLogStates[serverName] = new StderrLogState(client);
      }
    }
    if (Object.keys(newClients).length > 0) {
      setInspectorClients((prev) => ({ ...prev, ...newClients }));
      setManagedToolsStates((prev) => ({ ...prev, ...newManagers }));
      setManagedResourcesStates((prev) => ({
        ...prev,
        ...newManagedResourcesStates,
      }));
      setManagedResourceTemplatesStates((prev) => ({
        ...prev,
        ...newManagedResourceTemplatesStates,
      }));
      setManagedPromptsStates((prev) => ({
        ...prev,
        ...newManagedPromptsStates,
      }));
      setMessageLogStates((prev) => ({ ...prev, ...newMessageLogStates }));
      setFetchRequestLogStates((prev) => ({
        ...prev,
        ...newFetchRequestLogStates,
      }));
      setStderrLogStates((prev) => ({ ...prev, ...newStderrLogStates }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    clientConfig,
    clientId,
    clientSecret,
    clientMetadataUrl,
    callbackUrlConfig,
  ]);

  // Cleanup: destroy managers and disconnect all clients on unmount
  useEffect(() => {
    return () => {
      void callbackServerRef.current?.stop();
      callbackServerRef.current = null;
      Object.values(managedToolsStates).forEach((manager) => {
        manager.destroy();
      });
      Object.values(managedResourcesStates).forEach((manager) => {
        manager.destroy();
      });
      Object.values(managedResourceTemplatesStates).forEach((manager) => {
        manager.destroy();
      });
      Object.values(managedPromptsStates).forEach((manager) => {
        manager.destroy();
      });
      Object.values(messageLogStates).forEach((manager) => {
        manager.destroy();
      });
      Object.values(fetchRequestLogStates).forEach((manager) => {
        manager.destroy();
      });
      Object.values(stderrLogStates).forEach((manager) => {
        manager.destroy();
      });
      Object.values(inspectorClients).forEach((client) => {
        client.disconnect().catch(() => {
          // Ignore errors during cleanup
        });
      });
    };
  }, [
    inspectorClients,
    managedToolsStates,
    managedResourcesStates,
    managedResourceTemplatesStates,
    managedPromptsStates,
    messageLogStates,
    fetchRequestLogStates,
    stderrLogStates,
  ]);

  // Preselect the first server on mount
  useEffect(() => {
    if (serverNames.length > 0 && selectedServer === null) {
      setSelectedServer(serverNames[0]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Clear OAuth status when switching servers; drop step-up for other servers.
  useEffect(() => {
    setOauthStatus("idle");
    setOauthMessage(null);
    const stepUp = pendingStepUpRef.current;
    if (stepUp && selectedServer && stepUp.serverName !== selectedServer) {
      setPendingStepUp(null);
    }
  }, [selectedServer]);

  useEffect(() => {
    selectedServerRef.current = selectedServer;
    mcpServersRef.current = mcpServers;
    inspectorClientsRef.current = inspectorClients;
  }, [selectedServer, mcpServers, inspectorClients]);

  // Switch away from Auth tab when server is not OAuth-capable
  useEffect(() => {
    if (
      activeTab === "auth" &&
      selectedServerConfig &&
      !isOAuthCapableServerConfig(selectedServerConfig)
    ) {
      setActiveTab("info");
    }
  }, [activeTab, selectedServerConfig]);

  // Get InspectorClient for selected server
  const selectedInspectorClient = useMemo(
    () => (selectedServer ? inspectorClients[selectedServer] : null),
    [selectedServer, inspectorClients],
  );

  // Use the hook to get reactive state from InspectorClient
  const {
    status: inspectorStatus,
    capabilities: inspectorCapabilities,
    serverInfo: inspectorServerInfo,
    instructions: inspectorInstructions,
    connect: connectInspector,
    disconnect: disconnectInspector,
    lastError: inspectorLastError,
  } = useInspectorClient(selectedInspectorClient);

  // Log state from managers (per-server)
  const selectedMessageLogState = useMemo(
    () =>
      selectedServer && messageLogStates[selectedServer]
        ? messageLogStates[selectedServer]
        : null,
    [selectedServer, messageLogStates],
  );
  const selectedFetchRequestLogState = useMemo(
    () =>
      selectedServer && fetchRequestLogStates[selectedServer]
        ? fetchRequestLogStates[selectedServer]
        : null,
    [selectedServer, fetchRequestLogStates],
  );
  const selectedStderrLogState = useMemo(
    () =>
      selectedServer && stderrLogStates[selectedServer]
        ? stderrLogStates[selectedServer]
        : null,
    [selectedServer, stderrLogStates],
  );
  const { messages: inspectorMessages } = useMessageLog(
    selectedMessageLogState,
  );
  const { fetchRequests: inspectorFetchRequests } = useFetchRequestLog(
    selectedFetchRequestLogState,
  );
  const { stderrLogs: inspectorStderrLogs } = useStderrLog(
    selectedStderrLogState,
  );

  // Tools from ManagedToolsState (full list, auto-load on connect)
  const selectedManagedToolsState = useMemo(
    () =>
      selectedServer && managedToolsStates[selectedServer]
        ? managedToolsStates[selectedServer]
        : null,
    [selectedServer, managedToolsStates],
  );
  const { tools: managedTools } = useManagedTools(
    selectedInspectorClient,
    selectedManagedToolsState,
  );

  // Resources, resource templates, prompts from managed state managers
  const selectedManagedResourcesState = useMemo(
    () =>
      selectedServer && managedResourcesStates[selectedServer]
        ? managedResourcesStates[selectedServer]
        : null,
    [selectedServer, managedResourcesStates],
  );
  const selectedManagedResourceTemplatesState = useMemo(
    () =>
      selectedServer && managedResourceTemplatesStates[selectedServer]
        ? managedResourceTemplatesStates[selectedServer]
        : null,
    [selectedServer, managedResourceTemplatesStates],
  );
  const selectedManagedPromptsState = useMemo(
    () =>
      selectedServer && managedPromptsStates[selectedServer]
        ? managedPromptsStates[selectedServer]
        : null,
    [selectedServer, managedPromptsStates],
  );
  const { resources: managedResources } = useManagedResources(
    selectedInspectorClient,
    selectedManagedResourcesState,
  );
  const { resourceTemplates: managedResourceTemplates } =
    useManagedResourceTemplates(
      selectedInspectorClient,
      selectedManagedResourceTemplatesState,
    );
  const { prompts: managedPrompts } = useManagedPrompts(
    selectedInspectorClient,
    selectedManagedPromptsState,
  );

  // Connect — on 401 or mid-session auth recovery, run OAuth then retry.
  type TuiOAuthRunResult =
    | "success"
    | "already_authorized"
    | "insufficient_scope"
    | "skipped"
    | "unsupported";

  const runOAuthAuthentication = useCallback(
    async (options?: {
      challenge?: AuthChallenge;
      authorizationUrl?: URL;
      /** When set, run OAuth for this server (may differ from the selected server). */
      serverName?: string;
    }): Promise<TuiOAuthRunResult> => {
      const serverName = options?.serverName ?? selectedServer;
      if (!serverName) {
        return "unsupported";
      }
      const client = inspectorClientsRef.current[serverName];
      const serverEntry = mcpServersRef.current[serverName];
      const serverConfig = serverEntry?.config;
      if (
        !client ||
        !serverConfig ||
        !isOAuthCapableServerConfig(serverConfig)
      ) {
        return "unsupported";
      }
      if (oauthInProgressRef.current) {
        return "skipped";
      }
      oauthInProgressRef.current = true;
      getTuiLogger().info(
        { server: serverName },
        "OAuth authentication started",
      );
      const existing = callbackServerRef.current;
      if (existing) {
        await existing.stop();
        callbackServerRef.current = null;
      }
      const redirectUrlProvider = redirectUrlProvidersRef.current[serverName];
      if (!redirectUrlProvider) {
        oauthInProgressRef.current = false;
        return "unsupported";
      }
      try {
        const result = await runRunnerInteractiveOAuth({
          client,
          redirectUrlProvider,
          callbackListen: callbackUrlConfig,
          createCallbackServer: createOAuthCallbackServer,
          onCallbackServer: (server) => {
            callbackServerRef.current = server;
          },
          authorizationUrl: options?.authorizationUrl,
          authChallenge: options?.challenge,
        });

        if (result.kind === "insufficient_scope") {
          setOauthStatus("error");
          setOauthMessage(stepUpInsufficientScopeMessage(result.challenge));
          return "insufficient_scope";
        }
        if (result.kind === "success" || result.kind === "already_authorized") {
          setOauthRevision((n) => n + 1);
          return result.kind;
        }
        return "unsupported";
      } finally {
        oauthInProgressRef.current = false;
        callbackServerRef.current = null;
      }
    },
    [selectedServer, callbackUrlConfig],
  );

  const presentStepUpForServer = useCallback(
    (
      serverName: string,
      challenge: AuthChallenge,
      authorizationUrl: URL,
      enterpriseManaged?: boolean,
    ) => {
      const pending = pendingStepUpRef.current;
      if (pending && pending.serverName !== serverName) {
        setOauthMessage(
          "A step-up prompt is already open. Complete or decline it before continuing.",
        );
        return;
      }
      if (pending?.serverName === serverName) {
        setOauthMessage(
          "Updated step-up request — review the scopes on the Auth tab.",
        );
      } else {
        setOauthMessage(null);
      }
      setSelectedServer(serverName);
      setPendingStepUp({
        serverName,
        challenge,
        authorizationUrl,
        enterpriseManaged,
      });
      setActiveTab("auth");
      setOauthStatus("idle");
      setFocus("tabContentList");
    },
    [],
  );

  const handleAuthRecoveryRequired = useCallback(
    (serverName: string, error: AuthRecoveryRequiredError) => {
      const serverEntry = mcpServersRef.current[serverName];
      const settings = serverEntry?.settings;
      const client = inspectorClientsRef.current[serverName];
      const needsStepUpConfirm =
        error.emaStepUpConfirm ||
        isStepUpConfirmation(error.authChallenge, settings);
      if (needsStepUpConfirm) {
        void (async () => {
          if (
            client &&
            (await client.checkAuthChallengeSatisfied(error.authChallenge))
          ) {
            setOauthStatus("idle");
            setOauthMessage("Authorization updated. Retry your action.");
            setOauthRevision((n) => n + 1);
            return;
          }
          presentStepUpForServer(
            serverName,
            error.authChallenge,
            error.authorizationUrl,
            settings?.enterpriseManaged,
          );
        })();
        return;
      }
      void (async () => {
        if (
          client &&
          (await client.checkAuthChallengeSatisfied(error.authChallenge))
        ) {
          setOauthStatus("idle");
          setOauthMessage("Authorization updated. Retry your action.");
          setOauthRevision((n) => n + 1);
          return;
        }
        const needsSwitch = selectedServerRef.current !== serverName;
        if (needsSwitch) {
          setSelectedServer(serverName);
          setActiveTab("auth");
          setOauthMessage(
            `Authentication required for "${serverName}". Re-authenticating…`,
          );
        } else {
          setOauthMessage(null);
        }
        setOauthStatus("authenticating");
        try {
          const oauthResult = await runOAuthAuthentication({
            challenge: error.authChallenge,
            authorizationUrl: error.authorizationUrl,
            serverName,
          });
          if (
            oauthResult === "success" ||
            oauthResult === "already_authorized"
          ) {
            setOauthStatus("idle");
            setOauthMessage("Authorization updated. Retry your action.");
          } else if (oauthResult === "skipped") {
            setOauthStatus("idle");
            setOauthMessage("OAuth already in progress.");
          }
        } catch (authErr) {
          const authMsg =
            authErr instanceof Error ? authErr.message : String(authErr);
          setOauthStatus("error");
          setOauthMessage(authMsg);
        }
      })();
    },
    [presentStepUpForServer, runOAuthAuthentication],
  );

  const onAuthRecoveryRequired = useCallback(
    (error: AuthRecoveryRequiredError) => {
      if (selectedServer) {
        handleAuthRecoveryRequired(selectedServer, error);
      }
    },
    [selectedServer, handleAuthRecoveryRequired],
  );

  const handleConnect = useCallback(async () => {
    if (!selectedServer || !selectedInspectorClient || !selectedServerConfig) {
      return;
    }

    const finishConnect = async () => {
      await connectInspector();
      setConnectError(null);
      setOauthStatus("idle");
      setOauthMessage(null);
      setOauthRevision((n) => n + 1);
    };

    try {
      await finishConnect();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setConnectError(msg);

      if (isEmaClientNotConfiguredError(err)) {
        setOauthStatus("error");
        setOauthMessage(err.message);
        return;
      }

      if (
        isOAuthCapableServerConfig(selectedServerConfig) &&
        isUnauthorizedError(err)
      ) {
        try {
          setOauthStatus("authenticating");
          setOauthMessage(null);
          await disconnectInspector();
          const oauthResult = await runOAuthAuthentication();
          if (
            oauthResult === "success" ||
            oauthResult === "already_authorized"
          ) {
            await finishConnect();
          } else if (oauthResult === "skipped") {
            setOauthStatus("idle");
            setOauthMessage("OAuth already in progress.");
          }
        } catch (authErr) {
          if (authErr instanceof AuthRecoveryRequiredError) {
            handleAuthRecoveryRequired(selectedServer, authErr);
            return;
          }
          const authMsg =
            authErr instanceof Error ? authErr.message : String(authErr);
          setConnectError(authMsg);
          if (isEmaClientNotConfiguredError(authErr)) {
            setOauthStatus("error");
            setOauthMessage(authErr.message);
            return;
          }
          setOauthStatus("error");
          setOauthMessage(authMsg);
        }
        return;
      }

      if (err instanceof AuthRecoveryRequiredError && selectedServer) {
        handleAuthRecoveryRequired(selectedServer, err);
        return;
      }
    }
  }, [
    selectedServer,
    selectedInspectorClient,
    selectedServerConfig,
    connectInspector,
    disconnectInspector,
    runOAuthAuthentication,
    handleAuthRecoveryRequired,
  ]);

  useEffect(() => {
    const cleanups: Array<() => void> = [];

    for (const [serverName, client] of Object.entries(inspectorClients)) {
      const onAmbient = (): void => {
        if (selectedServerRef.current !== serverName) return;
        setOauthStatus("idle");
        setOauthMessage("Refreshing authorization…");
      };
      const onRecovered = (): void => {
        if (selectedServerRef.current !== serverName) return;
        setOauthMessage(null);
        setOauthRevision((n) => n + 1);
      };
      const onInteractive = (
        event: TypedEvent<"authChallengeInteractive">,
      ): void => {
        handleAuthRecoveryRequired(
          serverName,
          new AuthRecoveryRequiredError(
            event.detail.authorizationUrl,
            event.detail.challenge,
          ),
        );
      };
      const onOAuthError = (event: TypedEvent<"oauthError">): void => {
        if (selectedServerRef.current !== serverName) return;
        const message =
          event.detail.error instanceof Error
            ? event.detail.error.message
            : String(event.detail.error);
        setOauthStatus("error");
        setOauthMessage(message);
      };

      client.addEventListener("authChallengeAmbient", onAmbient);
      client.addEventListener("authChallengeRecovered", onRecovered);
      client.addEventListener("authChallengeInteractive", onInteractive);
      client.addEventListener("oauthError", onOAuthError);
      cleanups.push(() => {
        client.removeEventListener("authChallengeAmbient", onAmbient);
        client.removeEventListener("authChallengeRecovered", onRecovered);
        client.removeEventListener("authChallengeInteractive", onInteractive);
        client.removeEventListener("oauthError", onOAuthError);
      });
    }

    return () => {
      for (const cleanup of cleanups) {
        cleanup();
      }
    };
  }, [inspectorClients, handleAuthRecoveryRequired]);

  // Disconnect handler
  const handleDisconnect = useCallback(async () => {
    if (!selectedServer) return;
    await disconnectInspector();
    // InspectorClient will update status automatically, and data is preserved
  }, [selectedServer, disconnectInspector]);

  const handleClearOAuth = useCallback(async () => {
    if (!selectedInspectorClient) return;
    await selectedInspectorClient.clearOAuthTokens();
    setOauthStatus("idle");
    setOauthMessage(null);
    setConnectError(null);
    if (inspectorStatus === "connected" || inspectorStatus === "connecting") {
      await disconnectInspector();
    }
    setOauthRevision((n) => n + 1);
  }, [selectedInspectorClient, inspectorStatus, disconnectInspector]);

  // Build current server state from InspectorClient data (tools from ManagedToolsState)
  const currentServerState = useMemo(() => {
    if (!selectedServer) return null;
    return {
      status: inspectorStatus,
      error: connectError ?? inspectorLastError ?? null,
      capabilities: inspectorCapabilities,
      serverInfo: inspectorServerInfo,
      instructions: inspectorInstructions,
      resources: managedResources,
      resourceTemplates: managedResourceTemplates,
      prompts: managedPrompts,
      tools: managedTools,
      stderrLogs: inspectorStderrLogs, // InspectorClient manages this
    };
  }, [
    selectedServer,
    inspectorStatus,
    connectError,
    inspectorLastError,
    inspectorCapabilities,
    inspectorServerInfo,
    inspectorInstructions,
    managedResources,
    managedResourceTemplates,
    managedPrompts,
    managedTools,
    inspectorStderrLogs,
  ]);

  const renderResourceDetails = (
    resource:
      | Resource
      | {
          content: import("@modelcontextprotocol/client").ReadResourceResult;
        },
  ) => (
    <>
      {"uri" in resource && resource.description && (
        <>
          {resource.description.split("\n").map((line: string, idx: number) => (
            <Box
              key={`desc-${idx}`}
              marginTop={idx === 0 ? 0 : 0}
              flexShrink={0}
            >
              <Text dimColor>{line}</Text>
            </Box>
          ))}
        </>
      )}
      {"uri" in resource && resource.uri && (
        <Box marginTop={1} flexShrink={0}>
          <Text bold>URI:</Text>
          <Box paddingLeft={2}>
            <Text dimColor>{resource.uri}</Text>
          </Box>
        </Box>
      )}
      {"mimeType" in resource && resource.mimeType && (
        <Box marginTop={1} flexShrink={0}>
          <Text bold>MIME Type:</Text>
          <Box paddingLeft={2}>
            <Text dimColor>{resource.mimeType}</Text>
          </Box>
        </Box>
      )}
      <Box marginTop={1} flexShrink={0} flexDirection="column">
        <Text bold>Full JSON:</Text>
        <Box paddingLeft={2}>
          <Text dimColor>{JSON.stringify(resource, null, 2)}</Text>
        </Box>
      </Box>
    </>
  );

  const renderPromptDetails = (
    prompt: Prompt & { result?: GetPromptResult },
  ) => (
    <>
      {prompt.description && (
        <>
          {prompt.description.split("\n").map((line: string, idx: number) => (
            <Box
              key={`desc-${idx}`}
              marginTop={idx === 0 ? 0 : 0}
              flexShrink={0}
            >
              <Text dimColor>{line}</Text>
            </Box>
          ))}
        </>
      )}
      {prompt.arguments && prompt.arguments.length > 0 && (
        <>
          <Box marginTop={1} flexShrink={0}>
            <Text bold>Arguments:</Text>
          </Box>
          {prompt.arguments.map((arg: PromptArgument, idx: number) => (
            <Box
              key={`arg-${idx}`}
              marginTop={1}
              paddingLeft={2}
              flexShrink={0}
            >
              <Text dimColor>
                - {arg.name}:{" "}
                {arg.description ?? (arg as { type?: string }).type ?? "string"}
              </Text>
            </Box>
          ))}
        </>
      )}
      <Box marginTop={1} flexShrink={0} flexDirection="column">
        <Text bold>Full JSON:</Text>
        <Box paddingLeft={2}>
          <Text dimColor>{JSON.stringify(prompt, null, 2)}</Text>
        </Box>
      </Box>
    </>
  );

  const renderToolDetails = (tool: Tool) => (
    <>
      {tool.description && (
        <>
          {tool.description.split("\n").map((line: string, idx: number) => (
            <Box
              key={`desc-${idx}`}
              marginTop={idx === 0 ? 0 : 0}
              flexShrink={0}
            >
              <Text dimColor>{line}</Text>
            </Box>
          ))}
        </>
      )}
      {tool.inputSchema && (
        <Box marginTop={1} flexShrink={0} flexDirection="column">
          <Text bold>Input Schema:</Text>
          <Box paddingLeft={2}>
            <Text dimColor>{JSON.stringify(tool.inputSchema, null, 2)}</Text>
          </Box>
        </Box>
      )}
      <Box marginTop={1} flexShrink={0} flexDirection="column">
        <Text bold>Full JSON:</Text>
        <Box paddingLeft={2}>
          <Text dimColor>{JSON.stringify(tool, null, 2)}</Text>
        </Box>
      </Box>
    </>
  );

  const renderRequestDetails = (request: FetchRequestEntry) => (
    <>
      <Box flexShrink={0}>
        <Text bold>
          {request.method} {request.url}
        </Text>
      </Box>
      <Box marginTop={1} flexShrink={0}>
        <Text bold>
          Category:{" "}
          <Text>{request.category === "auth" ? "auth" : "transport"}</Text>
        </Text>
      </Box>
      {request.responseStatus !== undefined ? (
        <Box marginTop={1} flexShrink={0}>
          <Text bold>
            Status: {request.responseStatus} {request.responseStatusText || ""}
          </Text>
        </Box>
      ) : request.error ? (
        <Box marginTop={1} flexShrink={0}>
          <Text bold color="red">
            Error: {request.error}
          </Text>
        </Box>
      ) : null}
      {request.duration !== undefined && (
        <Box marginTop={1} flexShrink={0}>
          <Text dimColor>
            {request.timestamp.toLocaleTimeString()} ({request.duration}ms)
          </Text>
        </Box>
      )}
      <Box marginTop={1} flexShrink={0}>
        <Text bold>Request Headers:</Text>
        {Object.entries(request.requestHeaders).map(([key, value]) => (
          <Box key={key} marginTop={0} paddingLeft={2} flexShrink={0}>
            <Text dimColor>
              {key}: {value}
            </Text>
          </Box>
        ))}
      </Box>
      {request.requestBody && (
        <>
          <Box marginTop={1} flexShrink={0}>
            <Text bold>Request Body:</Text>
          </Box>
          {(() => {
            try {
              const parsed = JSON.parse(request.requestBody);
              return JSON.stringify(parsed, null, 2)
                .split("\n")
                .map((line: string, idx: number) => (
                  <Box
                    key={`req-body-${idx}`}
                    marginTop={idx === 0 ? 1 : 0}
                    paddingLeft={2}
                    flexShrink={0}
                  >
                    <Text dimColor>{line}</Text>
                  </Box>
                ));
            } catch {
              return (
                <Box marginTop={1} paddingLeft={2} flexShrink={0}>
                  <Text dimColor>{request.requestBody}</Text>
                </Box>
              );
            }
          })()}
        </>
      )}
      {request.responseHeaders &&
        Object.keys(request.responseHeaders).length > 0 && (
          <>
            <Box marginTop={1} flexShrink={0}>
              <Text bold>Response Headers:</Text>
            </Box>
            {Object.entries(request.responseHeaders).map(([key, value]) => (
              <Box key={key} marginTop={0} paddingLeft={2} flexShrink={0}>
                <Text dimColor>
                  {key}: {value}
                </Text>
              </Box>
            ))}
          </>
        )}
      {request.responseBody && (
        <>
          <Box marginTop={1} flexShrink={0}>
            <Text bold>Response Body:</Text>
          </Box>
          {(() => {
            try {
              const parsed = JSON.parse(request.responseBody);
              return JSON.stringify(parsed, null, 2)
                .split("\n")
                .map((line: string, idx: number) => (
                  <Box
                    key={`resp-body-${idx}`}
                    marginTop={idx === 0 ? 1 : 0}
                    paddingLeft={2}
                    flexShrink={0}
                  >
                    <Text dimColor>{line}</Text>
                  </Box>
                ));
            } catch {
              return (
                <Box marginTop={1} paddingLeft={2} flexShrink={0}>
                  <Text dimColor>{request.responseBody}</Text>
                </Box>
              );
            }
          })()}
        </>
      )}
    </>
  );

  const renderMessageDetails = (message: MessageEntry) => (
    <>
      <Box flexShrink={0}>
        <Text bold>Direction: {message.direction}</Text>
      </Box>
      <Box marginTop={1} flexShrink={0}>
        <Text dimColor>
          {message.timestamp.toLocaleTimeString()}
          {message.duration !== undefined && ` (${message.duration}ms)`}
        </Text>
      </Box>
      {message.direction === "request" ? (
        <>
          <Box marginTop={1} flexShrink={0} flexDirection="column">
            <Text bold>Request:</Text>
            <Box paddingLeft={2}>
              <Text dimColor>{JSON.stringify(message.message, null, 2)}</Text>
            </Box>
          </Box>
          {message.response && (
            <Box marginTop={1} flexShrink={0} flexDirection="column">
              <Text bold>Response:</Text>
              <Box paddingLeft={2}>
                <Text dimColor>
                  {JSON.stringify(message.response, null, 2)}
                </Text>
              </Box>
            </Box>
          )}
        </>
      ) : (
        <Box marginTop={1} flexShrink={0} flexDirection="column">
          <Text bold>
            {message.direction === "response" ? "Response:" : "Notification:"}
          </Text>
          <Box paddingLeft={2}>
            <Text dimColor>{JSON.stringify(message.message, null, 2)}</Text>
          </Box>
        </Box>
      )}
    </>
  );

  // Update tab counts when selected server changes or InspectorClient state changes
  // Just reflect InspectorClient state - don't try to be clever
  useEffect(() => {
    if (!selectedServer) {
      return;
    }

    setTabCounts({
      resources: managedResources.length || 0,
      prompts: managedPrompts.length || 0,
      tools: managedTools.length || 0,
      messages: inspectorMessages.length || 0,
      requests: inspectorFetchRequests.length || 0,
      logging: inspectorStderrLogs.length || 0,
    });
  }, [
    selectedServer,
    managedResources,
    managedPrompts,
    managedTools,
    inspectorMessages,
    inspectorFetchRequests,
    inspectorStderrLogs,
  ]);

  // Keep focus state consistent when switching tabs (only adjust if focus is already in tab content)
  useEffect(() => {
    if (activeTab === "messages") {
      if (focus === "tabContentList" || focus === "tabContentDetails") {
        setFocus("messagesList");
      }
    } else if (activeTab === "requests") {
      if (focus === "tabContentList" || focus === "tabContentDetails") {
        setFocus("requestsList");
      }
    } else {
      if (
        focus === "messagesList" ||
        focus === "messagesDetail" ||
        focus === "requestsList" ||
        focus === "requestsDetail"
      ) {
        setFocus("tabContentList");
      }
    }
    // Intentionally not depending on focus to avoid loops
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab]);

  // Switch away from logging tab if server is not stdio
  useEffect(() => {
    if (activeTab === "logging" && selectedServer) {
      const client = inspectorClients[selectedServer];
      if (client && client.getServerType() !== "stdio") {
        setActiveTab("info");
      }
    }
  }, [selectedServer, activeTab, inspectorClients]);

  useInput((input: string, key: Key) => {
    // Don't process input when modal is open
    if (toolTestModal || resourceTestModal || promptTestModal || detailsModal) {
      return;
    }

    if (key.ctrl && input === "c") {
      exit();
    }

    // Exit accelerators
    if (key.escape) {
      exit();
    }

    // Tab switching with accelerator keys (first character of tab name)
    const showAuthTab =
      !!selectedServer &&
      !!selectedServerConfig &&
      isOAuthCapableServerConfig(selectedServerConfig);
    const showLoggingTab =
      !!selectedServer &&
      inspectorClients[selectedServer]?.getServerType() === "stdio";
    const showRequestsTab =
      !!selectedServer &&
      (inspectorClients[selectedServer]?.getServerType() === "sse" ||
        inspectorClients[selectedServer]?.getServerType() ===
          "streamable-http");
    const tabAccelerators: Record<string, TabType> = Object.fromEntries(
      tabList
        .filter((tab: { id: TabType }) => {
          if (tab.id === "auth" && !showAuthTab) return false;
          if (tab.id === "logging" && !showLoggingTab) return false;
          if (tab.id === "requests" && !showRequestsTab) return false;
          return true;
        })
        .map((tab: { id: TabType; label: string; accelerator: string }) => [
          tab.accelerator,
          tab.id,
        ]),
    );
    if (tabAccelerators[input.toLowerCase()]) {
      const nextTab = tabAccelerators[input.toLowerCase()]!;
      const authStepUpAccelerator =
        input.toLowerCase() === "a" &&
        nextTab === "auth" &&
        activeTab === "auth" &&
        pendingStepUp?.serverName === selectedServer;
      if (!authStepUpAccelerator) {
        setActiveTab(nextTab);
        setFocus(nextTab === "auth" ? "tabContentList" : "tabs");
      }
    } else if (key.tab && !key.shift) {
      // Flat focus order: servers -> tabs -> list -> details -> wrap to servers
      const focusOrder: FocusArea[] =
        activeTab === "messages"
          ? ["serverList", "tabs", "messagesList", "messagesDetail"]
          : activeTab === "requests"
            ? ["serverList", "tabs", "requestsList", "requestsDetail"]
            : ["serverList", "tabs", "tabContentList", "tabContentDetails"];
      const currentIndex = focusOrder.indexOf(focus);
      const nextIndex = (currentIndex + 1) % focusOrder.length;
      setFocus(focusOrder[nextIndex]);
    } else if (key.tab && key.shift) {
      // Reverse order: servers <- tabs <- list <- details <- wrap to servers
      const focusOrder: FocusArea[] =
        activeTab === "messages"
          ? ["serverList", "tabs", "messagesList", "messagesDetail"]
          : activeTab === "requests"
            ? ["serverList", "tabs", "requestsList", "requestsDetail"]
            : ["serverList", "tabs", "tabContentList", "tabContentDetails"];
      const currentIndex = focusOrder.indexOf(focus);
      const prevIndex =
        currentIndex > 0 ? currentIndex - 1 : focusOrder.length - 1;
      setFocus(focusOrder[prevIndex]);
    } else if (key.upArrow || key.downArrow) {
      // Arrow keys only work in the focused pane
      if (focus === "serverList") {
        // Arrow key navigation for server list
        if (key.upArrow) {
          if (selectedServer === null) {
            setSelectedServer(serverNames[serverNames.length - 1] || null);
          } else {
            const currentIndex = serverNames.indexOf(selectedServer);
            const newIndex =
              currentIndex > 0 ? currentIndex - 1 : serverNames.length - 1;
            setSelectedServer(serverNames[newIndex] || null);
          }
        } else if (key.downArrow) {
          if (selectedServer === null) {
            setSelectedServer(serverNames[0] || null);
          } else {
            const currentIndex = serverNames.indexOf(selectedServer);
            const newIndex =
              currentIndex < serverNames.length - 1 ? currentIndex + 1 : 0;
            setSelectedServer(serverNames[newIndex] || null);
          }
        }
        return; // Handled, don't let other handlers process
      }
      // If focus is on tabs, tabContentList, tabContentDetails, messagesList, or messagesDetail,
      // arrow keys will be handled by those components - don't do anything here
    } else if (focus === "tabs" && (key.leftArrow || key.rightArrow)) {
      // Left/Right arrows switch tabs when tabs are focused
      const showAuthTab =
        !!selectedServer &&
        !!selectedServerConfig &&
        isOAuthCapableServerConfig(selectedServerConfig);
      const showLoggingTab =
        !!selectedServer &&
        inspectorClients[selectedServer]?.getServerType() === "stdio";
      const showRequestsTab =
        !!selectedServer &&
        (inspectorClients[selectedServer]?.getServerType() === "sse" ||
          inspectorClients[selectedServer]?.getServerType() ===
            "streamable-http");
      const allTabs: TabType[] = [
        "info",
        "auth",
        "resources",
        "prompts",
        "tools",
        "messages",
        "requests",
        "logging",
      ];
      const tabs = allTabs.filter((t) => {
        if (t === "auth" && !showAuthTab) return false;
        if (t === "logging" && !showLoggingTab) return false;
        if (t === "requests" && !showRequestsTab) return false;
        return true;
      });
      const currentIndex = tabs.indexOf(activeTab);
      if (key.leftArrow) {
        const newIndex = currentIndex > 0 ? currentIndex - 1 : tabs.length - 1;
        setActiveTab(tabs[newIndex]);
      } else if (key.rightArrow) {
        const newIndex = currentIndex < tabs.length - 1 ? currentIndex + 1 : 0;
        setActiveTab(tabs[newIndex]);
      }
    }

    // Accelerator keys for connect/disconnect (work from anywhere)
    if (selectedServer) {
      if (
        input.toLowerCase() === "c" &&
        (inspectorStatus === "disconnected" || inspectorStatus === "error")
      ) {
        handleConnect();
      } else if (
        input.toLowerCase() === "d" &&
        (inspectorStatus === "connected" || inspectorStatus === "connecting")
      ) {
        handleDisconnect();
      }
    }
  });

  // Calculate layout dimensions
  const headerHeight = 1;
  const tabsHeight = 1;
  // Server details will be flexible - calculate remaining space for content
  const availableHeight = dimensions.height - headerHeight - tabsHeight;
  // Reserve space for server details (will grow as needed, but we'll use flexGrow)
  const serverDetailsMinHeight = 3;
  const contentHeight = availableHeight - serverDetailsMinHeight;
  const serverListWidth = Math.floor(dimensions.width * 0.3);
  const contentWidth = dimensions.width - serverListWidth;

  const getStatusColor = (status: string) => {
    switch (status) {
      case "connected":
        return "green";
      case "connecting":
        return "yellow";
      case "error":
        return "red";
      default:
        return "gray";
    }
  };

  const getStatusSymbol = (status: string) => {
    switch (status) {
      case "connected":
        return "●";
      case "connecting":
        return "◐";
      case "error":
        return "✗";
      default:
        return "○";
    }
  };

  return (
    <Box
      flexDirection="column"
      width={dimensions.width}
      height={dimensions.height}
    >
      {/* Header row across the top */}
      <Box
        width={dimensions.width}
        height={headerHeight}
        borderStyle="single"
        borderTop={false}
        borderLeft={false}
        borderRight={false}
        paddingX={1}
        justifyContent="space-between"
        alignItems="center"
      >
        <Box>
          <Text bold color="cyan">
            {APP_NAME}
          </Text>
          <Text dimColor> - {APP_DESCRIPTION}</Text>
        </Box>
        <Text dimColor>v{APP_VERSION}</Text>
      </Box>

      {/* Main content area */}
      <Box
        flexDirection="row"
        height={availableHeight + tabsHeight}
        width={dimensions.width}
      >
        {/* Left column - Server list */}
        <Box
          width={serverListWidth}
          height={availableHeight + tabsHeight}
          borderStyle="single"
          borderTop={false}
          borderBottom={false}
          borderLeft={false}
          borderRight={true}
          flexDirection="column"
          paddingX={1}
        >
          <Box marginTop={1} marginBottom={1}>
            <Text
              bold
              backgroundColor={focus === "serverList" ? "yellow" : undefined}
            >
              MCP Servers
            </Text>
          </Box>
          <Box flexDirection="column" flexGrow={1}>
            {serverNames.map((serverName) => {
              const isSelected = selectedServer === serverName;
              return (
                <Box key={serverName} paddingY={0}>
                  <Text>
                    {isSelected ? "▶ " : "  "}
                    {serverName}
                  </Text>
                </Box>
              );
            })}
          </Box>

          {/* Fixed footer */}
          <Box
            flexShrink={0}
            height={1}
            justifyContent="center"
            backgroundColor="gray"
          >
            <Text bold color="white">
              ESC to exit
            </Text>
          </Box>
        </Box>

        {/* Right column - Server details, Tabs and content */}
        <Box
          flexGrow={1}
          height={availableHeight + tabsHeight}
          flexDirection="column"
        >
          {/* Server Details - Flexible height */}
          <Box
            width={contentWidth}
            borderStyle="single"
            borderTop={false}
            borderLeft={false}
            borderRight={false}
            borderBottom={true}
            paddingX={1}
            paddingY={1}
            flexDirection="column"
            flexShrink={0}
          >
            <Box flexDirection="column">
              <Box
                flexDirection="row"
                justifyContent="space-between"
                alignItems="center"
              >
                <Text bold color="cyan">
                  {selectedServer}
                </Text>
                <Box flexDirection="row" alignItems="center" gap={1}>
                  {currentServerState && (
                    <>
                      <Text color={getStatusColor(currentServerState.status)}>
                        {getStatusSymbol(currentServerState.status)}{" "}
                        {currentServerState.status}
                      </Text>
                      <Text> </Text>
                      {(currentServerState?.status === "disconnected" ||
                        currentServerState?.status === "error") && (
                        <Text color="cyan" bold>
                          [<Text underline>C</Text>onnect]
                        </Text>
                      )}
                      {(currentServerState?.status === "connected" ||
                        currentServerState?.status === "connecting") && (
                        <Text color="red" bold>
                          [<Text underline>D</Text>isconnect]
                        </Text>
                      )}
                    </>
                  )}
                </Box>
              </Box>
              {oauthStatus === "authenticating" && (
                <Box marginTop={1}>
                  <Text dimColor>OAuth: authenticating…</Text>
                </Box>
              )}
              {oauthStatus === "error" && oauthMessage && (
                <Box marginTop={1}>
                  <Text color="red">OAuth: {oauthMessage}</Text>
                </Box>
              )}
            </Box>
          </Box>

          {/* Tabs */}
          <Tabs
            activeTab={activeTab}
            onTabChange={setActiveTab}
            width={contentWidth}
            counts={tabCounts}
            focused={focus === "tabs"}
            showAuth={
              !!(
                selectedServer &&
                selectedServerConfig &&
                isOAuthCapableServerConfig(selectedServerConfig)
              )
            }
            showLogging={
              selectedServer && inspectorClients[selectedServer]
                ? inspectorClients[selectedServer].getServerType() === "stdio"
                : false
            }
            showRequests={
              selectedServer && inspectorClients[selectedServer]
                ? (() => {
                    const serverType =
                      inspectorClients[selectedServer].getServerType();
                    return (
                      serverType === "sse" || serverType === "streamable-http"
                    );
                  })()
                : false
            }
          />

          {/* Tab Content */}
          <Box
            flexGrow={1}
            minHeight={6}
            width={contentWidth}
            borderTop={false}
            borderLeft={false}
            borderRight={false}
            borderBottom={false}
          >
            {activeTab === "info" && (
              <InfoTab
                serverName={selectedServer}
                serverConfig={selectedServerConfig}
                serverState={currentServerState}
                width={contentWidth}
                height={contentHeight}
                focused={
                  focus === "tabContentList" || focus === "tabContentDetails"
                }
              />
            )}
            {activeTab === "auth" &&
            selectedServer &&
            selectedServerConfig &&
            isOAuthCapableServerConfig(selectedServerConfig) ? (
              <AuthTab
                serverName={selectedServer}
                serverConfig={selectedServerConfig}
                inspectorClient={selectedInspectorClient}
                oauthStatus={oauthStatus}
                oauthMessage={oauthMessage}
                oauthRevision={oauthRevision}
                pendingStepUp={
                  pendingStepUp?.serverName === selectedServer
                    ? {
                        challenge: pendingStepUp.challenge,
                        authorizationScopes:
                          pendingStepUp.challenge.authorizationScopes,
                        enterpriseManaged: pendingStepUp.enterpriseManaged,
                      }
                    : null
                }
                onAuthorizeStepUp={() => {
                  if (!pendingStepUp || !selectedInspectorClient) return;
                  const { challenge, authorizationUrl, enterpriseManaged } =
                    pendingStepUp;
                  setPendingStepUp(null);
                  setOauthStatus("authenticating");
                  void (async () => {
                    try {
                      if (enterpriseManaged) {
                        const outcome =
                          await selectedInspectorClient.handleAuthChallenge(
                            challenge,
                            { confirmedStepUp: true },
                          );
                        if (outcome.kind === "satisfied") {
                          await disconnectInspector().catch(() => {});
                          await connectInspector();
                          setOauthStatus("idle");
                          setOauthMessage(
                            "Step-up authorization succeeded. Retry your action.",
                          );
                          setOauthRevision((n) => n + 1);
                          return;
                        }
                        if (outcome.kind === "interactive") {
                          const oauthResult = await runOAuthAuthentication({
                            challenge: outcome.challenge,
                            authorizationUrl: outcome.authorizationUrl,
                          });
                          if (
                            oauthResult === "success" ||
                            oauthResult === "already_authorized"
                          ) {
                            setOauthStatus("idle");
                            setOauthMessage(
                              "Step-up authorization succeeded. Retry your action.",
                            );
                          } else if (oauthResult === "skipped") {
                            setOauthStatus("idle");
                            setOauthMessage("OAuth already in progress.");
                          }
                          return;
                        }
                        if (outcome.kind === "failed") {
                          setOauthStatus("error");
                          setOauthMessage(
                            emaStepUpFailureMessage(outcome.error.message),
                          );
                          return;
                        }
                        setOauthStatus("idle");
                        setOauthMessage(
                          "Step-up authorization succeeded. Retry your action.",
                        );
                        return;
                      }
                      const oauthResult = await runOAuthAuthentication({
                        challenge,
                        authorizationUrl,
                      });
                      if (
                        oauthResult === "success" ||
                        oauthResult === "already_authorized"
                      ) {
                        setOauthStatus("idle");
                        setOauthMessage(
                          "Step-up authorization succeeded. Retry your action.",
                        );
                      } else if (oauthResult === "skipped") {
                        setOauthStatus("idle");
                        setOauthMessage("OAuth already in progress.");
                      }
                    } catch (authErr) {
                      const authMsg =
                        authErr instanceof Error
                          ? authErr.message
                          : String(authErr);
                      setOauthStatus("error");
                      setOauthMessage(authMsg);
                    }
                  })();
                }}
                onCancelStepUp={() => {
                  setPendingStepUp(null);
                  setOauthMessage("Authorization cancelled.");
                }}
                width={contentWidth}
                height={contentHeight}
                focused={
                  focus === "tabContentList" || focus === "tabContentDetails"
                }
                onClearOAuth={() => {
                  void handleClearOAuth();
                }}
                connectionStatus={inspectorStatus}
              />
            ) : null}
            {activeTab === "resources" &&
            currentServerState?.status === "connected" &&
            selectedInspectorClient ? (
              <ResourcesTab
                key={`resources-${selectedServer}`}
                resources={currentServerState.resources}
                resourceTemplates={currentServerState.resourceTemplates}
                inspectorClient={selectedInspectorClient}
                width={contentWidth}
                height={contentHeight}
                onCountChange={(count) =>
                  setTabCounts((prev) => ({ ...prev, resources: count }))
                }
                focusedPane={
                  focus === "tabContentDetails"
                    ? "details"
                    : focus === "tabContentList"
                      ? "list"
                      : null
                }
                onViewDetails={(resource) =>
                  setDetailsModal({
                    title: `Resource: ${"uri" in resource ? resource.name || resource.uri || "Unknown" : "Resource content"}`,
                    content: renderResourceDetails(resource),
                  })
                }
                onFetchResource={() => {
                  // Resource fetching is handled internally by ResourcesTab
                  // This callback is just for triggering the fetch
                }}
                onFetchTemplate={(template) => {
                  setResourceTestModal({
                    template,
                    inspectorClient: selectedInspectorClient,
                  });
                }}
                onAuthRecoveryRequired={onAuthRecoveryRequired}
                modalOpen={
                  !!(
                    toolTestModal ||
                    resourceTestModal ||
                    promptTestModal ||
                    detailsModal
                  )
                }
              />
            ) : activeTab === "prompts" &&
              currentServerState?.status === "connected" &&
              selectedInspectorClient ? (
              <PromptsTab
                key={`prompts-${selectedServer}`}
                prompts={currentServerState.prompts}
                inspectorClient={selectedInspectorClient}
                width={contentWidth}
                height={contentHeight}
                onCountChange={(count) =>
                  setTabCounts((prev) => ({ ...prev, prompts: count }))
                }
                focusedPane={
                  focus === "tabContentDetails"
                    ? "details"
                    : focus === "tabContentList"
                      ? "list"
                      : null
                }
                onViewDetails={(prompt) =>
                  setDetailsModal({
                    title: `Prompt: ${prompt.name || "Unknown"}`,
                    content: renderPromptDetails(prompt),
                  })
                }
                onFetchPrompt={(prompt) => {
                  setPromptTestModal({
                    prompt,
                    inspectorClient: selectedInspectorClient,
                  });
                }}
                onAuthRecoveryRequired={onAuthRecoveryRequired}
                modalOpen={
                  !!(
                    toolTestModal ||
                    resourceTestModal ||
                    promptTestModal ||
                    detailsModal
                  )
                }
              />
            ) : activeTab === "tools" &&
              currentServerState?.status === "connected" &&
              selectedInspectorClient ? (
              <ToolsTab
                key={`tools-${selectedServer}`}
                tools={currentServerState.tools}
                isConnected={inspectorStatus === "connected"}
                width={contentWidth}
                height={contentHeight}
                onCountChange={(count) =>
                  setTabCounts((prev) => ({ ...prev, tools: count }))
                }
                focusedPane={
                  focus === "tabContentDetails"
                    ? "details"
                    : focus === "tabContentList"
                      ? "list"
                      : null
                }
                onTestTool={(tool) =>
                  setToolTestModal({
                    tool,
                    inspectorClient: selectedInspectorClient,
                  })
                }
                onViewDetails={(tool) =>
                  setDetailsModal({
                    title: `Tool: ${tool.name || "Unknown"}`,
                    content: renderToolDetails(tool),
                  })
                }
                modalOpen={!!(toolTestModal || detailsModal)}
              />
            ) : activeTab === "messages" && selectedInspectorClient ? (
              <HistoryTab
                serverName={selectedServer}
                messages={inspectorMessages}
                width={contentWidth}
                height={contentHeight}
                onCountChange={(count) =>
                  setTabCounts((prev) => ({ ...prev, messages: count }))
                }
                focusedPane={
                  focus === "messagesDetail"
                    ? "details"
                    : focus === "messagesList"
                      ? "messages"
                      : null
                }
                modalOpen={!!(toolTestModal || detailsModal)}
                onViewDetails={(message) => {
                  const label =
                    message.direction === "request" &&
                    "method" in message.message
                      ? message.message.method
                      : message.direction === "response"
                        ? "Response"
                        : message.direction === "notification" &&
                            "method" in message.message
                          ? message.message.method
                          : "Message";
                  setDetailsModal({
                    title: `Message: ${label}`,
                    content: renderMessageDetails(message),
                  });
                }}
              />
            ) : activeTab === "requests" &&
              selectedInspectorClient &&
              (inspectorStatus === "connected" ||
                inspectorFetchRequests.length > 0) ? (
              <RequestsTab
                serverName={selectedServer}
                requests={inspectorFetchRequests}
                width={contentWidth}
                height={contentHeight}
                onCountChange={(count) =>
                  setTabCounts((prev) => ({ ...prev, requests: count }))
                }
                focusedPane={
                  focus === "requestsDetail"
                    ? "details"
                    : focus === "requestsList"
                      ? "requests"
                      : null
                }
                modalOpen={!!(toolTestModal || detailsModal)}
                onViewDetails={(request) => {
                  setDetailsModal({
                    title: `Request: ${request.method} ${request.url}`,
                    content: renderRequestDetails(request),
                  });
                }}
              />
            ) : activeTab === "logging" && selectedInspectorClient ? (
              <NotificationsTab
                stderrLogs={inspectorStderrLogs}
                width={contentWidth}
                height={contentHeight}
                onCountChange={(count) =>
                  setTabCounts((prev) => ({ ...prev, logging: count }))
                }
                focused={
                  focus === "tabContentList" || focus === "tabContentDetails"
                }
              />
            ) : null}
          </Box>
        </Box>
      </Box>

      {/* Tool Test Modal - rendered at App level for full screen overlay */}
      {toolTestModal && (
        <ToolTestModal
          tool={toolTestModal.tool}
          inspectorClient={toolTestModal.inspectorClient}
          width={dimensions.width}
          height={dimensions.height}
          onClose={() => setToolTestModal(null)}
          onAuthRecoveryRequired={(error) => {
            onAuthRecoveryRequired(error);
            setToolTestModal(null);
          }}
        />
      )}

      {/* Resource Test Modal - rendered at App level for full screen overlay */}
      {resourceTestModal && (
        <ResourceTestModal
          template={resourceTestModal.template}
          inspectorClient={resourceTestModal.inspectorClient}
          width={dimensions.width}
          height={dimensions.height}
          onClose={() => setResourceTestModal(null)}
          onAuthRecoveryRequired={(error) => {
            onAuthRecoveryRequired(error);
            setResourceTestModal(null);
          }}
        />
      )}

      {promptTestModal && (
        <PromptTestModal
          prompt={promptTestModal.prompt}
          inspectorClient={promptTestModal.inspectorClient}
          width={dimensions.width}
          height={dimensions.height}
          onClose={() => setPromptTestModal(null)}
          onAuthRecoveryRequired={(error) => {
            onAuthRecoveryRequired(error);
            setPromptTestModal(null);
          }}
        />
      )}

      {/* Details Modal - rendered at App level for full screen overlay */}
      {detailsModal && (
        <DetailsModal
          title={detailsModal.title}
          content={detailsModal.content}
          width={dimensions.width}
          height={dimensions.height}
          onClose={() => setDetailsModal(null)}
        />
      )}
    </Box>
  );
}

export default App;
