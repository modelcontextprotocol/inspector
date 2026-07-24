/**
 * Long-lived daemon stream client.
 *
 * Outside the per-file coverage gate (see vitest.config.ts); behavior is
 * covered by `__tests__/daemon-stream.test.ts`.
 */
import { randomUUID } from "node:crypto";
import * as net from "node:net";
import { CliExitCodeError, EXIT_CODES } from "../error-handler.js";
import { getDaemonTokenFromEnv } from "./auth.js";
import { encodeRequest } from "./framing.js";
import { getDaemonSocketPath } from "./paths.js";
import type {
  DaemonRequest,
  DaemonResponse,
  DaemonStreamFrame,
} from "./protocol.js";
import type { DaemonClientOptions } from "./client.js";

export type StreamDaemonOptions = DaemonClientOptions & {
  onData: (data: unknown) => void;
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
  const token = options.token ?? getDaemonTokenFromEnv();
  const request: DaemonRequest = { id, op: "stream", params };
  if (token !== undefined) request.token = token;

  return new Promise<void>((resolve, reject) => {
    let settled = false;
    let buffer = "";
    let streaming = false;
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
              response.error.message,
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
        options.onData(frame.data);
        return;
      }
      if (frame.stream === "end") {
        succeed();
      }
    }

    socket.on("error", (err) => {
      if (streaming) {
        succeed();
        return;
      }
      fail(
        new CliExitCodeError(
          EXIT_CODES.UNREACHABLE,
          `Cannot reach session daemon at ${socketPath}: ${err.message}`,
          { code: "daemon_unreachable" },
        ),
      );
    });

    socket.on("close", () => {
      if (!settled) succeed();
    });

    timer = setTimeout(() => {
      fail(
        new CliExitCodeError(
          EXIT_CODES.UNREACHABLE,
          `Daemon stream open timed out after ${timeoutMs}ms`,
          { code: "daemon_timeout" },
        ),
      );
    }, timeoutMs);

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
        handleLine(line);
      }
    });

    socket.connect(socketPath);
  });
}
