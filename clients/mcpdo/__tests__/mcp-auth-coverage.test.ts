import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  createSampleTestConfig,
  deleteConfigFile,
} from "../../cli/__tests__/helpers/fixtures.js";
import { CliExitCodeError, EXIT_CODES } from "@inspector/cli/error-handler.js";

const callDaemon = vi.fn();
const ensureDaemon = vi.fn();
const authorizeInFrontend = vi.fn();
const obtainPendingAuthUrl = vi.fn();

vi.mock("../src/daemon/index.js", () => ({
  callDaemon: (...args: unknown[]) => callDaemon(...args),
  ensureDaemon: (...args: unknown[]) => ensureDaemon(...args),
  streamDaemon: vi.fn(),
}));

vi.mock("../src/connection/authorize.js", () => ({
  authorizeInFrontend: (...args: unknown[]) => authorizeInFrontend(...args),
}));

vi.mock("../src/connection/auth-helper.js", () => ({
  AUTH_HELPER_COMMAND: "auth/complete-signin",
  PENDING_AUTH_TTL_MS: 15 * 60 * 1000,
  runAuthHelper: vi.fn(),
  obtainPendingAuthUrl: (...args: unknown[]) => obtainPendingAuthUrl(...args),
  // ema-login-helper.js (imported real by mcp.ts) also pulls these from the
  // mocked module; stubs keep its import resolvable.
  obtainPendingUrlForKey: vi.fn(),
  pendingAuthMarkerPath: vi.fn(() => "/tmp/pending-auth-stub.json"),
  readLivePendingAuthMarker: vi.fn(),
  removeOwnPendingAuthMarker: vi.fn(),
  writePendingAuthMarker: vi.fn(),
}));

