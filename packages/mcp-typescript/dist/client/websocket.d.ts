import { Transport } from "../shared/transport.js";
import { JSONRPCMessage } from "../types.js";
/**
 * Client transport for WebSocket: this will connect to a server over the WebSocket protocol.
 */
export declare class WebSocketClientTransport implements Transport {
    private _socket?;
    onclose?: () => void;
    onerror?: (error: Error) => void;
    onmessage?: (message: JSONRPCMessage) => void;
    connect(url: URL): Promise<void>;
    close(): Promise<void>;
    send(message: JSONRPCMessage): Promise<void>;
}
//# sourceMappingURL=websocket.d.ts.map