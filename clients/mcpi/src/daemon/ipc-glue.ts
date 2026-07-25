/**
 * Low-level Unix-socket accept / stale-socket helpers for {@link DaemonServer}.
 *
 * Outside the per-file coverage gate (see vitest.config.ts); behavior is
 * covered by `__tests__/daemon-stream.test.ts`.
 */
import * as fs from "node:fs";
import * as net from "node:net";
import { createInterface } from "node:readline";
import { encodeResponse, parseRequestLine } from "./framing.js";
import type {
  DaemonRequest,
  DaemonResponse,
  DaemonStreamFrame,
} from "./protocol.js";

export type StreamStarter = (writeData: (data: unknown) => void) => () => void;

/** Result of handling one daemon request — optional long-lived stream. */
export type HandleOutcome = {
  response: DaemonResponse;
  /** When set, keep the socket open and push stream frames until closed. */
  startStream?: StreamStarter;
};

export type HandleRequest = (request: DaemonRequest) => Promise<HandleOutcome>;

export function acceptDaemonConnection(
  socket: net.Socket,
  handle: HandleRequest,
): void {
  const rl = createInterface({ input: socket, crlfDelay: Infinity });
  rl.on("line", (line) => {
    void (async () => {
      let request: DaemonRequest;
      try {
        const parsed = parseRequestLine(line);
        if (!parsed) return;
        request = parsed;
      } catch (error) {
        socket.write(
          encodeResponse({
            id: "?",
            ok: false,
            error: {
              code: "invalid_request",
              message: error instanceof Error ? error.message : String(error),
            },
          }),
        );
        return;
      }
      const outcome = await handle(request);
      if (socket.destroyed) return;
      socket.write(encodeResponse(outcome.response));

      if (!outcome.response.ok || !outcome.startStream) {
        return;
      }

      const id = request.id;
      let stopped = false;
      const writeData = (data: unknown) => {
        if (stopped || socket.destroyed) return;
        const frame: DaemonStreamFrame = { id, stream: "data", data };
        socket.write(JSON.stringify(frame) + "\n");
      };
      const stop = outcome.startStream(writeData);
      const cleanup = () => {
        if (stopped) return;
        stopped = true;
        try {
          stop();
        } catch {
          // ignore unsubscribe errors
        }
        if (!socket.destroyed) {
          const end: DaemonStreamFrame = { id, stream: "end" };
          socket.write(JSON.stringify(end) + "\n");
          socket.end();
        }
      };
      socket.once("close", cleanup);
      socket.once("error", cleanup);
    })();
  });
  socket.on("error", () => {
    rl.close();
  });
}

export async function removeStaleDaemonSocket(
  socketPath: string,
): Promise<void> {
  if (!fs.existsSync(socketPath)) return;
  const live = await canConnect(socketPath);
  if (live) {
    throw new Error(
      `Daemon already running at ${socketPath}. Use mcpi daemon stop first.`,
    );
  }
  try {
    fs.unlinkSync(socketPath);
  } catch {
    // ignore
  }
}

async function canConnect(socketPath: string): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    const socket = new net.Socket();
    const done = (ok: boolean) => {
      if (settled) return;
      settled = true;
      socket.removeAllListeners();
      socket.on("error", () => {});
      socket.destroy();
      resolve(ok);
    };
    socket.once("connect", () => done(true));
    socket.once("error", () => done(false));
    socket.connect(socketPath);
  });
}
