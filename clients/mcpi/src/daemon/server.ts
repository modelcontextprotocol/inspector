import * as fs from "node:fs";
import * as net from "node:net";
import {
  classifyError,
  CliExitCodeError,
  EXIT_CODES,
} from "../error-handler.js";
import { runMethod } from "../handlers/run-method.js";
import type { MethodArgs } from "../handlers/method-types.js";
import {
  acceptDaemonConnection,
  removeStaleDaemonSocket,
  type HandleOutcome,
} from "./ipc-glue.js";
import { assertDaemonToken, getDaemonTokenFromEnv } from "./auth.js";
import {
  ensureDaemonDir,
  getDaemonDir,
  getDaemonLockPath,
  getDaemonSocketPath,
} from "./paths.js";
import type {
  ConnectParams,
  DaemonRequest,
  DaemonResponse,
  DaemonStatus,
  RpcParams,
  RpcResult,
  SessionNameParams,
} from "./protocol.js";
import { DEFAULT_IDLE_MS, SessionRegistry } from "./sessions.js";

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
};

/**
 * Unix-socket NDJSON daemon that owns {@link SessionRegistry}.
 */
export class DaemonServer {
  readonly registry: SessionRegistry;
  readonly socketPath: string;
  readonly lockPath: string;
  readonly dir: string;
  private readonly requiredToken: string | undefined;
  private server: net.Server | null = null;
  private readonly onShutdown: (() => void) | null;
  private stopping = false;

  constructor(options: DaemonServerOptions = {}) {
    this.dir = options.dir ?? getDaemonDir();
    this.socketPath = getDaemonSocketPath(this.dir);
    this.lockPath = getDaemonLockPath(this.dir);
    this.requiredToken = options.requiredToken ?? getDaemonTokenFromEnv();
    this.registry = new SessionRegistry(options.idleMs ?? DEFAULT_IDLE_MS);
    this.onShutdown = options.onShutdown ?? null;
    this.registry.setIdleHandler(() => {
      void this.stop("idle");
    });
  }

  async start(): Promise<void> {
    ensureDaemonDir(this.dir);
    await removeStaleDaemonSocket(this.socketPath);
    this.writeLock();

    this.server = net.createServer((socket) => {
      acceptDaemonConnection(socket, (req) => this.handleOutcome(req));
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

    // Session-less spawn (e.g. ensureDaemon from tools/list with no sessions)
    // must still self-reap — idle was previously only armed after disconnect.
    this.registry.armIdleTimerIfEmpty();
  }

  async stop(reason: "idle" | "stop" | "signal" = "stop"): Promise<void> {
    void reason;
    if (this.stopping) return;
    this.stopping = true;
    await this.registry.disconnectAll();
    await new Promise<void>((resolve) => {
      if (!this.server) {
        resolve();
        return;
      }
      this.server.close(() => resolve());
    });
    this.server = null;
    this.removeLockAndSocket();
    this.onShutdown?.();
  }

  status(): DaemonStatus {
    return {
      pid: process.pid,
      socketPath: this.socketPath,
      sessions: this.registry.list(),
      idleMs: this.registry.idleRemainingMs(),
    };
  }

  /** Handle one request; returns the response body (used by in-process tests). */
  async handle(request: DaemonRequest): Promise<DaemonResponse> {
    return (await this.handleOutcome(request)).response;
  }

  /** Full handle including optional stream starter (socket accept path). */
  async handleOutcome(request: DaemonRequest): Promise<HandleOutcome> {
    try {
      assertDaemonToken(this.requiredToken, request.token);
      return await this.dispatch(request);
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

  private async dispatch(request: DaemonRequest): Promise<HandleOutcome> {
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
            result: await this.registry.connect(params),
          },
        };
      }
      case "disconnect": {
        const params = (request.params ?? {}) as SessionNameParams;
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
      case "sessions/list":
        return {
          response: {
            id: request.id,
            ok: true,
            result: { sessions: this.registry.list() },
          },
        };
      case "sessions/use": {
        const params = (request.params ?? {}) as SessionNameParams;
        if (!params.name) {
          throw new CliExitCodeError(
            EXIT_CODES.USAGE,
            "sessions/use requires a session name",
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
            result: await this.runRpc(request.params as RpcParams),
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

  private async runRpc(params: RpcParams): Promise<RpcResult> {
    if (!params?.method) {
      throw new CliExitCodeError(EXIT_CODES.USAGE, "rpc requires a method", {
        code: "invalid_params",
      });
    }
    const client = this.registry.clientFor(params.name, params.requireExplicit);
    const methodArgs = stripSessionFields(params);
    const outcome = await runMethod(client, methodArgs);
    if (outcome.kind === "stream") {
      throw new CliExitCodeError(
        EXIT_CODES.USAGE,
        `Method '${params.method}' is a stream; use the stream op.`,
        { code: "use_stream_op" },
      );
    }
    if (outcome.kind === "ndjson") {
      return { kind: "ndjson", lines: outcome.lines };
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
    const methodArgs = stripSessionFields(params);
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
      startStream: outcome.start,
    };
  }

  private writeLock(): void {
    fs.writeFileSync(this.lockPath, `${process.pid}\n`, { flag: "w" });
  }

  private removeLockAndSocket(): void {
    try {
      fs.unlinkSync(this.socketPath);
    } catch {
      // absent is fine
    }
    try {
      fs.unlinkSync(this.lockPath);
    } catch {
      // absent is fine
    }
  }
}

function stripSessionFields(
  params: RpcParams,
): MethodArgs & { method: string } {
  const { name, requireExplicit, method, ...rest } = params;
  void name;
  void requireExplicit;
  return { method, ...rest };
}