describe("mcp.ts auth / daemon error paths", () => {
  let configPath: string | undefined;
  let stdout: string;
  let originalStdoutWrite: typeof process.stdout.write;
  let originalStderrWrite: typeof process.stderr.write;

  beforeEach(() => {
    stdout = "";
    originalStdoutWrite = process.stdout.write;
    originalStderrWrite = process.stderr.write;
    process.stdout.write = ((chunk: unknown, ...rest: unknown[]) => {
      stdout += typeof chunk === "string" ? chunk : String(chunk);
      const cb = rest.find((r) => typeof r === "function") as
        | (() => void)
        | undefined;
      cb?.();
      return true;
    }) as typeof process.stdout.write;
    process.stderr.write = ((chunk: unknown, ...rest: unknown[]) => {
      const cb = rest.find((r) => typeof r === "function") as
        | (() => void)
        | undefined;
      cb?.();
      return true;
    }) as typeof process.stderr.write;

    ensureDaemon.mockReset();
    ensureDaemon.mockResolvedValue({ socketPath: "/tmp/mcp-auth-cov.sock" });
    callDaemon.mockReset();
    authorizeInFrontend.mockReset();
    authorizeInFrontend.mockResolvedValue(undefined);
    obtainPendingAuthUrl.mockReset();
  });

  const originalStderrIsTTY = process.stderr.isTTY;
  const originalStdinIsTTY = process.stdin.isTTY;

  afterEach(() => {
    process.stderr.isTTY = originalStderrIsTTY;
    process.stdin.isTTY = originalStdinIsTTY;
    process.stdout.write = originalStdoutWrite;
    process.stderr.write = originalStderrWrite;
    if (configPath) {
      deleteConfigFile(configPath);
      configPath = undefined;
    }
  });

  it("connect --ema overlays enterpriseManaged onto the resolved settings", async () => {
    configPath = createSampleTestConfig();
    callDaemon.mockResolvedValueOnce({
      name: "test-stdio",
      isMru: true,
      serverIdentity: "stdio",
    });

    const { runMcp } = await import("../src/connection/mcp.js");
    await runMcp([
      "node",
      "mcpdo",
      "connect",
      "test-stdio",
      "--config",
      configPath,
      "--ema",
      "--format",
      "json",
    ]);

    const connectCall = callDaemon.mock.calls.find((c) => c[0] === "connect");
    const params = connectCall?.[1] as {
      serverSettings?: { enterpriseManaged?: boolean };
    };
    expect(params.serverSettings?.enterpriseManaged).toBe(true);
  });

  it("retries connect after auth_required via authorizeInFrontend", async () => {
    process.stderr.isTTY = true; // human path: blocking interactive OAuth
    configPath = createSampleTestConfig();
    const connection = {
      name: "test-stdio",
      isMru: true,
      serverIdentity: "stdio",
    };
    callDaemon
      .mockRejectedValueOnce(
        new CliExitCodeError(EXIT_CODES.AUTH_REQUIRED, "need auth", {
          code: "auth_required",
        }),
      )
      .mockResolvedValueOnce(connection);

    const { runMcp } = await import("../src/connection/mcp.js");
    await runMcp([
      "node",
      "mcpdo",
      "connect",
      "test-stdio",
      "--config",
      configPath,
      "--format",
      "json",
    ]);

    expect(authorizeInFrontend).toHaveBeenCalledOnce();
    expect(callDaemon).toHaveBeenCalledTimes(2);
    expect(JSON.parse(stdout.trim()).name).toBe("test-stdio");
  });

  it("re-ensures the daemon after authorizeInFrontend, in case interactive OAuth outlasted its idle timeout", async () => {
    process.stderr.isTTY = true; // human path: blocking interactive OAuth
    configPath = createSampleTestConfig();
    const connection = {
      name: "test-stdio",
      isMru: true,
      serverIdentity: "stdio",
    };
    callDaemon
      .mockRejectedValueOnce(
        new CliExitCodeError(EXIT_CODES.AUTH_REQUIRED, "need auth", {
          code: "auth_required",
        }),
      )
      .mockResolvedValueOnce(connection);
    // Simulate the pre-auth daemon having idled out while OAuth ran: the
    // retry's ensureDaemon() call returns a different (freshly respawned)
    // socket than the one used for the first attempt.
    ensureDaemon
      .mockResolvedValueOnce({ socketPath: "/tmp/mcp-auth-cov-stale.sock" })
      .mockResolvedValueOnce({ socketPath: "/tmp/mcp-auth-cov-fresh.sock" });

    const { runMcp } = await import("../src/connection/mcp.js");
    await runMcp([
      "node",
      "mcpdo",
      "connect",
      "test-stdio",
      "--config",
      configPath,
      "--format",
      "json",
    ]);

    expect(ensureDaemon).toHaveBeenCalledTimes(2);
    expect(callDaemon).toHaveBeenCalledTimes(2);
    expect(callDaemon.mock.calls[0][2]).toMatchObject({
      socketPath: "/tmp/mcp-auth-cov-stale.sock",
    });
    expect(callDaemon.mock.calls[1][2]).toMatchObject({
      socketPath: "/tmp/mcp-auth-cov-fresh.sock",
    });
  });

  it("non-TTY connect on auth_required: hands off to the helper, registers a pending entry, and prints the auth URL", async () => {
    // Agent path: no TTY on stdin or stderr.
    process.stdin.isTTY = undefined as unknown as boolean;
    process.stderr.isTTY = undefined as unknown as boolean;
    configPath = createSampleTestConfig();
    callDaemon
      .mockRejectedValueOnce(
        new CliExitCodeError(EXIT_CODES.AUTH_REQUIRED, "need auth", {
          code: "auth_required",
        }),
      )
      .mockResolvedValueOnce({
        name: "test-stdio",
        isMru: true,
        serverIdentity: "stdio",
        pendingAuth: true,
        auth: { method: "oauth", authorized: false },
      });
    obtainPendingAuthUrl.mockResolvedValueOnce(
      "https://as.example/authorize?client_id=abc&state=xyz",
    );

    const { runMcp } = await import("../src/connection/mcp.js");
    await runMcp([
      "node",
      "mcpdo",
      "connect",
      "test-stdio",
      "--config",
      configPath,
      "--format",
      "json",
    ]);

    // Never the blocking interactive flow on the agent path.
    expect(authorizeInFrontend).not.toHaveBeenCalled();
    expect(obtainPendingAuthUrl).toHaveBeenCalledOnce();
    // The re-dial carries the pending-intent flag.
    const second = callDaemon.mock.calls[1];
    expect(second[0]).toBe("connect");
    expect(second[1]).toMatchObject({ pendingOnAuthRequired: true });
    // The auth URL rides the normal JSON payload, query string intact
    // (the error envelope would redact it).
    const out = JSON.parse(stdout.trim()) as Record<string, unknown>;
    expect(out.pendingAuth).toBe(true);
    expect(out.authUrl).toBe(
      "https://as.example/authorize?client_id=abc&state=xyz",
    );
  });

  it("non-TTY connect omits authUrl when the pending re-dial actually connected (sign-in already finished)", async () => {
    process.stdin.isTTY = undefined as unknown as boolean;
    process.stderr.isTTY = undefined as unknown as boolean;
    configPath = createSampleTestConfig();
    callDaemon
      .mockRejectedValueOnce(
        new CliExitCodeError(EXIT_CODES.AUTH_REQUIRED, "need auth", {
          code: "auth_required",
        }),
      )
      .mockResolvedValueOnce({
        name: "test-stdio",
        isMru: true,
        serverIdentity: "stdio",
        auth: { method: "oauth", authorized: true },
      });
    obtainPendingAuthUrl.mockResolvedValueOnce("https://as.example/authorize");

    const { runMcp } = await import("../src/connection/mcp.js");
    await runMcp([
      "node",
      "mcpdo",
      "connect",
      "test-stdio",
      "--config",
      configPath,
      "--format",
      "json",
    ]);

    const out = JSON.parse(stdout.trim()) as Record<string, unknown>;
    expect(out.pendingAuth).toBeUndefined();
    expect(out.authUrl).toBeUndefined();
  });

  it("MCP_AUTO_OPEN_ENABLED=true keeps the blocking interactive flow even without a TTY", async () => {
    process.stdin.isTTY = undefined as unknown as boolean;
    process.stderr.isTTY = undefined as unknown as boolean;
    const prev = process.env.MCP_AUTO_OPEN_ENABLED;
    process.env.MCP_AUTO_OPEN_ENABLED = "true";
    configPath = createSampleTestConfig();
    callDaemon
      .mockRejectedValueOnce(
        new CliExitCodeError(EXIT_CODES.AUTH_REQUIRED, "need auth", {
          code: "auth_required",
        }),
      )
      .mockResolvedValueOnce({
        name: "test-stdio",
        isMru: true,
        serverIdentity: "stdio",
      });

    try {
      const { runMcp } = await import("../src/connection/mcp.js");
      await runMcp([
        "node",
        "mcpdo",
        "connect",
        "test-stdio",
        "--config",
        configPath,
        "--format",
        "json",
      ]);
      expect(authorizeInFrontend).toHaveBeenCalledOnce();
      expect(obtainPendingAuthUrl).not.toHaveBeenCalled();
    } finally {
      if (prev === undefined) delete process.env.MCP_AUTO_OPEN_ENABLED;
      else process.env.MCP_AUTO_OPEN_ENABLED = prev;
    }
  });

  it("rejects --relogin with --stored-auth-only", async () => {
    configPath = createSampleTestConfig();
    const { runMcp } = await import("../src/connection/mcp.js");
    await expect(
      runMcp([
        "node",
        "mcpdo",
        "--stored-auth-only",
        "connect",
        "test-stdio",
        "--config",
        configPath,
        "--relogin",
      ]),
    ).rejects.toMatchObject({ exitCode: 1 });
    expect(callDaemon).not.toHaveBeenCalled();
  });

  it("clears stored auth on connect --relogin for HTTP targets", async () => {
    const fs = await import("node:fs");
    const os = await import("node:os");
    const path = await import("node:path");
    const { resetNodeOAuthStorageCache } =
      await import("@inspector/core/auth/node/storage-node.js");
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-relogin-"));
    const oauthFile = path.join(dir, "oauth.json");
    fs.writeFileSync(
      oauthFile,
      JSON.stringify({
        servers: {
          "http://example.com/mcp": {
            tokens: { access_token: "x", token_type: "Bearer" },
          },
        },
        idpSessions: {},
      }),
      "utf8",
    );
    const prev = process.env.MCP_INSPECTOR_OAUTH_STATE_PATH;
    process.env.MCP_INSPECTOR_OAUTH_STATE_PATH = oauthFile;
    resetNodeOAuthStorageCache();

    callDaemon.mockResolvedValueOnce({
      name: "http",
      isMru: true,
      serverIdentity: "http://example.com/mcp",
    });

    try {
      const { runMcp } = await import("../src/connection/mcp.js");
      await runMcp([
        "node",
        "mcpdo",
        "connect",
        "--connection",
        "relogin-http",
        "--server-url",
        "http://example.com/mcp",
        "--transport",
        "http",
        "--relogin",
        "--format",
        "json",
      ]);
      expect(callDaemon).toHaveBeenCalledOnce();
      const after = JSON.parse(fs.readFileSync(oauthFile, "utf8")) as {
        servers?: Record<string, unknown>;
      };
      expect(after.servers?.["http://example.com/mcp"]).toBeUndefined();
    } finally {
      if (prev === undefined) delete process.env.MCP_INSPECTOR_OAUTH_STATE_PATH;
      else process.env.MCP_INSPECTOR_OAUTH_STATE_PATH = prev;
      resetNodeOAuthStorageCache();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("rethrows auth_required when --stored-auth-only is set", async () => {
    configPath = createSampleTestConfig();
    callDaemon.mockRejectedValueOnce(
      new CliExitCodeError(EXIT_CODES.AUTH_REQUIRED, "need auth", {
        code: "auth_required",
      }),
    );

    const { runMcp } = await import("../src/connection/mcp.js");
    await expect(
      runMcp([
        "node",
        "mcpdo",
        "connect",
        "test-stdio",
        "--config",
        configPath,
        "--stored-auth-only",
        "--format",
        "json",
      ]),
    ).rejects.toMatchObject({
      exitCode: EXIT_CODES.AUTH_REQUIRED,
      envelope: { code: "auth_required" },
    });
    expect(authorizeInFrontend).not.toHaveBeenCalled();
  });

  it("rethrows unexpected daemon/stop errors", async () => {
    callDaemon.mockRejectedValueOnce(
      new CliExitCodeError(EXIT_CODES.USAGE, "boom", { code: "usage" }),
    );

    const { runMcp } = await import("../src/connection/mcp.js");
    await expect(
      runMcp(["node", "mcpdo", "daemon", "stop", "--format", "json"]),
    ).rejects.toMatchObject({
      exitCode: EXIT_CODES.USAGE,
      envelope: { code: "usage" },
    });
  });

  describe("connections/show pending-auth URL relay (surface 1 front-end)", () => {
    const RELAY_URL = "https://as.example/authorize?client_id=abc&state=xyz";
    const showResult = {
      name: "api",
      serverIdentity: "https://mcp.example.com/mcp",
      pendingAuth: true,
      authUrl: RELAY_URL,
    };

    it("--format json always carries authUrl (machine-readable), query intact", async () => {
      process.stderr.isTTY = true; // TTY must not suppress it for JSON.
      callDaemon.mockResolvedValueOnce(showResult);
      const { runMcp } = await import("../src/connection/mcp.js");
      await runMcp([
        "node",
        "mcpdo",
        "connections/show",
        "api",
        "--format",
        "json",
      ]);
      const parsed = JSON.parse(stdout) as { authUrl?: string };
      expect(parsed.authUrl).toBe(RELAY_URL);
    });

    it("no human present (non-TTY): human text prints the relay block + URL", async () => {
      process.stderr.isTTY = false;
      process.stdin.isTTY = false;
      callDaemon.mockResolvedValueOnce(showResult);
      const { runMcp } = await import("../src/connection/mcp.js");
      await runMcp([
        "node",
        "mcpdo",
        "connections/show",
        "api",
        "--format",
        "text",
      ]);
      expect(stdout).toContain("Sign-in required");
      expect(stdout).toContain(RELAY_URL);
    });

    it("human present (TTY): human text omits the relay block entirely", async () => {
      process.stderr.isTTY = true;
      callDaemon.mockResolvedValueOnce(showResult);
      const { runMcp } = await import("../src/connection/mcp.js");
      await runMcp([
        "node",
        "mcpdo",
        "connections/show",
        "api",
        "--format",
        "text",
      ]);
      // The connection still renders (pending status), but the agent-relay
      // URL block — and the URL — are suppressed for a human at a TTY.
      expect(stdout).not.toContain("Sign-in required");
      expect(stdout).not.toContain(RELAY_URL);
    });
  });
});
