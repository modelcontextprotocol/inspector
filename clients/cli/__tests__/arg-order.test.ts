import { describe, it, expect } from "vitest";
import {
  CRASHABLE_FLAG,
  getTestMcpServerCommand,
} from "@modelcontextprotocol/inspector-test-server";
import { runCli } from "./helpers/cli-runner.js";
import { expectCliSuccess, expectJsonStructure } from "./helpers/assertions.js";

/**
 * Where an ad-hoc stdio target may sit relative to the Inspector's own
 * options, and how arguments reach the server (#2631). The target is whatever
 * Commander does not consume as an Inspector option, so option order around it
 * does not matter and a flag the Inspector does not define is forwarded.
 *
 * The crashable test server is the probe for "did the argument reach the
 * server": started with `--crashable` it advertises a `crash_server` tool the
 * default configuration does not.
 */
describe("CLI argument order (#2631)", () => {
  const { command, args } = getTestMcpServerCommand();
  const target = [command, ...args];

  async function toolNames(argv: string[]): Promise<string[]> {
    const result = await runCli(argv);
    expectCliSuccess(result);
    const json = expectJsonStructure(result, ["tools"]);
    return (json.tools as { name: string }[]).map((tool) => tool.name);
  }

  it.each([
    ["-q"],
    ["--quiet"],
    ["--strict"],
    ["--advertise-apps"],
    ["--stored-auth-only"],
    ["--format", "json"],
  ])("keeps the target when %s precedes it", async (...flag) => {
    const result = await runCli([...flag, ...target, "--method", "tools/list"]);
    expectCliSuccess(result);
    expect(result.stdout).toContain('"echo"');
  });

  it("keeps the target when --method precedes it", async () => {
    expect(await toolNames(["--method", "tools/list", ...target])).toContain(
      "echo",
    );
  });

  it("forwards an unknown flag after the target to the server", async () => {
    const names = await toolNames([
      ...target,
      CRASHABLE_FLAG,
      "--method",
      "tools/list",
    ]);
    expect(names).toContain("crash_server");
  });

  it("does not forward a known option placed between target tokens", async () => {
    const names = await toolNames([command, "--method", "tools/list", ...args]);
    expect(names).toContain("echo");
    expect(names).not.toContain("crash_server");
  });

  it("appends everything after `--` to the target when an option leads", async () => {
    const names = await toolNames([
      "-q",
      ...target,
      "--method",
      "tools/list",
      "--",
      CRASHABLE_FLAG,
    ]);
    expect(names).toContain("crash_server");
  });

  it("takes the whole target from after a leading `--`", async () => {
    const names = await toolNames([
      "--method",
      "tools/list",
      "--",
      ...target,
      CRASHABLE_FLAG,
    ]);
    expect(names).toContain("crash_server");
  });

  it("keeps the documented `<target> -- <options>` form", async () => {
    // Before `--` the target is taken verbatim, flags included; after it come
    // the Inspector's options, and an unknown flag there still reaches the
    // server.
    const names = await toolNames([
      ...target,
      "--",
      "--method",
      "tools/list",
      CRASHABLE_FLAG,
    ]);
    expect(names).toContain("crash_server");

    const verbatim = await toolNames([
      ...target,
      CRASHABLE_FLAG,
      "--",
      "--method",
      "tools/list",
    ]);
    expect(verbatim).toContain("crash_server");
  });

  it("drops unknown flags ahead of the target instead of running them", async () => {
    const names = await toolNames([
      "--not-an-inspector-flag",
      ...target,
      "--method",
      "tools/list",
    ]);
    expect(names).toContain("echo");
    expect(names).not.toContain("crash_server");
  });
});
