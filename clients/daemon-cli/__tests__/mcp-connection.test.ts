import { describe, it, expect, afterEach, beforeAll } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { runMcp } from "./helpers/mcp-runner.js";
import { runCli } from "../../cli/__tests__/helpers/cli-runner.js";
import {
  createSampleTestConfig,
  deleteConfigFile,
} from "../../cli/__tests__/helpers/fixtures.js";
import { expectCliSuccess } from "../../cli/__tests__/helpers/assertions.js";
import { resolveDaemonScriptPath } from "../src/daemon/ensure.js";
import { callDaemon } from "../src/daemon/client.js";

describe("mcp connection CLI", () => {
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
    storageDir = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-connection-"));
    return {
      MCP_STORAGE_DIR: storageDir,
      MCP_INSPECTOR_DAEMON_DIR: storageDir,
      MCP_ALLOW_DEFAULT_CONNECTION: "1",
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

  it("connects, lists connections, disconnects via auto-spawned daemon", async () => {
    configPath = createSampleTestConfig();
    const e = env();

    const connected = await runMcp(
      ["connect", "test-stdio", "--config", configPath, "--format", "json"],
      { env: e, timeout: 20000 },
    );
    expectCliSuccess(connected);
    const connection = JSON.parse(connected.stdout) as {
      name: string;
      isMru: boolean;
    };
    expect(connection.name).toBe("test-stdio");
    expect(connection.isMru).toBe(true);

    const listed = await runMcp(["connections/list", "--format", "json"], {
      env: e,
    });
    expectCliSuccess(listed);
    const connections = JSON.parse(listed.stdout) as {
      connections: { name: string; isMru: boolean }[];
    };
    expect(connections.connections).toHaveLength(1);
    expect(connections.connections[0]?.name).toBe("test-stdio");

    const servers = await runMcp(
      ["servers/list", "--config", configPath, "--format", "json"],
      { env: e },
    );
    expectCliSuccess(servers);
    const serverBody = JSON.parse(servers.stdout) as {
      servers: {
        name: string;
        connection?: string;
        isMru?: boolean;
      }[];
    };
    const stdio = serverBody.servers.find((s) => s.name === "test-stdio");
    expect(stdio?.connection).toBe("test-stdio");
    expect(stdio?.isMru).toBe(true);
    expect(
      serverBody.servers.find((s) => s.name === "test-http")?.connection,
    ).toBeUndefined();

    const disc = await runMcp(
      ["disconnect", "--connection", "test-stdio", "--format", "json"],
      { env: e },
    );
    expectCliSuccess(disc);

    const stopped = await runMcp(["daemon", "stop", "--format", "json"], {
      env: e,
    });
    expectCliSuccess(stopped);
  });

  it("one-shot servers/list still works alongside connection mode", async () => {
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

  it("runs tools/list, tools/call, and connections/show over a live connection", async () => {
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
      ["tools/call", "echo", "message:=connection", "--format", "json"],
      { env: e, timeout: 20000 },
    );
    expectCliSuccess(called);

    const calledJson = await runMcp(
      [
        "tools/call",
        "echo",
        '{"message":"connection-json"}',
        "--format",
        "json",
      ],
      { env: e, timeout: 20000 },
    );
    expectCliSuccess(calledJson);

    const resources = await runMcp(["resources/list", "--format", "json"], {
      env: e,
      timeout: 20000,
    });
    expectCliSuccess(resources);

    const shown = await runMcp(
      ["@test-stdio", "connections/show", "--format", "json"],
      { env: e, timeout: 20000 },
    );
    expectCliSuccess(shown);
    const shownBody = JSON.parse(shown.stdout) as {
      name?: string;
      serverInfo?: { name?: string };
      protocolVersion?: string;
      protocolEra?: string;
    };
    expect(shownBody.protocolVersion).toBeTruthy();
    expect(shownBody.protocolEra).toBeTruthy();

    // `connections/show <name>` (positional, no `@name`/--connection) exercises
    // the opts.connection-absent fallback to the command's own argument.
    const shownByArg = await runMcp(
      ["connections/show", "test-stdio", "--format", "json"],
      { env: e, timeout: 20000 },
    );
    expectCliSuccess(shownByArg);

    await runMcp(
      ["disconnect", "--connection", "test-stdio", "--format", "json"],
      {
        env: e,
      },
    );
    await runMcp(["daemon", "stop", "--format", "json"], { env: e });
  });
});
