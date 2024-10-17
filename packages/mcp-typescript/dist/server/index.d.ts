import { Protocol } from "../shared/protocol.js";
import { ClientCapabilities, Implementation, ServerNotification, ServerRequest, ServerResult } from "../types.js";
/**
 * An MCP server on top of a pluggable transport.
 *
 * This server will automatically respond to the initialization flow as initiated from the client.
 */
export declare class Server extends Protocol<ServerRequest, ServerNotification, ServerResult> {
    private _serverInfo;
    private _clientCapabilities?;
    private _clientVersion?;
    /**
     * Callback for when initialization has fully completed (i.e., the client has sent an `initialized` notification).
     */
    oninitialized?: () => void;
    /**
     * Initializes this server with the given name and version information.
     */
    constructor(_serverInfo: Implementation);
    private _oninitialize;
    /**
     * After initialization has completed, this will be populated with the client's reported capabilities.
     */
    getClientCapabilities(): ClientCapabilities | undefined;
    /**
     * After initialization has completed, this will be populated with information about the client's name and version.
     */
    getClientVersion(): Implementation | undefined;
    private getCapability;
    private getCapabilities;
}
//# sourceMappingURL=index.d.ts.map