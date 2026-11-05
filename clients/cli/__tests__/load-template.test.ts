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
import {
  createEchoTool,
  createTestServerHttp,
  createTestServerInfo,
} from "@modelcontextprotocol/inspector-test-server";
import {
  assertLoadArgsTemplate,
  checkLoadTemplate,
  compileLoadTemplate,
  LOAD_ARGS_INVALID,
  loadArgsTemplate,
  loadTemplateOrConstant,
  parseLoadArgsRows,
  readLoadArgsFile,
} from "@inspector/core/cli/handlers/load-template.js";
import { validateLoadScenario } from "@inspector/core/cli/handlers/load-scenario.js";
import {
  resolveLoadOptions,
  runLoad,
} from "@inspector/core/cli/handlers/load-test.js";
import { CliExitCodeError } from "@inspector/core/cli/error-handler.js";

/**
 * Varying `--load` arguments (#2840): placeholders, the args file, and their
 * use by the engine and both front ends' one-shot CLI path.
 */

const ctx = { seq: 7, worker: 2 };
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe("compileLoadTemplate", () => {
  it("returns undefined for a value with no placeholder", () => {
    expect(compileLoadTemplate("plain")).toBeUndefined();
    expect(compileLoadTemplate("{{name}} and {{ seq }}")).toBeUndefined();
    expect(compileLoadTemplate({ a: [1, true, null, "x"] })).toBeUndefined();
    expect(compileLoadTemplate(3)).toBeUndefined();
  });

  it("turns a whole numeric placeholder into a number", () => {
    expect(compileLoadTemplate("{{seq}}")!(ctx)).toBe(7);
    expect(compileLoadTemplate("{{worker}}")!(ctx)).toBe(2);
    expect(compileLoadTemplate("{{rand:5-5}}")!(ctx)).toBe(5);
  });

  it("substitutes inside a string and leaves other braces alone", () => {
    expect(compileLoadTemplate("id-{{seq}}/w{{worker}} {{name}}")!(ctx)).toBe(
      "id-7/w2 {{name}}",
    );
    expect(compileLoadTemplate("{{uuid}}")!(ctx)).toMatch(UUID);
    const two = compileLoadTemplate("{{uuid}} {{uuid}}")!(ctx) as string;
    const [a, b] = two.split(" ");
    expect(a).not.toBe(b);
  });

  it("draws rand from the injected source, inclusive at both ends", () => {
    const low = compileLoadTemplate("{{rand:-3-4}}", () => 0)!;
    const high = compileLoadTemplate("{{rand:-3-4}}", () => 0.9999)!;
    expect(low(ctx)).toBe(-3);
    expect(high(ctx)).toBe(4);
    expect(compileLoadTemplate("r{{rand:1-10}}", () => 0.5)!(ctx)).toBe("r6");
  });

  it("walks objects and arrays, sharing what is not templated", () => {
    const shared = { keep: true };
    const t = compileLoadTemplate({
      id: "{{seq}}",
      list: ["a", "k{{worker}}"],
      shared,
      n: 1,
    })!;
    const out = t(ctx) as Record<string, unknown>;
    expect(out).toEqual({ id: 7, list: ["a", "k2"], shared, n: 1 });
    expect(out.shared).toBe(shared);
  });

  it("copies an own __proto__ key as data", () => {
    const value = JSON.parse('{"__proto__":{"tenant":"a"},"id":"{{seq}}"}');
    const out = compileLoadTemplate(value)!(ctx);
    expect(JSON.parse(JSON.stringify(out))).toEqual(
      JSON.parse('{"__proto__":{"tenant":"a"},"id":7}'),
    );
    expect(Object.getPrototypeOf(out)).toBe(Object.prototype);
  });

  it("loadTemplateOrConstant returns the value itself when constant", () => {
    const value = { a: 1 };
    expect(loadTemplateOrConstant(value)(ctx)).toBe(value);
  });
});

