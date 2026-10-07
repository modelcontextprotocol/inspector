import { describe, it, expect, afterEach, beforeAll } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { runMcp } from "./helpers/mcp-runner.js";
import {
  expectCliSuccess,
  expectCliFailure,
} from "../../cli/__tests__/helpers/assertions.js";
import { resolveDaemonScriptPath } from "../src/daemon/ensure.js";
import { callDaemon } from "../src/daemon/client.js";
import type { ElicitationPendingInfo } from "../src/daemon/protocol.js";

/**
 * End-to-end non-interactive elicitation: a real daemon, a real composable
 * test server (stdio) whose `collect_elicitation` tool sends a legacy
 * `elicitation/create` mid-call, a non-TTY front-end that gets the exchange
 * parked (`elicitationPending`), and `elicitation/respond` resuming the call
 * to its final result.
 */
describe("mcp non-interactive elicitation (e2e)", () => {
  let storageDir: string | undefined;
  let configPath: string | undefined;
  const ttyDescriptors: Array<{
    stream: NodeJS.ReadStream | NodeJS.WriteStream;
    desc: PropertyDescriptor | undefined;
  }> = [];

  beforeAll(() => {
    expect(fs.existsSync(resolveDaemonScriptPath())).toBe(true);
  });

  afterEach(async () => {
    for (const { stream, desc } of ttyDescriptors.splice(0)) {
      if (desc) Object.defineProperty(stream, "isTTY", desc);
    }
    if (storageDir) {
      const socketPath = path.join(storageDir, "mcpdod.sock");
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
      fs.rmSync(configPath, { force: true });
      configPath = undefined;
    }
  });

  /** runMcp is in-process: force the non-TTY (parking) path regardless of
   * how vitest itself was launched. */
  function stubNonTty(): void {
    for (const stream of [process.stdin, process.stderr] as const) {
      ttyDescriptors.push({
        stream,
        desc: Object.getOwnPropertyDescriptor(stream, "isTTY"),
      });
      Object.defineProperty(stream, "isTTY", {
        configurable: true,
        value: undefined,
      });
    }
  }

  function env(): Record<string, string> {
    storageDir = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-elicit-e2e-"));
    return {
      MCP_STORAGE_DIR: storageDir,
      MCP_INSPECTOR_DAEMON_DIR: storageDir,
      MCP_ALLOW_DEFAULT_CONNECTION: "1",
    };
  }

  function elicitServerArgs(): string[] {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const serverScript = path.resolve(
      here,
      "../../../test-servers/build/server-composable.js",
    );
    expect(fs.existsSync(serverScript)).toBe(true);
    configPath = path.join(
      os.tmpdir(),
      `elicit-server-${process.pid}-${Date.now()}.json`,
    );
    fs.writeFileSync(
      configPath,
      JSON.stringify({
        serverInfo: { name: "elicit-e2e", version: "1.0.0" },
        tools: [{ preset: "collect_elicitation" }],
        transport: { type: "stdio" },
      }),
    );
    return ["node", serverScript, "--config", configPath];
  }

  it("parks a legacy form elicitation and elicitation/respond resumes to the tool result", async () => {
    const e = env();
    stubNonTty();

    const connected = await runMcp(
      [
        "connect",
        "--connection",
        "el",
        "--transport",
        "stdio",
        "--format",
        "json",
        "--",
        ...elicitServerArgs(),
      ],
      { env: e, timeout: 20000 },
    );
    expectCliSuccess(connected);

    const parked = await runMcp(
      [
        "tools/call",
        "collect_elicitation",
        "message:=Pick a color",
        'schema:={"type":"object","properties":{"color":{"type":"string"}},"required":["color"]}',
        "--format",
        "json",
        "--connection",
        "el",
      ],
      { env: e, timeout: 20000 },
    );
    expectCliSuccess(parked);
    const pending = JSON.parse(parked.stdout) as {
      elicitationPending: ElicitationPendingInfo;
    };
    expect(pending.elicitationPending).toMatchObject({
      connection: "el",
      method: "tools/call",
      toolName: "collect_elicitation",
      mode: "form",
      message: "Pick a color",
    });
    const id = pending.elicitationPending.elicitationId;
    expect(id).toBeTruthy();

    // The connection refuses new rpcs while the call is parked.
    const blocked = await runMcp(
      ["tools/list", "--format", "json", "--connection", "el"],
      { env: e, timeout: 20000 },
    );
    expectCliFailure(blocked);
    expect(blocked.output).toContain(`elicitation/respond ${id}`);

    const done = await runMcp(
      ["elicitation/respond", id, "color:=teal", "--format", "json"],
      { env: e, timeout: 20000 },
    );
    expectCliSuccess(done);
    expect(done.stdout).toContain("accept");
    expect(done.stdout).toContain("teal");
  }, 40000);

  it("validates flag exclusivity before contacting the daemon", async () => {
    const e = env();
    stubNonTty();
    const conflicting = await runMcp(
      ["elicitation/respond", "e-1", "--done", "--cancel"],
      { env: e, timeout: 10000 },
    );
    expectCliFailure(conflicting);
    expect(conflicting.output).toContain("exactly one of");

    const empty = await runMcp(["elicitation/respond", "e-1"], {
      env: e,
      timeout: 10000,
    });
    expectCliFailure(empty);
    expect(empty.output).toContain("key:=value");
  });
});
