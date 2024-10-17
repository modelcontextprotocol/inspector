import { JSONRPCMessage } from "../types.js";
import { Transport } from "../shared/transport.js";
export type StdioServerParameters = {
    /**
     * The executable to run to start the server.
     */
    command: string;
    /**
     * Command line arguments to pass to the executable.
     */
    args?: string[];
    /**
     * The environment to use when spawning the process.
     *
     * The environment is NOT inherited from the parent process by default.
     */
    env?: object;
};
/**
 * Client transport for stdio: this will connect to a server by spawning a process and communicating with it over stdin/stdout.
 *
 * This transport is only available in Node.js environments.
 */
export declare class StdioClientTransport implements Transport {
    private _process?;
    private _abortController;
    private _readBuffer;
    private _serverParams;
    onclose?: () => void;
    onerror?: (error: Error) => void;
    onmessage?: (message: JSONRPCMessage) => void;
    constructor(server: StdioServerParameters);
    /**
     * Starts the server process and prepares to communicate with it.
     */
    start(): Promise<void>;
    private processReadBuffer;
    close(): Promise<void>;
    send(message: JSONRPCMessage): Promise<void>;
}
//# sourceMappingURL=stdio.d.ts.map