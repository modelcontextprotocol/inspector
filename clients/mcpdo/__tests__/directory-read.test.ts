/**
 * mcpdo `resources/directory/read` takes a URI and a cursor (#2767).
 *
 * The subcommand once registered neither, so the handler's "URI is required"
 * error was the only outcome: `--uri` was an unknown option and a positional
 * URI was "too many arguments". This drives it end to end against a real
 * skills server — positional URI, `--uri`, and the `nextCursor` of the first
 * page passed back through `--cursor`.
 */
import { describe, it, expect, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  createTestServerHttp,
  createTestServerInfo,
} from "@modelcontextprotocol/inspector-test-server";
import { runMcp, type McpResult } from "./helpers/mcp-runner.js";
import {
  createTestConfig,
  deleteConfigFile,
} from "../../cli/__tests__/helpers/fixtures.js";
import { expectCliSuccess } from "../../cli/__tests__/helpers/assertions.js";
import { callDaemon } from "../src/daemon/client.js";

/** Budget for each mcpdo command, matching the sibling suites' `runMcp` calls. */
const COMMAND_TIMEOUT_MS = 20_000;
/**
 * Five commands run in sequence, so the test's own budget must exceed them all
 * together, or Vitest cuts in before a slow command's own timer can name it
 * (see AGENTS.md "Test-gate timeouts").
 */
const TEST_TIMEOUT_MS = 5 * COMMAND_TIMEOUT_MS + 10_000;

/** The skills fixture's directory resource (no trailing slash). */
const DIRECTORY_URI = "skill://data-analysis";

interface DirectoryPage {
  resources: { uri: string }[];
  nextCursor?: string;
  ttlMs?: number;
  cacheScope?: string;
}

function pageOf(result: McpResult): DirectoryPage {
  expectCliSuccess(result);
  try {
    return JSON.parse(result.stdout) as DirectoryPage;
  } catch {
    throw new Error(
      `not a directory page (exit ${result.exitCode}):\n${result.output}`,
    );
  }
}

describe("mcpdo resources/directory/read (#2767)", () => {
  let storageDir: string | undefined;
  let configPath: string | undefined;

  afterEach(async () => {
    if (storageDir) {
      const socketPath = path.join(storageDir, "mcpdod.sock");
      if (fs.existsSync(socketPath)) {
        try {
          await callDaemon("daemon/stop", {}, { socketPath, timeoutMs: 2000 });
        } catch {
          // already stopped
        }
        // `daemon/stop` answers before shutdown finishes, so wait for the
        // socket to go before deleting the directory a live daemon holds.
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

  it(
    "reads a directory by positional URI or --uri, and pages with --cursor",
    async () => {
      const server = createTestServerHttp({
        serverInfo: createTestServerInfo("skills-directory", "1.0.0"),
        skills: true,
      });
      try {
        await server.start();
        configPath = createTestConfig({
          mcpServers: {
            skills: { type: "streamable-http", url: server.url },
          },
        });
        storageDir = fs.mkdtempSync(path.join(os.tmpdir(), "mcpdo-dirread-"));
        const env = {
          MCP_STORAGE_DIR: storageDir,
          MCP_INSPECTOR_DAEMON_DIR: storageDir,
        };

        expectCliSuccess(
          await runMcp(
            ["connect", "skills", "--config", configPath, "--format", "json"],
            { env, timeout: COMMAND_TIMEOUT_MS },
          ),
        );

        const positional = pageOf(
          await runMcp(
            [
              "@skills",
              "resources/directory/read",
              DIRECTORY_URI,
              "--format",
              "json",
            ],
            { env, timeout: COMMAND_TIMEOUT_MS },
          ),
        );
        expect(positional.resources.length).toBeGreaterThan(0);
        expect(
          positional.resources.every((r) =>
            r.uri.startsWith(`${DIRECTORY_URI}/`),
          ),
        ).toBe(true);
        // The result is returned whole, so #2740's cacheable fields reach it.
        expect(positional.ttlMs).toBeTypeOf("number");
        expect(positional.cacheScope).toBeTypeOf("string");

        const flag = pageOf(
          await runMcp(
            [
              "@skills",
              "resources/directory/read",
              "--uri",
              DIRECTORY_URI,
              "--format",
              "json",
            ],
            { env, timeout: COMMAND_TIMEOUT_MS },
          ),
        );
        expect(flag.resources).toEqual(positional.resources);

        // The fixture pages its directory, so the first page hands back a
        // cursor; passing it back must return a different page.
        const cursor = positional.nextCursor;
        if (cursor === undefined) {
          throw new Error("the skills fixture's first page has no nextCursor");
        }
        const next = pageOf(
          await runMcp(
            [
              "@skills",
              "resources/directory/read",
              DIRECTORY_URI,
              "--cursor",
              cursor,
              "--format",
              "json",
            ],
            { env, timeout: COMMAND_TIMEOUT_MS },
          ),
        );
        expect(next.resources.length).toBeGreaterThan(0);
        expect(next.resources).not.toEqual(positional.resources);
      } finally {
        await server.stop();
      }
    },
    TEST_TIMEOUT_MS,
  );
});
