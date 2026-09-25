import { describe, it, expect, afterEach, vi } from "vitest";
import * as fs from "node:fs";
import * as net from "node:net";
import * as os from "node:os";
import * as path from "node:path";
import { getTestMcpServerCommand } from "@modelcontextprotocol/inspector-test-server";
import { DaemonServer } from "../src/daemon/server.js";
import { callDaemon } from "../src/daemon/client.js";
import {
  ensureDaemon,
  readLogTail,
  resolveDaemonScriptPath,
} from "../src/daemon/ensure.js";
import { ConnectionRegistry } from "../src/daemon/connections.js";
import { CliExitCodeError } from "@inspector/cli/error-handler.js";
import { runMcp } from "./helpers/mcp-runner.js";
import {
  createSampleTestConfig,
  deleteConfigFile,
} from "../../cli/__tests__/helpers/fixtures.js";
import {
  expectCliSuccess,
  expectCliFailure,
} from "../../cli/__tests__/helpers/assertions.js";

describe("daemon coverage", () => {
  let server: DaemonServer | undefined;
  let dir: string | undefined;
  let configPath: string | undefined;

  afterEach(async () => {
    if (server) {
      await server.stop("stop");
      server = undefined;
    }
    if (dir) {
      fs.rmSync(dir, { recursive: true, force: true });
      dir = undefined;
    }
    if (configPath) {
      deleteConfigFile(configPath);
      configPath = undefined;
    }
  });

  function freshDir(): string {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-cov-"));
    return dir;
  }

  it("handle() covers invalid connect / connections/use / unknown op", async () => {
    server = new DaemonServer({ dir: freshDir(), idleMs: 0 });
    const badConnect = await server.handle({
      id: "1",
      op: "connect",
      params: { name: "" } as never,
    });
    expect(badConnect.ok).toBe(false);
    if (!badConnect.ok) expect(badConnect.error.code).toBe("invalid_params");

    const badUse = await server.handle({
      id: "2",
      op: "connections/use",
      params: {},
    });
    expect(badUse.ok).toBe(false);

    // connections/show with no `params` at all exercises the `request.params ??
    // {}` fallback; with no active connection it still fails, same shape as
    // connections/use above.
    const badShow = await server.handle({ id: "2b", op: "connections/show" });
    expect(badShow.ok).toBe(false);

    const unknown = await server.handle({
      id: "3",
      op: "nope" as never,
    });
    expect(unknown.ok).toBe(false);
    if (!unknown.ok) expect(unknown.error.code).toBe("unknown_op");

    // CliExitCodeError without an envelope → default code "cli_error".
    const bare = new CliExitCodeError(1, "bare");
    vi.spyOn(server.registry, "list").mockImplementationOnce(() => {
      throw bare;
    });
    const listed = await server.handle({ id: "4", op: "connections/list" });
    expect(listed.ok).toBe(false);
    if (!listed.ok) expect(listed.error.code).toBe("cli_error");

    vi.spyOn(server.registry, "list").mockImplementationOnce(() => {
      throw new Error("boom");
    });
    const boom = await server.handle({ id: "5", op: "connections/list" });
    expect(boom.ok).toBe(false);
    // Non-CliExitCodeError failures go through classifyError (code "error").
    if (!boom.ok) expect(boom.error.code).toBe("error");

    vi.spyOn(server.registry, "list").mockImplementationOnce(() => {
      throw "string-throw";
    });
    const strErr = await server.handle({ id: "6", op: "connections/list" });
    expect(strErr.ok).toBe(false);

    const disc = await server.handle({
      id: "7",
      op: "disconnect",
      params: undefined,
    });
    expect(disc.ok).toBe(false);

    // Defaults constructor + stop without onShutdown + re-entrant stop.
    const plain = new DaemonServer({ dir: freshDir(), idleMs: 0 });
    await plain.start();
    await plain.stop("stop");
    await plain.stop("stop");

    // Constructor default dir/idle/onShutdown branches (isolated storage dir).
    const prev = process.env.MCP_INSPECTOR_DAEMON_DIR;
    process.env.MCP_INSPECTOR_DAEMON_DIR = freshDir();
    try {
      const defs = new DaemonServer();
      expect(defs.socketPath).toContain("daemon.sock");
    } finally {
      if (prev === undefined) delete process.env.MCP_INSPECTOR_DAEMON_DIR;
      else process.env.MCP_INSPECTOR_DAEMON_DIR = prev;
    }
  });

  it("rejects a second daemon while a live one holds the lock", async () => {
    const d = freshDir();
    server = new DaemonServer({ dir: d, idleMs: 0 });
    await server.start();
    const other = new DaemonServer({ dir: d, idleMs: 0 });
    await expect(other.start()).rejects.toThrow(/held by running pid/);
  });

  it("reclaims a lock left by a dead pid", async () => {
    const d = freshDir();
    // No live process can have this pid-space value in practice; write a
    // plausible-but-dead pid by spawning nothing and using an exited child.
    fs.writeFileSync(path.join(d, "daemon.lock"), "999999999\n");
    server = new DaemonServer({ dir: d, idleMs: 0 });
    await server.start();
    expect(fs.readFileSync(path.join(d, "daemon.lock"), "utf8").trim()).toBe(
      String(process.pid),
    );
  });

  it("removes a stale socket before binding", async () => {
    const d = freshDir();
    const sock = path.join(d, "daemon.sock");
    fs.writeFileSync(sock, "");
    server = new DaemonServer({ dir: d, idleMs: 0 });
    await server.start();
    expect(fs.existsSync(sock)).toBe(true);
  });

  it("daemon/stop responds then shuts down", async () => {
    const d = freshDir();
    server = new DaemonServer({ dir: d, idleMs: 0 });
    await server.start();
    const result = await callDaemon<{ stopping: boolean }>(
      "daemon/stop",
      {},
      { socketPath: server.socketPath },
    );
    expect(result.stopping).toBe(true);
    // Allow async stop to finish.
    await new Promise((r) => setTimeout(r, 100));
    server = undefined;
  });

  it("accepts malformed NDJSON lines without crashing", async () => {
    const d = freshDir();
    server = new DaemonServer({ dir: d, idleMs: 0 });
    await server.start();
    await new Promise<void>((resolve, reject) => {
      const socket = net.createConnection(server!.socketPath);
      let data = "";
      socket.on("data", (chunk) => {
        data += String(chunk);
        if (data.includes("invalid_request")) {
          socket.on("error", () => {});
          socket.end();
          resolve();
        }
      });
      socket.on("error", reject);
      socket.write("not-json\n");
    });
  });

  it("callDaemon maps error responses and unreachable sockets", async () => {
    await expect(
      callDaemon(
        "ping",
        {},
        { socketPath: path.join(freshDir(), "missing.sock") },
      ),
    ).rejects.toThrow(CliExitCodeError);

    const d = freshDir();
    server = new DaemonServer({ dir: d, idleMs: 0 });
    await server.start();
    await expect(
      callDaemon("connections/use", {}, { socketPath: server.socketPath }),
    ).rejects.toThrow(/requires a connection name/);
  });

  it("callDaemon rejects malformed response JSON", async () => {
    const d = freshDir();
    const sock = path.join(d, "daemon.sock");
    const bad = net.createServer((socket) => {
      socket.on("error", () => {});
      socket.write("not-json\n");
    });
    await new Promise<void>((resolve) => bad.listen(sock, resolve));
    try {
      await expect(
        callDaemon("ping", {}, { socketPath: sock, timeoutMs: 2000 }),
      ).rejects.toThrow();
    } finally {
      bad.close();
      try {
        fs.unlinkSync(sock);
      } catch {
        // ignore
      }
    }
  });

  it("callDaemon ignores mismatched response ids then accepts a match", async () => {
    const d = freshDir();
    const sock = path.join(d, "daemon.sock");
    const echo = net.createServer((socket) => {
      socket.on("error", () => {});
      socket.once("data", (buf) => {
        const req = JSON.parse(String(buf).trim()) as { id: string };
        socket.write(
          JSON.stringify({ id: "other", ok: true, result: {} }) + "\n",
        );
        socket.write(
          JSON.stringify({ id: req.id, ok: true, result: { ok: true } }) + "\n",
        );
      });
    });
    await new Promise<void>((resolve) => echo.listen(sock, resolve));
    try {
      const result = await callDaemon<{ ok: boolean }>(
        "ping",
        {},
        { socketPath: sock, timeoutMs: 2000 },
      );
      expect(result.ok).toBe(true);
    } finally {
      echo.close();
      try {
        fs.unlinkSync(sock);
      } catch {
        // ignore
      }
    }
  });

  it("callDaemon skips blank lines and defaults missing exitCode", async () => {
    const d = freshDir();
    const sock = path.join(d, "daemon.sock");
    const echo = net.createServer((socket) => {
      socket.on("error", () => {});
      socket.once("data", (buf) => {
        const req = JSON.parse(String(buf).trim()) as { id: string };
        socket.write("\n");
        socket.write(
          JSON.stringify({
            id: req.id,
            ok: false,
            error: { code: "usage", message: "no exit" },
          }) + "\n",
        );
      });
    });
    await new Promise<void>((resolve) => echo.listen(sock, resolve));
    try {
      await expect(
        callDaemon("ping", {}, { socketPath: sock, timeoutMs: 2000 }),
      ).rejects.toMatchObject({ exitCode: 1 });
    } finally {
      echo.close();
      try {
        fs.unlinkSync(sock);
      } catch {
        // ignore
      }
    }
  });

  it("stop() without start and with missing lock files is safe", async () => {
    const d = freshDir();
    const orphan = new DaemonServer({ dir: d, idleMs: 0 });
    await orphan.stop("stop");

    server = new DaemonServer({ dir: d, idleMs: 0 });
    await server.start();
    fs.unlinkSync(server.socketPath);
    fs.unlinkSync(path.join(d, "daemon.lock"));
    await server.stop("stop");
    server = undefined;
  });

  it("repeated stop() returns the same in-flight cleanup promise", async () => {
    // A second SIGINT used to see `stopping` and resolve immediately,
    // letting its caller process.exit() mid-teardown and strand the
    // socket/token/lock. Both calls must await the same cleanup.
    server = new DaemonServer({ dir: freshDir(), idleMs: 0 });
    await server.start();
    const first = server.stop("signal");
    const second = server.stop("signal");
    expect(second).toBe(first);
    await first;
    expect(fs.existsSync(server.socketPath)).toBe(false);
    server = undefined;
  });

  it("rejects new ops while stopping but keeps status ops answerable", async () => {
    server = new DaemonServer({ dir: freshDir(), idleMs: 0 });
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    vi.spyOn(server.registry, "disconnectAll").mockImplementation(() => gate);
    const stopP = server.stop("stop");

    const rejected = await server.handle({ id: "q1", op: "connections/list" });
    expect(rejected.ok).toBe(false);
    if (!rejected.ok) expect(rejected.error.code).toBe("daemon_stopping");

    const status = await server.handle({ id: "q2", op: "daemon/status" });
    expect(status.ok).toBe(true);
    const pong = await server.handle({ id: "q3", op: "ping" });
    expect(pong.ok).toBe(true);

    release();
    await stopP;
    server = undefined;
  });

  it("stop() quiesces in-flight ops before disconnecting connections", async () => {
    // A connect racing shutdown used to register its client *after*
    // disconnectAll's snapshot, leaking a live child process. Shutdown now
    // waits for in-flight ops so the late registration is included.
    server = new DaemonServer({ dir: freshDir(), idleMs: 0 });
    const order: string[] = [];
    let releaseConnect!: () => void;
    const gate = new Promise<void>((resolve) => (releaseConnect = resolve));
    vi.spyOn(server.registry, "connect").mockImplementation(async () => {
      order.push("connect:start");
      await gate;
      order.push("connect:end");
      return { name: "a" } as never;
    });
    vi.spyOn(server.registry, "disconnectAll").mockImplementation(async () => {
      order.push("disconnectAll");
    });

    const opP = server.handle({
      id: "c1",
      op: "connect",
      params: {
        name: "a",
        serverConfig: { type: "stdio", command: "x" },
        serverIdentity: "x",
      } as never,
    });
    await vi.waitFor(() => expect(order).toContain("connect:start"));
    const stopP = server.stop("stop");
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(order).toEqual(["connect:start"]); // stop is waiting, not tearing down

    releaseConnect();
    await opP;
    await stopP;
    expect(order).toEqual(["connect:start", "connect:end", "disconnectAll"]);
    server = undefined;
  });

  it("callDaemon times out a hung server", async () => {
    const d = freshDir();
    const sock = path.join(d, "daemon.sock");
    const hung = net.createServer((socket) => {
      socket.on("error", () => {});
    });
    await new Promise<void>((resolve) => hung.listen(sock, resolve));
    try {
      await expect(
        callDaemon("ping", {}, { socketPath: sock, timeoutMs: 100 }),
      ).rejects.toThrow(/timed out/);
    } finally {
      hung.close();
      try {
        fs.unlinkSync(sock);
      } catch {
        // ignore
      }
    }
  }, 5000);

  it("connections/use and reconnect replace an existing connection", async () => {
    const { command, args } = getTestMcpServerCommand();
    const registry = new ConnectionRegistry(0);
    await registry.connect({
      name: "s",
      serverConfig: { type: "stdio", command, args },
      serverIdentity: "s",
    });
    await registry.connect({
      name: "s",
      serverConfig: { type: "stdio", command, args },
      serverIdentity: "s-again",
    });
    expect(registry.use("s").serverIdentity).toBe("s-again");
    expect(() => registry.resolve("missing", false)).toThrow(/not found/);
    await registry.disconnectAll();
  });

  it("idle handler fires after last disconnect when idleMs > 0", async () => {
    const registry = new ConnectionRegistry(20);
    let idle = false;
    registry.setIdleHandler(() => {
      idle = true;
    });
    const { command, args } = getTestMcpServerCommand();
    await registry.connect({
      name: "s",
      serverConfig: { type: "stdio", command, args },
      serverIdentity: "s",
    });
    await registry.disconnect("s", false);
    await new Promise((r) => setTimeout(r, 60));
    expect(idle).toBe(true);
    expect(registry.idleRemainingMs()).toBeNull();
  });

  it("covers touch/auth/oauth-setup/disconnect-swallow/reconnect-before-idle", async () => {
    const { command, args } = getTestMcpServerCommand();
    const registry = new ConnectionRegistry(0);
    registry.touch("missing");

    await registry.connect({
      name: "s",
      serverConfig: { type: "stdio", command, args },
      serverIdentity: "s",
    });
    const connection = registry.resolve("s", false);
    vi.spyOn(connection.client, "disconnect").mockRejectedValueOnce(
      new Error("teardown boom"),
    );
    await expect(registry.disconnect("s", false)).resolves.toEqual({
      name: "s",
    });
    expect(registry.getMruName()).toBeNull();

    const { AuthRecoveryRequiredError } =
      await import("@inspector/core/auth/challenge.js");
    const { InspectorClient } = await import("@inspector/core/mcp/index.js");
    vi.spyOn(InspectorClient.prototype, "connect").mockRejectedValueOnce(
      new AuthRecoveryRequiredError(new URL("https://as.example/authorize"), {
        reason: "unauthorized",
      }),
    );
    await expect(
      registry.connect({
        name: "auth",
        serverConfig: { type: "stdio", command, args },
        serverIdentity: "auth",
      }),
    ).rejects.toMatchObject({ exitCode: 3 });

    // SDK token-exchange failure (empty redirectUrl / stale store) must surface
    // as auth_required so the front-end can re-prompt — not a hard ErrorEnvelope.
    vi.spyOn(InspectorClient.prototype, "connect").mockRejectedValueOnce(
      new Error(
        "Either provider.prepareTokenRequest() or authorizationCode is required",
      ),
    );
    await expect(
      registry.connect({
        name: "reauth",
        serverConfig: {
          type: "streamable-http",
          url: "https://example.com/mcp",
        },
        serverIdentity: "reauth",
      }),
    ).rejects.toMatchObject({
      exitCode: 3,
      envelope: { code: "auth_required" },
    });

    await expect(
      registry.connect({
        name: "http",
        serverConfig: {
          type: "streamable-http",
          url: "http://127.0.0.1:1/mcp",
        },
        serverIdentity: "http",
      }),
    ).rejects.toThrow();

    const idleReg = new ConnectionRegistry(80);
    const onIdle = vi.fn();
    idleReg.setIdleHandler(onIdle);
    await idleReg.connect({
      name: "a",
      serverConfig: { type: "stdio", command, args },
      serverIdentity: "a",
    });
    await idleReg.disconnect("a", false);
    await idleReg.connect({
      name: "b",
      serverConfig: { type: "stdio", command, args },
      serverIdentity: "b",
    });
    await new Promise((r) => setTimeout(r, 100));
    expect(onIdle).not.toHaveBeenCalled();
    await idleReg.disconnectAll();
  }, 20000);

  it("ensureDaemon reuses a running daemon and resolveDaemonScriptPath finds build", async () => {
    const d = freshDir();
    server = new DaemonServer({ dir: d, idleMs: 0 });
    await server.start();
    const ensured = await ensureDaemon({
      dir: d,
      daemonScript: resolveDaemonScriptPath(),
    });
    expect(ensured.spawned).toBe(false);
    expect(ensured.socketPath).toBe(server.socketPath);
  });

  it("ensureDaemon auto-spawns when no daemon is present", async () => {
    const d = freshDir();
    const ensured = await ensureDaemon({
      dir: d,
      daemonScript: resolveDaemonScriptPath(),
    });
    expect(ensured.spawned).toBe(true);
    await callDaemon("daemon/stop", {}, { socketPath: ensured.socketPath });
    await new Promise((r) => setTimeout(r, 150));
  });

  it("start-timeout error quotes the daemon's stderr log", async () => {
    const d = freshDir();
    // A "daemon" that logs a failure and dies without ever binding a socket
    // — the silent-death case the 0600 log exists to explain.
    const script = path.join(d, "dying-daemon.js");
    fs.writeFileSync(
      script,
      'console.error("boom: could not start"); setTimeout(() => {}, 3000);\n',
    );
    await expect(
      ensureDaemon({ dir: d, daemonScript: script, readyTimeoutMs: 700 }),
    ).rejects.toMatchObject({
      envelope: { code: "daemon_start_timeout" },
      message: expect.stringContaining("boom: could not start"),
    });
  }, 15000);

  it("start-timeout error stays clean when the daemon logged nothing", async () => {
    const d = freshDir();
    const script = path.join(d, "silent-daemon.js");
    fs.writeFileSync(script, "setTimeout(() => {}, 3000);\n");
    await expect(
      ensureDaemon({ dir: d, daemonScript: script, readyTimeoutMs: 700 }),
    ).rejects.toMatchObject({
      envelope: { code: "daemon_start_timeout" },
      message: expect.not.stringContaining("Daemon log"),
    });
  }, 15000);

  it("readLogTail returns the last lines and empty string when unreadable", () => {
    const d = freshDir();
    const logPath = path.join(d, "daemon.log");
    const lines = Array.from({ length: 15 }, (_, i) => `line-${i}`);
    fs.writeFileSync(logPath, lines.join("\n") + "\n");
    const tail = readLogTail(logPath);
    expect(tail.split("\n")).toHaveLength(10);
    expect(tail).toContain("line-14");
    expect(tail).not.toContain("line-4\n");
    expect(readLogTail(path.join(d, "missing.log"))).toBe("");
  });

  it("ensureDaemon fails loudly when a live listener rejects ping (no takeover)", async () => {
    // Regression test for the daemon-takeover hole: a socket that ACCEPTS
    // connections is owned by a live process. ensureDaemon must never unlink
    // it and install a replacement daemon — it must surface the ping failure.
    const d = freshDir();
    const sock = path.join(d, "daemon.sock");
    const occupant = net.createServer((socket) => {
      socket.on("error", () => {});
      socket.end();
    });
    await new Promise<void>((resolve) => occupant.listen(sock, resolve));
    try {
      await expect(
        ensureDaemon({ dir: d, daemonScript: resolveDaemonScriptPath() }),
      ).rejects.toThrow(/closed the connection during 'ping'/);
      // The occupant's socket must still be in place, untouched.
      expect(fs.existsSync(sock)).toBe(true);
    } finally {
      occupant.close();
    }
  });

  it("ensureDaemon fails loudly on daemon_auth_failed (wrong token is not a stale socket)", async () => {
    const d = freshDir();
    server = new DaemonServer({ dir: d, idleMs: 0, requiredToken: "good" });
    await server.start();
    await expect(
      ensureDaemon({
        dir: d,
        daemonScript: resolveDaemonScriptPath(),
        token: "wrong",
      }),
    ).rejects.toMatchObject({ envelope: { code: "daemon_auth_failed" } });
    // The live daemon keeps its socket and still serves the right token.
    const pong = await callDaemon(
      "ping",
      {},
      {
        socketPath: server.socketPath,
        token: "good",
      },
    );
    expect(pong).toBeDefined();
  });

  it("connection-less start arms idle and self-reaps", async () => {
    const d = freshDir();
    let shut = false;
    server = new DaemonServer({
      dir: d,
      idleMs: 40,
      onShutdown: () => {
        shut = true;
      },
    });
    await server.start();
    // ensureDaemon from tools/list with no connections must not leak forever.
    expect(server.registry.idleRemainingMs()).not.toBeNull();
    await new Promise((r) => setTimeout(r, 100));
    expect(shut).toBe(true);
    server = undefined;
  });

  it("connect failure for a dead stdio command is surfaced and re-arms idle", async () => {
    const registry = new ConnectionRegistry(5_000);
    let idle = false;
    registry.setIdleHandler(() => {
      idle = true;
    });
    await expect(
      registry.connect({
        name: "dead",
        serverConfig: {
          type: "stdio",
          command: path.join(os.tmpdir(), "no-such-mcp-server-binary"),
          args: [],
        },
        serverIdentity: "dead",
      }),
    ).rejects.toThrow();
    expect(registry.idleRemainingMs()).not.toBeNull();
    expect(idle).toBe(false);
  });

  it("re-arms idle when createConnectionClient fails before client.connect", async () => {
    const registry = new ConnectionRegistry(5_000);
    registry.setIdleHandler(() => {});
    const prev = process.env.MCP_OAUTH_CALLBACK_URL;
    process.env.MCP_OAUTH_CALLBACK_URL = "https://example.com/oauth/callback";
    try {
      await expect(
        registry.connect({
          name: "http",
          serverConfig: {
            type: "streamable-http",
            url: "http://127.0.0.1:1/mcp",
          },
          serverIdentity: "http",
        }),
      ).rejects.toThrow(/http scheme|callback URL/i);
      expect(registry.idleRemainingMs()).not.toBeNull();
    } finally {
      if (prev === undefined) delete process.env.MCP_OAUTH_CALLBACK_URL;
      else process.env.MCP_OAUTH_CALLBACK_URL = prev;
    }
  });

  it("callDaemon fails immediately when the peer closes without a response", async () => {
    const d = freshDir();
    const sock = path.join(d, "daemon.sock");
    const peer = net.createServer((socket) => {
      socket.on("error", () => {});
      // Accept then FIN with no NDJSON reply.
      socket.end();
    });
    await new Promise<void>((resolve) => peer.listen(sock, resolve));
    try {
      await expect(
        callDaemon("ping", {}, { socketPath: sock, timeoutMs: 60_000 }),
      ).rejects.toMatchObject({
        envelope: { code: "daemon_unreachable" },
      });
    } finally {
      peer.close();
      try {
        fs.unlinkSync(sock);
      } catch {
        // ignore
      }
    }
  });

  it("connections/use via handle and blank IPC lines", async () => {
    const d = freshDir();
    server = new DaemonServer({ dir: d, idleMs: 60_000 });
    await server.start();
    const { command, args } = getTestMcpServerCommand();
    await callDaemon(
      "connect",
      {
        name: "s",
        serverConfig: { type: "stdio", command, args },
        serverIdentity: "s",
      },
      { socketPath: server.socketPath, timeoutMs: 15000 },
    );
    const used = await server.handle({
      id: "u",
      op: "connections/use",
      params: { name: "s" },
    });
    expect(used.ok).toBe(true);
    expect(server.registry.idleRemainingMs()).toBeNull();

    // connections/show over the same live connection — exercises the full case
    // body (serverInfo/protocolVersion/protocolEra/capabilities lookups)
    // in-process, where coverage instrumentation can see it.
    const shown = await server.handle({
      id: "s2",
      op: "connections/show",
      params: { name: "s" },
    });
    expect(shown.ok).toBe(true);
    if (shown.ok) {
      const result = shown.result as { protocolVersion?: string };
      expect(result.protocolVersion).toBeTruthy();
    }

    await new Promise<void>((resolve, reject) => {
      const socket = new net.Socket();
      socket.on("error", reject);
      socket.connect(server!.socketPath, () => {
        socket.write("\n\n");
        socket.end();
        resolve();
      });
    });

    await callDaemon(
      "disconnect",
      { name: "s" },
      { socketPath: server.socketPath },
    );
    // Idle timer armed — remaining countdown is positive and ≤ configured idleMs.
    const remaining = server.registry.idleRemainingMs();
    expect(remaining).not.toBeNull();
    expect(remaining!).toBeLessThanOrEqual(60_000);
    expect(remaining!).toBeGreaterThan(0);
  });
});

