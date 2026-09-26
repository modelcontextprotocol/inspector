import * as fs from "node:fs";
import * as net from "node:net";
import {
  classifyError,
  CliExitCodeError,
  EXIT_CODES,
} from "@inspector/cli/error-handler.js";
import { runMethod } from "@inspector/cli/handlers/run-method.js";
import type { MethodArgs } from "@inspector/cli/handlers/method-types.js";
import {
  acceptDaemonConnection,
  removeStaleDaemonSocket,
  type ElicitationChannel,
  type HandleOutcome,
} from "./ipc-glue.js";
import { wireElicitationBridge } from "./elicitation-bridge.js";
import { assertDaemonToken, getDaemonTokenFromEnv } from "./auth.js";
import type { InspectorClient } from "@inspector/core/mcp/index.js";
import { isTerminalStatus } from "@inspector/core/mcp/types.js";
import type { InspectorClientEventMap } from "@inspector/core/mcp/inspectorClientEventTarget.js";
import type { TypedEventGeneric } from "@inspector/core/mcp/typedEventTarget.js";
import {
  assertSocketPathWithinLimit,
  ensureDaemonDir,
  getDaemonDir,
  getDaemonLockPath,
  getDaemonSocketPath,
  getDaemonTokenPath,
} from "./paths.js";
import type {
  ConnectParams,
  DaemonRequest,
  DaemonResponse,
  DaemonStatus,
  RpcParams,
  RpcResult,
  ConnectionNameParams,
  ConnectionShowResult,
} from "./protocol.js";
import {
  DEFAULT_IDLE_MS,
  getLiveConnectionAuthInfo,
  ConnectionRegistry,
} from "./connections.js";

/**
 * Default channel used when a caller doesn't wire a real one (in-process
 * `handle`/`handleOutcome` test call sites that predate elicitation support).
 * Immediately cancels any elicitation, matching `elicit: false` behavior —
 * these callers never advertise elicitation support to the server anyway.
 */
const autoCancelElicitationChannel: ElicitationChannel = {
  request(frame) {
    return Promise.resolve({
      id: frame.id,
      kind: "elicitation-response",
      elicitationId: frame.elicitationId,
      action: "cancel",
    });
  },
};

export type DaemonServerOptions = {
  dir?: string;
  idleMs?: number;
  /**
   * When set, every IPC request must present this token. Defaults to
   * `MCP_INSPECTOR_DAEMON_TOKEN` from the environment (private mode).
   */
  requiredToken?: string;
  /** Called when the daemon should exit (idle timeout or daemon/stop). */
  onShutdown?: () => void;
  /**
   * Grace period at shutdown for flushing buffered response bytes before
   * still-open sockets are force-destroyed (a client that stopped reading
   * must not hang `daemon stop`). Tests use a short value.
   */
  flushTimeoutMs?: number;
};

/**
 * Unix-socket NDJSON daemon that owns {@link ConnectionRegistry}.
 */
export class DaemonServer {
  readonly registry: ConnectionRegistry;
  readonly socketPath: string;
  readonly lockPath: string;
  readonly dir: string;
  private readonly requiredToken: string | undefined;
  private server: net.Server | null = null;
  private readonly onShutdown: (() => void) | null;
  private stopping = false;
  /** In-flight stop, memoized so a repeated stop (e.g. a second SIGINT)
   * awaits the original cleanup instead of resolving immediately and letting
   * its caller `process.exit()` mid-teardown, stranding the socket, token,
   * and lock on disk. */
  private stopPromise: Promise<void> | null = null;
  /** In-flight handleOutcome calls; shutdown quiesces these before the
   * registry snapshot so a concurrent connect cannot register a live client
   * after disconnectAll and leak it. */
  private activeOps = 0;
  private opsIdleResolvers: (() => void)[] = [];
  /** Accepted IPC sockets. Long-lived stream sockets never end on their own,
   * so shutdown flushes and destroys them — otherwise server.close() would
   * wait forever. */
  private readonly ipcSockets = new Set<net.Socket>();
  /** Serializes `rpc` ops per client. Core cannot attribute an elicitation
   * to a specific in-flight call, so with concurrent RPCs on one connection
   * the bridge would route a prompt to the wrong caller's terminal; running
   * at most one rpc per connection at a time makes the routing exact. */
  private readonly rpcQueues = new WeakMap<InspectorClient, Promise<void>>();

