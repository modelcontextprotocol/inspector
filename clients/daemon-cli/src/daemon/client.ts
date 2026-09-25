import { randomUUID } from "node:crypto";
import * as net from "node:net";
import * as path from "node:path";
import { CliExitCodeError, EXIT_CODES } from "@inspector/cli/error-handler.js";
import { getDaemonTokenFromEnv, readDaemonTokenFile } from "./auth.js";
import { encodeRequest } from "./framing.js";
import { getDaemonSocketPath } from "./paths.js";
import { sanitizeText } from "../connection/sanitize.js";
import type {
  DaemonOp,
  DaemonRequest,
  DaemonResponse,
  ElicitationRequestFrame,
  ElicitationResponseFrame,
} from "./protocol.js";

export type DaemonClientOptions = {
  socketPath?: string;
  /** Per-request timeout in ms. */
  /**
   * Client-side deadline for the whole request; `0` disables it. Defaults to
   * 60s, which suits short control ops (ping, status, list). Callers of ops
   * whose duration is governed by configured MCP timeouts the daemon already
   * enforces (`connect` honouring `--connect-timeout`, `rpc` honouring the
   * request timeout — either may validly run past 60s or be unlimited) must
   * pass `0` so the fixed local timer can't fail an op the daemon is still
   * executing. Daemon death is still detected via socket error/close.
   */
  timeoutMs?: number;
  /** IPC token; defaults to `MCP_INSPECTOR_DAEMON_TOKEN` when set. */
  token?: string;
  /**
   * Called when the in-flight `rpc` call surfaces a legacy or modern
   * non-task MRTR elicitation mid-call (dual-era support, phase 1). Omit to
   * auto-answer `{action: "cancel"}` — appropriate for non-interactive
   * callers (e.g. `--format json`, non-TTY) that shouldn't hang waiting on a
   * human. The connect timeout is cleared once the first such frame arrives,
   * so an interactive prompt isn't bounded by the original request timeout.
   */
  onElicitation?: (
    frame: ElicitationRequestFrame,
  ) => Promise<ElicitationResponseFrame>;
  /**
   * Abort the in-flight request (e.g. on SIGINT/SIGTERM), failing it with a
   * clear cancellation error instead of leaving the caller to kill the
   * process abruptly mid-call (mid-`tools/call`, mid-elicitation-wait, etc).
   */
  signal?: AbortSignal;
};

/**
 * Short-lived NDJSON client for one request/response against the daemon.
 */
