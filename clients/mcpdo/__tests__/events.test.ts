/**
 * mcpdo `events/list`, `events/poll` and `events/stream` (#3032), end to end
 * against the phase 0 Events fixture over a real Streamable HTTP connection
 * held by the daemon.
 *
 * `events/stream` is the case only mcpdo has: a push subscription on the
 * daemon's long-lived connection. It is driven to its natural end — the
 * fixture's `remove_event_type` terminates the stream with `NotFound`, and the
 * stream closes after its `terminated` line — so the command returns without a
 * signal and its whole output can be asserted.
 */
import { describe, it, expect, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import {
  createTestServerHttp,
  loadConfig,
  resolveConfig,
  EVENT_TYPE_NAMES,
  EVENTS_CONTROL_TOOL_NAMES,
  type TestServerHttp,
} from "@modelcontextprotocol/inspector-test-server";
import { InspectorClient } from "@inspector/core/mcp/index.js";
import { createTransportNode } from "@inspector/core/mcp/node/transport.js";
import { eraToVersionNegotiation } from "@inspector/core/mcp/types.js";
import { runMcp, type McpResult } from "./helpers/mcp-runner.js";
import {
  createTestConfig,
  deleteConfigFile,
} from "../../cli/__tests__/helpers/fixtures.js";
import {
  expectCliFailure,
  expectCliSuccess,
} from "../../cli/__tests__/helpers/assertions.js";
import { removeDaemonDir, stopDaemonIn } from "./helpers/daemon-endpoint.js";

/** Budget for each mcpdo command, matching the sibling suites. */
const COMMAND_TIMEOUT_MS = 20_000;
/** Several commands run in sequence; the test's own budget must exceed them. */
const TEST_TIMEOUT_MS = 6 * COMMAND_TIMEOUT_MS + 10_000;

const MODERN_CONFIG = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../test-servers/configs/events-modern-http.json",
);

function jsonOf<T>(result: McpResult): T {
  expectCliSuccess(result);
  return JSON.parse(result.stdout) as T;
}

/**
 * The stream's `--format json` objects. mcpdo pretty-prints each one, so an
 * object spans several lines: accumulate until the text parses.
 */
function streamObjects(result: McpResult): Record<string, unknown>[] {
  const objects: Record<string, unknown>[] = [];
  let pending = "";
  for (const line of result.stdout.split("\n")) {
    pending += line + "\n";
    if (line.startsWith("}")) {
      objects.push(JSON.parse(pending) as Record<string, unknown>);
      pending = "";
    }
  }
  return objects;
}

