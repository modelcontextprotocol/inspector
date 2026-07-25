import { describe, it, expect, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { getTestMcpServerCommand } from "@modelcontextprotocol/inspector-test-server";
import { DaemonServer } from "../src/daemon/server.js";
import { callDaemon } from "../src/daemon/client.js";
import { parseRequestLine, encodeResponse } from "../src/daemon/framing.js";
import {
  DEFAULT_IDLE_MS,
  isSessionAuthRequiredError,
  SessionRegistry,
} from "../src/daemon/sessions.js";
import { CliExitCodeError } from "../src/error-handler.js";
import { AuthRecoveryRequiredError } from "@inspector/core/auth/challenge.js";

describe("daemon framing", () => {
  it("parses and rejects invalid request lines", () => {
    expect(parseRequestLine("")).toBeNull();
    expect(parseRequestLine("   ")).toBeNull();
    expect(parseRequestLine('{"id":"1","op":"ping"}')).toEqual({
      id: "1",
      op: "ping",
    });
    expect(() => parseRequestLine("not-json")).toThrow();
    expect(() => parseRequestLine('{"op":"ping"}')).toThrow(/Invalid daemon/);
    expect(encodeResponse({ id: "1", ok: true, result: { pong: true } })).toBe(
      '{"id":"1","ok":true,"result":{"pong":true}}\n',
    );
  });
});

describe("isSessionAuthRequiredError", () => {
  it("recognizes unauthorized, recovery, and SDK token-exchange failures", () => {
    expect(isSessionAuthRequiredError(new Error("nope"))).toBe(false);
    expect(
      isSessionAuthRequiredError(
        new AuthRecoveryRequiredError(new URL("https://as.example/a"), {
          reason: "unauthorized",
        }),
      ),
    ).toBe(true);
    const unauthorized = Object.assign(new Error("boom"), { status: 401 });
    expect(isSessionAuthRequiredError(unauthorized)).toBe(true);
    expect(
      isSessionAuthRequiredError(
        new Error(
          "Either provider.prepareTokenRequest() or authorizationCode is required",
        ),
      ),
    ).toBe(true);
    expect(
      isSessionAuthRequiredError(
        new Error("redirectUrl is required for authorization_code flow"),
      ),
    ).toBe(true);
    expect(
      isSessionAuthRequiredError(
        new Error("No code verifier saved for session"),
      ),
    ).toBe(true);
  });
});

describe("SessionRegistry", () => {
  it("requires an explicit session when asked", () => {
    const registry = new SessionRegistry(0);
    expect(() => registry.resolve(undefined, true)).toThrow(CliExitCodeError);
    expect(() => registry.resolve(undefined, false)).toThrow(
      /No open sessions/,
    );
  });

  it("tracks MRU across connect/disconnect", async () => {
    const { command, args } = getTestMcpServerCommand();
    const registry = new SessionRegistry(0);
    const a = await registry.connect({
      name: "a",
      serverConfig: { type: "stdio", command, args },
      serverIdentity: `${command} ${args.join(" ")}`,
    });
    expect(a.isMru).toBe(true);
    const b = await registry.connect({
      name: "b",
      serverConfig: { type: "stdio", command, args },
      serverIdentity: `${command} ${args.join(" ")}`,
    });
    expect(b.isMru).toBe(true);
    expect(registry.getMruName()).toBe("b");
    registry.use("a");
    expect(registry.getMruName()).toBe("a");
    await registry.disconnect("b", false);
    expect(registry.list().map((s) => s.name)).toEqual(["a"]);
    await registry.disconnect(undefined, false);
    expect(registry.sessionCount()).toBe(0);
    expect(DEFAULT_IDLE_MS).toBe(60_000);
  });
});

describe("DaemonServer IPC", () => {
  let server: DaemonServer | undefined;
  let dir: string | undefined;

  afterEach(async () => {
    if (server) {
      await server.stop("stop");
      server = undefined;
    }
    if (dir) {
      fs.rmSync(dir, { recursive: true, force: true });
      dir = undefined;
    }
  });

  it("serves ping / connect / sessions/list / disconnect over the socket", async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-daemon-"));
    server = new DaemonServer({ dir, idleMs: 0 });
    await server.start();

    const pong = await callDaemon<{ pong: boolean }>(
      "ping",
      {},
      { socketPath: server.socketPath },
    );
    expect(pong.pong).toBe(true);

    const { command, args } = getTestMcpServerCommand();
    const connected = await callDaemon<{ name: string; isMru: boolean }>(
      "connect",
      {
        name: "stdio",
        serverConfig: { type: "stdio", command, args },
        serverIdentity: "test-stdio",
      },
      { socketPath: server.socketPath, timeoutMs: 15000 },
    );
    expect(connected.name).toBe("stdio");
    expect(connected.isMru).toBe(true);

    const listed = await callDaemon<{ sessions: { name: string }[] }>(
      "sessions/list",
      {},
      { socketPath: server.socketPath },
    );
    expect(listed.sessions.map((s) => s.name)).toEqual(["stdio"]);

    const status = await callDaemon<{ pid: number; socketPath: string }>(
      "daemon/status",
      {},
      { socketPath: server.socketPath },
    );
    expect(status.pid).toBe(process.pid);
    expect(status.socketPath).toBe(server.socketPath);

    const disc = await callDaemon<{ name: string }>(
      "disconnect",
      { name: "stdio" },
      { socketPath: server.socketPath },
    );
    expect(disc.name).toBe("stdio");
  });

  it("runs rpc tools/list and initialize against a live session", async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-daemon-rpc-"));
    server = new DaemonServer({ dir, idleMs: 0 });
    await server.start();

    const { command, args } = getTestMcpServerCommand();
    await callDaemon(
      "connect",
      {
        name: "stdio",
        serverConfig: { type: "stdio", command, args },
        serverIdentity: "test-stdio",
      },
      { socketPath: server.socketPath, timeoutMs: 15000 },
    );

    const listed = await callDaemon<{
      kind: string;
      result: { tools: unknown[] };
    }>(
      "rpc",
      { method: "tools/list", name: "stdio" },
      { socketPath: server.socketPath, timeoutMs: 15000 },
    );
    expect(listed.kind).toBe("result");
    expect(listed.result.tools.length).toBeGreaterThan(0);

    const init = await callDaemon<{
      kind: string;
      result: { protocolVersion?: string };
    }>(
      "rpc",
      { method: "initialize", name: "stdio" },
      { socketPath: server.socketPath, timeoutMs: 15000 },
    );
    expect(init.kind).toBe("result");
    expect(init.result.protocolVersion).toBeTruthy();

    await callDaemon(
      "disconnect",
      { name: "stdio" },
      { socketPath: server.socketPath },
    );
  });

  it("rejects stream methods on rpc and rpc methods on stream", async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-daemon-ops-"));
    server = new DaemonServer({ dir, idleMs: 0 });
    await server.start();

    const { command, args } = getTestMcpServerCommand();
    await callDaemon(
      "connect",
      {
        name: "stdio",
        serverConfig: { type: "stdio", command, args },
        serverIdentity: "test-stdio",
      },
      { socketPath: server.socketPath, timeoutMs: 15000 },
    );

    await expect(
      callDaemon(
        "rpc",
        { method: "logging/tail", name: "stdio" },
        { socketPath: server.socketPath, timeoutMs: 5000 },
      ),
    ).rejects.toMatchObject({ envelope: { code: "use_stream_op" } });

    const badStream = await server.handleOutcome({
      id: "s1",
      op: "stream",
      params: { method: "tools/list", name: "stdio" },
    });
    expect(badStream.response.ok).toBe(false);

    const noMethod = await server.handle({
      id: "s2",
      op: "rpc",
      params: { name: "stdio" } as never,
    });
    expect(noMethod.ok).toBe(false);

    await callDaemon(
      "disconnect",
      { name: "stdio" },
      { socketPath: server.socketPath },
    );
  });
});
