import { describe, it, expect, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { runCli } from "./helpers/cli-runner.js";
import {
  expectCliFailure,
  expectCliSuccess,
  expectValidJson,
} from "./helpers/assertions.js";
import { getTestMcpServerCommand } from "@modelcontextprotocol/inspector-test-server";
import {
  createWeightedPicker,
  LOAD_SCENARIO_INVALID,
  parseLoadScenario,
  readLoadScenarioFile,
  validateLoadScenario,
  type LoadScenario,
} from "@inspector/core/cli/handlers/load-scenario.js";
import {
  resolveLoadOptions,
  runLoad,
  runScenarioLoad,
  type LoadCallOutcome,
} from "@inspector/core/cli/handlers/load-test.js";
import type { InspectorClient } from "@inspector/core/mcp/index.js";
import { CliExitCodeError } from "@inspector/core/cli/error-handler.js";

/**
 * `--load-scenario` (#2839): the scenario file's validation, the weighted
 * picker, the engine's per-step breakdown, and end-to-end runs of a mixed
 * scenario through the one-shot CLI.
 */

describe("validateLoadScenario", () => {
  it("accepts an array of steps and fills in names and weights", () => {
    expect(
      validateLoadScenario([
        { method: "tools/call", tool: "echo", args: { message: "hi" } },
        { method: "resources/read", uri: "test://env", weight: 3 },
        {
          method: "prompts/get",
          prompt: "args_prompt",
          args: { city: "Paris" },
          meta: { trace: "x" },
          name: "prompt",
        },
      ]),
    ).toEqual({
      steps: [
        {
          name: "tools/call echo",
          weight: 1,
          method: "tools/call",
          tool: "echo",
          args: { message: "hi" },
        },
        {
          name: "resources/read test://env",
          weight: 3,
          method: "resources/read",
          uri: "test://env",
        },
        {
          name: "prompt",
          weight: 1,
          meta: { trace: "x" },
          method: "prompts/get",
          prompt: "args_prompt",
          args: { city: "Paris" },
        },
      ],
    });
  });

  it("accepts an object with a steps array", () => {
    const { steps } = validateLoadScenario({
      steps: [{ method: "tools/call", tool: "echo" }],
    });
    expect(steps).toHaveLength(1);
  });

  it("numbers unnamed steps that share a target", () => {
    const { steps } = validateLoadScenario([
      { method: "tools/call", tool: "echo", args: { message: "a" } },
      { method: "tools/call", tool: "echo", args: { message: "b" } },
      { method: "tools/call", tool: "echo", name: "tools/call echo #3" },
      { method: "resources/read", uri: "test://env", name: "env" },
      { method: "resources/read", uri: "test://argv" },
    ]);
    expect(steps.map((s) => s.name)).toEqual([
      "tools/call echo #1",
      "tools/call echo #2",
      "tools/call echo #3",
      "env",
      "resources/read test://argv",
    ]);
  });

  it("numbers a default name that collides with an explicit one", () => {
    const { steps } = validateLoadScenario([
      { method: "resources/read", uri: "a", name: "resources/read b" },
      { method: "resources/read", uri: "b" },
    ]);
    expect(steps[1]!.name).toBe("resources/read b #2");
  });

  it.each([
    [
      {},
      'a scenario must be an array of steps, or an object with a "steps" array.',
    ],
    [
      "steps",
      'a scenario must be an array of steps, or an object with a "steps" array.',
    ],
    [{ steps: [], extra: 1 }, 'unknown key "extra" (allowed: steps).'],
    [[], "a scenario needs at least one step."],
    [[1], "step 1 must be a JSON object."],
    [
      [{ method: "tools/list" }],
      'step 1: "method" must be one of tools/call, resources/read, prompts/get.',
    ],
    [
      [{ method: "tools/call", tool: "echo", argument: {} }],
      'step 1: unknown key "argument" for tools/call (allowed: method, name, weight, meta, tool, args).',
    ],
    [
      [{ method: "resources/read", uri: "x", args: {} }],
      'step 1: unknown key "args" for resources/read (allowed: method, name, weight, meta, uri).',
    ],
    [
      [{ method: "tools/call" }],
      'step 1: tools/call needs a non-empty "tool".',
    ],
    [
      [{ method: "resources/read", uri: " " }],
      'step 1: resources/read needs a non-empty "uri".',
    ],
    [
      [{ method: "prompts/get", prompt: 3 }],
      'step 1: prompts/get needs a non-empty "prompt".',
    ],
    [
      [{ method: "tools/call", tool: "e", weight: 0 }],
      'step 1: "weight" must be a positive number.',
    ],
    [
      [{ method: "tools/call", tool: "e", weight: null }],
      'step 1: "weight" must be a positive number.',
    ],
    [
      [{ method: "tools/call", tool: "e", weight: "2" }],
      'step 1: "weight" must be a positive number.',
    ],
    [
      [{ method: "tools/call", tool: "e", name: "" }],
      'step 1: "name" must be a non-empty string.',
    ],
    [
      [{ method: "tools/call", tool: "e", args: [1] }],
      'step 1: "args" must be a JSON object.',
    ],
    [
      [{ method: "prompts/get", prompt: "p", meta: "m" }],
      'step 1: "meta" must be a JSON object.',
    ],
    [
      [
        { method: "tools/call", tool: "e", name: "x" },
        { method: "tools/call", tool: "e", name: "x" },
      ],
      'step 2: duplicate name "x".',
    ],
    [
      [
        { method: "tools/call", tool: "e", name: "tools/call e #2" },
        { method: "tools/call", tool: "e" },
        { method: "tools/call", tool: "e" },
      ],
      'step 2: duplicate name "tools/call e #2".',
    ],
  ])("refuses %j", (value, message) => {
    expect(() => validateLoadScenario(value)).toThrow(message);
  });
});

describe("parseLoadScenario / readLoadScenarioFile", () => {
  let dir: string | undefined;
  afterEach(() => {
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
    dir = undefined;
  });

  function usageError(fn: () => unknown): CliExitCodeError {
    try {
      fn();
    } catch (err) {
      expect(err).toBeInstanceOf(CliExitCodeError);
      return err as CliExitCodeError;
    }
    throw new Error("expected a throw");
  }

  it("names the source and the problem, as a usage error", () => {
    const bad = usageError(() => parseLoadScenario("{", "s.json"));
    expect(bad.message).toMatch(/^--load-scenario s\.json: not valid JSON: /);
    expect(bad.exitCode).toBe(1);
    expect(bad.envelope?.code).toBe(LOAD_SCENARIO_INVALID);
    expect(usageError(() => parseLoadScenario("[]", "s.json")).message).toBe(
      "--load-scenario s.json: a scenario needs at least one step.",
    );
  });

  it("refuses args or meta holding a number that overflows to Infinity", () => {
    for (const key of ["args", "meta"]) {
      const text = `[{"method":"tools/call","tool":"e","${key}":{"n":[1e400]}}]`;
      expect(usageError(() => parseLoadScenario(text, "s.json")).message).toBe(
        `--load-scenario s.json: step 1: "${key}" holds a number JSON cannot represent (overflowing to Infinity).`,
      );
    }
  });

  it("reads a file, and reports one it cannot read", () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "load-scenario-"));
    const file = path.join(dir, "s.json");
    fs.writeFileSync(
      file,
      JSON.stringify([{ method: "tools/call", tool: "echo" }]),
    );
    expect(readLoadScenarioFile(file).steps[0]!.name).toBe("tools/call echo");
    const missing = path.join(dir, "missing.json");
    expect(usageError(() => readLoadScenarioFile(missing)).message).toMatch(
      /^--load-scenario .*missing\.json: cannot be read: /,
    );
  });
});

