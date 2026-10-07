import type {
  InspectorServerSettings,
  MCPServerConfig,
  PendingRequestOrigin,
} from "@inspector/core/mcp/types.js";
import type {
  CliAppInfo,
  MethodArgs,
} from "@inspector/core/cli/handlers/method-types.js";
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
  | "stream"
  | "elicitation/respond";

export type ConnectParams = {
  name: string;
  serverConfig: MCPServerConfig;
  serverSettings?: InspectorServerSettings;
  /** Human-readable server identity for `connections/list`. */
  serverIdentity: string;
  /**
   * When true and the dial fails with `auth_required`, register the
   * connection anyway as a dormant intent entry (never-connected client,
   * terminal status) and return `ConnectionInfo` with `pendingAuth: true`
   * instead of throwing. The front-end sets this on the non-TTY connect path
   * after handing interactive OAuth to the detached auth helper: once the
   * user finishes signing in, the next op on this connection revives it with
   * the freshly stored credentials — no second `connect` required.
   */
  pendingOnAuthRequired?: boolean;
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
    /**
     * Whether a human is driving this call: set by the front-end to
     * `format === "text" && (stdin.isTTY || stderr.isTTY)` (see dispatch.ts).
     * One honest fact — "is there a human at the stream?" — drives two
     * daemon behaviours, so the daemon reads interactivity here rather than
     * inferring it from a side effect:
     *
     * - **Elicitation routing.** The daemon parks a legacy/modern non-task
     *   MRTR elicitation — instead of relaying it for an inline prompt — only
     *   when this field is *explicitly* `false` (`park = interactive === false`):
     *   it returns immediately with `kind: "elicitation-pending"` and the
     *   caller answers via the `elicitation/respond` op. Parking is opt-in, so
     *   an absent field does NOT park (a caller that never announced itself
     *   must not have its elicitations silently parked and hang). A
     *   non-interactive caller (`--format json` or non-TTY) has no human at the
     *   stream to answer an inline prompt.
     * - **Agent-vs-human message text.** Auth-pending errors use agent-tuned
     *   wording (relay instructions) unless this field is *explicitly* `true`.
     *   See `ConnectionRegistry.reviveLocked`.
     *
     * The two reads differ in the absent case on purpose: parking defaults OFF
     * (absent ⇒ don't park), message audience defaults to agent-facing
     * (absent ⇒ non-interactive). The front-end always sends it, so absent is
     * only ever a daemon-internal caller.
     */
    interactive?: boolean;
  };

export type DaemonRequest = {
  id: string;
  op: DaemonOp;
  /**
   * IPC auth token. Every daemon requires one: private mode passes it via
   * `MCP_INSPECTOR_DAEMON_TOKEN`, and the shared default daemon generates
   * one at startup and publishes it to `mcpdod.token` for clients to read.
   * Optional only at the wire/type boundary so a request missing the token
   * can still be parsed — and then rejected — rather than failing framing.
   */
  token?: string;
  params?:
    | ConnectParams
    | ConnectionNameParams
    | RpcParams
    | ElicitationRespondParams
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
 * A parked elicitation, as reported to a non-interactive caller
 * ({@link RpcParams.interactive} false): everything an agent needs to relay
 * the request to a human and answer it with `elicitation/respond`. Rides the
 * normal success payload — like the pending-auth URL, an elicitation URL's
 * query string is meaningful data the error envelope would redact.
 */
export type ElicitationPendingInfo = {
  /** Key for `elicitation/respond`; changes on every round. */
  elicitationId: string;
  /** Connection whose in-flight call is parked. */
  connection: string;
  /** Originating rpc method (e.g. `tools/call`), for output rendering. */
  method: string;
  /** Originating tool, when the method was `tools/call`. */
  toolName?: string;
  mode: "form" | "url";
  message: string;
  /** Form mode only. */
  requestedSchema?: Record<string, unknown>;
  /** URL mode only. */
  url?: string;
  /** Legacy server→client request vs. modern non-task MRTR round. */
  origin: PendingRequestOrigin;
  /** Epoch ms; the exchange is auto-cancelled if unanswered by then. */
  expiresAt: number;
};

/** Params for the `elicitation/respond` op. */
export type ElicitationRespondParams = {
  elicitationId: string;
  action: "accept" | "decline" | "cancel";
  /** Form mode `action: "accept"` only. */
  content?: Record<string, unknown>;
};

/**
 * `elicitation/respond` result. `outcome` is either the parked call's final
 * result — the response the original `rpc` would have produced — or the next
 * `elicitation-pending` round; `method`/`toolName` echo the originating call
 * so the front-end can render that result the same way `rpc` output is.
 */
export type ElicitationRespondResult = {
  method: string;
  toolName?: string;
  outcome: RpcResult;
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
  /**
   * True when this entry was registered as auth-pending intent
   * ({@link ConnectParams.pendingOnAuthRequired}): the dial hit
   * `auth_required` and interactive sign-in is completing out of band in the
   * detached auth helper. The entry holds a never-connected client, so the
   * first op after tokens land revives (dials) it transparently. Reported by
   * `connect` and echoed by `connections/list`/`connections/show` until a
   * revive succeeds; `connections/show` itself revives once it sees the
   * signed-in tokens on disk, so polling it observes the completion.
   */
  pendingAuth?: boolean;
  /**
   * Only alongside `pendingAuth: true`: the out-of-band sign-in has already
   * stored usable tokens on disk, so the connection completes on its next
   * use (or on the next `connections/show`, which revives it). Set by the
   * read-only echoes (`connections/list`, `connections/use`, `daemon/status`)
   * from a disk check — no dial. A poller seeing this can stop waiting on the
   * user and proceed to its next command.
   */
  pendingAuthSignedIn?: boolean;
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
  /**
   * Live transport state, `connections/show` only. The connection itself is
   * user intent ("connected until I disconnect"); the transport under it is
   * disposable and self-healing. `"live"` = the client session is up;
   * `"connecting"` = mid-dial; `"dormant"` = the transport dropped (server
   * expired the session, SSE stream closed, stdio child exited) and the next
   * op will transparently re-dial with stored credentials. Debug detail, not
   * something the user must act on.
   */
  transport?: "live" | "connecting" | "dormant";
  /**
   * Only alongside `pendingAuth: true`: the authorize URL the human must open
   * to complete an out-of-band sign-in, present while the detached auth
   * helper is still live (unexpired, PID alive — see
   * `readLivePendingAuthMarker`). Rides the result payload, not the error
   * envelope, because the envelope redacts URL query strings and this URL IS
   * its query (client_id/PKCE/state). A poller reads it here and relays it;
   * the `auth_required` error on other ops points here rather than carrying a
   * (redacted, useless) copy.
   */
  authUrl?: string;
};

export type DaemonStatus = {
  pid: number;
  socketPath: string;
  connections: ConnectionInfo[];
  idleMs: number | null;
  /** True once shutdown has begun (status stays answerable while stopping). */
  stopping: boolean;
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
    }
  | {
      /**
       * The call surfaced an elicitation while
       * {@link RpcParams.interactive} was false: the call is parked
       * daemon-side awaiting `elicitation/respond`, and this is everything
       * the caller needs to answer it.
       */
      kind: "elicitation-pending";
      elicitation: ElicitationPendingInfo;
    };
