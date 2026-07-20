import type { JsonValue } from "@inspector/core/mcp/index.js";
import type { AppInfo } from "@inspector/core/mcp/apps.js";
import type { LoggingLevel } from "@modelcontextprotocol/client";
import type { OutputFormat } from "./format-output.js";

export type { OutputFormat };

/**
 * {@link AppInfo} plus a CLI-only `resourceError` so a `resources/read` failure
 * during the probe is reported instead of being silently swallowed.
 */
export type CliAppInfo = AppInfo & { resourceError?: string };

/** Arguments for a single MCP method invocation (one-shot or session RPC). */
export type MethodArgs = {
  method?: string;
  promptName?: string;
  promptArgs?: Record<string, JsonValue>;
  uri?: string;
  logLevel?: LoggingLevel;
  toolName?: string;
  toolArg?: Record<string, JsonValue>;
  toolMeta?: Record<string, string>;
  metadata?: Record<string, string>;
  appInfo?: boolean;
  format?: OutputFormat;
  /** Task id for tasks/get, tasks/cancel, tasks/result. */
  taskId?: string;
  /** When true, tools/call uses callToolStream (task-augmented). */
  task?: boolean;
  /** roots/set payload (JSON array of {uri, name?}). */
  rootsJson?: string;
  /** prompts/complete: argument name / value / ref. */
  completeRefType?: "ref/prompt" | "ref/resource";
  completeRef?: string;
  completeArgName?: string;
  completeArgValue?: string;
};

export type McpResponse = Record<string, unknown>;

/**
 * Discriminated outcome from {@link runMethod}. Most methods return a `result`
 * for formatting; `tools/list --app-info` returns `ndjson` lines for the
 * caller to write. Stream methods return `stream` for a long-lived consumer.
 */
export type MethodOutcome =
  | { kind: "result"; result: McpResponse; appInfo?: CliAppInfo }
  /** One JSON object per line (e.g. tools/list --app-info). Caller writes stdout. */
  | { kind: "ndjson"; lines: unknown[] }
  | {
      kind: "stream";
      /** Human label for errors. */
      label: string;
      /** Subscribe and push NDJSON object lines; return an unsubscribe. */
      start: (writeLine: (obj: unknown) => void) => () => void;
    };

/** Methods supported by {@link runMethod}. */
export const SESSION_RPC_METHODS = [
  "initialize",
  "tools/list",
  "tools/call",
  "resources/list",
  "resources/read",
  "resources/templates/list",
  "resources/subscribe",
  "resources/unsubscribe",
  "prompts/list",
  "prompts/get",
  "prompts/complete",
  "logging/setLevel",
  "logging/tail",
  "tasks/list",
  "tasks/get",
  "tasks/cancel",
  "tasks/result",
  "roots/list",
  "roots/set",
] as const;

export type SessionRpcMethod = (typeof SESSION_RPC_METHODS)[number];