describe("createWeightedPicker", () => {
  it("interleaves the steps and keeps the mix exact over each cycle", () => {
    const pick = createWeightedPicker([2, 1]);
    expect(Array.from({ length: 6 }, pick)).toEqual([0, 1, 0, 0, 1, 0]);
    const seven = createWeightedPicker([7, 3]);
    const picks = Array.from({ length: 100 }, seven);
    expect(picks.filter((p) => p === 0)).toHaveLength(70);
  });

  it("keeps the mix at weights whose sum overflows", () => {
    const pick = createWeightedPicker([1e308, 1e308]);
    const picks = Array.from({ length: 10 }, pick);
    expect(picks.filter((p) => p === 0)).toHaveLength(5);
  });

  it("handles fractional weights and a single step", () => {
    const pick = createWeightedPicker([0.5, 1.5]);
    const picks = Array.from({ length: 8 }, pick);
    expect(picks.filter((p) => p === 1)).toHaveLength(6);
    const one = createWeightedPicker([4]);
    expect([one(), one()]).toEqual([0, 0]);
  });
});

const SCENARIO: LoadScenario = validateLoadScenario([
  { method: "tools/call", tool: "search", weight: 3 },
  { method: "resources/read", uri: "test://doc", weight: 1 },
]);

describe("runLoad with a scenario", () => {
  it("passes the picked step and breaks the summary down per step", async () => {
    const seen: number[] = [];
    const call = async (_: number, step: number): Promise<LoadCallOutcome> => {
      seen.push(step);
      if (step === 1) throw new Error("not found");
      return seen.length % 2 === 0
        ? { outcome: "tool_error", message: "busy" }
        : "ok";
    };
    const summary = await runLoad(call, {
      concurrency: 1,
      requests: 8,
      scenario: SCENARIO,
    });
    expect(seen).toEqual([0, 0, 1, 0, 0, 0, 1, 0]);
    expect(summary).toMatchObject({ requests: 8, errors: 2 });
    const [search, doc] = summary.steps!;
    expect(search).toMatchObject({
      name: "tools/call search",
      method: "tools/call",
      target: "search",
      weight: 3,
      requests: 6,
      ok: search!.requests - search!.toolErrors,
      errors: 0,
    });
    expect(search!.toolErrorMessages).toEqual([
      { message: "busy", count: search!.toolErrors },
    ]);
    expect(doc).toMatchObject({
      name: "resources/read test://doc",
      method: "resources/read",
      target: "test://doc",
      requests: 2,
      ok: 0,
      errors: 2,
      errorRate: 1,
      latencyMs: null,
      errorMessages: [{ message: "not found", count: 2 }],
    });
    expect(summary.ok + summary.toolErrors).toBe(6);
  });

  it("leaves steps out of a run without a scenario", async () => {
    const summary = await runLoad(async () => "ok", {
      concurrency: 1,
      requests: 2,
    });
    expect(summary).not.toHaveProperty("steps");
  });

  it("carries the scenario through resolveLoadOptions", () => {
    expect(resolveLoadOptions({ requests: 5, scenario: SCENARIO })).toEqual({
      concurrency: 10,
      requests: 5,
      scenario: SCENARIO,
    });
  });
});

