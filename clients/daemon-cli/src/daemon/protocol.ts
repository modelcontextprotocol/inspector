import type {
  InspectorServerSettings,
  MCPServerConfig,
  PendingRequestOrigin,
} from "@inspector/core/mcp/types.js";
import type {
  CliAppInfo,
  MethodArgs,
} from "@inspector/cli/handlers/method-types.js";
import type {
  Implementation,
  ProtocolEra,
  ServerCapabilities,
} from "@modelcontextprotocol/client";

/** Operations the connection daemon accepts over IPC. */
export type DaemonOp =
  | "ping"
  | "connect"
  | "disconnect"
  | "connections/list"
  | "connections/use"
  | "connections/show"
  | "daemon/status"
  | "daemon/stop"
  | "rpc"
  | "stream";

export type ConnectParams = {
  name: string;
  serverConfig: MCPServerConfig;
  serverSettings?: InspectorServerSettings;
  /** Human-readable server identity for `connections/list`. */
  serverIdentity: string;
};

export type ConnectionNameParams = {
  /** Omit to target the MRU connection (TTY). */
  name?: string;
  /**
   * When true (non-TTY / CI), omit is an error — require an explicit connection.
   * Front-end sets this from `!process.stdin.isTTY` (not stdout — keying off
   * stdin lets piping output, e.g. `mcpdo tools/list | jq`, still use MRU when
   * a human is at the keyboard) unless opted out via
   * `MCP_ALLOW_DEFAULT_CONNECTION=1`.
   */
  requireExplicit?: boolean;
};

/** Params for `rpc` / `stream` — connection targeting plus method args. */
export type RpcParams = ConnectionNameParams &
  MethodArgs & {
    method: string;
  };

export type DaemonRequest = {
  id: string;
  op: DaemonOp;
  /**
   * IPC auth token. Required when the daemon was started with
   * `MCP_INSPECTOR_DAEMON_TOKEN` set (private mode); omitted for the shared
   * default daemon.
   */
  token?: string;
  params?:
    | ConnectParams
    | ConnectionNameParams
    | RpcParams
    | Record<string, never>;
};

export type DaemonErrorBody = {
  code: string;
  message: string;
  /** Suggested CLI exit code when applicable. */
  exitCode?: number;
};

export type DaemonResponse =
  | { id: string; ok: true; result: unknown }
  | { id: string; ok: false; error: DaemonErrorBody };

/** Frames after the initial ok response on a `stream` connection. */
export type DaemonStreamFrame =
  | { id: string; stream: "data"; data: unknown }
  | { id: string; stream: "end" };

/**
 * One elicitation request/answer exchange, carried mid-`rpc` call when the
 * in-flight tool/prompt/resource call surfaces a legacy or modern non-task
 * MRTR elicitation (dual-era support, phase 1 — task-augmented MRTR
 * elicitation is a separate follow-up, since that call already returns
 * immediately and never blocks a `rpc` round-trip in the first place).
 *
 * Written by the daemon onto the SAME connection as the originating `rpc`
 * request, before its `DaemonResponse`; the CLI answers on that same
 * connection with an {@link ElicitationResponseFrame}, and the daemon resumes
 * the (still in-flight) call. See `ipc-glue.ts`'s `acceptDaemonConnection` for
 * why this needs no new channel: each `rpc` request already owns its
 * connection exclusively, and core itself never has more than one elicitation
 * pending at a time (sequential by design) — though a single call can
 * pause/resume through several of these exchanges before its final response.
 */
export type ElicitationRequestFrame = {
  id: string;
  kind: "elicitation-request";
  /** `ElicitationCreateMessage.id` — echoed back so the answer can be matched. */
  elicitationId: string;
  mode: "form" | "url";
  message: string;
  /** Form mode only. */
  requestedSchema?: Record<string, unknown>;
  /** URL mode only. */
  url?: string;
  /** Legacy server→client request vs. modern non-task MRTR round. */
  origin: PendingRequestOrigin;
};

