import { useState, useEffect, useCallback } from "react";
import type { InspectorClientProtocol } from "../mcp/inspectorClientProtocol.js";
import type { AppRendererClient } from "../mcp/inspectorClientProtocol.js";
import type { TypedEvent } from "../mcp/inspectorClientEventTarget.js";
import type { ConnectionStatus } from "../mcp/types.js";
import type {
  ServerCapabilities,
  Implementation,
} from "@modelcontextprotocol/sdk/types.js";

export interface UseInspectorClientResult {
  status: ConnectionStatus;
  capabilities?: ServerCapabilities;
  serverInfo?: Implementation;
  instructions?: string;
  appRendererClient: AppRendererClient | null;
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
}

/**
 * React hook that subscribes to InspectorClient events and provides reactive
 * connection state. Log lists (message / stderr / fetch) live in dedicated
 * state managers consumed via useMessageLog / useStderrLog / useFetchRequestLog.
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

  useEffect(() => {
    if (!inspectorClient) {
      setStatus("disconnected");
      setCapabilities(undefined);
      setServerInfo(undefined);
      setInstructions(undefined);
      return;
    }

    setStatus(inspectorClient.getStatus());
    setCapabilities(inspectorClient.getCapabilities());
    setServerInfo(inspectorClient.getServerInfo());
    setInstructions(inspectorClient.getInstructions());

    const onStatusChange = (event: TypedEvent<"statusChange">) => {
      setStatus(event.detail);
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

    inspectorClient.addEventListener("statusChange", onStatusChange);
    inspectorClient.addEventListener(
      "capabilitiesChange",
      onCapabilitiesChange,
    );
    inspectorClient.addEventListener("serverInfoChange", onServerInfoChange);
    inspectorClient.addEventListener(
      "instructionsChange",
      onInstructionsChange,
    );

    return () => {
      inspectorClient.removeEventListener("statusChange", onStatusChange);
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
    serverInfo,
    instructions,
    appRendererClient: inspectorClient?.getAppRendererClient() ?? null,
    connect,
    disconnect,
  };
}
