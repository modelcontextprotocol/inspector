import { useCallback, useEffect, useState } from "react";
import type { InspectorClientProtocol } from "../mcp/inspectorClientProtocol.js";
import type { AppRendererClient } from "../mcp/inspectorClientProtocol.js";
import type { TypedEvent } from "../mcp/inspectorClientEventTarget.js";
import type { ConnectionStatus } from "../mcp/types.js";
import type {
  ClientCapabilities,
  ServerCapabilities,
  Implementation,
  ProtocolEra,
  DiscoverResult,
} from "@modelcontextprotocol/client";
import type { ExcludedTool } from "../mcp/types.js";
import type { MalformedListItem } from "../mcp/listSalvage.js";
import { useStoreSnapshot } from "./useStoreSnapshot.js";

// Module-scope frozen object so the `?? EMPTY_CLIENT_CAPABILITIES`
// fallback below doesn't return a fresh literal on every render —
// downstream `useMemo`/`useEffect` deps that key on `clientCapabilities`
// would otherwise invalidate every tick when no client is attached.
const EMPTY_CLIENT_CAPABILITIES: ClientCapabilities = Object.freeze({});

/**
 * Stable fallbacks for the no-client case, module scope for the same reason as
 * the constant above — a `useStoreSnapshot` fallback built in the component
 * body would look like a new value on every read.
 */
const NO_EXCLUDED_TOOLS: ExcludedTool[] = [];
const NO_MALFORMED_LIST_ITEMS: MalformedListItem[] = [];

const readStatus = (client: InspectorClientProtocol): ConnectionStatus =>
  client.getStatus();
const readCapabilities = (
  client: InspectorClientProtocol,
): ServerCapabilities | undefined => client.getCapabilities();
const readServerInfo = (
  client: InspectorClientProtocol,
): Implementation | undefined => client.getServerInfo();
const readInstructions = (
  client: InspectorClientProtocol,
): string | undefined => client.getInstructions();
const readProtocolVersion = (
  client: InspectorClientProtocol,
): string | undefined => client.getProtocolVersion();
const readProtocolEra = (
  client: InspectorClientProtocol,
): ProtocolEra | undefined => client.getProtocolEra();
const readDiscoverResult = (
  client: InspectorClientProtocol,
): DiscoverResult | undefined => client.getDiscoverResult();
const readExcludedTools = (client: InspectorClientProtocol): ExcludedTool[] =>
  client.getExcludedTools();
const readMalformedListItems = (
  client: InspectorClientProtocol,
): MalformedListItem[] => client.getMalformedListItems();

export interface UseInspectorClientResult {
  status: ConnectionStatus;
  capabilities?: ServerCapabilities;
  clientCapabilities: ClientCapabilities;
  serverInfo?: Implementation;
  instructions?: string;
  protocolVersion?: string;
  /**
   * Protocol era negotiated with the server (SEP §7.8): `"legacy"` for the
   * 2025-11-25 initialize handshake, `"modern"` for the 2026-era sessionless
   * model. Populated for every era once connected (a plain legacy connect
   * reports `"legacy"`); undefined only when not connected. (#1626)
   */
  protocolEra?: ProtocolEra;
  /**
   * The `server/discover` result on a probed/pinned connect — server identity,
   * capabilities, and supported versions learned without an initialize
   * handshake. Undefined on a legacy connect. (#1626)
   */
  discoverResult?: DiscoverResult;
  /**
   * Tools the SDK excluded from `tools/list` for invalid `x-mcp-header`
   * annotations (SEP-2243), each with its reason. Empty on legacy/stdio
   * connections and before connect (#1632).
   */
  excludedTools: ExcludedTool[];
  /**
   * Entries the Inspector dropped from a list result because they failed the
   * spec schema for their primitive. Empty against a conforming server; a
   * non-empty set means that list rendered without them (#1909).
   */
  malformedListItems: MalformedListItem[];
  /**
   * Message from the most recent mid-session transport failure (the client's
   * `error` event — stdio crash, SSE drop, HTTP 5xx). Stays set until the next
   * connection attempt (`status` → `"connecting"`) clears it, so consumers can
   * render it without subscribing to the event directly. Handshake failures do
   * NOT populate this — they reject the `connect()` promise instead.
   */
  lastError?: string;
  appRendererClient: AppRendererClient | null;
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
}

