import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
export function getServerType(config) {
  if ("type" in config) {
    if (config.type === "sse") return "sse";
    if (config.type === "streamableHttp") return "streamableHttp";
  }
  return "stdio";
}
/**
 * Creates the appropriate transport for an MCP server configuration
 */
export function createTransport(config, options = {}) {
  const serverType = getServerType(config);
  const { onStderr, pipeStderr = false } = options;
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
  } else if (serverType === "sse") {
    const sseConfig = config;
    const url = new URL(sseConfig.url);
    // Merge headers and requestInit
    const eventSourceInit = {
      ...sseConfig.eventSourceInit,
      ...(sseConfig.headers && { headers: sseConfig.headers }),
    };
    const requestInit = {
      ...sseConfig.requestInit,
      ...(sseConfig.headers && { headers: sseConfig.headers }),
    };
    const transport = new SSEClientTransport(url, {
      eventSourceInit,
      requestInit,
    });
    return { transport };
  } else {
    // streamableHttp
    const httpConfig = config;
    const url = new URL(httpConfig.url);
    // Merge headers and requestInit
    const requestInit = {
      ...httpConfig.requestInit,
      ...(httpConfig.headers && { headers: httpConfig.headers }),
    };
    const transport = new StreamableHTTPClientTransport(url, {
      requestInit,
    });
    return { transport };
  }
}
