/**
 * The client verifies the daemon before trusting it.
 *
 * Every connection opens with `hello { nonce }`, which a genuine daemon
 * answers with HMAC(token, nonce). Until that checks out the client sends
 * neither its token nor any request payload, so a process that merely holds
 * the daemon endpoint (on Windows the named pipe namespace is machine-wide)
 * learns nothing and cannot forge a result. These tests stand up such an
 * impostor and assert on the exact bytes it received.
 */
import { describe, it, expect, afterEach } from "vitest";
import * as fs from "node:fs";
import * as net from "node:net";
import * as os from "node:os";
import * as path from "node:path";
import { callDaemon } from "../src/daemon/client.js";
import { streamDaemon } from "../src/daemon/stream-client.js";
import { ensureDaemon } from "../src/daemon/ensure.js";
import { DaemonServer } from "../src/daemon/server.js";
import {
  computeDaemonProof,
  generateDaemonNonce,
  isDaemonNonce,
  readDaemonTokenFile,
  verifyDaemonProof,
} from "../src/daemon/auth.js";
import {
  checkDaemonHelloLine,
  createDaemonHello,
} from "../src/daemon/handshake.js";
import type { ConnectParams } from "../src/daemon/protocol.js";
import { daemonEndpoint } from "./helpers/daemon-endpoint.js";
import { publishFakeDaemonToken } from "./helpers/fake-daemon.js";

/** The victim's token, published in its daemon dir. */
const VICTIM_TOKEN = "victim-daemon-token-0123456789abcdef";
/** Stands in for the stdio env a `connect` would carry. */
const SECRET = "sk-live-not-for-the-impostor";

const connectParams: ConnectParams = {
  name: "s",
  serverConfig: {
    type: "stdio",
    command: "node",
    args: ["server.js"],
    env: { API_KEY: SECRET },
  },
  serverIdentity: "s",
};

type Answer = (helloLine: string, socket: net.Socket) => void;

/** A listener that records every byte it receives and answers with `answer`. */
async function impostor(
  sock: string,
  answer: Answer,
): Promise<{ server: net.Server; received: () => string }> {
  let received = "";
  const server = net.createServer((socket) => {
    socket.on("error", () => {});
    let answered = false;
    socket.on("data", (buf: Buffer) => {
      received += String(buf);
      if (answered) return;
      const idx = received.indexOf("\n");
      if (idx === -1) return;
      answered = true;
      answer(received.slice(0, idx), socket);
    });
  });
  await new Promise<void>((resolve) => server.listen(sock, resolve));
  return { server, received: () => received };
}

/** The only line an impostor may ever see: a bare hello, no token. */
function expectOnlyHello(received: string): void {
  const lines = received.split("\n").filter((l) => l.trim());
  expect(lines).toHaveLength(1);
  const hello = JSON.parse(lines[0]) as Record<string, unknown>;
  expect(hello.op).toBe("hello");
  expect(Object.keys(hello).sort()).toEqual(["id", "op", "params"]);
  expect(isDaemonNonce((hello.params as { nonce?: unknown }).nonce)).toBe(true);
  expect(received).not.toContain(VICTIM_TOKEN);
  expect(received).not.toContain(SECRET);
}

function reply(socket: net.Socket, value: unknown): void {
  socket.write(JSON.stringify(value) + "\n");
}

function helloOf(line: string): { id: string; nonce: string } {
  const parsed = JSON.parse(line) as { id: string; params: { nonce: string } };
  return { id: parsed.id, nonce: parsed.params.nonce };
}

const unverified = { envelope: { code: "daemon_unverified" } };

