import type {
  InspectorServerSettings,
  MCPServerConfig,
} from "@inspector/core/mcp/types.js";
import type { CliAppInfo, MethodArgs } from "../handlers/method-types.js";

/** Operations the session daemon accepts over IPC. */
export type DaemonOp =
  | "ping"
  | "connect"
  | "disconnect"
  | "sessions/list"
  | "sessions/use"
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
  | { kind: "ndjson"; lines: unknown[] };
