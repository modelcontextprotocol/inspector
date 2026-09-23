import { describe, it, expect, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { getTestMcpServerCommand } from "@modelcontextprotocol/inspector-test-server";
import { assertDaemonToken, tokensEqual } from "../src/daemon/auth.js";
import { callDaemon } from "../src/daemon/client.js";
import { ensureDaemon } from "../src/daemon/ensure.js";
import { MAX_REQUEST_LINE_BYTES } from "../src/daemon/ipc-glue.js";
import {
  createPrivateDaemonDir,
  DAEMON_DIR_ENV,
  DAEMON_TOKEN_ENV,
  getDaemonTokenPath,
} from "../src/daemon/paths.js";
import { DaemonServer } from "../src/daemon/server.js";
import { CliExitCodeError } from "@inspector/cli/error-handler.js";
import { runMcp } from "./helpers/mcp-runner.js";
import {
  expectCliSuccess,
  expectCliFailure,
} from "../../cli/__tests__/helpers/assertions.js";
import {
  createSampleTestConfig,
  deleteConfigFile,
} from "../../cli/__tests__/helpers/fixtures.js";
import {
  createPrivateBinding,
  formatPrivateEnvExports,
} from "../src/connection/private-env.js";

describe("daemon IPC token", () => {
  it("compares tokens in constant time", () => {
    expect(tokensEqual("abc", "abc")).toBe(true);
    expect(tokensEqual("abc", "abd")).toBe(false);
    expect(tokensEqual("abc", "ab")).toBe(false);
    expect(tokensEqual(undefined, "x")).toBe(false);
  });

  it("assertDaemonToken allows shared mode and rejects bad private tokens", () => {
    expect(() => assertDaemonToken(undefined, undefined)).not.toThrow();
    expect(() => assertDaemonToken(undefined, "x")).not.toThrow();
    expect(() => assertDaemonToken("secret", "secret")).not.toThrow();
    expect(() => assertDaemonToken("secret", "nope")).toThrow(CliExitCodeError);
    expect(() => assertDaemonToken("secret", undefined)).toThrow(
      CliExitCodeError,
    );
  });
});

describe("mcpdo private", () => {
  let home: string | undefined;
  let prevHome: string | undefined;

  afterEach(() => {
    if (prevHome === undefined) delete process.env.HOME;
    else process.env.HOME = prevHome;
    prevHome = undefined;
    if (home) {
      fs.rmSync(home, { recursive: true, force: true });
      home = undefined;
    }
  });

  function useTempHome() {
    prevHome = process.env.HOME;
    home = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-home-"));
    process.env.HOME = home;
  }

  it("prints shell exports for a new private binding", async () => {
    useTempHome();
    const result = await runMcp(["private"], {
      env: { HOME: home! },
    });
    expectCliSuccess(result);
    expect(result.stdout).toMatch(
      new RegExp(
        `export ${DAEMON_DIR_ENV}='[^']+/mcp-conn-[^/']+/[0-9a-f]{8}'`,
      ),
    );
    expect(result.stdout).toMatch(
      new RegExp(`export ${DAEMON_TOKEN_ENV}='[^']+'`),
    );
    const dirMatch = result.stdout.match(
      new RegExp(`${DAEMON_DIR_ENV}='([^']+)'`),
    );
    expect(dirMatch?.[1]).toBeTruthy();
    expect(fs.statSync(dirMatch![1]!).isDirectory()).toBe(true);
  });

  it("formatPrivateEnvExports escapes single quotes", () => {
    const text = formatPrivateEnvExports({
      dir: "/tmp/o'brian",
      token: "t'ok",
    });
    expect(text).toContain(`'/tmp/o'\\''brian'`);
    expect(text).toContain(`'t'\\''ok'`);
  });

  it("createPrivateBinding allocates a short 0700 dir under the tmpdir", () => {
    useTempHome();
    const binding = createPrivateBinding();
    expect(path.basename(binding.dir)).toMatch(/^[0-9a-f]{8}$/);
    expect(path.basename(path.dirname(binding.dir))).toMatch(/^mcp-conn-/);
    expect(binding.dir.startsWith(os.tmpdir())).toBe(true);
    expect(binding.token.length).toBeGreaterThan(20);
  });
});

describe("private daemon end-to-end", () => {
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

  it("rejects IPC with a wrong token and accepts with the right one", async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-priv-"));
    const token = "test-token-value";
    server = new DaemonServer({ dir, idleMs: 0, requiredToken: token });
    await server.start();

    // The daemon publishes daemon.token (0600) for same-user clients, so a
    // tokenless call auto-discovers it; only a wrong token must fail.
    await expect(
      callDaemon(
        "ping",
        {},
        { socketPath: server.socketPath, timeoutMs: 2000, token: "wrong" },
      ),
    ).rejects.toMatchObject({ envelope: { code: "daemon_auth_failed" } });

    // Tokenless call discovers the published token file next to the socket.
    const discovered = await callDaemon<{ pong: boolean }>(
      "ping",
      {},
      { socketPath: server.socketPath, timeoutMs: 2000 },
    );
    expect(discovered.pong).toBe(true);

    const pong = await callDaemon<{ pong: boolean }>(
      "ping",
      {},
      { socketPath: server.socketPath, timeoutMs: 2000, token },
    );
    expect(pong.pong).toBe(true);
  });

  it("publishes daemon.token (0600) on start and removes it on stop", async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-priv-tok-"));
    const token = "published-token";
    server = new DaemonServer({ dir, idleMs: 0, requiredToken: token });
    await server.start();

    const tokenPath = getDaemonTokenPath(dir);
    expect(fs.readFileSync(tokenPath, "utf8").trim()).toBe(token);
    if (process.platform !== "win32") {
      expect(fs.statSync(tokenPath).mode & 0o777).toBe(0o600);
    }

    await server.stop("stop");
    server = undefined;
    expect(fs.existsSync(tokenPath)).toBe(false);
  });

  it("drops a connection whose request line exceeds the cap", async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-priv-cap-"));
    server = new DaemonServer({ dir, idleMs: 0 });
    await server.start();

    const net = await import("node:net");
    const closed = await new Promise<boolean>((resolve) => {
      const socket = net.connect(server!.socketPath, () => {
        // One oversized line, never newline-terminated.
        socket.write(Buffer.alloc(MAX_REQUEST_LINE_BYTES + 64 * 1024, 0x61));
      });
      const done = () => resolve(true);
      socket.once("close", done);
      socket.once("error", done);
      setTimeout(() => {
        socket.destroy();
        resolve(false);
      }, 5000).unref();
    });
    expect(closed).toBe(true);
  });

  it("connection front-end rethrows non-unreachable daemon errors", async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-priv-rethrow-"));
    const token = "good-token";
    server = new DaemonServer({ dir, idleMs: 0, requiredToken: token });
    await server.start();

    const env = {
      MCP_STORAGE_DIR: dir,
      [DAEMON_DIR_ENV]: dir,
      [DAEMON_TOKEN_ENV]: "wrong-token",
    };

    const listed = await runMcp(["connections/list"], { env });
    expectCliFailure(listed);
    expect(listed.stderr).toMatch(/authentication failed|daemon_auth_failed/i);

    const status = await runMcp(["daemon", "status"], { env });
    expectCliFailure(status);

    const configPath = createSampleTestConfig();
    try {
      const servers = await runMcp(["servers/list", "--config", configPath], {
        env,
      });
      // Optional daemon probe must not swallow auth failures as empty connections.
      expectCliFailure(servers);
    } finally {
      deleteConfigFile(configPath);
    }
  });

  it("ensureDaemon spawns a token-gated daemon from env", async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-home-spawn-"));
    const prevHome = process.env.HOME;
    process.env.HOME = home;
    try {
      dir = createPrivateDaemonDir();
      const token = "spawn-token-xyz";
      const prevDir = process.env[DAEMON_DIR_ENV];
      const prevTok = process.env[DAEMON_TOKEN_ENV];
      process.env[DAEMON_DIR_ENV] = dir;
      process.env[DAEMON_TOKEN_ENV] = token;
      try {
        const { socketPath, spawned } = await ensureDaemon({ dir, token });
        expect(spawned).toBe(true);

        // Explicit wrong token — do not rely on clearing env (callDaemon
        // falls back to MCP_INSPECTOR_DAEMON_TOKEN when options.token omitted).
        await expect(
          callDaemon(
            "ping",
            {},
            { socketPath, timeoutMs: 2000, token: "wrong" },
          ),
        ).rejects.toMatchObject({ envelope: { code: "daemon_auth_failed" } });

        const pong = await callDaemon<{ pong: boolean }>(
          "ping",
          {},
          { socketPath, timeoutMs: 2000, token },
        );
        expect(pong.pong).toBe(true);

        const { command, args } = getTestMcpServerCommand();
        await callDaemon(
          "connect",
          {
            name: "s",
            serverConfig: { type: "stdio", command, args },
            serverIdentity: "s",
          },
          { socketPath, timeoutMs: 15000, token },
        );
        await callDaemon("daemon/stop", {}, { socketPath, token });
      } finally {
        if (prevDir === undefined) delete process.env[DAEMON_DIR_ENV];
        else process.env[DAEMON_DIR_ENV] = prevDir;
        if (prevTok === undefined) delete process.env[DAEMON_TOKEN_ENV];
        else process.env[DAEMON_TOKEN_ENV] = prevTok;
      }
    } finally {
      if (prevHome === undefined) delete process.env.HOME;
      else process.env.HOME = prevHome;
      fs.rmSync(home, { recursive: true, force: true });
    }
  });
});
