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
  ElicitationRequestFrame,
  ElicitationResponseFrame,
} from "./protocol.js";

export type StreamStarter = (writeData: (data: unknown) => void) => () => void;

/** Result of handling one daemon request — optional long-lived stream. */
export type HandleOutcome = {
  response: DaemonResponse;
  /** When set, keep the socket open and push stream frames until closed. */
  startStream?: StreamStarter;
};

/**
 * Bridges a single in-flight `rpc` call to its owning connection so it can
 * pause mid-call for a legacy/modern-non-task elicitation, and resume once
 * the CLI answers. See `ElicitationRequestFrame`'s doc comment in
 * `protocol.ts` for why one exchange (repeatable) is all a single connection
 * ever needs.
 */
export type ElicitationChannel = {
  request(frame: ElicitationRequestFrame): Promise<ElicitationResponseFrame>;
};

export type HandleRequest = (
  request: DaemonRequest,
  elicitation: ElicitationChannel,
) => Promise<HandleOutcome>;

/**
 * Per-connection {@link ElicitationChannel}. Writes an elicitation-request
 * frame straight onto the socket (ahead of the eventual `DaemonResponse`) and
 * waits for the next line to answer it; `acceptDaemonConnection`'s line
 * handler gives that next line to {@link tryConsumeLine} instead of parsing
 * it as a new top-level request. Rejects any pending exchange if the socket
 * disconnects, so a dropped client can't hang the daemon-side call forever.
 */
class ConnectionElicitationChannel implements ElicitationChannel {
  private pending: {
    resolve: (frame: ElicitationResponseFrame) => void;
    reject: (error: Error) => void;
  } | null = null;

  constructor(private readonly socket: net.Socket) {
    const onDisconnect = () => this.rejectPending("Connection closed");
    socket.once("close", onDisconnect);
    socket.once("error", onDisconnect);
  }

  request(frame: ElicitationRequestFrame): Promise<ElicitationResponseFrame> {
    if (this.pending) {
      return Promise.reject(
        new Error("Another elicitation is already pending on this connection"),
      );
    }
    return new Promise((resolve, reject) => {
      this.pending = { resolve, reject };
      if (this.socket.destroyed) {
        this.rejectPending("Connection closed");
        return;
      }
      this.socket.write(JSON.stringify(frame) + "\n");
    });
  }

  /** Returns true if this line was consumed as a pending elicitation answer. */
  tryConsumeLine(line: string): boolean {
    if (!this.pending) return false;
    let parsed: ElicitationResponseFrame;
    try {
      parsed = JSON.parse(line);
    } catch {
      return false;
    }
    if (!parsed || parsed.kind !== "elicitation-response") return false;
    const { resolve } = this.pending;
    this.pending = null;
    resolve(parsed);
    return true;
  }

  private rejectPending(message: string): void {
    if (!this.pending) return;
    const { reject } = this.pending;
    this.pending = null;
    reject(new Error(message));
  }
}

export function acceptDaemonConnection(
  socket: net.Socket,
  handle: HandleRequest,
): void {
  const rl = createInterface({ input: socket, crlfDelay: Infinity });
  const elicitationChannel = new ConnectionElicitationChannel(socket);
  rl.on("line", (line) => {
    void (async () => {
      if (elicitationChannel.tryConsumeLine(line)) return;
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
      const outcome = await handle(request, elicitationChannel);
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