/**
 * React hook that subscribes to InspectorClient events and provides reactive
 * connection state. Log lists (message / stderr / fetch) live in dedicated
 * state managers consumed via useMessageLog / useStderrLog / useFetchRequestLog.
 *
 * Every value the client can be *asked* for is read through `useStoreSnapshot`
 * rather than mirrored into local state by an effect (#1955): the effect ran
 * after the commit, so swapping servers painted one frame of the previous
 * client's status and capabilities before correcting itself.
 *
 * Note: `appRendererClient` is read lazily from the client on every render
 * and is NOT subscribed. It changes once at connect time and is not expected
 * to change again during a session, so callers will see the current value
 * on any rerender triggered by status / capabilities / serverInfo / instructions.
 * If a future use case requires autonomous updates when the renderer attaches,
 * add an `appRendererClientChange` event to `InspectorClientEventMap` and
 * subscribe here.
 */
export function useInspectorClient(
  inspectorClient: InspectorClientProtocol | null,
): UseInspectorClientResult {
  const status = useStoreSnapshot(
    inspectorClient,
    "statusChange",
    readStatus,
    "disconnected" as ConnectionStatus,
  );
  const capabilities = useStoreSnapshot(
    inspectorClient,
    "capabilitiesChange",
    readCapabilities,
    undefined,
  );
  const serverInfo = useStoreSnapshot(
    inspectorClient,
    "serverInfoChange",
    readServerInfo,
    undefined,
  );
  const instructions = useStoreSnapshot(
    inspectorClient,
    "instructionsChange",
    readInstructions,
    undefined,
  );
  const protocolVersion = useStoreSnapshot(
    inspectorClient,
    "protocolVersionChange",
    readProtocolVersion,
    undefined,
  );
  const protocolEra = useStoreSnapshot(
    inspectorClient,
    "protocolEraChange",
    readProtocolEra,
    undefined,
  );
  const discoverResult = useStoreSnapshot(
    inspectorClient,
    "discoverResultChange",
    readDiscoverResult,
    undefined,
  );
  const excludedTools = useStoreSnapshot(
    inspectorClient,
    "excludedToolsChange",
    readExcludedTools,
    NO_EXCLUDED_TOOLS,
  );
  const malformedListItems = useStoreSnapshot(
    inspectorClient,
    "malformedListItemsChange",
    readMalformedListItems,
    NO_MALFORMED_LIST_ITEMS,
  );

  // `lastError` is the one value here that is NOT a snapshot of something the
  // client stores: there is no `getLastError()`, because the client emits the
  // failure and moves on. It is accumulated from the event stream instead, so
  // it stays local state — but it is still tied to one client, and must reset
  // when a different one is passed in.
  //
  // That reset is done during render (React's documented "adjusting state
  // when a prop changes" pattern, the same one `useValueChange` implements for
  // the web client) rather than in an effect. An effect would paint one frame
  // carrying the previous client's error, which is precisely the defect this
  // hook was converted to fix.
  const [errorState, setErrorState] = useState<{
    client: InspectorClientProtocol | null;
    message?: string;
  }>({ client: inspectorClient });
  if (errorState.client !== inspectorClient) {
    setErrorState({ client: inspectorClient });
  }
  const lastError =
    errorState.client === inspectorClient ? errorState.message : undefined;

  useEffect(() => {
    if (!inspectorClient) return;
    const onStatusChange = (event: TypedEvent<"statusChange">) => {
      // A fresh connection attempt clears any stale error from the prior
      // session so the UI doesn't keep showing why the last transport died.
      if (event.detail === "connecting") {
        setErrorState({ client: inspectorClient });
      }
    };
    const onError = (event: TypedEvent<"error">) => {
      setErrorState({ client: inspectorClient, message: event.detail.message });
    };
    inspectorClient.addEventListener("statusChange", onStatusChange);
    inspectorClient.addEventListener("error", onError);
    return () => {
      inspectorClient.removeEventListener("statusChange", onStatusChange);
      inspectorClient.removeEventListener("error", onError);
    };
  }, [inspectorClient]);

  const connect = useCallback(async () => {
    if (!inspectorClient) return;
    await inspectorClient.connect();
  }, [inspectorClient]);

  const disconnect = useCallback(async () => {
    if (!inspectorClient) return;
    await inspectorClient.disconnect();
  }, [inspectorClient]);

  return {
    status,
    capabilities,
    // Read lazily on every render rather than subscribed: client capabilities
    // are built once in InspectorClient's constructor (from `sample`, `elicit`,
    // `roots`, `receiverTasks`) and never mutate during a session, so there's
    // no event to subscribe to. The module-scope frozen empty object is the
    // stable fallback when no client is attached.
    clientCapabilities:
      inspectorClient?.getClientCapabilities() ?? EMPTY_CLIENT_CAPABILITIES,
    serverInfo,
    instructions,
    protocolVersion,
    protocolEra,
    discoverResult,
    excludedTools,
    malformedListItems,
    lastError,
    appRendererClient: inspectorClient?.getAppRendererClient() ?? null,
    connect,
    disconnect,
  };
}
