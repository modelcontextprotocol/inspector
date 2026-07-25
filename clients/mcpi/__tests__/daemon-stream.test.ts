import { describe, it, expect, afterEach } from "vitest";
import * as fs from "node:fs";
import * as net from "node:net";
import * as os from "node:os";
import * as path from "node:path";
import { streamDaemon } from "../src/daemon/stream-client.js";
import {
  acceptDaemonConnection,
  removeStaleDaemonSocket,
} from "../src/daemon/ipc-glue.js";
import { CliExitCodeError, EXIT_CODES } from "../src/error-handler.js";

describe("streamDaemon + ipc-glue", () => {
  let dir: string | undefined;
  let server: net.Server | undefined;
  const sockets = new Set<net.Socket>();

  afterEach(async () => {
    for (const s of sockets) {
      s.destroy();
    }
    sockets.clear();
    if (server) {
      await new Promise<void>((resolve) => {
        server!.close(() => resolve());
      });
      server = undefined;
    }
    if (dir) {
      fs.rmSync(dir, { recursive: true, force: true });
      dir = undefined;
    }
  });

  function freshSock(): string {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-stream-"));
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

  it("delivers data frames then end (skips blank/mismatched ids)", async () => {
    const sock = freshSock();
    await listen(sock, (socket) => {
      socket.once("data", (buf) => {
        const req = JSON.parse(String(buf).trim()) as { id: string };
        // Mismatched first response id is ignored; matching ok opens the stream.
        socket.write(
          JSON.stringify({ id: "wrong", ok: true, result: {} }) + "\n",
        );
        socket.write(
          JSON.stringify({ id: req.id, ok: true, result: {} }) + "\n",
        );
        socket.write("\n");
        socket.write(
          JSON.stringify({ id: "other", stream: "data", data: { skip: 1 } }) +
            "\n",
        );
        socket.write(
          JSON.stringify({ id: req.id, stream: "noop", data: 0 }) + "\n",
        );
        socket.write(
          JSON.stringify({ id: req.id, stream: "data", data: { n: 1 } }) + "\n",
        );
        socket.write(JSON.stringify({ id: req.id, stream: "end" }) + "\n");
      });
    });

    const data: unknown[] = [];
    await streamDaemon(
      { method: "logging/tail" },
      { socketPath: sock, timeoutMs: 5000, onData: (d) => data.push(d) },
    );
    expect(data).toEqual([{ n: 1 }]);
  });

  it("resolves on socket error after the stream has opened", async () => {
    const sock = freshSock();
    await listen(sock, (socket) => {
      socket.once("data", (buf) => {
        const req = JSON.parse(String(buf).trim()) as { id: string };
        socket.write(
          JSON.stringify({ id: req.id, ok: true, result: {} }) + "\n",
        );
        setTimeout(() => socket.destroy(), 20);
      });
    });
    await streamDaemon(
      {},
      { socketPath: sock, timeoutMs: 2000, onData: () => {} },
    );
  });

  it("rejects malformed stream frames after open", async () => {
    const sock = freshSock();
    await listen(sock, (socket) => {
      socket.once("data", (buf) => {
        const req = JSON.parse(String(buf).trim()) as { id: string };
        socket.write(
          JSON.stringify({ id: req.id, ok: true, result: {} }) + "\n",
        );
        socket.write("not-a-frame\n");
      });
    });
    await expect(
      streamDaemon({}, { socketPath: sock, timeoutMs: 2000, onData: () => {} }),
    ).rejects.toThrow();
  });

  it("rejects error responses without exitCode (defaults USAGE)", async () => {
    const sock = freshSock();
    await listen(sock, (socket) => {
      socket.once("data", (buf) => {
        const req = JSON.parse(String(buf).trim()) as { id: string };
        socket.write(
          JSON.stringify({
            id: req.id,
            ok: false,
            error: { code: "usage", message: "nope" },
          }) + "\n",
        );
      });
    });

    await expect(
      streamDaemon({}, { socketPath: sock, timeoutMs: 2000, onData: () => {} }),
    ).rejects.toMatchObject({ exitCode: EXIT_CODES.USAGE });
  });

  it("rejects malformed first-frame JSON", async () => {
    const sock = freshSock();
    await listen(sock, (socket) => {
      socket.once("data", () => {
        socket.write("not-json\n");
      });
    });
    await expect(
      streamDaemon({}, { socketPath: sock, timeoutMs: 2000, onData: () => {} }),
    ).rejects.toThrow();
  });

  it("aborts via signal after the stream opens", async () => {
    const sock = freshSock();
    await listen(sock, (socket) => {
      socket.once("data", (buf) => {
        const req = JSON.parse(String(buf).trim()) as { id: string };
        socket.write(
          JSON.stringify({ id: req.id, ok: true, result: {} }) + "\n",
        );
      });
    });

    const ac = new AbortController();
    const pending = streamDaemon(
      {},
      {
        socketPath: sock,
        timeoutMs: 5000,
        signal: ac.signal,
        onData: () => {},
      },
    );
    await new Promise((r) => setTimeout(r, 50));
    ac.abort();
    await pending;
  });

  it("times out a hung stream open", async () => {
    const sock = freshSock();
    await listen(sock, (socket) => {
      socket.once("data", () => {
        // never respond with an ok frame
      });
    });
    await expect(
      streamDaemon({}, { socketPath: sock, timeoutMs: 80, onData: () => {} }),
    ).rejects.toThrow(/timed out/);
  }, 5000);

  it("resolves when the peer closes mid-stream", async () => {
    const sock = freshSock();
    await listen(sock, (socket) => {
      socket.once("data", (buf) => {
        const req = JSON.parse(String(buf).trim()) as { id: string };
        socket.write(
          JSON.stringify({ id: req.id, ok: true, result: {} }) + "\n",
        );
        socket.end();
      });
    });
    await streamDaemon(
      {},
      { socketPath: sock, timeoutMs: 2000, onData: () => {} },
    );
  });

  it("removeStaleDaemonSocket handles absent, dead, and live sockets", async () => {
    const sock = freshSock();
    await removeStaleDaemonSocket(sock);

    fs.writeFileSync(sock, "");
    await removeStaleDaemonSocket(sock);
    expect(fs.existsSync(sock)).toBe(false);

    await listen(sock, () => {});
    await expect(removeStaleDaemonSocket(sock)).rejects.toThrow(
      /already running/,
    );
  });

  it("acceptDaemonConnection rejects invalid request lines", async () => {
    const sock = freshSock();
    const chunks: string[] = [];
    await listen(sock, (socket) => {
      acceptDaemonConnection(socket, async () => ({
        response: { id: "x", ok: true, result: {} },
      }));
    });

    await new Promise<void>((resolve, reject) => {
      const client = net.connect(sock, () => {
        sockets.add(client);
        client.on("data", (c) => chunks.push(String(c)));
        client.write('{"op":"ping"}\n');
        setTimeout(() => {
          client.destroy();
          resolve();
        }, 50);
      });
      client.on("error", reject);
    });
    expect(chunks.join("")).toContain("invalid_request");
  });

  it("acceptDaemonConnection streams via startStream until socket closes", async () => {
    const sock = freshSock();
    let stopCalled = false;
    await listen(sock, (socket) => {
      acceptDaemonConnection(socket, async (req) => ({
        response: { id: req.id, ok: true, result: {} },
        startStream: (writeData) => {
          writeData({ a: 1 });
          return () => {
            stopCalled = true;
            throw new Error("unsubscribe boom");
          };
        },
      }));
    });

    const frames: string[] = [];
    await new Promise<void>((resolve) => {
      const client = net.connect(sock, () => {
        sockets.add(client);
        client.on("data", (c) => frames.push(String(c)));
        client.on("close", () => resolve());
        client.on("error", () => {});
        client.write(
          JSON.stringify({ id: "s1", op: "stream", params: {} }) + "\n",
        );
        // Half-close so the server cleanup can still write the end frame.
        setTimeout(() => client.end(), 80);
      });
      client.on("error", () => {});
    });
    const joined = frames.join("");
    expect(joined).toContain('"stream":"data"');
    expect(stopCalled).toBe(true);
  });

  it("unreachable socket path fails before streaming", async () => {
    await expect(
      streamDaemon(
        {},
        {
          socketPath: path.join(os.tmpdir(), "no-such-mcp-daemon.sock"),
          timeoutMs: 500,
          onData: () => {},
        },
      ),
    ).rejects.toBeInstanceOf(CliExitCodeError);
  });
});