export async function callDaemon<T = unknown>(
  op: DaemonOp,
  params?: DaemonRequest["params"],
  options: DaemonClientOptions = {},
): Promise<T> {
  const socketPath = options.socketPath ?? getDaemonSocketPath();
  const timeoutMs = options.timeoutMs ?? 60_000;
  const id = randomUUID();
  // Env token wins (private mode / spawner); otherwise read the token the
  // daemon published next to its socket (see getDaemonTokenPath).
  const token =
    options.token ??
    getDaemonTokenFromEnv() ??
    readDaemonTokenFile(path.dirname(socketPath));
  const request: DaemonRequest = { id, op, params };
  if (token !== undefined) request.token = token;

  return new Promise<T>((resolve, reject) => {
    let settled = false;
    let buffer = "";
    let queue: Promise<void> = Promise.resolve();
    // `let` so settle() can clearTimeout before the assignment if connect fails
    // synchronously (prefer-const would put `timer` in the TDZ for that race).
    let timer: ReturnType<typeof setTimeout> | undefined;
    const socket = new net.Socket();

    function settle(fn: () => void) {
      /* v8 ignore next -- settle() no-op when already settled (connect/timeout race) */
      if (settled) return;
      settled = true;
      if (timer !== undefined) clearTimeout(timer);
      options.signal?.removeEventListener("abort", onAbort);
      socket.removeAllListeners();
      socket.on("error", () => {});
      fn();
    }

    function onAbort() {
      fail(
        new CliExitCodeError(EXIT_CODES.USAGE, `'${op}' cancelled.`, {
          code: "cancelled",
        }),
      );
    }

    function fail(error: unknown) {
      settle(() => {
        socket.destroy();
        reject(error);
      });
    }

    function succeed(value: T) {
      settle(() => {
        socket.end();
        resolve(value);
      });
    }

    function handleLine(line: string): Promise<void> {
      const trimmed = line.trim();
      if (!trimmed) return Promise.resolve();
      let parsed: DaemonResponse | ElicitationRequestFrame;
      try {
        parsed = JSON.parse(trimmed) as
          | DaemonResponse
          | ElicitationRequestFrame;
      } catch (error) {
        fail(error);
        return Promise.resolve();
      }
      if (
        parsed !== null &&
        typeof parsed === "object" &&
        "kind" in parsed &&
        parsed.kind === "elicitation-request"
      ) {
        return handleElicitationRequest(parsed as ElicitationRequestFrame);
      }
      handleResponse(parsed as DaemonResponse);
      return Promise.resolve();
    }

    async function handleElicitationRequest(
      frame: ElicitationRequestFrame,
    ): Promise<void> {
      if (frame.id !== id) return;
      // A human (or a multi-round MRTR exchange) answering this shouldn't be
      // bounded by the original fixed request timeout.
      if (timer !== undefined) {
        clearTimeout(timer);
        timer = undefined;
      }
      const answer = options.onElicitation
        ? await options.onElicitation(frame)
        : ({
            id: frame.id,
            kind: "elicitation-response",
            elicitationId: frame.elicitationId,
            action: "cancel",
          } satisfies ElicitationResponseFrame);
      if (settled || socket.destroyed) return;
      socket.write(JSON.stringify(answer) + "\n");
    }

    function handleResponse(response: DaemonResponse) {
      if (response.id !== id && response.id !== "?") {
        return;
      }
      if (!response.ok) {
        fail(
          new CliExitCodeError(
            response.error.exitCode ?? EXIT_CODES.USAGE,
            // Daemon error text can embed server-supplied strings; sanitize
            // before it reaches a terminal via the shared error handler.
            sanitizeText(response.error.message),
            { code: response.error.code },
          ),
        );
        return;
      }
      succeed(response.result as T);
    }

    socket.on("error", (err) => {
      fail(
        new CliExitCodeError(
          EXIT_CODES.UNREACHABLE,
          `Cannot reach connection daemon at ${socketPath}: ${err.message}`,
          { code: "daemon_unreachable" },
        ),
      );
    });

    // Clean FIN with no response must not sit until timeoutMs (mirrors
    // streamDaemon's close guard).
    socket.on("close", () => {
      if (!settled) {
        fail(
          new CliExitCodeError(
            EXIT_CODES.UNREACHABLE,
            `Connection daemon closed the connection during '${op}'`,
            { code: "daemon_unreachable" },
          ),
        );
      }
    });

    timer =
      timeoutMs > 0
        ? setTimeout(() => {
            fail(
              new CliExitCodeError(
                EXIT_CODES.UNREACHABLE,
                `Daemon request '${op}' timed out after ${timeoutMs}ms`,
                { code: "daemon_timeout" },
              ),
            );
          }, timeoutMs)
        : undefined;

    options.signal?.addEventListener("abort", onAbort, { once: true });

    socket.once("connect", () => {
      socket.write(encodeRequest(request));
    });

    socket.on("data", (chunk) => {
      buffer += String(chunk);
      let idx: number;
      while ((idx = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 1);
        // Sequential so an awaited onElicitation prompt fully settles (and
        // its answer is written) before the next buffered line is handled.
        queue = queue
          .then(() => handleLine(line))
          .catch((error) => fail(error));
      }
    });

    socket.connect(socketPath);
  });
}
