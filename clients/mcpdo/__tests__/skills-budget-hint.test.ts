/**
 * mcpdo names its OWN remedies for a skill `--verify` left unread under the
 * catalog budget (#2633).
 *
 * The walk is shared core, and the message once hard-coded the web's Skills
 * settings and the one-shot CLI's `--method skills/get --uri` — so an mcpdo
 * user was sent to a screen and a flag mcpdo does not have. The daemon now
 * passes mcpdo's hint into `runMethod`; this runs it end to end and then runs
 * the command the message suggests back through mcpdo, since that text is the
 * only route the user has to a verdict for the skipped skill.
 */
import { describe, it, expect, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  createTestServerHttp,
  createTestServerInfo,
} from "@modelcontextprotocol/inspector-test-server";
import type { SkillVerifyReport } from "@inspector/core/mcp/skillsVerification.js";
import { runMcp, type McpResult } from "./helpers/mcp-runner.js";
import {
  createTestConfig,
  deleteConfigFile,
} from "../../cli/__tests__/helpers/fixtures.js";
import { expectCliSuccess } from "../../cli/__tests__/helpers/assertions.js";
import { callDaemon } from "../src/daemon/client.js";

/**
 * The reports of a `--verify` run under `--format json`, which mcpdo prints as
 * one JSON array — or a failure naming what the run printed instead.
 */
function reportsOf(result: McpResult): SkillVerifyReport[] {
  try {
    return JSON.parse(result.stdout) as SkillVerifyReport[];
  } catch {
    throw new Error(
      `not a --verify report (exit ${result.exitCode}):\n${result.output}`,
    );
  }
}

describe("mcpdo skills catalog-budget hint (#2633)", () => {
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
      }
      fs.rmSync(storageDir, { recursive: true, force: true });
      storageDir = undefined;
    }
    if (configPath) {
      deleteConfigFile(configPath);
      configPath = undefined;
    }
  });

  it("names mcpdo's remedies, and the suggested command verifies the skipped skill", async () => {
    const server = createTestServerHttp({
      serverInfo: createTestServerInfo("skills-budget", "1.0.0"),
      skills: true,
    });
    try {
      await server.start();
      configPath = createTestConfig({
        mcpServers: {
          skills: {
            type: "streamable-http",
            url: server.url,
            skillCatalogMaxSkills: 1,
          },
        },
      });
      storageDir = fs.mkdtempSync(path.join(os.tmpdir(), "mcpdo-budget-"));
      const env = {
        MCP_STORAGE_DIR: storageDir,
        MCP_INSPECTOR_DAEMON_DIR: storageDir,
      };

      expectCliSuccess(
        await runMcp(
          ["connect", "skills", "--config", configPath, "--format", "json"],
          { env, timeout: 20000 },
        ),
      );

      const listed = await runMcp(
        ["@skills", "skills/list", "--verify", "--format", "json"],
        { env, timeout: 20000 },
      );
      const skipped = reportsOf(listed).find((report) =>
        report.incomplete?.includes("catalog budget"),
      );
      if (!skipped) throw new Error(`no skipped skill in: ${listed.output}`);
      // mcpdo's own remedies — not the web's settings screen, nor the
      // one-shot CLI's flags and `--method` syntax.
      expect(skipped.incomplete).toContain(
        "raise it with skillCatalogMaxSkills / skillCatalogMaxBytes in the connection's catalog entry",
      );
      expect(skipped.incomplete).toContain(
        "`mcpdo @<conn> skills/get <uri> --verify`",
      );
      expect(skipped.incomplete).not.toMatch(
        /--method|--skill-catalog-max|Skills settings/,
      );
      expect(skipped.incomplete).not.toContain(skipped.uri);

      // Run the suggested command back, placeholders filled the way a user
      // would fill them, minus the `mcpdo` program name itself.
      const command = /`([^`]+)`/.exec(skipped.incomplete ?? "")?.[1] ?? "";
      const argv = command
        .split(/\s+/)
        .slice(1)
        .map((arg) =>
          arg === "@<conn>" ? "@skills" : arg === "<uri>" ? skipped.uri : arg,
        );
      const got = await runMcp([...argv, "--format", "json"], {
        env,
        timeout: 20000,
      });
      const reports = reportsOf(got);
      expect(reports).toHaveLength(1);
      expect(reports[0].uri).toBe(skipped.uri);
      expect(reports[0].incomplete ?? "").not.toMatch(/catalog budget/);
      expect(reports[0].files.length).toBeGreaterThan(0);
    } finally {
      await server.stop();
    }
  });
});
