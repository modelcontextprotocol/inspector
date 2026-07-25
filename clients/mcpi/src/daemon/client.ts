import { randomUUID } from "node:crypto";
import * as net from "node:net";
import { CliExitCodeError, EXIT_CODES } from "../error-handler.js";
import { getDaemonTokenFromEnv } from "./auth.js";
import { encodeRequest } from "./framing.js";
import { getDaemonSocketPath } from "./paths.js";
import type { DaemonOp, DaemonRequest, DaemonResponse } from "./protocol.js";

export type DaemonClientOptions = {
  socketPath?: string;
  /** Per-request timeout in ms. */
  timeoutMs?: number;
  /** IPC token; defaults to `MCP_INSPECTOR_DAEMON_TOKEN` when set. */
  token?: string;
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
    // `let` so settle() can clearTimeout before the assignment if connect fails
    // synchronously (prefer-const would put `timer` in the TDZ for that race).
    // eslint-disable-next-line prefer-const -- see comment above
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

    function handleLine(line: string) {
      const trimmed = line.trim();
      if (!trimmed) return;
      let response: DaemonResponse;
      try {
        response = JSON.parse(trimmed) as DaemonResponse;
      } catch (error) {
        fail(error);
        return;
      }
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
        handleLine(line);
      }
    });

    socket.connect(socketPath);
  });
}