  constructor(options: DaemonServerOptions = {}) {
    this.dir = options.dir ?? getDaemonDir();
    this.socketPath = getDaemonSocketPath(this.dir);
    this.lockPath = getDaemonLockPath(this.dir);
    this.requiredToken = options.requiredToken ?? getDaemonTokenFromEnv();
    this.flushTimeoutMs =
      options.flushTimeoutMs ?? DaemonServer.FLUSH_TIMEOUT_MS;
    this.registry = new ConnectionRegistry(options.idleMs ?? DEFAULT_IDLE_MS);
    this.onShutdown = options.onShutdown ?? null;
    this.registry.setIdleHandler(() => {
      void this.stop("idle");
    });
  }

  async start(): Promise<void> {
    ensureDaemonDir(this.dir);
    assertSocketPathWithinLimit(this.socketPath);
    this.acquireLock();
    try {
      await removeStaleDaemonSocket(this.socketPath);

      // Publish the IPC token (0600, inside the 0700 daemon dir) before the
      // socket exists, so a client can never connect without being able to
      // read the token it needs. See getDaemonTokenPath.
      if (this.requiredToken !== undefined) {
        const tokenPath = getDaemonTokenPath(this.dir);
        // Exclusive create after removing any existing entry: writeFileSync
        // follows symlinks, and ensureDaemonDir's tightening of the parent
        // does not remove children planted while the dir was writable — a
        // planted symlink would leak the token into an attacker-readable
        // file. rmSync removes a symlink itself, never its target.
        fs.rmSync(tokenPath, { force: true });
        fs.writeFileSync(tokenPath, this.requiredToken + "\n", {
          mode: 0o600,
          flag: "wx",
        });
        try {
          fs.chmodSync(tokenPath, 0o600);
        } catch {
          // Unsupported on some platforms.
        }
      }

      this.server = net.createServer((socket) => {
        this.ipcSockets.add(socket);
        socket.once("close", () => this.ipcSockets.delete(socket));
        acceptDaemonConnection(socket, (req, elicitation, signal) =>
          this.handleOutcome(req, elicitation, signal),
        );
      });

      await new Promise<void>((resolve, reject) => {
        this.server!.once("error", reject);
        this.server!.listen(this.socketPath, () => {
          this.server!.off("error", reject);
          resolve();
        });
      });

      // Restrict socket + lock to the creating user. Private mode also requires
      // an IPC token (see specification/v2_cli_v2.md §5.3).
      try {
        fs.chmodSync(this.socketPath, 0o600);
        fs.chmodSync(this.lockPath, 0o600);
      } catch {
        // Unsupported on some platforms (e.g. Windows named pipes).
      }

      // Connection-less spawn (e.g. ensureDaemon from tools/list with no connections)
      // must still self-reap — idle was previously only armed after disconnect.
      this.registry.armIdleTimerIfEmpty();
    } catch (error) {
      // Never leave a lock we own but no daemon behind it. The socket is only
      // unlinked by removeStaleDaemonSocket after a dead connect probe, so a
      // live daemon's socket is never touched here.
      this.releaseLock();
      throw error;
    }
  }

  stop(reason: "idle" | "stop" | "signal" = "stop"): Promise<void> {
    this.stopPromise ??= this.doStop(reason);
    return this.stopPromise;
  }

  private async doStop(reason: "idle" | "stop" | "signal"): Promise<void> {
    void reason;
    this.stopping = true;
    // Quiesce: new ops are rejected above; wait (bounded — an rpc blocked on
    // an interactive elicitation prompt must not hang shutdown forever) for
    // in-flight ops so a concurrent connect lands in the registry before the
    // disconnect snapshot below.
    await this.waitForActiveOps(DaemonServer.QUIESCE_TIMEOUT_MS);
    await this.registry.disconnectAll();
    // Flush pending response writes (e.g. daemon/stop's own {stopping:true})
    // then drop the sockets: long-lived stream sockets never end on their
    // own and would keep server.close() waiting forever.
    for (const socket of [...this.ipcSockets]) {
      socket.destroySoon();
    }
    await new Promise<void>((resolve) => {
      if (!this.server) {
        resolve();
        return;
      }
      // destroySoon() only destroys once queued bytes drain — a client that
      // stopped reading with a buffered response would keep server.close()
      // waiting forever. Bounded grace for the flush, then force-destroy
      // whatever is left.
      const force = setTimeout(() => {
        for (const socket of [...this.ipcSockets]) {
          socket.destroy();
        }
      }, this.flushTimeoutMs);
      force.unref();
      this.server.close(() => {
        clearTimeout(force);
        resolve();
      });
    });
    this.server = null;
    this.removeLockAndSocket();
    this.onShutdown?.();
  }

  /** Grace period for in-flight ops during shutdown before teardown proceeds
   * anyway. Exported for tests. */
  static readonly QUIESCE_TIMEOUT_MS = 3_000;

