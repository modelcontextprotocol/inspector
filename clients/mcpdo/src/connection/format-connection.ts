import {
  awaitableError,
  awaitableLog,
} from "@inspector/cli/utils/awaitable-log.js";
import type {
  ConnectionInfo,
  ElicitationPendingInfo,
} from "../daemon/protocol.js";
import { CliExitCodeError, EXIT_CODES } from "@inspector/cli/error-handler.js";
import type { OutputFormat } from "@inspector/cli/handlers/format-output.js";
import type { CliAppInfo } from "@inspector/cli/handlers/method-types.js";
import {
  formatAppInfoHuman,
  formatAppInfoListHuman,
  formatAuthListHuman,
  formatEmaStatusHuman,
  formatRpcResultHuman,
  formatServersListHuman,
  formatServerShowHuman,
  formatConnectionInfoHuman,
  formatConnectionsListHuman,
  formatElicitationPendingHuman,
  formatSkillVerifyListHuman,
  formatStreamEventHuman,
} from "./format-human.js";
import { isSafeLinkTarget, sanitizeDeep, sanitizeText } from "./sanitize.js";
import { PLAIN, type Style } from "@inspector/cli/style.js";

type JsonObject = Record<string, unknown>;

/**
 * Pretty-print JSON for connection `--format json`.
 * Unlike one-shot, this does **not** wrap in `{ result }` — the payload is the
 * MCP / admin object itself (convenient for scripting).
 *
 * `JSON.stringify` escapes C0 controls but emits C1 controls (U+0080–U+009F,
 * including 8-bit CSI/OSC) literally, which terminals can interpret. Escape
 * them as standard `\uXXXX` sequences: the serialized text is terminal-safe
 * while parsed values stay byte-identical.
 */
export function formatConnectionJson(data: unknown): string {
  return (
    JSON.stringify(data, null, 2).replace(
      /[\u0080-\u009F]/g,
      (ch) => `\\u${ch.charCodeAt(0).toString(16).padStart(4, "0")}`,
    ) + "\n"
  );
}

export type ConnectionWriteKind =
  | {
      kind: "rpc";
      method: string;
      result: JsonObject;
      /**
       * Auto-collected by `runMethod` for `tools/call` + `--format json`.
       * Connection output ignores this side-channel (no `{ result, appInfo }`
       * envelope); only `result` is printed. `--app-info` probes put the
       * info object in `result` itself.
       */
      appInfo?: CliAppInfo;
      /** For exit-code messages when result.isError. */
      toolName?: string;
    }
  | {
      kind: "ndjson";
      lines: unknown[];
      /** Distinguishes `tools/list --app-info` probe lines from a `--verify` report. */
      variant?: "app-info" | "skill-verify";
      /** `--verify` one-line stderr verdict; absent for `--app-info`. */
      summary?: string;
      /** Non-zero when the emitted `--verify` report is itself a failure. */
      exitCode?: number;
    }
  | { kind: "stream-event"; data: unknown }
  | {
      kind: "servers/list";
      servers: unknown[];
      /** Which file produced the entries (writable catalog vs read-only config). */
      source?: { kind: "catalog" | "config"; path: string };
    }
  | {
      kind: "servers/show";
      server: JsonObject;
      /** Which file produced the entry (writable catalog vs read-only config). */
      source?: { kind: "catalog" | "config"; path: string };
    }
  | { kind: "connections/list"; connections: unknown[] }
  | {
      kind: "connection";
      connection: ConnectionInfo | JsonObject;
      /**
       * Non-TTY pending sign-in (see auth-helper.ts): the authorize URL the
       * caller must relay to a human. Rides the normal output payload — the
       * error envelope redacts URL query strings, which would strip the
       * client_id/PKCE/state this URL is made of.
       */
      authUrl?: string;
    }
  | {
      /**
       * A parked elicitation (non-interactive caller): everything needed to
       * relay the request to a human and answer it with
       * `elicitation/respond`. Rides the normal output payload for the same
       * redaction reason as `authUrl` (URL-mode elicitations carry a URL
       * whose query is meaningful).
       */
      kind: "elicitation-pending";
      elicitation: ElicitationPendingInfo;
    }
  | { kind: "disconnect"; name: string; clearedAuthUrl?: string }
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
  | {
      kind: "auth/ema-status";
      status: {
        clientConfigPath: string;
        configured: boolean;
        enabled: boolean;
        issuer?: string;
        clientId?: string;
        loginState: string;
      };
    }
  | {
      kind: "auth/ema-login";
      result: {
        issuer: string;
        loginState: string;
        alreadyLoggedIn: boolean;
        /** Present when the login was parked on a detached helper (non-TTY). */
        pendingLogin?: boolean;
        /** IdP authorization URL to relay to the human. */
        authUrl?: string;
      };
    }
  | {
      kind: "auth/ema-logout";
      result: { issuer: string; endSessionUrl?: string };
    }
  | { kind: "generic"; data: unknown; title?: string };