// The handshake is platform-independent, and Windows is the platform it is
// for: a named pipe lives in a machine-wide namespace (see handshake.ts).
describe("daemon hello handshake", () => {
  let dir: string | undefined;
  const servers: net.Server[] = [];
  let daemon: DaemonServer | undefined;

  afterEach(async () => {
    for (const s of servers.splice(0)) {
      await new Promise<void>((resolve) => s.close(() => resolve()));
    }
    if (daemon) {
      await daemon.stop("stop");
      daemon = undefined;
    }
    if (dir) {
      fs.rmSync(dir, { recursive: true, force: true });
      dir = undefined;
    }
  });

  function freshSock(): string {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-hello-"));
    return daemonEndpoint(dir);
  }

  function freshDir(): string {
    freshSock();
    return dir!;
  }

  async function listenImpostor(sock: string, answer: Answer) {
    const result = await impostor(sock, answer);
    servers.push(result.server);
    return result;
  }

  const impostorAnswers: [string, Answer][] = [
    [
      "a pong without any proof (echoing the old ping shape)",
      (line, socket) =>
        reply(socket, {
          id: helloOf(line).id,
          ok: true,
          result: { pong: true, version: "9.9.9" },
        }),
    ],
    [
      "a proof keyed by a token it guessed",
      (line, socket) => {
        const { id, nonce } = helloOf(line);
        reply(socket, {
          id,
          ok: true,
          result: { proof: computeDaemonProof("guessed-token", nonce) },
        });
      },
    ],
    [
      "a proof for a different nonce (a replayed answer)",
      (line, socket) =>
        reply(socket, {
          id: helloOf(line).id,
          ok: true,
          result: {
            proof: computeDaemonProof(VICTIM_TOKEN, generateDaemonNonce()),
          },
        }),
    ],
    [
      "a valid proof under another request id",
      // The proof is genuine for this hello's nonce, so only the id check
      // can reject it.
      (line, socket) =>
        reply(socket, {
          id: "?",
          ok: true,
          result: {
            proof: computeDaemonProof(VICTIM_TOKEN, helloOf(line).nonce),
          },
        }),
    ],
    [
      "an error response (what a pre-handshake daemon sends)",
      (line, socket) =>
        reply(socket, {
          id: helloOf(line).id,
          ok: false,
          error: { code: "daemon_auth_failed", message: "no token" },
        }),
    ],
    [
      "an elicitation request instead of an answer",
      (line, socket) =>
        reply(socket, {
          id: helloOf(line).id,
          kind: "elicitation-request",
          elicitationId: "e1",
          mode: "url",
          message: "open this",
          url: "https://attacker.example/",
          origin: "server-request",
        }),
    ],
    ["a line that is not JSON", (_line, socket) => socket.write("pong\n")],
  ];

  it.each(impostorAnswers)(
    "callDaemon('connect') refuses an impostor answering with %s, having sent only the hello",
    async (_label, answer) => {
      const sock = freshSock();
      publishFakeDaemonToken(dir!, VICTIM_TOKEN);
      const { received } = await listenImpostor(sock, answer);
      let elicited = false;
      await expect(
        callDaemon("connect", connectParams, {
          socketPath: sock,
          dir,
          timeoutMs: 2000,
          onElicitation: () => {
            elicited = true;
            return Promise.reject(new Error("must not be reached"));
          },
        }),
      ).rejects.toMatchObject(unverified);
      expectOnlyHello(received());
      expect(elicited).toBe(false);
    },
  );

  it.each(impostorAnswers)(
    "streamDaemon refuses an impostor answering with %s, having sent only the hello",
    async (_label, answer) => {
      const sock = freshSock();
      publishFakeDaemonToken(dir!, VICTIM_TOKEN);
      const { received } = await listenImpostor(sock, answer);
      const data: unknown[] = [];
      await expect(
        streamDaemon(
          { method: "logging/tail" },
          {
            socketPath: sock,
            dir,
            timeoutMs: 2000,
            onData: (d) => {
              data.push(d);
            },
          },
        ),
      ).rejects.toMatchObject(unverified);
      expectOnlyHello(received());
      expect(data).toEqual([]);
    },
  );

  it("sends nothing at all when no token exists (the daemon stopped and something else holds its endpoint)", async () => {
    const sock = freshSock();
    // No mcpdod.token: a stopped daemon removes it.
    const { received } = await listenImpostor(sock, (line, socket) =>
      reply(socket, { id: helloOf(line).id, ok: true, result: {} }),
    );
    const prev = process.env.MCP_INSPECTOR_DAEMON_TOKEN;
    delete process.env.MCP_INSPECTOR_DAEMON_TOKEN;
    try {
      await expect(
        callDaemon("connect", connectParams, { socketPath: sock, dir }),
      ).rejects.toMatchObject({
        ...unverified,
        message: expect.stringContaining("No connection daemon token found"),
      });
      await expect(
        streamDaemon({}, { socketPath: sock, dir, onData: () => {} }),
      ).rejects.toMatchObject(unverified);
      // ensureDaemon finds the endpoint occupied and must not ping it.
      await expect(ensureDaemon({ dir: dir! })).rejects.toMatchObject(
        unverified,
      );
      // Give any stray write a moment to land before asserting silence.
      await new Promise((r) => setTimeout(r, 50));
      expect(received()).toBe("");
    } finally {
      if (prev !== undefined) process.env.MCP_INSPECTOR_DAEMON_TOKEN = prev;
    }
  });

  it("without a token, nothing listening is still reported as unreachable", async () => {
    const sock = freshSock();
    await expect(
      callDaemon("ping", {}, { socketPath: sock, dir, timeoutMs: 2000 }),
    ).rejects.toMatchObject({ envelope: { code: "daemon_unreachable" } });
  });

  it("ensureDaemon refuses an impostor on the endpoint even with a token on disk", async () => {
    const sock = freshSock();
    publishFakeDaemonToken(dir!, VICTIM_TOKEN);
    const { received } = await listenImpostor(sock, (line, socket) =>
      reply(socket, {
        id: helloOf(line).id,
        ok: true,
        result: { pong: true, stopping: false },
      }),
    );
    await expect(ensureDaemon({ dir: dir! })).rejects.toMatchObject(unverified);
    expectOnlyHello(received());
  });

  it("the genuine daemon proves its token and serves calls and streams", async () => {
    const d = freshDir();
    daemon = new DaemonServer({ dir: d, idleMs: 0 });
    await daemon.start();
    const pong = await callDaemon<{ pong: boolean }>(
      "ping",
      {},
      { socketPath: daemon.socketPath, dir: d, timeoutMs: 2000 },
    );
    expect(pong.pong).toBe(true);
    // A stream over an unknown connection is refused by the daemon itself —
    // which it can only do once the handshake let the request through.
    await expect(
      streamDaemon(
        { name: "missing", method: "logging/tail" },
        {
          socketPath: daemon.socketPath,
          dir: d,
          timeoutMs: 2000,
          onData: () => {},
        },
      ),
    ).rejects.not.toMatchObject(unverified);
  });

  it("the daemon answers hello with the HMAC of the nonce, without the token, even while stopping", async () => {
    const d = freshDir();
    daemon = new DaemonServer({ dir: d, idleMs: 0 });
    await daemon.start();
    const token = readDaemonTokenFile(d)!;
    const nonce = generateDaemonNonce();
    const answer = await daemon.handle({
      id: "h",
      op: "hello",
      params: { nonce },
    });
    expect(answer).toEqual({
      id: "h",
      ok: true,
      result: { proof: computeDaemonProof(token, nonce) },
    });
    // The proof is not the token, and does not contain it.
    expect(JSON.stringify(answer)).not.toContain(token);

    await daemon.stop("stop");
    const stopping = await daemon.handle({
      id: "h2",
      op: "hello",
      params: { nonce },
    });
    expect(stopping.ok).toBe(true);
    daemon = undefined;
  });

  it("the daemon rejects a malformed hello nonce", async () => {
    const srv = new DaemonServer({
      dir: freshDir(),
      idleMs: 0,
      requiredToken: "t",
    });
    for (const params of [undefined, {}, { nonce: "short" }, { nonce: 7 }]) {
      const answer = await srv.handle({
        id: "h",
        op: "hello",
        params: params as never,
      });
      expect(answer).toMatchObject({
        ok: false,
        error: { code: "invalid_request" },
      });
    }
  });

  it("a never-started daemon without a token has nothing to prove", async () => {
    const prev = process.env.MCP_INSPECTOR_DAEMON_TOKEN;
    delete process.env.MCP_INSPECTOR_DAEMON_TOKEN;
    try {
      const srv = new DaemonServer({
        dir: freshDir(),
        idleMs: 0,
      });
      const answer = await srv.handle({
        id: "h",
        op: "hello",
        params: { nonce: generateDaemonNonce() },
      });
      expect(answer).toMatchObject({
        ok: false,
        error: { code: "daemon_auth_failed" },
      });
    } finally {
      if (prev !== undefined) process.env.MCP_INSPECTOR_DAEMON_TOKEN = prev;
    }
  });
});

