import { describe, it, expect, afterEach, vi } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { getTestMcpServerCommand } from "@modelcontextprotocol/inspector-test-server";
import { DaemonServer } from "../src/daemon/server.js";
import { callDaemon } from "../src/daemon/client.js";
import { parseRequestLine, encodeResponse } from "../src/daemon/framing.js";
import {
  DEFAULT_IDLE_MS,
  elicitCapabilityToClientOption,
  getLiveConnectionAuthInfo,
  getConnectionAuthInfo,
  isConnectionAuthRequiredError,
  ConnectionRegistry,
} from "../src/daemon/connections.js";
import { CliExitCodeError } from "@inspector/cli/error-handler.js";
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

describe("elicitCapabilityToClientOption", () => {
  it("maps each elicitCapability mode to the InspectorClient elicit shape", () => {
    expect(elicitCapabilityToClientOption("off")).toBe(false);
    expect(elicitCapabilityToClientOption("url")).toEqual({ url: true });
    expect(elicitCapabilityToClientOption("form")).toEqual({ form: true });
    expect(elicitCapabilityToClientOption("both")).toEqual({
      url: true,
      form: true,
    });
  });

  it("defaults to both (url+form) when unset, matching the pre-#1783 hardcoded default", () => {
    expect(elicitCapabilityToClientOption(undefined)).toEqual({
      url: true,
      form: true,
    });
  });
});

describe("isConnectionAuthRequiredError", () => {
  it("treats EMA client misconfiguration as auth_required (front-end maps it to guidance)", async () => {
    const { EmaClientNotConfiguredError } =
      await import("@inspector/core/auth/ema/clientConfigError.js");
    expect(
      isConnectionAuthRequiredError(
        new EmaClientNotConfiguredError("not_configured"),
      ),
    ).toBe(true);
  });

  it("recognizes unauthorized, recovery, and SDK token-exchange failures", () => {
    expect(isConnectionAuthRequiredError(new Error("nope"))).toBe(false);
    expect(
      isConnectionAuthRequiredError(
        new AuthRecoveryRequiredError(new URL("https://as.example/a"), {
          reason: "unauthorized",
        }),
      ),
    ).toBe(true);
    const unauthorized = Object.assign(new Error("boom"), { status: 401 });
    expect(isConnectionAuthRequiredError(unauthorized)).toBe(true);
    expect(
      isConnectionAuthRequiredError(
        new Error(
          "Either provider.prepareTokenRequest() or authorizationCode is required",
        ),
      ),
    ).toBe(true);
    expect(
      isConnectionAuthRequiredError(
        new Error("redirectUrl is required for authorization_code flow"),
      ),
    ).toBe(true);
    expect(
      isConnectionAuthRequiredError(
        new Error("No code verifier saved for connection"),
      ),
    ).toBe(true);
  });
});

describe("getConnectionAuthInfo", () => {
  const clientWith = (
    getOAuthState: () => Promise<unknown>,
  ): Parameters<typeof getConnectionAuthInfo>[0] =>
    ({ getOAuthState }) as unknown as Parameters<
      typeof getConnectionAuthInfo
    >[0];

  it("is undefined for no-auth connections and when the state read fails", async () => {
    expect(
      await getConnectionAuthInfo(clientWith(async () => undefined)),
    ).toBeUndefined();
    expect(
      await getConnectionAuthInfo(
        clientWith(async () => {
          throw new Error("storage unavailable");
        }),
      ),
    ).toBeUndefined();
  });

  it("projects standard OAuth state (scope + clientId when present)", async () => {
    expect(
      await getConnectionAuthInfo(
        clientWith(async () => ({
          authorized: true,
          protocol: "standard",
          serverUrl: "https://mcp.example",
          grantedScope: "mcp:tools",
          client: { clientId: "client-123", hasClientSecret: false },
        })),
      ),
    ).toEqual({
      method: "oauth",
      authorized: true,
      scope: "mcp:tools",
      clientId: "client-123",
    });
  });

  it("projects EMA state with IdP session and omits absent optionals", async () => {
    expect(
      await getConnectionAuthInfo(
        clientWith(async () => ({
          authorized: false,
          protocol: "ema",
          serverUrl: "https://mcp.example",
          ema: {
            idpIssuer: "https://idp.example",
            idpClientId: "idp-client",
            idpSession: "logged_in",
          },
        })),
      ),
    ).toEqual({ method: "ema", authorized: false, idpSession: "logged_in" });
  });
});