export type ConnectionWriteOpts = {
  format?: OutputFormat;
  /** Human-output styling; ignored for `--format json`. Defaults to plain. */
  style?: Style;
};

/**
 * Write connection CLI output honouring `--format text|json`.
 * One-shot output paths are unchanged (`emitResult` / `writeFormattedResult`).
 */
export async function writeConnectionOutput(
  opts: ConnectionWriteOpts,
  payload: ConnectionWriteKind,
): Promise<void> {
  const format: OutputFormat = opts.format === "json" ? "json" : "text";
  const style = opts.style ?? PLAIN;

  if (format === "json") {
    await awaitableLog(formatConnectionJson(jsonPayload(payload)));
    await writeNdjsonSummary(payload);
    applyExitCodes(payload);
    return;
  }

  // Server-controlled strings must never reach the terminal raw (escape
  // injection: OSC 52 clipboard writes, title spoofing, output rewriting).
  // Sanitize the whole payload before human formatting; the formatter's own
  // ANSI styling is applied afterwards and stays intact. JSON output above
  // is made safe by formatConnectionJson (C0 via JSON.stringify, C1 via its
  // own escaping).
  await awaitableLog(humanPayload(sanitizeDeep(payload), style) + "\n");
  await writeNdjsonSummary(payload);
  applyExitCodes(payload);
}

/**
 * `skills/list --verify` / `skills/get --verify`: the one-line verdict goes to
 * **stderr**, after the report, in both `--format text` and `--format json` —
 * mirrors the one-shot CLI (`consumeMethodOutcome`), so a reader piping stdout
 * into `jq` still sees it and a `--format json` caller isn't left without one
 * just because the report itself is already structured.
 */
async function writeNdjsonSummary(payload: ConnectionWriteKind): Promise<void> {
  if (payload.kind === "ndjson" && payload.summary) {
    // Human-facing stderr line in both formats; may embed server-derived
    // names, so sanitize (see sanitize.ts).
    await awaitableError(`${sanitizeText(payload.summary)}\n`);
  }
}

function jsonPayload(payload: ConnectionWriteKind): unknown {
  switch (payload.kind) {
    case "rpc":
      // Pretty payload only — never the one-shot `{ result[, appInfo] }` wrap.
      return payload.result;
    case "ndjson":
      return payload.lines;
    case "stream-event":
      return payload.data;
    case "servers/list":
      return {
        servers: payload.servers,
        ...(payload.source && { source: payload.source }),
      };
    case "servers/show":
      return payload.source
        ? { ...payload.server, source: payload.source }
        : payload.server;
    case "connections/list":
      return { connections: payload.connections };
    case "connection":
      return payload.authUrl !== undefined
        ? { ...(payload.connection as JsonObject), authUrl: payload.authUrl }
        : payload.connection;
    case "elicitation-pending":
      // The key doubles as the discriminator: a caller can tell "input
      // required" from a final tool result by `elicitationPending` alone.
      return { elicitationPending: payload.elicitation };
    case "disconnect":
      return {
        name: payload.name,
        ...(payload.clearedAuthUrl && {
          clearedAuthUrl: payload.clearedAuthUrl,
        }),
      };
    case "daemon/status":
      return payload.status;
    case "daemon/stop":
      return payload.result;
    case "auth/list":
      return payload.list;
    case "auth/clear":
      return payload.result;
    case "auth/ema-status":
      return payload.status;
    case "auth/ema-login":
      return payload.result;
    case "auth/ema-logout":
      return payload.result;
    case "generic":
      return payload.data;
  }
}

