import { getServerType } from "../config.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { createFetchTracker } from "../fetchTracking.js";
/**
 * Creates the appropriate transport for an MCP server configuration.
 */
export function createTransportNode(config, options = {}) {
    const serverType = getServerType(config);
    const { fetchFn: optionsFetchFn, onStderr, pipeStderr = false, onFetchRequest, authProvider, } = options;
    const baseFetch = optionsFetchFn ?? globalThis.fetch;
    if (serverType === "stdio") {
        const stdioConfig = config;
        const transport = new StdioClientTransport({
            command: stdioConfig.command,
            args: stdioConfig.args || [],
            env: stdioConfig.env,
            cwd: stdioConfig.cwd,
            stderr: pipeStderr ? "pipe" : undefined,
        });
        // Set up stderr listener if requested
        if (pipeStderr && transport.stderr && onStderr) {
            transport.stderr.on("data", (data) => {
                const logEntry = data.toString().trim();
                if (logEntry) {
                    onStderr({
                        timestamp: new Date(),
                        message: logEntry,
                    });
                }
            });
        }
        return { transport: transport };
    }
    else if (serverType === "sse") {
        const sseConfig = config;
        const url = new URL(sseConfig.url);
        const sseFetch = sseConfig.eventSourceInit?.fetch || baseFetch;
        const trackedFetch = onFetchRequest
            ? createFetchTracker(sseFetch, { trackRequest: onFetchRequest })
            : sseFetch;
        const eventSourceInit = {
            ...sseConfig.eventSourceInit,
            ...(sseConfig.headers && { headers: sseConfig.headers }),
            fetch: trackedFetch,
        };
        const requestInit = {
            ...sseConfig.requestInit,
            ...(sseConfig.headers && { headers: sseConfig.headers }),
        };
        const postFetch = onFetchRequest
            ? createFetchTracker(baseFetch, { trackRequest: onFetchRequest })
            : baseFetch;
        const transport = new SSEClientTransport(url, {
            authProvider,
            eventSourceInit,
            requestInit,
            fetch: postFetch,
        });
        return { transport };
    }
    else {
        // streamable-http
        const httpConfig = config;
        const url = new URL(httpConfig.url);
        const requestInit = {
            ...httpConfig.requestInit,
            ...(httpConfig.headers && { headers: httpConfig.headers }),
        };
        const transportFetch = onFetchRequest
            ? createFetchTracker(baseFetch, { trackRequest: onFetchRequest })
            : baseFetch;
        const transport = new StreamableHTTPClientTransport(url, {
            authProvider,
            requestInit,
            fetch: transportFetch,
        });
        return { transport };
    }
}
//# sourceMappingURL=transport.js.map