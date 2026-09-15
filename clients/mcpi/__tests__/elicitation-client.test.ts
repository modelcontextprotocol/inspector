import { describe, it, expect, afterEach } from "vitest";
import * as fs from "node:fs";
import * as net from "node:net";
import * as os from "node:os";
import * as path from "node:path";
import { callDaemon } from "../src/daemon/client.js";
import type {
  ElicitationRequestFrame,
  ElicitationResponseFrame,
} from "../src/daemon/protocol.js";

/**
 * Covers `callDaemon`'s duplex elicitation handling (dual-era support, phase
 * 1): a mid-`rpc` `elicitation-request` frame arriving before the final
 * response, answered via `onElicitation` (or auto-cancelled without one),
 * with the connect timeout cleared once the exchange starts.
 */
describe("callDaemon elicitation duplex", () => {
  let dir: string | undefined;
  let server: net.Server | undefined;
  const sockets = new Set<net.Socket>();

  afterEach(async () => {
    for (const s of sockets) s.destroy();
    sockets.clear();
    if (server) {
      await new Promise<void>((resolve) => server!.close(() => resolve()));
      server = undefined;
    }
    if (dir) {
      fs.rmSync(dir, { recursive: true, force: true });
      dir = undefined;
    }
  });

  function freshSock(): string {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-elicit-client-"));
    return path.join(dir, "daemon.sock");
  }

  async function listen(
    sock: string,
    onSocket: (socket: net.Socket) => void,
  ): Promise<void> {
    server = net.createServer((socket) => {
      sockets.add(socket);
      socket.on("error", () => {});
      socket.on("close", () => sockets.delete(socket));
      onSocket(socket);
    });
    await new Promise<void>((resolve) => server!.listen(sock, resolve));
  }

  it("routes an elicitation-request frame to onElicitation and writes its answer", async () => {
    const sock = freshSock();
    let receivedAnswer: ElicitationResponseFrame | undefined;
    await listen(sock, (socket) => {
      let buffer = "";
      socket.on("data", (chunk) => {
        buffer += String(chunk);
        let idx: number;
        while ((idx = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 1);
          if (!line.trim()) continue;
          const msg = JSON.parse(line) as { id: string; kind?: string };
          if (msg.kind === "elicitation-response") {
            receivedAnswer = msg as ElicitationResponseFrame;
            socket.write(
              JSON.stringify({ id: msg.id, ok: true, result: { done: true } }) +
                "\n",
            );
            continue;
          }
          const frame: ElicitationRequestFrame = {
            id: msg.id,
            kind: "elicitation-request",
            elicitationId: "elicitation-1",
            mode: "url",
            message: "Please confirm",
            url: "https://example.com/confirm",
            origin: "server-request",
          };
          socket.write(JSON.stringify(frame) + "\n");
        }
      });
    });

    const seenFrames: ElicitationRequestFrame[] = [];
    const result = await callDaemon<{ done: boolean }>(
      "rpc",
      { method: "tools/call" },
      {
        socketPath: sock,
        timeoutMs: 5000,
        onElicitation: async (frame) => {
          seenFrames.push(frame);
          return {
            id: frame.id,
            kind: "elicitation-response",
            elicitationId: frame.elicitationId,
            action: "accept",
          };
        },
      },
    );

    expect(result).toEqual({ done: true });
    expect(seenFrames).toHaveLength(1);
    expect(seenFrames[0].mode).toBe("url");
    expect(seenFrames[0].url).toBe("https://example.com/confirm");
    expect(receivedAnswer?.action).toBe("accept");
    expect(receivedAnswer?.elicitationId).toBe("elicitation-1");
  });

  it("auto-cancels when no onElicitation callback is provided", async () => {
    const sock = freshSock();
    let receivedAnswer: ElicitationResponseFrame | undefined;
    await listen(sock, (socket) => {
      let buffer = "";
      socket.on("data", (chunk) => {
        buffer += String(chunk);
        let idx: number;
        while ((idx = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 1);
          if (!line.trim()) continue;
          const msg = JSON.parse(line) as { id: string; kind?: string };
          if (msg.kind === "elicitation-response") {
            receivedAnswer = msg as ElicitationResponseFrame;
            socket.write(
              JSON.stringify({ id: msg.id, ok: true, result: { done: true } }) +
                "\n",
            );
            continue;
          }
          const frame: ElicitationRequestFrame = {
            id: msg.id,
            kind: "elicitation-request",
            elicitationId: "elicitation-2",
            mode: "url",
            message: "Please confirm",
            url: "https://example.com/confirm",
            origin: "input-required",
          };
          socket.write(JSON.stringify(frame) + "\n");
        }
      });
    });

    const result = await callDaemon<{ done: boolean }>(
      "rpc",
      { method: "tools/call" },
      { socketPath: sock, timeoutMs: 5000 },
    );

    expect(result).toEqual({ done: true });
    expect(receivedAnswer?.action).toBe("cancel");
    expect(receivedAnswer?.elicitationId).toBe("elicitation-2");
  });

  it("ignores an elicitation-request frame whose id doesn't match this call", async () => {
    const sock = freshSock();
    await listen(sock, (socket) => {
      let buffer = "";
      let answered = false;
      socket.on("data", (chunk) => {
        buffer += String(chunk);
        let idx: number;
        while ((idx = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 1);
          if (!line.trim()) continue;
          const msg = JSON.parse(line) as { id: string };
          if (!answered) {
            answered = true;
            const frame: ElicitationRequestFrame = {
              id: "not-this-call",
              kind: "elicitation-request",
              elicitationId: "elicitation-3",
              mode: "url",
              message: "stray frame",
              url: "https://example.com",
              origin: "server-request",
            };
            socket.write(JSON.stringify(frame) + "\n");
            socket.write(
              JSON.stringify({ id: msg.id, ok: true, result: { done: true } }) +
                "\n",
            );
          }
        }
      });
    });

    const onElicitation = async () =>
      ({
        id: "n/a",
        kind: "elicitation-response",
        elicitationId: "n/a",
        action: "cancel",
      }) satisfies ElicitationResponseFrame;

    const result = await callDaemon<{ done: boolean }>(
      "rpc",
      { method: "tools/call" },
      { socketPath: sock, timeoutMs: 5000, onElicitation },
    );
    expect(result).toEqual({ done: true });
  });

  it("fails the call if onElicitation itself throws", async () => {
    const sock = freshSock();
    await listen(sock, (socket) => {
      let buffer = "";
      socket.on("data", (chunk) => {
        buffer += String(chunk);
        let idx: number;
        while ((idx = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 1);
          if (!line.trim()) continue;
          const msg = JSON.parse(line) as { id: string; kind?: string };
          if (msg.kind === "elicitation-response") continue;
          const frame: ElicitationRequestFrame = {
            id: msg.id,
            kind: "elicitation-request",
            elicitationId: "elicitation-4",
            mode: "url",
            message: "boom",
            url: "https://example.com",
            origin: "server-request",
          };
          socket.write(JSON.stringify(frame) + "\n");
        }
      });
    });

    await expect(
      callDaemon<{ done: boolean }>(
        "rpc",
        { method: "tools/call" },
        {
          socketPath: sock,
          timeoutMs: 5000,
          onElicitation: async () => {
            throw new Error("prompt blew up");
          },
        },
      ),
    ).rejects.toThrow("prompt blew up");
  });

  it("fails with a clear cancellation error when the abort signal fires mid-call", async () => {
    const sock = freshSock();
    await listen(sock, () => {
      // Never respond — the call should hang until aborted, not until
      // timeoutMs, proving the signal (not the timeout) ended it.
    });

    const ac = new AbortController();
    const promise = callDaemon(
      "rpc",
      { method: "tools/call" },
      { socketPath: sock, timeoutMs: 60_000, signal: ac.signal },
    );
    ac.abort();
    await expect(promise).rejects.toThrow("cancelled");
  });

  it("silently swallows a post-settle socket error (e.g. late ECONNRESET)", async () => {
    const sock = freshSock();
    let serverSocket: net.Socket | undefined;
    await listen(sock, (socket) => {
      serverSocket = socket;
      let buffer = "";
      socket.on("data", (chunk) => {
        buffer += String(chunk);
        let idx: number;
        while ((idx = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 1);
          if (!line.trim()) continue;
          const msg = JSON.parse(line) as { id: string };
          socket.write(
            JSON.stringify({ id: msg.id, ok: true, result: { done: true } }) +
              "\n",
          );
        }
      });
    });

    const result = await callDaemon<{ done: boolean }>(
      "rpc",
      { method: "tools/call" },
      { socketPath: sock, timeoutMs: 5000 },
    );
    expect(result).toEqual({ done: true });
    // Force a client-side 'error' after the call already settled; the
    // no-op listener installed by settle() must swallow it without
    // rethrowing or crashing the test.
    serverSocket?.destroy(new Error("late reset"));
    await new Promise((resolve) => setTimeout(resolve, 50));
  });
});