describe("checkLoadTemplate", () => {
  it("accepts good ranges and anything without one", () => {
    expect(() =>
      checkLoadTemplate({ a: ["{{rand:1-2}}", 3], b: null }, "args"),
    ).not.toThrow();
    // The widest span allowed: exactly MAX_SAFE_INTEGER values.
    expect(() =>
      checkLoadTemplate("{{rand:0-9007199254740990}}", "args"),
    ).not.toThrow();
  });

  it.each([
    [
      "{{rand:9-1}}",
      "args.x: {{rand:9-1}} needs safe integer bounds with min <= max and a span",
    ],
    [
      "{{rand:1-99999999999999999999}}",
      "args.x: {{rand:1-99999999999999999999}} needs safe integer bounds with min <= max and a span",
    ],
    [
      "{{rand:-9007199254740991-1}}",
      "args.x: {{rand:-9007199254740991-1}} needs safe integer bounds with min <= max and a span",
    ],
  ])("refuses %s", (bad, message) => {
    expect(() => checkLoadTemplate({ x: bad }, "args")).toThrow(message);
    expect(() => checkLoadTemplate([{ x: bad }], "args")).toThrow();
  });

  it("raises a usage error through assertLoadArgsTemplate", () => {
    try {
      assertLoadArgsTemplate({ x: "{{rand:2-1}}" }, "--tool-arg");
      throw new Error("expected a throw");
    } catch (err) {
      expect(err).toBeInstanceOf(CliExitCodeError);
      expect((err as CliExitCodeError).exitCode).toBe(1);
      expect((err as CliExitCodeError).envelope?.code).toBe(LOAD_ARGS_INVALID);
    }
  });

  it("is applied to scenario args and uris", () => {
    expect(() =>
      validateLoadScenario([
        { method: "tools/call", tool: "e", args: { n: "{{rand:3-1}}" } },
      ]),
    ).toThrow("step 1 args.n: {{rand:3-1}}");
    expect(() =>
      validateLoadScenario([
        { method: "resources/read", uri: "x/{{rand:3-1}}" },
      ]),
    ).toThrow("step 1 uri: {{rand:3-1}}");
  });
});

describe("parseLoadArgsRows / readLoadArgsFile", () => {
  let dir: string | undefined;
  afterEach(() => {
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
    dir = undefined;
  });

  it("reads one object per line, skipping blank lines", () => {
    expect(parseLoadArgsRows('{"a":1}\r\n\n  \n{"a":"{{seq}}"}\n')).toEqual([
      { a: 1 },
      { a: "{{seq}}" },
    ]);
  });

  it.each([
    ["{", /^line 1: not valid JSON: /],
    ['{"a":1}\n[1]', /^line 2: each line must be a JSON object\.$/],
    ["null", /^line 1: each line must be a JSON object\.$/],
    ['{"a":1e400}', /^line 1: holds a number JSON cannot represent/],
    ['{"a":"{{rand:2-1}}"}', /^line 1\.a: \{\{rand:2-1\}\} needs/],
    ["\n\n", /^the file holds no argument rows\.$/],
  ])("refuses %j", (text, message) => {
    expect(() => parseLoadArgsRows(text)).toThrow(message);
  });

  it("reads a file, and names it in a usage error", () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "load-args-"));
    const file = path.join(dir, "args.ndjson");
    fs.writeFileSync(file, '{"q":"a"}\n{"q":"b"}\n');
    expect(readLoadArgsFile(file)).toEqual([{ q: "a" }, { q: "b" }]);
    for (const [target, pattern] of [
      [path.join(dir, "missing.ndjson"), /: cannot be read: /],
      [(fs.writeFileSync(file, "[]"), file), /: line 1: each line must be/],
    ] as const) {
      try {
        readLoadArgsFile(target);
        throw new Error("expected a throw");
      } catch (err) {
        expect((err as Error).message).toMatch(/^--load-args-file /);
        expect((err as Error).message).toMatch(pattern);
        expect((err as CliExitCodeError).envelope?.code).toBe(
          LOAD_ARGS_INVALID,
        );
      }
    }
  });
});

describe("loadArgsTemplate", () => {
  it("is the flag arguments alone without rows", () => {
    expect(loadArgsTemplate({ q: "x{{seq}}" }, undefined)(ctx)).toEqual({
      q: "x7",
    });
  });

  it("merges rows over the flag arguments in turn", () => {
    const t = loadArgsTemplate(
      { q: "base", fixed: 1 },
      { rows: [{ q: "a" }, { q: "b-{{seq}}" }], order: "sequential" },
    );
    expect([1, 2, 3, 4].map((seq) => t({ seq, worker: 0 }))).toEqual([
      { q: "a", fixed: 1 },
      { q: "b-2", fixed: 1 },
      { q: "a", fixed: 1 },
      { q: "b-4", fixed: 1 },
    ]);
  });

  it("picks a row at random with the random order", () => {
    const rows = { rows: [{ q: "a" }, { q: "b" }], order: "random" as const };
    expect(loadArgsTemplate({}, rows, () => 0.99)(ctx)).toEqual({ q: "b" });
    expect(loadArgsTemplate({}, rows, () => 0)(ctx)).toEqual({ q: "a" });
  });

  it("is carried through resolveLoadOptions", () => {
    const argRows = { rows: [{ q: "a" }], order: "sequential" as const };
    expect(resolveLoadOptions({ requests: 1, argRows })).toMatchObject({
      argRows,
    });
  });
});