function humanPayload(payload: ConnectionWriteKind, style: Style): string {
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
      return payload.variant === "skill-verify"
        ? formatSkillVerifyListHuman(payload.lines, style)
        : formatAppInfoListHuman(payload.lines, style);
    case "stream-event":
      return formatStreamEventHuman(payload.data, style);
    case "servers/list":
      return formatServersListHuman(payload.servers, style, payload.source);
    case "servers/show":
      return formatServerShowHuman(payload.server, style, payload.source);
    case "connections/list":
      return formatConnectionsListHuman(payload.connections, style);
    case "connection": {
      const info = formatConnectionInfoHuman(
        payload.connection as JsonObject,
        style,
      );
      if (payload.authUrl === undefined) return info;
      const name = String((payload.connection as JsonObject).name ?? "");
      return [
        info,
        "",
        "Sign-in required. The user needs to open this link in a browser to authenticate:",
        // The URL comes from server-controlled OAuth metadata: only
        // allowlisted schemes become clickable OSC 8 links (same gate as
        // every other server-supplied link — see sanitize.ts).
        `  ${isSafeLinkTarget(payload.authUrl) ? style.link(payload.authUrl) : payload.authUrl}`,
        style.dim(
          `The connection completes automatically after sign-in — check with \`connections/show @${name}\`, or just run the next command.`,
        ),
      ].join("\n");
    }
    case "elicitation-pending":
      return formatElicitationPendingHuman(payload.elicitation, style);
    case "disconnect": {
      const line = `${style.bold("Disconnected")} ${`\`${style.bold(`@${payload.name}`)}\``}`;
      if (!payload.clearedAuthUrl) return line;
      return [
        line,
        style.dim(
          `Cleared stored auth for ${payload.clearedAuthUrl} — the next connect will re-trigger sign-in.`,
        ),
      ].join("\n");
    }
    case "daemon/status": {
      const s = payload.status;
      if (s.running === false) {
        return String(s.message ?? "Daemon is not running.");
      }
      const connections = Array.isArray(s.connections)
        ? (s.connections as unknown[])
        : [];
      return [
        `${style.bold("Daemon")} pid ${String(s.pid)}` +
          (s.stopping === true ? ` ${style.yellow("(shutting down)")}` : ""),
        style.dim(`Socket: ${String(s.socketPath ?? "")}`),
        formatConnectionsListHuman(connections, style),
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
    case "auth/ema-status":
      return formatEmaStatusHuman(payload.status, style);
    case "auth/ema-login":
      if (payload.result.alreadyLoggedIn) {
        return `${style.green("Already signed in")} to \`${style.bold(payload.result.issuer)}\` ${style.dim("(use auth/ema-login --relogin for a fresh connection)")}`;
      }
      if (payload.result.pendingLogin === true && payload.result.authUrl) {
        return [
          "Sign-in required. The user needs to open this link in a browser to authenticate:",
          // Same OSC 8 allowlist gate as the connection authUrl above.
          `  ${isSafeLinkTarget(payload.result.authUrl) ? style.link(payload.result.authUrl) : payload.result.authUrl}`,
          style.dim(
            "The sign-in completes in the background — check with `auth/ema-status` (loginState becomes logged_in).",
          ),
        ].join("\n");
      }
      return `${style.green("Signed in")} to \`${style.bold(payload.result.issuer)}\``;
    case "auth/ema-logout": {
      const signedOut = `${style.green("Signed out")} of \`${style.bold(payload.result.issuer)}\` ${style.dim("(EMA server tokens cleared)")}`;
      if (payload.result.endSessionUrl === undefined) return signedOut;
      // Local clear only — the IdP's browser SSO cookie survives it. Relay
      // the RP-initiated logout URL so the user can end that session too.
      return [
        signedOut,
        `To end your IdP browser session, navigate to: ${payload.result.endSessionUrl}`,
      ].join("\n");
    }
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
  // `JsonObject`'s index signature doesn't structurally overlap with
  // `CliAppInfo`'s concrete shape, so `as` needs the `unknown` bridge.
  return result as unknown as CliAppInfo;
}

function applyExitCodes(payload: ConnectionWriteKind): void {
  if (payload.kind === "ndjson" && payload.exitCode) {
    // Report already written above; thrown last so it routes through the
    // connection CLI's single exit path, same as the one-shot CLI's
    // `consumeMethodOutcome` (Copilot).
    throw new CliExitCodeError(payload.exitCode, payload.summary ?? "", {
      code:
        payload.exitCode === EXIT_CODES.SKILL_INCOMPLETE
          ? "skills_incomplete"
          : "skills_nonconformant",
    });
  }
  if (payload.kind === "rpc") {
    // Only `--app-info` probes (result is the info object) map to NO_APP.
    // Auto-collected `payload.appInfo` from tools/call+json must not.
    const info = asAppInfoProbe(payload.result);
    if (info) {
      if (!info.hasApp) {
        throw new CliExitCodeError(
          EXIT_CODES.NO_APP,
          // toolName echoes server-influenced text into a terminal-bound
          // error message; sanitize like the success path does.
          `Tool '${sanitizeText(info.toolName)}' has no MCP App UI resource (_meta.ui.resourceUri).`,
        );
      }
      return;
    }
    if (payload.result.isError === true) {
      throw new CliExitCodeError(
        EXIT_CODES.TOOL_ERROR,
        `Tool '${sanitizeText(payload.toolName ?? "tool")}' returned isError:true.`,
        { code: "tool_is_error" },
      );
    }
  }
}
