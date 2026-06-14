import { useState, useEffect, useCallback } from "react";
import type { InspectorClientProtocol } from "../mcp/inspectorClientProtocol.js";
import type { AppRendererClient } from "../mcp/inspectorClientProtocol.js";
import type { TypedEvent } from "../mcp/inspectorClientEventTarget.js";
import type { ConnectionStatus } from "../mcp/types.js";
import type {
  ClientCapabilities,
  ServerCapabilities,
  Implementation,
} from "@modelcontextprotocol/sdk/types.js";

// Module-scope frozen object so the `?? EMPTY_CLIENT_CAPABILITIES`
// fallback below doesn't return a fresh literal on every render —
// downstream `useMemo`/`useEffect` deps that key on `clientCapabilities`
// would otherwise invalidate every tick when no client is attached.
const EMPTY_CLIENT_CAPABILITIES: ClientCapabilities = Object.freeze({});

export interface UseInspectorClientResult {
  status: ConnectionStatus;
  capabilities?: ServerCapabilities;
  clientCapabilities: ClientCapabilities;
  serverInfo?: Implementation;
  instructions?: string;
  protocolVersion?: string;
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
  const [status, setStatus] = useState<ConnectionStatus>(
    inspectorClient?.getStatus() ?? "disconnected",
  );
  const [capabilities, setCapabilities] = useState<
    ServerCapabilities | undefined
  >(inspectorClient?.getCapabilities());
  const [serverInfo, setServerInfo] = useState<Implementation | undefined>(
    inspectorClient?.getServerInfo(),
  );
  const [instructions, setInstructions] = useState<string | undefined>(
    inspectorClient?.getInstructions(),
  );
  const [protocolVersion, setProtocolVersion] = useState<string | undefined>(
    inspectorClient?.getProtocolVersion(),
  );
  const [lastError, setLastError] = useState<string | undefined>();

  useEffect(() => {
    if (!inspectorClient) {
      setStatus("disconnected");
      setCapabilities(undefined);
      setServerInfo(undefined);
      setInstructions(undefined);
      setProtocolVersion(undefined);
      setLastError(undefined);
      return;
    }

    setStatus(inspectorClient.getStatus());
    setCapabilities(inspectorClient.getCapabilities());
    setServerInfo(inspectorClient.getServerInfo());
    setInstructions(inspectorClient.getInstructions());
    setProtocolVersion(inspectorClient.getProtocolVersion());
    setLastError(undefined);

    const onStatusChange = (event: TypedEvent<"statusChange">) => {
      setStatus(event.detail);
      if (event.detail !== "error") {
        setLastError(undefined);
      }
    };
    const onError = (event: TypedEvent<"error">) => {
      setLastError(event.detail.message);
    };
    const onCapabilitiesChange = (event: TypedEvent<"capabilitiesChange">) => {
      setCapabilities(event.detail);
    };
    const onServerInfoChange = (event: TypedEvent<"serverInfoChange">) => {
      setServerInfo(event.detail);
    };
    const onInstructionsChange = (event: TypedEvent<"instructionsChange">) => {
      setInstructions(event.detail);
    };
    const onProtocolVersionChange = (
      event: TypedEvent<"protocolVersionChange">,
    ) => {
      setProtocolVersion(event.detail);
    };

    inspectorClient.addEventListener("statusChange", onStatusChange);
    inspectorClient.addEventListener("error", onError);
    inspectorClient.addEventListener(
      "capabilitiesChange",
      onCapabilitiesChange,
    );
    inspectorClient.addEventListener("serverInfoChange", onServerInfoChange);
    inspectorClient.addEventListener(
      "instructionsChange",
      onInstructionsChange,
    );
    inspectorClient.addEventListener(
      "protocolVersionChange",
      onProtocolVersionChange,
    );

    return () => {
      inspectorClient.removeEventListener("statusChange", onStatusChange);
      inspectorClient.removeEventListener("error", onError);
      inspectorClient.removeEventListener(
        "capabilitiesChange",
        onCapabilitiesChange,
      );
      inspectorClient.removeEventListener(
        "serverInfoChange",
        onServerInfoChange,
      );
      inspectorClient.removeEventListener(
        "instructionsChange",
        onInstructionsChange,
      );
      inspectorClient.removeEventListener(
        "protocolVersionChange",
        onProtocolVersionChange,
      );
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
    lastError,
    appRendererClient: inspectorClient?.getAppRendererClient() ?? null,
    connect,
    disconnect,
  };
}