describe("runScenarioLoad", () => {
  /** A client that answers reads and prompts, recording what it was asked. */
  function fakeClient(calls: string[]): InspectorClient {
    const client = {
      readResource: async (uri: string, meta: unknown) => {
        calls.push(`read ${uri} ${JSON.stringify(meta)}`);
        return {};
      },
      getPrompt: async (name: string, args: unknown, meta: unknown) => {
        calls.push(`prompt ${name} ${JSON.stringify([args, meta])}`);
        return {};
      },
    };
    // Double cast, justified: InspectorClient is a class with private
    // members, so no plain object can satisfy it structurally. A scenario
    // with no tools/call step skips the tool lookup, so these two methods are
    // all runScenarioLoad reaches; the tools/call path runs end to end below.
    return client as unknown as InspectorClient;
  }

  it("runs resources and prompts with merged metadata and no tool lookup", async () => {
    const calls: string[] = [];
    const scenario = validateLoadScenario([
      { method: "resources/read", uri: "test://a", meta: { step: 1 } },
      { method: "prompts/get", prompt: "p" },
    ]);
    const summary = await runScenarioLoad(
      fakeClient(calls),
      { metadata: { run: "r" } },
      { concurrency: 1, requests: 2 },
      scenario,
    );
    expect(calls).toEqual([
      'read test://a {"run":"r","step":1}',
      'prompt p [{},{"run":"r"}]',
    ]);
    expect(summary.steps!.map((s) => s.ok)).toEqual([1, 1]);
    expect(summary).not.toHaveProperty("tool");
  });
});