describe("mcp connection coverage", () => {
  let configPath: string | undefined;
  let storageDir: string | undefined;

  afterEach(async () => {
    if (storageDir) {
      const socketPath = path.join(storageDir, "daemon.sock");
      if (fs.existsSync(socketPath)) {
        try {
          await callDaemon("daemon/stop", {}, { socketPath, timeoutMs: 2000 });
        } catch {
          // ignore
        }
        const deadline = Date.now() + 2000;
        while (fs.existsSync(socketPath) && Date.now() < deadline) {
          await new Promise((r) => setTimeout(r, 50));
        }
      }
      fs.rmSync(storageDir, { recursive: true, force: true });
      storageDir = undefined;
    }
    if (configPath) {
      deleteConfigFile(configPath);
      configPath = undefined;
    }
  });

  function env(): Record<string, string> {
    storageDir = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-sess-cov-"));
    return {
      MCP_STORAGE_DIR: storageDir,
      MCP_INSPECTOR_DAEMON_DIR: storageDir,
      MCP_ALLOW_DEFAULT_CONNECTION: "1",
    };
  }

  it("covers connections/use, daemon status, @connection connect, and stop no-op", async () => {
    configPath = createSampleTestConfig();
    const e = env();

    const stopIdle = await runMcp(["daemon", "stop", "--format", "json"], {
      env: e,
    });
    expectCliSuccess(stopIdle);
    expect(stopIdle.stdout).toContain("not running");

    const connected = await runMcp(
      [
        "connect",
        "@alpha",
        "test-stdio",
        "--config",
        configPath,
        "--format",
        "json",
      ],
      { env: e, timeout: 20000 },
    );
    expectCliSuccess(connected);
    expect(JSON.parse(connected.stdout).name).toBe("alpha");

    const used = await runMcp(
      ["connections/use", "@alpha", "--format", "text"],
      {
        env: e,
      },
    );
    expectCliSuccess(used);
    expect(used.stdout).toContain("alpha");

    const status = await runMcp(["daemon", "status"], { env: e });
    expectCliSuccess(status);

    const listed = await runMcp(["connections/list"], { env: e });
    expectCliSuccess(listed);

    const viaServer = await runMcp(
      [
        "connect",
        "--server",
        "test-stdio",
        "--config",
        configPath,
        "--connection",
        "via-flag",
        "--format",
        "json",
      ],
      { env: e, timeout: 20000 },
    );
    expectCliSuccess(viaServer);

    const stopped = await runMcp(["daemon", "stop", "--format", "json"], {
      env: e,
    });
    expectCliSuccess(stopped);
    expect(stopped.stdout).toContain("stopping");
  });

  it("rejects connect with no target and invalid --format", async () => {
    const e = env();
    const missing = await runMcp(["connect"], { env: e });
    expectCliFailure(missing);

    const badFormat = await runMcp(["servers/list", "--format", "xml"], {
      env: e,
    });
    expectCliFailure(badFormat);

    const badTransport = await runMcp(["connect", "x", "--transport", "ftp"], {
      env: e,
    });
    expectCliFailure(badTransport);

    const badTimeout = await runMcp(
      ["connect", "x", "--connect-timeout", "-1"],
      { env: e },
    );
    expectCliFailure(badTimeout);

    const emptyUse = await runMcp(["connections/use", ""], { env: e });
    expectCliFailure(emptyUse);
  });

  it("connects an ad-hoc stdio target", async () => {
    const { command, args } = getTestMcpServerCommand();
    const e = env();
    // Multi-token positional target → ad-hoc (not a catalog entry name).
    const result = await runMcp(
      [
        "connect",
        "--connection",
        "adhoc",
        "--transport",
        "stdio",
        "--format",
        "json",
        command,
        ...args,
      ],
      { env: e, timeout: 20000 },
    );
    expectCliSuccess(result);
    expect(JSON.parse(result.stdout).name).toBe("adhoc");
  });

  it("treats a URL positional as ad-hoc", async () => {
    const e = env();
    const result = await runMcp(
      [
        "connect",
        "http://127.0.0.1:9/mcp",
        "--connection",
        "url",
        "--connect-timeout",
        "100",
        "--format",
        "json",
      ],
      { env: e, timeout: 10000 },
    );
    // Connection should fail (nothing listening) but the ad-hoc URL path ran.
    expectCliFailure(result);
  });

  it("requires explicit connection in non-interactive mode without opt-in", async () => {
    configPath = createSampleTestConfig();
    storageDir = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-sess-ci-"));
    const e = {
      MCP_STORAGE_DIR: storageDir,
      MCP_INSPECTOR_DAEMON_DIR: storageDir,
      // no MCP_ALLOW_DEFAULT_CONNECTION
    };
    const connected = await runMcp(
      ["connect", "test-stdio", "--config", configPath, "--format", "json"],
      { env: e, timeout: 20000 },
    );
    expectCliSuccess(connected);

    // Force requireExplicit by stubbing isTTY false is default in vitest forks.
    const disc = await runMcp(["disconnect", "--format", "json"], { env: e });
    expectCliFailure(disc);
    expect(disc.stderr).toMatch(/Explicit|--connection|non-interactive/i);

    await runMcp(["disconnect", "--connection", "test-stdio"], { env: e });
  });
});
