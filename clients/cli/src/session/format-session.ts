import { awaitableLog } from "../utils/awaitable-log.js";
import type { SessionInfo } from "../daemon/protocol.js";
import { CliExitCodeError, EXIT_CODES } from "../error-handler.js";
import type { OutputFormat } from "../handlers/format-output.js";
import type { CliAppInfo } from "../handlers/method-types.js";
import {
  formatAppInfoHuman,
  formatAppInfoListHuman,
  formatAuthListHuman,
  formatRpcResultHuman,
  formatServersListHuman,
  formatServerShowHuman,
  formatSessionInfoHuman,
  formatSessionsListHuman,
  formatStreamEventHuman,
} from "./format-human.js";
import { PLAIN, type Style } from "./style.js";

type JsonObject = Record<string, unknown>;

/**
 * Pretty-print JSON for session `--format json`.
 * Unlike one-shot, this does **not** wrap in `{ result }` — the payload is the
 * MCP / admin object itself (convenient for scripting).
 */
export function formatSessionJson(data: unknown): string {
  return JSON.stringify(data, null, 2) + "\n";
}

export type SessionWriteKind =
  | {
      kind: "rpc";
      method: string;
      result: JsonObject;
      /**
       * Auto-collected by `runMethod` for `tools/call` + `--format json`.
       * Session output ignores this side-channel (no `{ result, appInfo }`
       * envelope); only `result` is printed. `--app-info` probes put the
       * info object in `result` itself.
       */
      appInfo?: CliAppInfo;
      /** For exit-code messages when result.isError. */
      toolName?: string;
    }
  | { kind: "ndjson"; lines: unknown[] }
  | { kind: "stream-event"; data: unknown }
  | { kind: "servers/list"; servers: unknown[] }
  | { kind: "servers/show"; server: JsonObject }
  | { kind: "sessions/list"; sessions: unknown[] }
  | { kind: "session"; session: SessionInfo | JsonObject }
  | { kind: "disconnect"; name: string }
  | { kind: "daemon/status"; status: JsonObject }
  | { kind: "daemon/stop"; result: JsonObject }
  | {
      kind: "auth/list";
      list: { oauthStatePath: string; servers: unknown[] };
    }
  | {
      kind: "auth/clear";
      result: { url?: string; cleared?: number; all?: boolean };
    }
  | { kind: "generic"; data: unknown; title?: string };

export type SessionWriteOpts = {
  format?: OutputFormat;
  /** Human-output styling; ignored for `--format json`. Defaults to plain. */
  style?: Style;
};

/**
 * Write session CLI output honouring `--format text|json`.
 * One-shot output paths are unchanged (`emitResult` / `writeFormattedResult`).
 */
export async function writeSessionOutput(
  opts: SessionWriteOpts,
  payload: SessionWriteKind,
): Promise<void> {
  const format: OutputFormat = opts.format === "json" ? "json" : "text";
  const style = opts.style ?? PLAIN;

  if (format === "json") {
    await awaitableLog(formatSessionJson(jsonPayload(payload)));
    applyExitCodes(payload);
    return;
  }

  await awaitableLog(humanPayload(payload, style) + "\n");
  applyExitCodes(payload);
}

function jsonPayload(payload: SessionWriteKind): unknown {
  switch (payload.kind) {
    case "rpc":
      // Pretty payload only — never the one-shot `{ result[, appInfo] }` wrap.
      return payload.result;
    case "ndjson":
      return payload.lines;
    case "stream-event":
      return payload.data;
    case "servers/list":
      return { servers: payload.servers };
    case "servers/show":
      return payload.server;
    case "sessions/list":
      return { sessions: payload.sessions };
    case "session":
      return payload.session;
    case "disconnect":
      return { name: payload.name };
    case "daemon/status":
      return payload.status;
    case "daemon/stop":
      return payload.result;
    case "auth/list":
      return payload.list;
    case "auth/clear":
      return payload.result;
    case "generic":
      return payload.data;
  }
}

function humanPayload(payload: SessionWriteKind, style: Style): string {
  switch (payload.kind) {
    case "rpc": {
      if (asAppInfoProbe(payload.result)) {
        return formatAppInfoHuman(payload.result, style);
      }
      const formatted = formatRpcResultHuman(
        payload.method,
        payload.result,
        style,
      );
      return formatted ?? JSON.stringify(payload.result, null, 2);
    }
    case "ndjson":
      return formatAppInfoListHuman(payload.lines, style);
    case "stream-event":
      return formatStreamEventHuman(payload.data, style);
    case "servers/list":
      return formatServersListHuman(payload.servers, style);
    case "servers/show":
      return formatServerShowHuman(payload.server, style);
    case "sessions/list":
      return formatSessionsListHuman(payload.sessions, style);
    case "session":
      return formatSessionInfoHuman(payload.session as JsonObject, style);
    case "disconnect":
      return `${style.bold("Disconnected")} ${`\`${style.bold(`@${payload.name}`)}\``}`;
    case "daemon/status": {
      const s = payload.status;
      if (s.running === false) {
        return String(s.message ?? "Daemon is not running.");
      }
      const sessions = Array.isArray(s.sessions)
        ? (s.sessions as unknown[])
        : [];
      return [
        `${style.bold("Daemon")} pid ${String(s.pid)}`,
        style.dim(`Socket: ${String(s.socketPath ?? "")}`),
        formatSessionsListHuman(sessions, style),
      ].join("\n");
    }
    case "daemon/stop":
      if (payload.result.stopping === false) {
        return String(payload.result.message ?? "Daemon was not running.");
      }
      return style.green("Daemon stopping.");
    case "auth/list":
      return formatAuthListHuman(payload.list, style);
    case "auth/clear":
      if (payload.result.all === true) {
        return style.green(
          `Cleared ${String(payload.result.cleared ?? 0)} stored auth entr${
            payload.result.cleared === 1 ? "y" : "ies"
          }.`,
        );
      }
      return `${style.green("Cleared")} \`${style.bold(String(payload.result.url ?? ""))}\``;
    case "generic": {
      if (payload.title) {
        return `${style.bold(payload.title)}\n${JSON.stringify(payload.data, null, 2)}`;
      }
      return JSON.stringify(payload.data, null, 2);
    }
  }
}

function asAppInfoProbe(result: JsonObject): CliAppInfo | undefined {
  if (
    typeof result.hasApp !== "boolean" ||
    typeof result.toolName !== "string" ||
    result.content !== undefined ||
    result.tools !== undefined
  ) {
    return undefined;
  }
  // Narrowed by the structural checks above; CliAppInfo adds optional fields.
  return result as CliAppInfo;
}

function applyExitCodes(payload: SessionWriteKind): void {
  if (payload.kind === "rpc") {
    // Only `--app-info` probes (result is the info object) map to NO_APP.
    // Auto-collected `payload.appInfo` from tools/call+json must not.
    const info = asAppInfoProbe(payload.result);
    if (info) {
      if (!info.hasApp) {
        throw new CliExitCodeError(
          EXIT_CODES.NO_APP,
          `Tool '${info.toolName}' has no MCP App UI resource (_meta.ui.resourceUri).`,
        );
      }
      return;
    }
    if (payload.result.isError === true) {
      throw new CliExitCodeError(
        EXIT_CODES.TOOL_ERROR,
        `Tool '${payload.toolName ?? "tool"}' returned isError:true.`,
        { code: "tool_is_error" },
      );
    }
  }
}