describe("--load-scenario (CLI)", () => {
  const { command, args } = getTestMcpServerCommand();
  let dir: string | undefined;
  afterEach(() => {
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
    dir = undefined;
  });

  function scenarioFile(content: unknown): string {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "load-scenario-e2e-"));
    const file = path.join(dir, "scenario.json");
    fs.writeFileSync(
      file,
      typeof content === "string" ? content : JSON.stringify(content),
    );
    return file;
  }

  const base = [command, ...args, "--cli", "--method", "tools/call", "--load"];

  it("runs a weighted mix of tools, resources and prompts", async () => {
    const file = scenarioFile({
      steps: [
        {
          name: "echo",
          method: "tools/call",
          tool: "echo",
          args: { message: "hi" },
          weight: 2,
        },
        { method: "resources/read", uri: "test://env" },
        { method: "prompts/get", prompt: "simple_prompt" },
      ],
    });
    const result = await runCli([
      ...base,
      "--load-scenario",
      file,
      "--load-requests",
      "8",
      "--load-concurrency",
      "2",
    ]);
    expectCliSuccess(result);
    const summary = expectValidJson(result);
    expect(summary).not.toHaveProperty("tool");
    expect(summary).toMatchObject({ requests: 8, ok: 8, errors: 0 });
    expect(
      summary.steps.map((s: { name: string; requests: number; ok: number }) => [
        s.name,
        s.requests,
        s.ok,
      ]),
    ).toEqual([
      ["echo", 4, 4],
      ["resources/read test://env", 2, 2],
      ["prompts/get simple_prompt", 2, 2],
    ]);
  });

  it("fails before loading when a scenario tool does not exist", async () => {
    const file = scenarioFile([{ method: "tools/call", tool: "no_such_tool" }]);
    const result = await runCli([...base, "--load-scenario", file]);
    expect(result.exitCode).toBe(5);
    expect(result.stderr).toContain("Tool 'no_such_tool' not found on server.");
  });

  it("refuses an invalid scenario file as a usage error", async () => {
    const file = scenarioFile([{ method: "tools/call" }]);
    const result = await runCli([...base, "--load-scenario", file]);
    expect(result.exitCode).toBe(1);
    expect(JSON.parse(result.stderr).error.message).toContain(
      'step 1: tools/call needs a non-empty "tool".',
    );
    expect(result.stderr).toContain(LOAD_SCENARIO_INVALID);
  });

  it.each([
    [["--tool-name", "echo"], "--tool-name"],
    [["--tool-arg", "message=hi"], "--tool-arg"],
    [["--tool-args-json", "{}"], "--tool-args-json"],
    [["--tool-metadata", "a=b"], "--tool-metadata"],
  ])("refuses %j alongside a scenario", async (extra, flag) => {
    const file = scenarioFile([{ method: "tools/call", tool: "echo" }]);
    const result = await runCli([...base, "--load-scenario", file, ...extra]);
    expectCliFailure(result);
    expect(result.stderr).toContain(
      `--load-scenario cannot be combined with ${flag}`,
    );
    expect(result.stderr).toContain("load_flag_conflict");
  });

  it("requires --load", async () => {
    const result = await runCli([
      command,
      ...args,
      "--cli",
      "--method",
      "tools/call",
      "--tool-name",
      "echo",
      "--load-scenario",
      "x.json",
    ]);
    expectCliFailure(result);
    expect(result.stderr).toContain("--load-scenario requires --load.");
  });
});
