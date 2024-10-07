import { Protocol } from "../shared/protocol.js";
import { InitializeResultSchema, PROTOCOL_VERSION, } from "../types.js";
/**
 * An MCP client on top of a pluggable transport.
 *
 * The client will automatically begin the initialization flow with the server when connect() is called.
 */
export class Client extends Protocol {
    /**
     * Initializes this client with the given name and version information.
     */
    constructor(_clientInfo) {
        super();
        this._clientInfo = _clientInfo;
    }
    async connect(transport) {
        await super.connect(transport);
        const result = await this.request({
            method: "initialize",
            params: {
                protocolVersion: 1,
                capabilities: {},
                clientInfo: this._clientInfo,
            },
        }, InitializeResultSchema);
        if (result === undefined) {
            throw new Error(`Server sent invalid initialize result: ${result}`);
        }
        if (result.protocolVersion !== PROTOCOL_VERSION) {
            throw new Error(`Server's protocol version is not supported: ${result.protocolVersion}`);
        }
        this._serverCapabilities = result.capabilities;
        this._serverVersion = result.serverInfo;
        await this.notification({
            method: "notifications/initialized",
        });
    }
    /**
     * After initialization has completed, this will be populated with the server's reported capabilities.
     */
    getServerCapabilities() {
        return this._serverCapabilities;
    }
    /**
     * After initialization has completed, this will be populated with information about the server's name and version.
     */
    getServerVersion() {
        return this._serverVersion;
    }
}
//# sourceMappingURL=index.js.map