describe("hello proof primitives", () => {
  it("accepts only a 64-character lowercase hex nonce", () => {
    expect(isDaemonNonce(generateDaemonNonce())).toBe(true);
    expect(isDaemonNonce("A".repeat(64))).toBe(false);
    expect(isDaemonNonce("a".repeat(63))).toBe(false);
    expect(isDaemonNonce(undefined)).toBe(false);
  });

  it("verifies a proof only for the right token and nonce", () => {
    const nonce = generateDaemonNonce();
    const proof = computeDaemonProof("tok", nonce);
    expect(verifyDaemonProof("tok", nonce, proof)).toBe(true);
    expect(verifyDaemonProof("other", nonce, proof)).toBe(false);
    expect(verifyDaemonProof("tok", generateDaemonNonce(), proof)).toBe(false);
    expect(verifyDaemonProof("tok", nonce, proof.slice(1))).toBe(false);
    expect(verifyDaemonProof("tok", nonce, undefined)).toBe(false);
    expect(verifyDaemonProof("tok", nonce, 12)).toBe(false);
  });

  it("a hello carries a fresh nonce and no token", () => {
    const a = createDaemonHello();
    const b = createDaemonHello();
    expect(a.nonce).not.toBe(b.nonce);
    expect(JSON.parse(a.line)).toEqual({
      id: a.id,
      op: "hello",
      params: { nonce: a.nonce },
    });
  });

  it("checkDaemonHelloLine accepts only a matching proof", () => {
    const hello = createDaemonHello();
    const good = JSON.stringify({
      id: hello.id,
      ok: true,
      result: { proof: computeDaemonProof("tok", hello.nonce) },
    });
    expect(checkDaemonHelloLine(good, hello, "tok", "s")).toBeUndefined();
    // No token on this side means nothing can be verified.
    expect(checkDaemonHelloLine(good, hello, undefined, "s")).toMatchObject(
      unverified,
    );
    for (const bad of [
      "null",
      "42",
      // A valid proof under another id: rejected on the id alone.
      JSON.stringify({
        id: "other",
        ok: true,
        result: { proof: computeDaemonProof("tok", hello.nonce) },
      }),
      JSON.stringify({ id: hello.id, ok: true, result: null }),
      JSON.stringify({ id: hello.id, ok: true }),
    ]) {
      expect(checkDaemonHelloLine(bad, hello, "tok", "s")).toMatchObject(
        unverified,
      );
    }
  });
});
