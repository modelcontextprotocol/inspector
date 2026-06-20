import { describe, it, expect } from "vitest";
import { getTestMcpServerCommand } from "@modelcontextprotocol/inspector-test-server";
import { runCli } from "./helpers/cli-runner.js";
import {
  expectCliSuccess,
  expectCliFailure,
  expectJsonStructure,
  expectOutputContains,
} from "./helpers/assertions.js";

/**
 * Covers the CLI method and option-validation branches that the broader
 * integration suites don't reach, keeping `src/cli.ts` above the per-file
 * coverage gate (#1484). All connect to the bundled stdio test server, whose
 * default config advertises resource templates, prompts, and logging.
 */
describe("CLI method coverage", () => {
  const { command, args } = getTestMcpServerCommand();

  it("lists resource templates", async () => {
    const result = await runCli([
      command,
      ...args,
      "--cli",
      "--method",
      "resources/templates/list",
    ]);

    expectCliSuccess(result);
    const json = expectJsonStructure(result, ["resourceTemplates"]);
    expect(Array.isArray(json.resourceTemplates)).toBe(true);
    expect(json.resourceTemplates.length).toBeGreaterThan(0);
  });

  it("rejects logging/setLevel without a --log-level", async () => {
    const result = await runCli([
      command,
      ...args,
      "--cli",
      "--method",
      "logging/setLevel",
    ]);

    expectCliFailure(result);
    expectOutputContains(result, "Log level is required");
  });

  it("treats args before a `--` separator as the server target", async () => {
    const result = await runCli([
      command,
      ...args,
      "--",
      "--method",
      "tools/list",
    ]);

    expectCliSuccess(result);
    const json = expectJsonStructure(result, ["tools"]);
    expect(Array.isArray(json.tools)).toBe(true);
  });

  it("rejects an invalid --transport value before connecting", async () => {
    const result = await runCli([
      command,
      ...args,
      "--cli",
      "--method",
      "tools/list",
      "--transport",
      "carrier-pigeon",
    ]);

    expectCliFailure(result);
    expectOutputContains(result, "Invalid transport type");
  });

  it("surfaces a commander usage error (missing option argument) as a failure", async () => {
    // `--method` with no value makes commander call its own error-exit path;
    // exitOverride re-throws it (exitCode !== 0) so the in-process runner can
    // catch it instead of the worker being torn down.
    const result = await runCli([command, ...args, "--method"]);

    expectCliFailure(result);
    expectOutputContains(result, "argument missing");
  });
});