describe("runLoad call numbering", () => {
  it("hands each call its 1-based start number", async () => {
    const seen: number[] = [];
    await runLoad(
      async (_worker, _step, seq) => {
        seen.push(seq);
        return "ok";
      },
      { concurrency: 1, requests: 4 },
    );
    expect(seen).toEqual([1, 2, 3, 4]);
  });
});

describe("--load with varying arguments (CLI)", () => {
  let dir: string | undefined;
  afterEach(() => {
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
    dir = undefined;
  });

  async function withServer(
    run: (url: string) => Promise<void>,
  ): Promise<Record<string, unknown>[]> {
    const server = createTestServerHttp({
      serverInfo: createTestServerInfo("load-args", "1.0.0"),
      tools: [createEchoTool()],
    });
    try {
      await server.start();
      await run(server.url);
      return server
        .getRecordedRequests()
        .filter((r) => r.method === "tools/call")
        .map((r) => r.params?.arguments as Record<string, unknown>);
    } finally {
      await server.stop();
    }
  }

  const loadArgs = (url: string) => [
    url,
    "--cli",
    "--transport",
    "http",
    "--method",
    "tools/call",
    "--tool-name",
    "echo",
    "--load",
    "--load-concurrency",
    "1",
    "--load-requests",
    "4",
  ];

  it("substitutes placeholders in --tool-arg per call", async () => {
    const sent = await withServer(async (url) => {
      const result = await runCli([
        ...loadArgs(url),
        "--tool-arg",
        "message=call-{{seq}}",
      ]);
      expectCliSuccess(result);
      expect(expectValidJson(result)).toMatchObject({ requests: 4, ok: 4 });
    });
    expect(sent.map((a) => a.message)).toEqual([
      "call-1",
      "call-2",
      "call-3",
      "call-4",
    ]);
  });

  it("merges --load-args-file rows over --tool-arg, cycling", async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "load-args-e2e-"));
    const file = path.join(dir, "args.ndjson");
    fs.writeFileSync(file, '{"message":"a"}\n{"message":"b-{{seq}}"}\n');
    const sent = await withServer(async (url) => {
      const result = await runCli([
        ...loadArgs(url),
        "--tool-arg",
        "message=base",
        "--load-args-file",
        file,
      ]);
      expectCliSuccess(result);
    });
    expect(sent.map((a) => a.message)).toEqual(["a", "b-2", "a", "b-4"]);
  });

  it("takes rows at random with --load-args-random", async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "load-args-e2e-"));
    const file = path.join(dir, "args.ndjson");
    fs.writeFileSync(file, '{"message":"a"}\n{"message":"b"}\n');
    const sent = await withServer(async (url) => {
      expectCliSuccess(
        await runCli([
          ...loadArgs(url),
          "--load-args-file",
          file,
          "--load-args-random",
        ]),
      );
    });
    expect(sent).toHaveLength(4);
    for (const a of sent) expect(["a", "b"]).toContain(a.message);
  });

  it.each([
    [["--load-args-random"], "--load-args-random requires --load-args-file."],
    [
      ["--tool-arg", "message={{rand:5-1}}"],
      "--tool-arg.message: {{rand:5-1}}",
    ],
  ])("refuses %j", async (extra, message) => {
    const result = await runCli([
      ...loadArgs("http://127.0.0.1:1/mcp"),
      ...extra,
    ]);
    expectCliFailure(result);
    expect(result.stderr).toContain(message);
  });

  it("refuses --load-args-file with --load-scenario", async () => {
    const result = await runCli([
      "http://127.0.0.1:1/mcp",
      "--cli",
      "--method",
      "tools/call",
      "--load",
      "--load-scenario",
      "s.json",
      "--load-args-file",
      "a.ndjson",
    ]);
    expectCliFailure(result);
    expect(result.stderr).toContain(
      "--load-args-file cannot be combined with --load-scenario",
    );
  });

  it.each([["--load-args-file", "a.ndjson"], ["--load-args-random"]])(
    "requires --load for %s",
    async (...flag) => {
      const result = await runCli([
        "http://127.0.0.1:1/mcp",
        "--cli",
        "--method",
        "tools/call",
        "--tool-name",
        "echo",
        ...flag,
      ]);
      expectCliFailure(result);
      expect(result.stderr).toContain(`${flag[0]} requires --load.`);
    },
  );
});