  /** Default shutdown flush grace before force-destroying sockets. */
  static readonly FLUSH_TIMEOUT_MS = 2_000;
  private readonly flushTimeoutMs: number;

  private waitForActiveOps(timeoutMs: number): Promise<void> {
    if (this.activeOps === 0) return Promise.resolve();
    return new Promise((resolve) => {
      const timer = setTimeout(resolve, timeoutMs);
      timer.unref?.();
      this.opsIdleResolvers.push(() => {
        clearTimeout(timer);
        resolve();
      });
    });
  }

  status(): DaemonStatus {
    return {
      pid: process.pid,
      socketPath: this.socketPath,
      connections: this.registry.list(),
      idleMs: this.registry.idleRemainingMs(),
    };
  }

  /** Handle one request; returns the response body (used by in-process tests). */
  async handle(
    request: DaemonRequest,
    elicitation: ElicitationChannel = autoCancelElicitationChannel,
    signal?: AbortSignal,
  ): Promise<DaemonResponse> {
    return (await this.handleOutcome(request, elicitation, signal)).response;
  }

  /** Full handle including optional stream starter (socket accept path). */
  async handleOutcome(
    request: DaemonRequest,
    elicitation: ElicitationChannel = autoCancelElicitationChannel,
    signal?: AbortSignal,
  ): Promise<HandleOutcome> {
    try {
      assertDaemonToken(this.requiredToken, request.token);
      this.activeOps++;
      try {
        return await this.dispatch(request, elicitation, signal);
      } finally {
        this.activeOps--;
        if (this.activeOps === 0) {
          for (const resolve of this.opsIdleResolvers.splice(0)) resolve();
        }
      }
    } catch (error) {
      if (error instanceof CliExitCodeError) {
        return {
          response: {
            id: request.id,
            ok: false,
            error: {
              code: error.envelope?.code ?? "cli_error",
              message: error.message,
              exitCode: error.exitCode,
            },
          },
        };
      }
      // Match one-shot CLI exit codes (e.g. unreachable → 4, not always 1).
      const { exitCode, envelope } = classifyError(error);
      return {
        response: {
          id: request.id,
          ok: false,
          error: {
            code: envelope.code,
            message: envelope.message,
            exitCode,
          },
        },
      };
    }
  }

  private async dispatch(
    request: DaemonRequest,
    elicitation: ElicitationChannel,
    signal?: AbortSignal,
  ): Promise<HandleOutcome> {
    // Once shutdown starts, new work is rejected: an op accepted here could
    // otherwise register a live client after disconnectAll's snapshot.
    // Status-style ops stay answerable; a repeated daemon/stop joins the
    // in-flight stop via the memoized promise.
    if (
      this.stopping &&
      request.op !== "ping" &&
      request.op !== "daemon/status" &&
      request.op !== "daemon/stop"
    ) {
      throw new CliExitCodeError(
        EXIT_CODES.UNREACHABLE,
        "Connection daemon is shutting down.",
        { code: "daemon_stopping" },
      );
    }
    switch (request.op) {
      case "ping":
        return {
          response: {
            id: request.id,
            ok: true,
            result: { pong: true, pid: process.pid },
          },
        };
      case "connect": {
        const params = request.params as ConnectParams;
        if (!params?.name || !params.serverConfig || !params.serverIdentity) {
          throw new CliExitCodeError(
            EXIT_CODES.USAGE,
            "connect requires name, serverConfig, and serverIdentity",
            { code: "invalid_params" },
          );
        }
        return {
          response: {
            id: request.id,
            ok: true,
            result: await this.registry.connect(params, signal),
          },
        };
      }
      case "disconnect": {
        const params = (request.params ?? {}) as ConnectionNameParams;
        return {
          response: {
            id: request.id,
            ok: true,
            result: await this.registry.disconnect(
              params.name,
              params.requireExplicit,
            ),
          },
        };
      }
      case "connections/list":
        return {
          response: {
            id: request.id,
            ok: true,
            result: { connections: this.registry.list() },
          },
        };
      case "connections/use": {
        const params = (request.params ?? {}) as ConnectionNameParams;
        if (!params.name) {
          throw new CliExitCodeError(
            EXIT_CODES.USAGE,
            "connections/use requires a connection name",
            { code: "invalid_params" },
          );
        }
        return {
          response: {
            id: request.id,
            ok: true,
            result: this.registry.use(params.name),
          },
        };
      }
      case "connections/show": {
        const params = (request.params ?? {}) as ConnectionNameParams;
        const connection = this.registry.connectionFor(
          params.name,
          params.requireExplicit,
        );
        const client = connection.client;
        // Recomputed live from disk (not the connect-time cache and not the
        // client's memory-cached storage): `show` reports the *current*
        // persisted auth state, so an auth/clear, auth/ema-logout, or a
        // web-client re-auth since connect is reflected here.
        const auth = await getLiveConnectionAuthInfo(connection);
        const result: ConnectionShowResult = {
          name: connection.name,
          serverIdentity: connection.serverIdentity,
          connectedAt: connection.connectedAt,
          lastAccessedAt: connection.lastAccessedAt,
          isMru: true,
          serverInfo: client.getServerInfo(),
          protocolVersion: client.getProtocolVersion(),
          protocolEra: client.getProtocolEra(),
          ...(auth && { auth }),
          capabilities: client.getCapabilities(),
          instructions: client.getInstructions(),
          supportedVersions: client.getDiscoverResult()?.supportedVersions,
        };
        return {
          response: { id: request.id, ok: true, result },
        };
      }
      case "daemon/status":
        return {
          response: { id: request.id, ok: true, result: this.status() },
        };
      case "daemon/stop":
        queueMicrotask(() => {
          void this.stop("stop");
        });
        return {
          response: { id: request.id, ok: true, result: { stopping: true } },
        };
      case "rpc":
        return {
          response: {
            id: request.id,
            ok: true,
            result: await this.runRpc(
              request.id,
              request.params as RpcParams,
              elicitation,
            ),
          },
        };
      case "stream":
        return this.openStream(request.id, request.params as RpcParams);
      default:
        throw new CliExitCodeError(
          EXIT_CODES.USAGE,
          `Unknown daemon op: ${(request as DaemonRequest).op}`,
          { code: "unknown_op" },
        );
    }
  }

