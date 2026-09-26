/**
 * Long-lived daemon stream client.
 */
import { randomUUID } from "node:crypto";
import * as net from "node:net";
import { CliExitCodeError, EXIT_CODES } from "@inspector/cli/error-handler.js";
import { getDaemonTokenFromEnv, readDaemonTokenFile } from "./auth.js";
import { encodeRequest } from "./framing.js";
import { getDaemonSocketPath } from "./paths.js";
import type {
  DaemonRequest,
  DaemonResponse,
  DaemonStreamFrame,
} from "./protocol.js";
import type { DaemonClientOptions } from "./client.js";
import { daemonTokenDir } from "./client.js";
import { sanitizeText } from "../connection/sanitize.js";

export type StreamDaemonOptions = DaemonClientOptions & {
  /**
   * Called for every data frame. A returned promise applies backpressure:
   * socket reads pause until it settles, so a fast daemon stream cannot
   * queue unbounded output ahead of a slow consumer.
   */
  onData: (data: unknown) => void | Promise<void>;
  /** Abort / cancel the stream (closes the socket). */
  signal?: AbortSignal;
};

/**
 * Long-lived `stream` op: first frame is a DaemonResponse; subsequent frames
 * are {@link DaemonStreamFrame} until `end` or the socket closes.
 */
export async function streamDaemon(
  params: DaemonRequest["params"],
  options: StreamDaemonOptions,
): Promise<void> {
  const socketPath = options.socketPath ?? getDaemonSocketPath();
  const timeoutMs = options.timeoutMs ?? 60_000;
  const id = randomUUID();
  const token =
    options.token ??
    getDaemonTokenFromEnv() ??
    readDaemonTokenFile(daemonTokenDir(options));
  const request: DaemonRequest = { id, op: "stream", params };
  if (token !== undefined) request.token = token;

  return new Promise<void>((resolve, reject) => {
    let settled = false;
    let buffer = "";
    let streaming = false;
    let pendingCallbacks = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const socket = new net.Socket();

    function settle(fn: () => void) {
      if (settled) return;
      settled = true;
      if (timer !== undefined) clearTimeout(timer);
      options.signal?.removeEventListener("abort", onAbort);
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

    function succeed() {
      settle(() => {
        socket.destroy();
        resolve();
      });
    }

    function onAbort() {
      succeed();
    }

    function handleLine(line: string) {
      const trimmed = line.trim();
      if (!trimmed) return;

      if (!streaming) {
        let response: DaemonResponse;
        try {
          response = JSON.parse(trimmed) as DaemonResponse;
        } catch (error) {
          fail(error);
          return;
        }
        if (response.id !== id && response.id !== "?") return;
        if (!response.ok) {
          fail(
            new CliExitCodeError(
              response.error.exitCode ?? EXIT_CODES.USAGE,
              sanitizeText(response.error.message),
              { code: response.error.code },
            ),
          );
          return;
        }
        streaming = true;
        if (timer !== undefined) {
          clearTimeout(timer);
          timer = undefined;
        }
        return;
      }

      let frame: DaemonStreamFrame;
      try {
        frame = JSON.parse(trimmed) as DaemonStreamFrame;
      } catch (error) {
        fail(error);
        return;
      }
      if (frame.id !== id) return;
      if (frame.stream === "data") {
        const result = options.onData(frame.data);
        if (
          result !== undefined &&
          typeof (result as Promise<void>).then === "function"
        ) {
          // Backpressure: stop reading until the consumer's write settles.
          // Frames already split from the current chunk still dispatch
          // synchronously (bounded by one socket read), but no further
          // chunks are read while any callback is pending. Callback errors
          // stay non-fatal, matching the previous fire-and-forget behavior.
          pendingCallbacks++;
          socket.pause();
          void Promise.resolve(result)
            .catch(() => {})
            .finally(() => {
              pendingCallbacks--;
              if (pendingCallbacks === 0 && !settled) socket.resume();
            });
        }
        return;
      }
      if (frame.stream === "end") {
        succeed();
      }
    }

    socket.on("error", (err) => {
      if (streaming) {
        // A socket error mid-stream means the daemon crashed or the
        // transport broke — not a clean finish. A deliberate cancel settles
        // first via onAbort, so only unsolicited errors reach here.
        fail(
          new CliExitCodeError(
            EXIT_CODES.UNREACHABLE,
            `Connection daemon stream failed: ${err.message}`,
            { code: "daemon_unreachable" },
          ),
        );
        return;
      }
      fail(
        new CliExitCodeError(
          EXIT_CODES.UNREACHABLE,
          `Cannot reach connection daemon at ${socketPath}: ${err.message}`,
          { code: "daemon_unreachable" },
        ),
      );
    });

    socket.on("close", () => {
      if (settled) return;
      // Only an explicit `end` frame (or a caller abort, which settles via
      // onAbort before destroying) is a clean finish. EOF without `end`
      // means the daemon exited or dropped the socket mid-stream.
      if (streaming) {
        fail(
          new CliExitCodeError(
            EXIT_CODES.UNREACHABLE,
            `Connection daemon closed the stream before it ended`,
            { code: "daemon_unreachable" },
          ),
        );
        return;
      }
      fail(
        new CliExitCodeError(
          EXIT_CODES.UNREACHABLE,
          `Connection daemon closed the connection before the stream opened`,
          { code: "daemon_unreachable" },
        ),
      );
    });

    // timeoutMs 0 disables the deadline (mirrors callDaemon): an
    // unconditional setTimeout(..., 0) would fire immediately, failing
    // every stream on the next tick instead of never.
    timer =
      timeoutMs > 0
        ? setTimeout(() => {
            fail(
              new CliExitCodeError(
                EXIT_CODES.UNREACHABLE,
                `Daemon stream open timed out after ${timeoutMs}ms`,
                { code: "daemon_timeout" },
              ),
            );
          }, timeoutMs)
        : undefined;

    // AbortSignal does not replay: a pre-aborted signal would never fire
    // the listener, leaving the stream open until the timeout. Check first.
    if (options.signal?.aborted) {
      onAbort();
    } else {
      options.signal?.addEventListener("abort", onAbort, { once: true });
    }

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
