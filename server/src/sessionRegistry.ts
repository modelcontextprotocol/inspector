import { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { ProxyHeaderHolder } from "./mcpProxy.js";

export type SessionMaps = {
  webAppTransports: Map<string, Transport>;
  serverTransports: Map<string, Transport>;
  sessionHeaderHolders: Map<string, ProxyHeaderHolder>;
};

export function removeSession(maps: SessionMaps, sessionId: string): void {
  maps.webAppTransports.delete(sessionId);
  maps.serverTransports.delete(sessionId);
  maps.sessionHeaderHolders.delete(sessionId);
}

/** Ignore "Not connected" when the browser SSE stream has already closed. */
export function sendToClientSafe(
  transport: Transport,
  message: Parameters<Transport["send"]>[0],
): void {
  transport.send(message).catch((error: unknown) => {
    if (error instanceof Error && error.message === "Not connected") {
      return;
    }
    console.error("Error from inspector client:", error);
  });
}

export function chainOnClose(transport: Transport, onClose: () => void): void {
  const previousOnClose = transport.onclose;
  transport.onclose = () => {
    onClose();
    previousOnClose?.();
  };
}
