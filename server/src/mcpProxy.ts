import { Transport } from "mcp-typescript/shared/transport.js";

export default function mcpProxy({
  transportToClient,
  transportToServer,
  onerror,
}: {
  transportToClient: Transport;
  transportToServer: Transport;
  onerror: (error: Error) => void;
}) {
  transportToClient.onmessage = (message) => {
    transportToServer.send(message).catch(onerror);
  };

  transportToServer.onmessage = (message) => {
    transportToClient.send(message).catch(onerror);
  };

  transportToClient.onclose = () => {
    transportToServer.close().catch(onerror);
  };

  transportToServer.onclose = () => {
    transportToClient.close().catch(onerror);
  };

  transportToClient.onerror = onerror;
  transportToServer.onerror = onerror;
}
