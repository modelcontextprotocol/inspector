import { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";

function onClientError(error: Error) {
  console.error("Error from inspector client:", error);
}

function onServerError(error: Error) {
  console.error("Error from MCP server:", error);
}

export default function mcpProxy({
  transportToClient,
  transportToServer,
}: {
  transportToClient: Transport;
  transportToServer: Transport;
}) {
  let transportToClientClosed = false;
  let transportToServerClosed = false;

  transportToClient.onmessage = (message) => {
    transportToServer.send(message).catch(onServerError);
  };

  transportToServer.onmessage = (message) => {
    transportToClient.send(message).catch(onClientError);
  };

  transportToClient.onclose = () => {
    if (transportToServerClosed) {
      return;
    }

    transportToClientClosed = true;
    transportToServer.close().catch(onServerError);
  };

  transportToServer.onclose = () => {
    if (transportToClientClosed) {
      return;
    }
    transportToServerClosed = true;
    transportToClient.close().catch(onClientError);
  };

  transportToClient.onerror = onClientError;
  transportToServer.onerror = onServerError;
}
