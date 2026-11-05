import { describe, it, expect } from "vitest";
import {
  CRASHABLE_FLAG,
  createEchoTool,
  createTestServerHttp,
  createTestServerInfo,
  getTestMcpServerCommand,
} from "@modelcontextprotocol/inspector-test-server";
import { runCli } from "./helpers/cli-runner.js";
import {
  expectCliFailure,
  expectCliSuccess,
  expectJsonStructure,
  expectOutputContains,
  expectValidJson,
} from "./helpers/assertions.js";

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

/**
 * A variadic option placed directly before the target (#2860). Commander hands
 * a variadic option every following non-dash token, so the target used to be
 * swallowed as more values ("Invalid parameter format: node"). Each variadic
 * option now keeps only the tokens shaped like its values; the first one that
 * is not starts the target.
 */
describe("variadic options ahead of the target (#2860)", () => {
  const { command, args } = getTestMcpServerCommand();
  const target = [command, ...args];

  it("keeps the target after --tool-arg", async () => {
    const result = await runCli([
      "--format",
      "json",
      "--method",
      "tools/call",
      "--tool-name",
      "echo",
      "--tool-arg",
      "message=hello world",
      ...target,
    ]);
    expectCliSuccess(result);
    expect(expectValidJson(result).result.content[0].text).toBe(
      "Echo: hello world",
    );
  });

  it("keeps every key=value pair in the run and the target after it", async () => {
    const result = await runCli([
      "--method",
      "prompts/get",
      "--prompt-name",
      "args_prompt",
      "--prompt-args",
      "city=New York",
      "state=NY",
      ...target,
    ]);
    expectCliSuccess(result);
    const text = expectValidJson(result).messages[0].content.text;
    expect(text).toContain("city=New York");
    expect(text).toContain("state=NY");
  });

  it.each([["--metadata"], ["--tool-metadata"]])(
    "keeps the target after %s",
    async (flag) => {
      const result = await runCli([
        "--method",
        "tools/call",
        "--tool-name",
        "echo",
        "--tool-arg",
        "message=hi",
        flag,
        "client=test",
        ...target,
      ]);
      expectCliSuccess(result);
      expect(expectValidJson(result).content[0].text).toBe("Echo: hi");
    },
  );

  it("keeps a URL target after --header and still sends the header", async () => {
    const server = createTestServerHttp({
      serverInfo: createTestServerInfo(),
      tools: [createEchoTool()],
    });
    try {
      await server.start();
      const result = await runCli([
        "--method",
        "tools/list",
        "--transport",
        "http",
        "--header",
        "Authorization: Bearer token123",
        "X-Api-Key: secret",
        server.url,
      ]);
      expectCliSuccess(result);
      const requests = server.getRecordedRequests();
      const last = requests[requests.length - 1];
      expect(last?.headers?.authorization).toBe("Bearer token123");
      expect(last?.headers?.["x-api-key"]).toBe("secret");
    } finally {
      await server.stop();
    }
  });

  it("still reports a malformed first value as the option's", async () => {
    const result = await runCli([
      "--method",
      "tools/call",
      "--tool-name",
      "echo",
      "--tool-arg",
      ...target,
    ]);
    expectCliFailure(result);
    expectOutputContains(result, `Invalid parameter format: ${command}`);
  });

  it("leaves a variadic option with no value to Commander", async () => {
    const result = await runCli([
      ...target,
      "--method",
      "tools/list",
      "--tool-arg",
    ]);
    expectCliFailure(result);
    expectOutputContains(result, "argument missing");
  });

  it("takes the first value even when it looks like an option, as Commander does", async () => {
    const result = await runCli([
      ...target,
      "--method",
      "tools/list",
      "--tool-arg",
      "--format",
      "json",
    ]);
    expectCliFailure(result);
    expectOutputContains(result, "Invalid parameter format: --format");
  });
});
