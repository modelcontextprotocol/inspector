import { Protocol } from "../shared/protocol.js";
import { Transport } from "../shared/transport.js";
import { ClientNotification, ClientRequest, ClientResult, Implementation, ServerCapabilities } from "../types.js";
/**
 * An MCP client on top of a pluggable transport.
 *
 * The client will automatically begin the initialization flow with the server when connect() is called.
 */
export declare class Client extends Protocol<ClientRequest, ClientNotification, ClientResult> {
    private _clientInfo;
    private _serverCapabilities?;
    private _serverVersion?;
    /**
     * Initializes this client with the given name and version information.
     */
    constructor(_clientInfo: Implementation);
    connect(transport: Transport): Promise<void>;
    /**
     * After initialization has completed, this will be populated with the server's reported capabilities.
     */
    getServerCapabilities(): ServerCapabilities | undefined;
    /**
     * After initialization has completed, this will be populated with information about the server's name and version.
     */
    getServerVersion(): Implementation | undefined;
}
//# sourceMappingURL=index.d.ts.map