import { randomUUID } from "node:crypto";
import * as net from "node:net";
import { CliExitCodeError, EXIT_CODES } from "@inspector/cli/error-handler.js";
import { getDaemonTokenFromEnv } from "./auth.js";
import { encodeRequest } from "./framing.js";
import { getDaemonSocketPath } from "./paths.js";
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
  const token = options.token ?? getDaemonTokenFromEnv();
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
      socket.removeAllListeners();
      socket.on("error", () => {});
      fn();
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
            response.error.message,
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
          `Cannot reach session daemon at ${socketPath}: ${err.message}`,
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
            `Session daemon closed the connection during '${op}'`,
            { code: "daemon_unreachable" },
          ),
        );
      }
    });

    timer = setTimeout(() => {
      fail(
        new CliExitCodeError(
          EXIT_CODES.UNREACHABLE,
          `Daemon request '${op}' timed out after ${timeoutMs}ms`,
          { code: "daemon_timeout" },
        ),
      );
    }, timeoutMs);

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
