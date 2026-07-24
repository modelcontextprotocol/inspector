import { describe, it, expect, afterEach, beforeAll } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { runMcp } from "./helpers/mcp-runner.js";
import { runCli } from "./helpers/cli-runner.js";
import {
  createSampleTestConfig,
  deleteConfigFile,
} from "./helpers/fixtures.js";
import { expectCliSuccess } from "./helpers/assertions.js";
import { resolveDaemonScriptPath } from "../src/daemon/ensure.js";
import { callDaemon } from "../src/daemon/client.js";

describe("mcp session CLI", () => {
  let configPath: string | undefined;
  let storageDir: string | undefined;

  beforeAll(() => {
    // Auto-spawn needs the built daemon bundle.
    expect(fs.existsSync(resolveDaemonScriptPath())).toBe(true);
  });

  afterEach(async () => {
    if (storageDir) {
      const socketPath = path.join(storageDir, "daemon.sock");
      if (fs.existsSync(socketPath)) {
        try {
          await callDaemon("daemon/stop", {}, { socketPath, timeoutMs: 2000 });
        } catch {
          // already stopped
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
    storageDir = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-session-"));
    return {
      MCP_STORAGE_DIR: storageDir,
      MCP_INSPECTOR_DAEMON_DIR: storageDir,
      MCP_ALLOW_DEFAULT_SESSION: "1",
    };
  }

  it("lists servers without a daemon", async () => {
    configPath = createSampleTestConfig();
    // No MCP_STORAGE_DIR — this path must not touch the daemon.
    const result = await runMcp([
      "servers/list",
      "--config",
      configPath,
      "--format",
      "json",
    ]);
    expectCliSuccess(result);
    const body = JSON.parse(result.stdout) as {
      servers: { name: string }[];
    };
    expect(body.servers.some((s) => s.name === "test-stdio")).toBe(true);
  });

  it("connects, lists sessions, disconnects via auto-spawned daemon", async () => {
    configPath = createSampleTestConfig();
    const e = env();

    const connected = await runMcp(
      ["connect", "test-stdio", "--config", configPath, "--format", "json"],
      { env: e, timeout: 20000 },
    );
    expectCliSuccess(connected);
    const session = JSON.parse(connected.stdout) as {
      name: string;
      isMru: boolean;
    };
    expect(session.name).toBe("test-stdio");
    expect(session.isMru).toBe(true);

    const listed = await runMcp(["sessions/list", "--format", "json"], {
      env: e,
    });
    expectCliSuccess(listed);
    const sessions = JSON.parse(listed.stdout) as {
      sessions: { name: string; isMru: boolean }[];
    };
    expect(sessions.sessions).toHaveLength(1);
    expect(sessions.sessions[0]?.name).toBe("test-stdio");

    const servers = await runMcp(
      ["servers/list", "--config", configPath, "--format", "json"],
      { env: e },
    );
    expectCliSuccess(servers);
    const serverBody = JSON.parse(servers.stdout) as {
      servers: {
        name: string;
        session?: string;
        isMru?: boolean;
      }[];
    };
    const stdio = serverBody.servers.find((s) => s.name === "test-stdio");
    expect(stdio?.session).toBe("test-stdio");
    expect(stdio?.isMru).toBe(true);
    expect(
      serverBody.servers.find((s) => s.name === "test-http")?.session,
    ).toBeUndefined();

    const disc = await runMcp(
      ["disconnect", "--session", "test-stdio", "--format", "json"],
      { env: e },
    );
    expectCliSuccess(disc);

    const stopped = await runMcp(["daemon", "stop", "--format", "json"], {
      env: e,
    });
    expectCliSuccess(stopped);
  });

  it("one-shot servers/list still works alongside session mode", async () => {
    configPath = createSampleTestConfig();
    const result = await runCli([
      "--config",
      configPath,
      "--method",
      "servers/list",
    ]);
    expectCliSuccess(result);
    expect(result.stdout).toContain("test-stdio");
  });

  it("runs tools/list, tools/call, and initialize over a live session", async () => {
    configPath = createSampleTestConfig();
    const e = env();

    const connected = await runMcp(
      ["connect", "test-stdio", "--config", configPath, "--format", "json"],
      { env: e, timeout: 20000 },
    );
    expectCliSuccess(connected);

    const tools = await runMcp(["tools/list", "--format", "json"], {
      env: e,
      timeout: 20000,
    });
    expectCliSuccess(tools);
    const toolsBody = JSON.parse(tools.stdout) as {
      tools: { name: string }[];
    };
    expect(toolsBody.tools.length).toBeGreaterThan(0);

    const toolsText = await runMcp(["tools/list"], {
      env: e,
      timeout: 20000,
    });
    expectCliSuccess(toolsText);
    expect(toolsText.stdout).toMatch(/Tools \(\d+\):/);
    expect(toolsText.stdout).toContain("`");

    const called = await runMcp(
      ["tools/call", "echo", "message:=session", "--format", "json"],
      { env: e, timeout: 20000 },
    );
    expectCliSuccess(called);

    const calledJson = await runMcp(
      ["tools/call", "echo", '{"message":"session-json"}', "--format", "json"],
      { env: e, timeout: 20000 },
    );
    expectCliSuccess(calledJson);

    const resources = await runMcp(["resources/list", "--format", "json"], {
      env: e,
      timeout: 20000,
    });
    expectCliSuccess(resources);

    const init = await runMcp(
      ["@test-stdio", "initialize", "--format", "json"],
      { env: e, timeout: 20000 },
    );
    expectCliSuccess(init);
    const initBody = JSON.parse(init.stdout) as {
      serverInfo?: { name?: string };
      protocolVersion?: string;
    };
    expect(initBody.protocolVersion).toBeTruthy();

    await runMcp(
      ["disconnect", "--session", "test-stdio", "--format", "json"],
      {
        env: e,
      },
    );
    await runMcp(["daemon", "stop", "--format", "json"], { env: e });
  });
});