  private async runRpc(
    requestId: string,
    params: RpcParams,
    elicitation: ElicitationChannel,
  ): Promise<RpcResult> {
    if (!params?.method) {
      throw new CliExitCodeError(EXIT_CODES.USAGE, "rpc requires a method", {
        code: "invalid_params",
      });
    }
    const client = this.registry.clientFor(params.name, params.requireExplicit);
    const previous = this.rpcQueues.get(client) ?? Promise.resolve();
    const run = previous.then(() =>
      this.runRpcOnClient(client, requestId, params, elicitation),
    );
    // Keep the queue alive past failures; each caller still sees its own
    // error through `run`.
    this.rpcQueues.set(
      client,
      run.then(
        () => undefined,
        () => undefined,
      ),
    );
    return run;
  }

  private async runRpcOnClient(
    client: InspectorClient,
    requestId: string,
    params: RpcParams,
    elicitation: ElicitationChannel,
  ): Promise<RpcResult> {
    const methodArgs = stripConnectionFields(params);
    const unwire = wireElicitationBridge(client, elicitation, requestId);
    let outcome;
    try {
      outcome = await runMethod(client, methodArgs);
    } finally {
      unwire();
    }
    if (outcome.kind === "stream") {
      throw new CliExitCodeError(
        EXIT_CODES.USAGE,
        `Method '${params.method}' is a stream; use the stream op.`,
        { code: "use_stream_op" },
      );
    }
    if (outcome.kind === "ndjson") {
      return {
        kind: "ndjson",
        lines: outcome.lines,
        summary: outcome.summary,
        exitCode: outcome.exitCode,
      };
    }
    return {
      kind: "result",
      result: outcome.result,
      appInfo: outcome.appInfo,
    };
  }

  private async openStream(
    id: string,
    params: RpcParams,
  ): Promise<HandleOutcome> {
    if (!params?.method) {
      throw new CliExitCodeError(EXIT_CODES.USAGE, "stream requires a method", {
        code: "invalid_params",
      });
    }
    const client = this.registry.clientFor(params.name, params.requireExplicit);
    const methodArgs = stripConnectionFields(params);
    const outcome = await runMethod(client, methodArgs);
    if (outcome.kind !== "stream") {
      throw new CliExitCodeError(
        EXIT_CODES.USAGE,
        `Method '${params.method}' is not a stream; use the rpc op.`,
        { code: "use_rpc_op" },
      );
    }
    return {
      response: {
        id,
        ok: true,
        result: { streaming: true, label: outcome.label },
      },
      startStream: (write, end) => {
        // Tie the stream to its connection's lifecycle: when the named
        // connection reaches a terminal state (mcpdo disconnect, a
        // connections/use replacement, or a transport failure), end the
        // stream instead of leaving the caller attached to a stale client
        // until Ctrl-C or daemon idle shutdown.
        const onStatus = (
          event: TypedEventGeneric<InspectorClientEventMap, "statusChange">,
        ) => {
          if (isTerminalStatus(event.detail)) end();
        };
        client.addEventListener("statusChange", onStatus);
        const stop = outcome.start(write);
        // Terminal status is persistent state, not just an event: a
        // disconnect completing between runMethod() and the listener
        // install above would never fire statusChange again, leaving the
        // stream open against a dead client. Checking the current status
        // after installing the listener closes both sides of that race.
        if (isTerminalStatus(client.getStatus())) end();
        return () => {
          client.removeEventListener("statusChange", onStatus);
          stop();
        };
      },
    };
  }

