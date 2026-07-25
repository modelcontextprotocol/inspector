import { describe, it, expect, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { getTestMcpServerCommand } from "@modelcontextprotocol/inspector-test-server";
import { assertDaemonToken, tokensEqual } from "../src/daemon/auth.js";
import { callDaemon } from "../src/daemon/client.js";
import { ensureDaemon } from "../src/daemon/ensure.js";
import {
  createPrivateDaemonDir,
  DAEMON_DIR_ENV,
  DAEMON_TOKEN_ENV,
} from "../src/daemon/paths.js";
import { DaemonServer } from "../src/daemon/server.js";
import { CliExitCodeError } from "../src/error-handler.js";
import { runMcp } from "./helpers/mcp-runner.js";
import { expectCliSuccess } from "./helpers/assertions.js";
import {
  createPrivateBinding,
  formatPrivateEnvExports,
} from "../src/session/private-env.js";

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

describe("mcpi private", () => {
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
      new RegExp(`export ${DAEMON_DIR_ENV}='[^']+/private/[^']+'`),
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

  it("createPrivateBinding allocates under private/", () => {
    useTempHome();
    const binding = createPrivateBinding();
    expect(binding.dir).toContain(`${path.sep}private${path.sep}`);
    expect(binding.dir.startsWith(home!)).toBe(true);
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

  it("rejects IPC without the required token and accepts with it", async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-priv-"));
    const token = "test-token-value";
    server = new DaemonServer({ dir, idleMs: 0, requiredToken: token });
    await server.start();

    await expect(
      callDaemon(
        "ping",
        {},
        { socketPath: server.socketPath, timeoutMs: 2000 },
      ),
    ).rejects.toMatchObject({ envelope: { code: "daemon_auth_failed" } });

    const pong = await callDaemon<{ pong: boolean }>(
      "ping",
      {},
      { socketPath: server.socketPath, timeoutMs: 2000, token },
    );
    expect(pong.pong).toBe(true);
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
