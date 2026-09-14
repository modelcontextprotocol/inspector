import type { JsonValue } from "@inspector/core/mcp/index.js";
import type { RequestMetadata } from "@inspector/core/mcp/types.js";
import type { AppInfo } from "@inspector/core/mcp/apps.js";
import type { LoggingLevel } from "@modelcontextprotocol/client";
import type { OutputFormat } from "./format-output.js";

export type { OutputFormat };

/**
 * {@link AppInfo} plus a CLI-only `resourceError` so a `resources/read` failure
 * during the probe is reported instead of being silently swallowed.
 */
export type CliAppInfo = AppInfo & { resourceError?: string };

/** Arguments for a single MCP method invocation via {@link runMethod}. */
export type MethodArgs = {
  method?: string;
  promptName?: string;
  promptArgs?: Record<string, JsonValue>;
  uri?: string;
  logLevel?: LoggingLevel;
  toolName?: string;
  toolArg?: Record<string, JsonValue>;
  toolMeta?: RequestMetadata;
  metadata?: RequestMetadata;
  appInfo?: boolean;
  /**
   * `--strict`: report tool-schema portability findings in full and exit
   * non-zero when any is error-severity (#1005). `tools/list` only.
   */
  strict?: boolean;
  format?: OutputFormat;
  /** Task id for tasks/get, tasks/cancel, tasks/result. */
  taskId?: string;
  /** When true, tools/call uses callToolStream (task-augmented). */
  task?: boolean;
  /**
   * `--verify`: run the SEP-2640 conformance and digest checks over the skills
   * a `skills/list` / `skills/get` returned, emit one NDJSON report per skill,
   * and exit non-zero when any fails (#2248).
   */
  verify?: boolean;
  /**
   * Opaque pagination cursor. Used by `resources/directory/read`, whose result
   * pages exactly as `resources/list` does — and where the caller descends the
   * tree itself, so there is no store to walk it.
   */
  cursor?: string;
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
  | {
      kind: "ndjson";
      lines: unknown[];
      /**
       * A line for **stderr**, written after the NDJSON. `--verify` uses it for
       * its one-line summary, so a reader who piped stdout into `jq` still sees
       * the verdict; `--app-info` sets nothing and behaves as before.
       */
      summary?: string;
      /** Non-zero when the emitted report is itself a failure (`--verify`). */
      exitCode?: number;
    }
  | {
      kind: "stream";
      /** Human label for errors. */
      label: string;
      /** Subscribe and push NDJSON object lines; return an unsubscribe. */
      start: (writeLine: (obj: unknown) => void) => () => void;
    };

/**
 * Full method set supported by {@link runMethod}.
 *
 * TODO(#1432): several of these (subscribe, tasks, roots, logging/tail, …) are
 * not exposed by `mcp-inspector --cli` today; they exist for the experimental
 * session CLI (`mcpi`) and other Node runners that share this dispatcher.
 */
export const SESSION_RPC_METHODS = [
  "initialize",
  "tools/list",
  "tools/call",
  "resources/list",
  "resources/read",
  "resources/templates/list",
  "resources/directory/read",
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
  "skills/list",
  "skills/get",
] as const;

export type SessionRpcMethod = (typeof SESSION_RPC_METHODS)[number];

/**
 * Methods accepted by `mcp-inspector --cli` (plus catalog-only
 * `servers/list` / `servers/show`, handled before connect). Stream methods and
 * long-lived RPCs (`logging/tail`, `tasks/*`, …) are rejected so the CLI
 * never hangs waiting for SIGINT.
 */
export const ONE_SHOT_METHODS = [
  "initialize",
  "tools/list",
  "tools/call",
  "resources/list",
  "resources/read",
  "resources/templates/list",
  "prompts/list",
  "prompts/get",
  "logging/setLevel",
  // SEP-2640. All three are ordinary one-shot request/response calls — no
  // stream, no long-lived subscription — so they belong here alongside the
  // other list verbs rather than being reachable only from the session CLI.
  "skills/list",
  "skills/get",
  "resources/directory/read",
] as const;

export type OneShotMethod = (typeof ONE_SHOT_METHODS)[number];

export function isOneShotMethod(method: string): method is OneShotMethod {
  return (ONE_SHOT_METHODS as readonly string[]).includes(method);
}