  /**
   * `daemon.lock` is a real lock, not bookkeeping: `O_EXCL`-create it with
   * our pid, and refuse to start while another *live* daemon holds it. A
   * lock left by a dead pid is reclaimed atomically: the stale file is
   * `rename`d aside first, so exactly one contender wins the reclaim and a
   * concurrent starter's freshly-created lock can never be deleted by the
   * read-pid → unlink window of another. If the renamed-aside file turns out
   * to hold a *live* pid (created between our read and the rename), it is
   * restored with a create-only `link` — ownership-preserving, same inode.
   */
  private acquireLock(): void {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const fd = fs.openSync(this.lockPath, "wx", 0o600);
        fs.writeSync(fd, `${process.pid}\n`);
        fs.closeSync(fd);
        return;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
        const holder = this.readLockPid();
        if (holder !== undefined && isPidAlive(holder)) {
          throw new Error(
            `Connection daemon lock ${this.lockPath} is held by running pid ${holder}. ` +
              `Use \`mcpdo daemon/stop\`, or remove the file if that pid is not an mcpdo daemon.`,
            { cause: error },
          );
        }
        const claimed = `${this.lockPath}.reclaim.${process.pid}`;
        try {
          fs.renameSync(this.lockPath, claimed);
        } catch {
          // Another contender renamed it first; retry the O_EXCL create.
          continue;
        }
        const claimedPid = this.readPidFile(claimed);
        if (claimedPid !== undefined && isPidAlive(claimedPid)) {
          // We renamed away a lock that a concurrent starter created between
          // our dead-pid read and the rename. Put it back without breaking
          // that starter's ownership: link() re-creates the path for the
          // same inode and fails (EEXIST) rather than overwriting.
          try {
            fs.linkSync(claimed, this.lockPath);
          } catch {
            // A third contender created a new lock meanwhile; the retry's
            // O_EXCL create / live-pid check decides.
          }
          try {
            fs.unlinkSync(claimed);
          } catch {
            // best-effort temp cleanup
          }
          throw new Error(
            `Connection daemon lock ${this.lockPath} is held by running pid ${claimedPid}. ` +
              `Use \`mcpdo daemon/stop\`, or remove the file if that pid is not an mcpdo daemon.`,
            { cause: error },
          );
        }
        try {
          fs.unlinkSync(claimed);
        } catch {
          // best-effort temp cleanup
        }
      }
    }
    throw new Error(
      `Could not acquire connection daemon lock ${this.lockPath}`,
    );
  }

  private readLockPid(): number | undefined {
    return this.readPidFile(this.lockPath);
  }

  private readPidFile(filePath: string): number | undefined {
    try {
      const pid = Number.parseInt(fs.readFileSync(filePath, "utf8").trim(), 10);
      return Number.isInteger(pid) && pid > 0 ? pid : undefined;
    } catch {
      return undefined;
    }
  }

  private releaseLock(): void {
    // Only release a lock this process still owns: after a reclaim race or
    // an operator's manual cleanup, the path may hold a successor's lock.
    if (this.readLockPid() !== process.pid) return;
    try {
      fs.unlinkSync(this.lockPath);
    } catch {
      // absent is fine
    }
  }

  private removeLockAndSocket(): void {
    try {
      fs.unlinkSync(this.socketPath);
    } catch {
      // absent is fine
    }
    try {
      fs.unlinkSync(getDaemonTokenPath(this.dir));
    } catch {
      // absent is fine
    }
    this.releaseLock();
  }
}

/** `kill(pid, 0)` liveness probe; EPERM means alive but not ours. */
function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

function stripConnectionFields(
  params: RpcParams,
): MethodArgs & { method: string } {
  // `format` is a frontend-only output concern; forwarding it would make
  // runMethod's `format === "json"` branch collect app info (an extra
  // resources/read) whose result the frontend discards.
  const { name, requireExplicit, format, method, ...rest } = params;
  void name;
  void requireExplicit;
  void format;
  return { method, ...rest };
}
