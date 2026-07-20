import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  createSampleTestConfig,
  deleteConfigFile,
} from "./helpers/fixtures.js";
import { CliExitCodeError, EXIT_CODES } from "../src/error-handler.js";

const callDaemon = vi.fn();
const ensureDaemon = vi.fn();
const authorizeInFrontend = vi.fn();

vi.mock("../src/daemon/index.js", () => ({
  callDaemon: (...args: unknown[]) => callDaemon(...args),
  ensureDaemon: (...args: unknown[]) => ensureDaemon(...args),
  streamDaemon: vi.fn(),
}));

vi.mock("../src/session/authorize.js", () => ({
  authorizeInFrontend: (...args: unknown[]) => authorizeInFrontend(...args),
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

    ensureDaemon.mockResolvedValue({ socketPath: "/tmp/mcp-auth-cov.sock" });
    callDaemon.mockReset();
    authorizeInFrontend.mockReset();
    authorizeInFrontend.mockResolvedValue(undefined);
  });

  afterEach(() => {
    process.stdout.write = originalStdoutWrite;
    process.stderr.write = originalStderrWrite;
    if (configPath) {
      deleteConfigFile(configPath);
      configPath = undefined;
    }
  });

  it("retries connect after auth_required via authorizeInFrontend", async () => {
    configPath = createSampleTestConfig();
    const session = {
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
      .mockResolvedValueOnce(session);

    const { runMcp } = await import("../src/session/mcp.js");
    await runMcp([
      "node",
      "mcp",
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

  it("rejects --relogin with --stored-auth-only", async () => {
    configPath = createSampleTestConfig();
    const { runMcp } = await import("../src/session/mcp.js");
    await expect(
      runMcp([
        "node",
        "mcp",
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
      const { runMcp } = await import("../src/session/mcp.js");
      await runMcp([
        "node",
        "mcp",
        "connect",
        "--session",
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

    const { runMcp } = await import("../src/session/mcp.js");
    await expect(
      runMcp([
        "node",
        "mcp",
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

    const { runMcp } = await import("../src/session/mcp.js");
    await expect(
      runMcp(["node", "mcp", "daemon", "stop", "--format", "json"]),
    ).rejects.toMatchObject({
      exitCode: EXIT_CODES.USAGE,
      envelope: { code: "usage" },
    });
  });
});