export type ElicitationResponseFrame = {
  id: string;
  kind: "elicitation-response";
  elicitationId: string;
  action: "accept" | "decline" | "cancel";
  /** Form mode `action: "accept"` only. */
  content?: Record<string, unknown>;
};

/**
 * Slim connect-time snapshot of a connection's authorization, projected from the
 * core `OAuthConnectionState` (see {@link ConnectionInfo.auth}). Absent entirely
 * for stdio servers and HTTP servers that never engaged OAuth — cleaner than
 * reporting "none" for every local server.
 */
export type ConnectionAuthInfo = {
  method: "oauth" | "ema";
  /** Whether tokens for this server are present in storage. */
  authorized: boolean;
  /** Granted scope (from the token response), when known. */
  scope?: string;
  /** OAuth client id used with the authorization server, when known. */
  clientId?: string;
  /** EMA only: IdP session state at connect time. */
  idpSession?: "none" | "logged_in" | "expired";
};

export type ConnectionInfo = {
  name: string;
  serverIdentity: string;
  connectedAt: number;
  lastAccessedAt: number;
  isMru: boolean;
  /**
   * Negotiated era for this connection's connection — legacy `initialize` vs.
   * modern `server/discover` (#2298 follow-up). Present everywhere a live
   * connection is reported (`connect`, `connections/list`, `connections/use`), not
   * just `connections/show`, so a user with several open connections can see which
   * era each negotiated without querying them one at a time. Absent only if
   * the client hasn't connected (never observed in practice — every code
   * path constructing a `ConnectionInfo` does so from an already-connected
   * connection).
   */
  protocolEra?: ProtocolEra;
  /**
   * Authorization snapshot. Like `protocolEra`, present everywhere a live
   * connection is reported so both humans and agents can see *how* a connection is
   * authenticated (OAuth vs. EMA, authorized or not) without a separate
   * query. Freshness varies by op: `connect` computes it right after the
   * connection succeeds; `connections/list` and `connections/use` reuse that
   * connect-time value; `connections/show` recomputes it live *from disk* so it
   * reflects the current persisted state (e.g. after `auth/clear` or
   * `auth/ema-logout`, even from another process). Note a live connection may
   * keep working on its in-memory tokens after storage was cleared — `show`
   * reports the persisted state, matching `auth/ema-status`.
   */
  auth?: ConnectionAuthInfo;
};

/**
 * `connections/show` result: daemon bookkeeping ({@link ConnectionInfo}, which as of
 * #2298 already carries `protocolEra`) plus the live MCP connection state —
 * era-agnostic (`serverInfo`/`capabilities`/`instructions`/`protocolVersion`
 * are populated the same way whether they came from a legacy `initialize`
 * response or a modern `server/discover`) and era-specific (`supportedVersions`,
 * only set when the connect actually probed `server/discover`, i.e.
 * `auto`/`modern`).
 */
export type ConnectionShowResult = ConnectionInfo & {
  serverInfo?: Implementation;
  protocolVersion?: string;
  capabilities?: ServerCapabilities;
  instructions?: string;
  supportedVersions?: string[];
};

export type DaemonStatus = {
  pid: number;
  socketPath: string;
  connections: ConnectionInfo[];
  idleMs: number | null;
};

/** Serializable RPC outcome (no live stream callbacks). */
export type RpcResult =
  | {
      kind: "result";
      result: Record<string, unknown>;
      appInfo?: CliAppInfo;
    }
  | {
      kind: "ndjson";
      lines: unknown[];
      /**
       * `skills/list --verify` / `skills/get --verify` one-line stderr
       * verdict (#2248). Carried across the daemon socket so the connection CLI
       * can report the same summary the one-shot CLI does, rather than
       * silently dropping it the way an earlier pass through this file did.
       */
      summary?: string;
      /** Non-zero when the emitted report is itself a failure (`--verify`). */
      exitCode?: number;
    };
