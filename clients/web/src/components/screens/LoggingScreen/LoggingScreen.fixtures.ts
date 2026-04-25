import type { LoggingLevel } from "@modelcontextprotocol/sdk/types.js";
import type { LogEntryData } from "../../elements/LogEntry/LogEntry";

const logMessages: {
  level: LoggingLevel;
  data: string;
  logger?: string;
}[] = [
  { level: "info", data: "Server started on port 3000" },
  {
    level: "debug",
    data: "Loading configuration from /etc/mcp/config.json",
    logger: "config",
  },
  {
    level: "warning",
    data: "Deprecated API endpoint called: /v1/tools",
    logger: "http",
  },
  { level: "info", data: "Client connected: inspector-web-ui" },
  {
    level: "error",
    data: "Failed to read resource: file not found at /data/missing.txt",
    logger: "resources",
  },
  {
    level: "info",
    data: "Tool execution completed: search_files (245ms)",
    logger: "tools",
  },
  {
    level: "debug",
    data: "Parsing JSON-RPC request body",
    logger: "transport",
  },
  {
    level: "info",
    data: "Listing available tools for client session",
    logger: "tools",
  },
  {
    level: "warning",
    data: "Slow query detected: 1200ms for resource lookup",
    logger: "db",
  },
  {
    level: "info",
    data: "Resource subscription added: file:///config.json",
    logger: "resources",
  },
  {
    level: "debug",
    data: "Heartbeat ping received from client",
    logger: "session",
  },
  {
    level: "error",
    data: "Permission denied reading /etc/secrets.env",
    logger: "resources",
  },
  {
    level: "info",
    data: "Prompt 'summarize' resolved with 2 messages",
    logger: "prompts",
  },
  {
    level: "debug",
    data: "Cache hit for resource: db://users/42",
    logger: "cache",
  },
  {
    level: "info",
    data: "Tool 'create_record' executed successfully in 89ms",
    logger: "tools",
  },
  {
    level: "warning",
    data: "Client reconnection attempt #3",
    logger: "session",
  },
  {
    level: "info",
    data: "New resource detected: file:///data/output.csv",
    logger: "resources",
  },
  {
    level: "debug",
    data: "Serializing response payload (2.4KB)",
    logger: "transport",
  },
  {
    level: "error",
    data: "Timeout waiting for tool response after 30s",
    logger: "tools",
  },
  {
    level: "info",
    data: "Session initialized with capabilities: tools, resources, prompts",
  },
  {
    level: "debug",
    data: "Validating input schema for tool 'batch_process'",
    logger: "tools",
  },
  {
    level: "info",
    data: "Resource template resolved: db://tables/users/rows/15",
    logger: "resources",
  },
  {
    level: "warning",
    data: "Memory usage at 78% — consider increasing limits",
    logger: "system",
  },
  {
    level: "info",
    data: "Client disconnected gracefully",
    logger: "session",
  },
  {
    level: "debug",
    data: "Flushing log buffer to disk (128 entries)",
    logger: "logging",
  },
];

function pad(n: number): string {
  return n.toString().padStart(2, "0");
}

export const mixedEntries: LogEntryData[] = Array.from(
  { length: 50 },
  (_, i) => {
    const src = logMessages[i % logMessages.length];
    return {
      receivedAt: new Date(`2026-03-17T10:00:${pad(i + 1)}Z`),
      params: { level: src.level, data: src.data, logger: src.logger },
    };
  },
);