describe("getLiveConnectionAuthInfo", () => {
  it("is undefined for stdio, malformed http configs, and unengaged OAuth", async () => {
    const { resetNodeOAuthStorageCache } =
      await import("@inspector/core/auth/node/storage-node.js");
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-conn-live-auth-"));
    const saved = process.env.MCP_INSPECTOR_OAUTH_STATE_PATH;
    const savedClient = process.env.MCP_CLIENT_CONFIG_PATH;
    process.env.MCP_INSPECTOR_OAUTH_STATE_PATH = path.join(dir, "oauth.json");
    process.env.MCP_CLIENT_CONFIG_PATH = path.join(dir, "client.json");
    resetNodeOAuthStorageCache();
    try {
      expect(
        await getLiveConnectionAuthInfo({
          serverConfig: { type: "stdio", command: "x" },
        }),
      ).toBeUndefined();
      // Defensive: OAuth-capable type without a usable url.
      expect(
        await getLiveConnectionAuthInfo({
          serverConfig: { type: "streamable-http" } as never,
        }),
      ).toBeUndefined();
      // http server, no oauth config anywhere, empty storage: no snapshot.
      expect(
        await getLiveConnectionAuthInfo({
          serverConfig: {
            type: "streamable-http",
            url: "https://mcp.example.com/mcp",
          },
        }),
      ).toBeUndefined();
      // Corrupt oauth.json: the disk read fails, and the best-effort catch
      // yields undefined rather than failing connections/show.
      fs.writeFileSync(process.env.MCP_INSPECTOR_OAUTH_STATE_PATH!, "{nope");
      resetNodeOAuthStorageCache();
      expect(
        await getLiveConnectionAuthInfo({
          serverConfig: {
            type: "streamable-http",
            url: "https://mcp.example.com/mcp",
          },
        }),
      ).toBeUndefined();
    } finally {
      if (saved === undefined)
        delete process.env.MCP_INSPECTOR_OAUTH_STATE_PATH;
      else process.env.MCP_INSPECTOR_OAUTH_STATE_PATH = saved;
      if (savedClient === undefined) delete process.env.MCP_CLIENT_CONFIG_PATH;
      else process.env.MCP_CLIENT_CONFIG_PATH = savedClient;
      resetNodeOAuthStorageCache();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("ConnectionRegistry", () => {
  it("requires an explicit connection when asked", () => {
    const registry = new ConnectionRegistry(0);
    expect(() => registry.resolve(undefined, true)).toThrow(CliExitCodeError);
    expect(() => registry.resolve(undefined, false)).toThrow(
      /No open connections/,
    );
  });

  it("tracks MRU across connect/disconnect", async () => {
    const { command, args } = getTestMcpServerCommand();
    const registry = new ConnectionRegistry(0);
    const a = await registry.connect({
      name: "a",
      serverConfig: { type: "stdio", command, args },
      serverIdentity: `${command} ${args.join(" ")}`,
    });
    expect(a.isMru).toBe(true);
    // stdio transport: no OAuth, so no auth snapshot is reported.
    expect(a.auth).toBeUndefined();
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
    expect(registry.connectionCount()).toBe(0);
    expect(DEFAULT_IDLE_MS).toBe(60_000);
  });

  it("serializes concurrent connects for the same name so the replaced client is torn down, not leaked", async () => {
    const { InspectorClient } = await import("@inspector/core/mcp/index.js");
    // Slow connect widens the check→set window that raced pre-lock.
    const connectSpy = vi
      .spyOn(InspectorClient.prototype, "connect")
      .mockImplementation(
        () => new Promise<void>((resolve) => setTimeout(resolve, 25)),
      );
    const disconnectSpy = vi
      .spyOn(InspectorClient.prototype, "disconnect")
      .mockResolvedValue(undefined);
    const authSpy = vi
      .spyOn(InspectorClient.prototype, "getOAuthState")
      .mockResolvedValue(undefined as never);
    const registry = new ConnectionRegistry(0);
    try {
      const params = {
        name: "dup",
        serverConfig: {
          type: "streamable-http",
          url: "https://mcp.example.com/mcp",
        },
        serverIdentity: "https://mcp.example.com/mcp",
      } as const;
      const [a, b] = await Promise.all([
        registry.connect(params),
        registry.connect(params),
      ]);
      expect(a.name).toBe("dup");
      expect(b.name).toBe("dup");
      // Exactly one tracked connection; the loser of the race was
      // disconnected by the serialized reconnect path, not orphaned.
      expect(registry.connectionCount()).toBe(1);
      expect(connectSpy).toHaveBeenCalledTimes(2);
      expect(disconnectSpy).toHaveBeenCalledTimes(1);
      await registry.disconnect("dup", false);
      expect(disconnectSpy).toHaveBeenCalledTimes(2);
      expect(registry.connectionCount()).toBe(0);
      // A queued duplicate disconnect fails cleanly rather than tearing
      // down a successor's connection.
      await expect(registry.disconnect("dup", false)).rejects.toThrow(
        /not found/,
      );
    } finally {
      connectSpy.mockRestore();
      disconnectSpy.mockRestore();
      authSpy.mockRestore();
    }
  });

  it("a connect that outlives shutdown's quiesce grace tears its client down instead of leaking it", async () => {
    const { InspectorClient } = await import("@inspector/core/mcp/index.js");
    let releaseConnect!: () => void;
    const gate = new Promise<void>((resolve) => (releaseConnect = resolve));
    const connectSpy = vi
      .spyOn(InspectorClient.prototype, "connect")
      .mockImplementation(() => gate);
    const disconnectSpy = vi
      .spyOn(InspectorClient.prototype, "disconnect")
      .mockResolvedValue(undefined);
    const authSpy = vi
      .spyOn(InspectorClient.prototype, "getOAuthState")
      .mockResolvedValue(undefined as never);
    const registry = new ConnectionRegistry(0);
    try {
      const params = {
        name: "late",
        serverConfig: {
          type: "streamable-http",
          url: "https://mcp.example.com/mcp",
        },
        serverIdentity: "https://mcp.example.com/mcp",
      } as const;
      const pending = registry.connect(params);
      // Ensure the client is actually dialing before the shutdown snapshot
      // runs — the bounded-quiesce-expired case (otherwise the entry check
      // rejects it before a client exists).
      await vi.waitFor(() => expect(connectSpy).toHaveBeenCalled());
      await registry.disconnectAll();
      releaseConnect();
      await expect(pending).rejects.toMatchObject({
        envelope: { code: "daemon_stopping" },
      });
      // The freshly connected client was disconnected, not registered.
      expect(disconnectSpy).toHaveBeenCalledTimes(1);
      expect(registry.connectionCount()).toBe(0);
      // And a connect arriving after close fails fast, before dialing.
      await expect(registry.connect(params)).rejects.toMatchObject({
        envelope: { code: "daemon_stopping" },
      });
      expect(connectSpy).toHaveBeenCalledTimes(1); // no second dial
    } finally {
      connectSpy.mockRestore();
      disconnectSpy.mockRestore();
      authSpy.mockRestore();
    }
  });

  it("reports the connect-time auth snapshot, and connections/show recomputes from disk", async () => {
    const { InspectorClient } = await import("@inspector/core/mcp/index.js");
    const { NodeOAuthStorage, resetNodeOAuthStorageCache } =
      await import("@inspector/core/auth/node/storage-node.js");
    // Isolated client.json (EMA IdP config) + oauth.json so the show
    // handler's disk read is deterministic.
    const stateDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "mcp-conn-auth-info-"),
    );
    const savedEnv = {
      MCP_CLIENT_CONFIG_PATH: process.env.MCP_CLIENT_CONFIG_PATH,
      MCP_INSPECTOR_OAUTH_STATE_PATH:
        process.env.MCP_INSPECTOR_OAUTH_STATE_PATH,
    };
    process.env.MCP_CLIENT_CONFIG_PATH = path.join(stateDir, "client.json");
    process.env.MCP_INSPECTOR_OAUTH_STATE_PATH = path.join(
      stateDir,
      "oauth.json",
    );
    const issuer = "https://idp.example.com";
    fs.writeFileSync(
      process.env.MCP_CLIENT_CONFIG_PATH,
      JSON.stringify({
        enterpriseManagedAuth: {
          enabled: true,
          idp: { issuer, clientId: "idp-client" },
        },
      }),
    );
    resetNodeOAuthStorageCache();
    // Unexpired unsigned JWT so the seeded IdP session reads as logged_in.
    const b64 = (obj: object) =>
      Buffer.from(JSON.stringify(obj)).toString("base64url");
    const idToken = `${b64({ alg: "none" })}.${b64({
      exp: Math.floor(Date.now() / 1000) + 3600,
    })}.sig`;

    // Force an auth snapshot onto the connect result without a live OAuth
    // server, so the auth-present reporting paths (connect result, list,
    // use) are exercised.
    const stateSpy = vi
      .spyOn(InspectorClient.prototype, "getOAuthState")
      .mockResolvedValue({
        authorized: true,
        protocol: "ema",
        serverUrl: "https://mcp.example.com/mcp",
        ema: {
          idpIssuer: issuer,
          idpClientId: "idp-client",
          idpSession: "logged_in",
        },
      });
    const connectSpy = vi
      .spyOn(InspectorClient.prototype, "connect")
      .mockResolvedValue(undefined);
    const server = new DaemonServer({
      dir: fs.mkdtempSync(path.join(os.tmpdir(), "mcp-conn-auth-daemon-")),
      idleMs: 0,
    });
    const registry = server.registry;
    try {
      const info = await registry.connect({
        name: "a",
        serverConfig: {
          type: "streamable-http",
          url: "https://mcp.example.com/mcp",
        },
        serverSettings: {
          headers: [],
          metadata: {},
          env: [],
          connectionTimeout: 30_000,
          requestTimeout: 0,
          taskTtl: 0,
          maxFetchRequests: 0,
          autoRefreshOnListChanged: false,
          paginatedLists: false,
          roots: [],
          enterpriseManaged: true,
        },
        serverIdentity: "https://mcp.example.com/mcp",
      });
      const expected = {
        method: "ema",
        authorized: true,
        idpSession: "logged_in",
      };
      expect(info.auth).toEqual(expected);
      expect(registry.list()[0]?.auth).toEqual(expected);
      expect(registry.use("a").auth).toEqual(expected);

      // connections/show reads *disk*, not the client's memory-cached storage:
      // seed an IdP session on disk and expect logged_in (no tokens were
      // persisted, so authorized is false — matching auth/ema-status).
      await new NodeOAuthStorage().saveIdpSession(issuer, {
        idToken,
        idTokenExpiresAt: Date.now() + 3600_000,
      });
      const shown = await server.handle({
        id: "show",
        op: "connections/show",
        params: { name: "a" },
      });
      expect(shown.ok).toBe(true);
      if (!shown.ok) throw new Error("unreachable");
      expect((shown.result as { auth?: unknown }).auth).toEqual({
        method: "ema",
        authorized: false,
        idpSession: "logged_in",
      });

      // Simulate a cross-process logout (e.g. auth/ema-logout): clear the
      // IdP session on disk. list keeps the connect-time value; show
      // reflects the new disk state.
      resetNodeOAuthStorageCache();
      await new NodeOAuthStorage().clearIdpSession(issuer);
      expect(registry.list()[0]?.auth).toEqual(expected);
      const loggedOut = await server.handle({
        id: "show2",
        op: "connections/show",
        params: { name: "a" },
      });
      expect(loggedOut.ok).toBe(true);
      if (!loggedOut.ok) throw new Error("unreachable");
      expect((loggedOut.result as { auth?: unknown }).auth).toEqual({
        method: "ema",
        authorized: false,
        idpSession: "none",
      });
    } finally {
      await registry.disconnectAll();
      stateSpy.mockRestore();
      connectSpy.mockRestore();
      for (const [key, value] of Object.entries(savedEnv)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
      resetNodeOAuthStorageCache();
      fs.rmSync(stateDir, { recursive: true, force: true });
    }
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

  it("serves ping / connect / connections/list / disconnect over the socket", async () => {
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

    const listed = await callDaemon<{ connections: { name: string }[] }>(
      "connections/list",
      {},
      { socketPath: server.socketPath },
    );
    expect(listed.connections.map((s) => s.name)).toEqual(["stdio"]);

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

  it("runs rpc tools/list and initialize against a live connection", async () => {
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