describe("mcpdo events/* (#3032)", () => {
  let storageDir: string | undefined;
  let configPath: string | undefined;
  let server: TestServerHttp | undefined;
  let control: InspectorClient | undefined;

  afterEach(async () => {
    await control?.disconnect().catch(() => {});
    control = undefined;
    if (storageDir) {
      await stopDaemonIn(storageDir);
      await removeDaemonDir(storageDir);
      storageDir = undefined;
    }
    if (configPath) {
      deleteConfigFile(configPath);
      configPath = undefined;
    }
    await server?.stop().catch(() => {});
    server = undefined;
  });

  async function callControl(
    name: string,
    args: Record<string, string | number> = {},
  ): Promise<Record<string, unknown> | undefined> {
    const tool = (await control!.listAllTools()).tools.find(
      (t) => t.name === name,
    );
    if (!tool) throw new Error(`fixture tool ${name} not listed`);
    const result = await control!.callTool(tool, args);
    expect(result.success).toBe(true);
    const content: unknown = result.result?.structuredContent;
    return content !== null && typeof content === "object"
      ? (content as Record<string, unknown>)
      : undefined;
  }

  it(
    "lists, polls and streams over the daemon's connection",
    async () => {
      server = createTestServerHttp({
        ...resolveConfig(loadConfig(MODERN_CONFIG)),
        port: undefined,
      });
      await server.start();
      control = new InspectorClient(
        { type: "streamable-http", url: server.url },
        {
          environment: { transport: createTransportNode },
          versionNegotiation: eraToVersionNegotiation("modern"),
        },
      );
      await control.connect();

      configPath = createTestConfig({
        mcpServers: { ev: { type: "streamable-http", url: server.url } },
      });
      storageDir = fs.mkdtempSync(path.join(os.tmpdir(), "mcpdo-events-"));
      const env = {
        MCP_STORAGE_DIR: storageDir,
        MCP_INSPECTOR_DAEMON_DIR: storageDir,
      };
      const run = (args: string[]) =>
        runMcp(["@ev", ...args], { env, timeout: COMMAND_TIMEOUT_MS });

      expectCliSuccess(
        await runMcp(
          [
            "connect",
            "ev",
            "--config",
            configPath,
            "--era",
            "modern",
            "--format",
            "json",
          ],
          { env, timeout: COMMAND_TIMEOUT_MS },
        ),
      );

      // events/list — every page, with the excluded type reported.
      const listed = jsonOf<{
        events: { name: string }[];
        excluded: { name: string }[];
      }>(await run(["events/list", "--format", "json"]));
      expect(listed.events.map((e) => e.name)).toContain(
        EVENT_TYPE_NAMES.allModes,
      );
      expect(listed.excluded.map((e) => e.name)).toEqual([
        EVENT_TYPE_NAMES.invalidHeader,
      ]);

      // events/poll — positional name and key:=value argument, from a cursor.
      await callControl(EVENTS_CONTROL_TOOL_NAMES.emit, {
        name: EVENT_TYPE_NAMES.headerAnnotated,
      });
      const polled = jsonOf<{ events: { name: string }[]; cursor: string }>(
        await run([
          "events/poll",
          EVENT_TYPE_NAMES.headerAnnotated,
          "region:=us-west1",
          "--cursor",
          "cur_0",
          "--format",
          "json",
        ]),
      );
      expect(polled.events.map((e) => e.name)).toEqual([
        EVENT_TYPE_NAMES.headerAnnotated,
      ]);
      expect(polled.cursor).toBe("cur_1");

      // The human form names the cursor to pass back.
      const human = await run([
        "events/poll",
        "--event-name",
        EVENT_TYPE_NAMES.pollOnly,
      ]);
      expectCliSuccess(human);
      expect(human.stdout).toContain("cursor:");

      // events/stream — replay the backlog from cur_0, then end it by removing
      // the type once the fixture holds the stream open.
      await callControl(EVENTS_CONTROL_TOOL_NAMES.emit, {
        name: EVENT_TYPE_NAMES.allModes,
        count: 2,
      });
      const streaming = run([
        "events/stream",
        EVENT_TYPE_NAMES.allModes,
        "--cursor",
        "cur_0",
        "--format",
        "json",
      ]);
      await expect
        .poll(
          async () =>
            (await callControl(EVENTS_CONTROL_TOOL_NAMES.stats))?.openStreams,
          { timeout: COMMAND_TIMEOUT_MS / 2, interval: 100 },
        )
        .toBe(1);
      await callControl(EVENTS_CONTROL_TOOL_NAMES.removeType, {
        name: EVENT_TYPE_NAMES.allModes,
      });
      const streamed = await streaming;
      expectCliSuccess(streamed);
      const lines = streamObjects(streamed);
      expect(lines[0]).toMatchObject({
        type: "subscribed",
        name: EVENT_TYPE_NAMES.allModes,
      });
      expect(lines.filter((l) => l.type === "event")).toHaveLength(2);
      expect(lines.at(-1)).toMatchObject({
        type: "terminated",
        reason: "removed",
      });
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "refuses an event type the connection cannot poll",
    async () => {
      server = createTestServerHttp({
        ...resolveConfig(loadConfig(MODERN_CONFIG)),
        port: undefined,
      });
      await server.start();
      configPath = createTestConfig({
        mcpServers: { ev: { type: "streamable-http", url: server.url } },
      });
      storageDir = fs.mkdtempSync(path.join(os.tmpdir(), "mcpdo-events-"));
      const env = {
        MCP_STORAGE_DIR: storageDir,
        MCP_INSPECTOR_DAEMON_DIR: storageDir,
      };
      // Legacy era (the default): the extension is not offered at all.
      expectCliSuccess(
        await runMcp(["connect", "ev", "--config", configPath], {
          env,
          timeout: COMMAND_TIMEOUT_MS,
        }),
      );
      const refused = await runMcp(["@ev", "events/list"], {
        env,
        timeout: COMMAND_TIMEOUT_MS,
      });
      expectCliFailure(refused);
      expect(refused.stderr).toContain("io.modelcontextprotocol/events");
    },
    TEST_TIMEOUT_MS,
  );
});
