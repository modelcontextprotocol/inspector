import { describe, it, expect, afterEach, beforeAll } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { getTestMcpServerCommand } from "@modelcontextprotocol/inspector-test-server";
import { runMcp } from "./helpers/mcp-runner.js";
import {
  createSampleTestConfig,
  deleteConfigFile,
} from "./helpers/fixtures.js";
import { expectCliSuccess, expectCliFailure } from "./helpers/assertions.js";
import { resolveDaemonScriptPath } from "../src/daemon/ensure.js";
import { callDaemon } from "../src/daemon/client.js";

describe("mcp.ts coverage", () => {
  let configPath: string | undefined;
  let storageDir: string | undefined;

  beforeAll(() => {
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
    storageDir = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-cov-"));
    return {
      MCP_STORAGE_DIR: storageDir,
      MCP_INSPECTOR_DAEMON_DIR: storageDir,
      MCP_ALLOW_DEFAULT_SESSION: "1",
    };
  }

  it("covers RPC registrations, metadata parse, and --plain", async () => {
    configPath = createSampleTestConfig();
    const e = env();

    const connected = await runMcp(
      ["connect", "test-stdio", "--config", configPath, "--format", "json"],
      { env: e, timeout: 20000 },
    );
    expectCliSuccess(connected);

    const withMeta = await runMcp(
      [
        "tools/list",
        "--metadata",
        "client=session-cov",
        "--metadata",
        "count=1",
        "--plain",
        "--format",
        "json",
      ],
      { env: e, timeout: 20000 },
    );
    expectCliSuccess(withMeta);

    const badMeta = await runMcp(["tools/list", "--metadata", "novalue"], {
      env: e,
    });
    expectCliFailure(badMeta, 1);

    const emptyMeta = await runMcp(["tools/list", "--metadata", "k="], {
      env: e,
    });
    expectCliFailure(emptyMeta, 1);

    const read = await runMcp(
      [
        "resources/read",
        "demo://resource/static/document/architecture.md",
        "--format",
        "json",
      ],
      { env: e, timeout: 20000 },
    );
    expectCliSuccess(read);

    // Same Commander action as subscribe (uri positional / --uri); prefer
    // unsubscribe so we don't open a long-lived stream in this suite.
    const unsub = await runMcp(
      ["resources/unsubscribe", "test://env", "--format", "json"],
      { env: e, timeout: 20000 },
    );
    // Default test server does not advertise subscriptions.
    expectCliFailure(unsub);
    expect(unsub.stderr).toMatch(/unsubscribe|Method not found/i);

    const prompt = await runMcp(
      [
        "prompts/get",
        "simple_prompt",
        "--prompt-args",
        "unused=1",
        "--format",
        "json",
      ],
      { env: e, timeout: 20000 },
    );
    expectCliSuccess(prompt);

    const completeBad = await runMcp(
      ["prompts/complete", "--complete-ref-type", "nope"],
      { env: e },
    );
    expectCliFailure(completeBad, 1);

    const complete = await runMcp(
      [
        "prompts/complete",
        "--complete-ref-type",
        "ref/prompt",
        "--complete-ref",
        "simple_prompt",
        "--complete-arg-name",
        "name",
        "--complete-arg-value",
        "s",
        "--format",
        "json",
      ],
      { env: e, timeout: 20000 },
    );
    // Completion support varies; assert the command ran (not a usage parse error).
    expect(complete.stderr).not.toMatch(/complete-ref-type/);
    expect([0, 1]).toContain(complete.exitCode);

    const logOk = await runMcp(
      ["logging/setLevel", "debug", "--format", "json"],
      { env: e, timeout: 20000 },
    );
    expectCliSuccess(logOk);

    const logBad = await runMcp(["logging/setLevel", "--log-level", "nope"], {
      env: e,
    });
    expectCliFailure(logBad, 1);

    const taskGet = await runMcp(
      ["tasks/get", "missing-task", "--format", "json"],
      {
        env: e,
        timeout: 20000,
      },
    );
    expectCliFailure(taskGet, 1);

    const taskCancel = await runMcp(
      ["tasks/cancel", "--task-id", "missing-task", "--format", "json"],
      { env: e, timeout: 20000 },
    );
    expectCliFailure(taskCancel, 1);

    const taskResult = await runMcp(
      ["tasks/result", "missing-task", "--format", "json"],
      { env: e, timeout: 20000 },
    );
    expectCliFailure(taskResult, 1);

    const roots = await runMcp(
      ["roots/set", "--roots-json", "[]", "--format", "json"],
      { env: e, timeout: 20000 },
    );
    expectCliSuccess(roots);

    const called = await runMcp(
      [
        "tools/call",
        "--tool-name",
        "echo",
        "--tool-arg",
        "message=cov",
        "--tool-metadata",
        "src=test",
        "--format",
        "json",
      ],
      { env: e, timeout: 20000 },
    );
    expectCliSuccess(called);

    const templates = await runMcp(
      ["resources/templates/list", "--format", "json"],
      { env: e, timeout: 20000 },
    );
    expectCliSuccess(templates);

    const prompts = await runMcp(["prompts/list", "--format", "json"], {
      env: e,
      timeout: 20000,
    });
    expectCliSuccess(prompts);

    const tasks = await runMcp(["tasks/list", "--format", "json"], {
      env: e,
      timeout: 20000,
    });
    expectCliSuccess(tasks);
    expect(JSON.parse(tasks.stdout)).toHaveProperty("tasks");

    const rootsList = await runMcp(["roots/list", "--format", "json"], {
      env: e,
      timeout: 20000,
    });
    expectCliSuccess(rootsList);
    expect(JSON.parse(rootsList.stdout)).toHaveProperty("roots");

    await runMcp(
      ["disconnect", "--session", "test-stdio", "--format", "json"],
      {
        env: e,
      },
    );
    await runMcp(["daemon", "stop", "--format", "json"], { env: e });
  });

  it("covers ad-hoc connect options and servers/list catalog env", async () => {
    configPath = createSampleTestConfig();
    const e = env();
    const { command, args } = getTestMcpServerCommand();

    const adHoc = await runMcp(
      [
        "connect",
        "--session",
        "opts",
        "--transport",
        "stdio",
        "--cwd",
        process.cwd(),
        "-e",
        "COV_FLAG=1",
        "--connect-timeout",
        "15000",
        "--format",
        "json",
        command,
        ...args,
      ],
      { env: e, timeout: 20000 },
    );
    expectCliSuccess(adHoc);

    await runMcp(["disconnect", "--session", "opts", "--format", "json"], {
      env: e,
    });

    // Ad-hoc HTTP with --server-url and no positional rest (empty-rest branch).
    const urlOnly = await runMcp(
      [
        "connect",
        "--session",
        "urlonly",
        "--transport",
        "http",
        "--server-url",
        "http://127.0.0.1:9/mcp",
        "--header",
        "X-Test: 1",
        "--connect-timeout",
        "100",
        "--format",
        "json",
      ],
      { env: e, timeout: 10000 },
    );
    expectCliFailure(urlOnly);
    // Unreachable HTTP should classify as exit 4 when the error is network-shaped.
    expect([1, 4]).toContain(urlOnly.exitCode);

    const listed = await runMcp(["servers/list", "--format", "json"], {
      env: {
        ...e,
        MCP_CATALOG_PATH: configPath,
      },
    });
    expectCliSuccess(listed);

    // Whitespace --config → trim || undefined branch on servers/list.
    const emptyConfig = await runMcp(
      ["servers/list", "--config", "   ", "--format", "json"],
      { env: { ...e, MCP_CATALOG_PATH: configPath } },
    );
    expectCliSuccess(emptyConfig);

    await runMcp(["daemon", "stop", "--format", "json"], { env: e });
  });

  it("bare mcp / --help print usage without an ErrorEnvelope", async () => {
    // Bare invocation: Commander writes help to stderr (help-after-error).
    const bare = await runMcp([]);
    expectCliSuccess(bare);
    expect(bare.stderr).toMatch(/Usage:/i);
    expect(bare.stderr).not.toContain('"error"');

    const help = await runMcp(["--help"]);
    expectCliSuccess(help);
    expect(help.stdout).toMatch(/Usage:/i);
    expect(help.stderr).not.toContain('"error"');
  });

  it("covers exitOverride (unknown command) and default process.argv", async () => {
    // Non-zero CommanderError goes through exitOverride → throw err.
    const unknown = await runMcp(["not-a-command"]);
    expectCliFailure(unknown);

    configPath = createSampleTestConfig();
    const originalArgv = process.argv;
    process.argv = [
      "node",
      "mcp",
      "servers/list",
      "--config",
      configPath,
      "--format",
      "json",
    ];
    try {
      const { runMcp: invoke } = await import("../src/session/mcp.js");
      await invoke();
    } finally {
      process.argv = originalArgv;
    }
  });

  it("sessions/list and daemon status do not auto-spawn the daemon", async () => {
    const e = env();
    const listed = await runMcp(["sessions/list", "--format", "json"], {
      env: e,
    });
    expectCliSuccess(listed);
    expect(JSON.parse(listed.stdout)).toEqual({ sessions: [] });

    const status = await runMcp(["daemon", "status", "--format", "json"], {
      env: e,
    });
    expectCliSuccess(status);
    expect(JSON.parse(status.stdout)).toMatchObject({
      running: false,
      message: "Daemon is not running.",
    });

    // Socket must not have been created by status/list.
    expect(fs.existsSync(path.join(storageDir!, "daemon.sock"))).toBe(false);
  });
});
