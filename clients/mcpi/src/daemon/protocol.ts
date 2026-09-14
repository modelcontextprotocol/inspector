import type {
  InspectorServerSettings,
  MCPServerConfig,
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

/** Operations the session daemon accepts over IPC. */
export type DaemonOp =
  | "ping"
  | "connect"
  | "disconnect"
  | "sessions/list"
  | "sessions/use"
  | "sessions/show"
  | "daemon/status"
  | "daemon/stop"
  | "rpc"
  | "stream";

export type ConnectParams = {
  name: string;
  serverConfig: MCPServerConfig;
  serverSettings?: InspectorServerSettings;
  /** Human-readable server identity for `sessions/list`. */
  serverIdentity: string;
};

export type SessionNameParams = {
  /** Omit to target the MRU session (TTY). */
  name?: string;
  /**
   * When true (non-TTY / CI), omit is an error — require an explicit session.
   * Front-end sets this from `!process.stdout.isTTY` unless opted out.
   */
  requireExplicit?: boolean;
};

/** Params for `rpc` / `stream` — session targeting plus method args. */
export type RpcParams = SessionNameParams &
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
    | SessionNameParams
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

export type SessionInfo = {
  name: string;
  serverIdentity: string;
  connectedAt: number;
  lastAccessedAt: number;
  isMru: boolean;
  /**
   * Negotiated era for this session's connection — legacy `initialize` vs.
   * modern `server/discover` (#2298 follow-up). Present everywhere a live
   * session is reported (`connect`, `sessions/list`, `sessions/use`), not
   * just `sessions/show`, so a user with several open sessions can see which
   * era each negotiated without querying them one at a time. Absent only if
   * the client hasn't connected (never observed in practice — every code
   * path constructing a `SessionInfo` does so from an already-connected
   * session).
   */
  protocolEra?: ProtocolEra;
};

/**
 * `sessions/show` result: daemon bookkeeping ({@link SessionInfo}, which as of
 * #2298 already carries `protocolEra`) plus the live MCP connection state —
 * era-agnostic (`serverInfo`/`capabilities`/`instructions`/`protocolVersion`
 * are populated the same way whether they came from a legacy `initialize`
 * response or a modern `server/discover`) and era-specific (`supportedVersions`,
 * only set when the connect actually probed `server/discover`, i.e.
 * `auto`/`modern`).
 */
export type SessionShowResult = SessionInfo & {
  serverInfo?: Implementation;
  protocolVersion?: string;
  capabilities?: ServerCapabilities;
  instructions?: string;
  supportedVersions?: string[];
};

export type DaemonStatus = {
  pid: number;
  socketPath: string;
  sessions: SessionInfo[];
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
       * verdict (#2248). Carried across the daemon socket so the session CLI
       * can report the same summary the one-shot CLI does, rather than
       * silently dropping it the way an earlier pass through this file did.
       */
      summary?: string;
      /** Non-zero when the emitted report is itself a failure (`--verify`). */
      exitCode?: number;
    };
