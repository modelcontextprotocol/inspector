import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { emitResult, runCli } from "../src/cli.js";
import { CliExitCodeError, EXIT_CODES } from "../src/error-handler.js";
import {
  lintListResult,
  toolsFromResult,
  writeSchemaLintReport,
} from "../src/handlers/schema-lint-report.js";

/** A `tools/list` result with one bare-`true` property — the issue's case. */
const DIRTY_LIST = {
  tools: [
    {
      name: "info",
      inputSchema: { type: "object", properties: {} },
      outputSchema: { type: "object", properties: { data: true } },
    },
  ],
};

/** Same shape, but every schema portable. */
const CLEAN_LIST = {
  tools: [{ name: "ok", inputSchema: { type: "object", properties: {} } }],
};

describe("toolsFromResult", () => {
  it("returns the tools array", () => {
    expect(toolsFromResult(DIRTY_LIST).map((t) => t.name)).toEqual(["info"]);
  });

  it.each([
    ["a missing tools key", {}],
    ["a non-array tools value", { tools: "nope" }],
  ])("returns nothing for %s", (_label, result) => {
    expect(toolsFromResult(result)).toEqual([]);
  });

  it("skips entries that are not tool-shaped", () => {
    const result = {
      tools: [null, 3, {}, { name: 7 }, { name: "real", inputSchema: {} }],
    };
    expect(toolsFromResult(result).map((t) => t.name)).toEqual(["real"]);
  });
});

describe("lintListResult", () => {
  it("reports the offending tool", () => {
    const results = lintListResult(DIRTY_LIST);
    expect(results.map((r) => r.toolName)).toEqual(["info"]);
  });

  it("reports nothing for a clean list", () => {
    expect(lintListResult(CLEAN_LIST)).toEqual([]);
  });
});

describe("writeSchemaLintReport", () => {
  let stderr: string;
  let originalWrite: typeof process.stderr.write;

  beforeEach(() => {
    stderr = "";
    originalWrite = process.stderr.write;
    process.stderr.write = ((chunk: unknown, ...rest: unknown[]): boolean => {
      stderr += typeof chunk === "string" ? chunk : String(chunk);
      (
        rest.find((r) => typeof r === "function") as (() => void) | undefined
      )?.();
      return true;
    }) as typeof process.stderr.write;
  });

  afterEach(() => {
    process.stderr.write = originalWrite;
  });

  it("writes nothing at all when there are no findings", async () => {
    await writeSchemaLintReport([], true);
    expect(stderr).toBe("");
  });

  it("writes a one-line hint without --strict", async () => {
    await writeSchemaLintReport(lintListResult(DIRTY_LIST), false);
    expect(stderr.trimEnd().split("\n")).toHaveLength(1);
    expect(stderr).toContain("Re-run with --strict");
  });

  it("writes the full report under --strict", async () => {
    await writeSchemaLintReport(lintListResult(DIRTY_LIST), true);
    expect(stderr).toContain('Error: tool "info"');
    expect(stderr).toContain("Path: outputSchema.properties.data");
    expect(stderr).toContain("Suggestion: ");
    expect(stderr).not.toContain("Re-run with --strict");
  });

  it("resolves only once stderr has taken the write", async () => {
    // Both CLI exit paths call `process.exit()` as soon as the work returns,
    // which discards anything still buffered on a piped stderr. The report is
    // only safe if this settles on the write callback rather than fire-and-
    // forget, so the fake defers its callback to a later tick.
    let flushed = false;
    process.stderr.write = ((
      chunk: unknown,
      cb?: (err?: Error | null) => void,
    ): boolean => {
      stderr += typeof chunk === "string" ? chunk : String(chunk);
      setTimeout(() => {
        flushed = true;
        cb?.();
      }, 0);
      return false;
    }) as typeof process.stderr.write;

    await writeSchemaLintReport(lintListResult(DIRTY_LIST), true);
    expect(flushed).toBe(true);
  });
});

describe("emitResult — schema lint wiring (#1005)", () => {
  let stdout: string;
  let stderr: string;
  let originalOut: typeof process.stdout.write;
  let originalErr: typeof process.stderr.write;

  beforeEach(() => {
    stdout = "";
    stderr = "";
    originalOut = process.stdout.write;
    originalErr = process.stderr.write;
    process.stdout.write = ((chunk: unknown, ...rest: unknown[]): boolean => {
      stdout += typeof chunk === "string" ? chunk : String(chunk);
      (
        rest.find((r) => typeof r === "function") as (() => void) | undefined
      )?.();
      return true;
    }) as typeof process.stdout.write;
    process.stderr.write = ((chunk: unknown, ...rest: unknown[]): boolean => {
      stderr += typeof chunk === "string" ? chunk : String(chunk);
      (
        rest.find((r) => typeof r === "function") as (() => void) | undefined
      )?.();
      return true;
    }) as typeof process.stderr.write;
  });

  afterEach(() => {
    process.stdout.write = originalOut;
    process.stderr.write = originalErr;
  });

  it("exits 6 under --strict when a finding is error-severity", async () => {
    const promise = emitResult(DIRTY_LIST, undefined, {
      method: "tools/list",
      strict: true,
      format: "text",
    });
    await expect(promise).rejects.toBeInstanceOf(CliExitCodeError);
    await promise.catch((e: CliExitCodeError) => {
      expect(e.exitCode).toBe(EXIT_CODES.SCHEMA_UNPORTABLE);
      // Not `schema_invalid`: the lint reports schemas that ARE valid JSON
      // Schema and are merely unportable, so the code an automated caller
      // branches on must not claim otherwise.
      expect(e.envelope?.code).toBe("schema_unportable");
    });
    // The result still goes to stdout; only the report is on stderr.
    expect(JSON.parse(stdout)).toEqual(DIRTY_LIST);
    expect(stderr).toContain("Path: outputSchema.properties.data");
  });

  it("succeeds under --strict when only warnings were found", async () => {
    const warnOnly = {
      tools: [
        {
          name: "w",
          inputSchema: {
            type: "object",
            properties: { a: { type: ["null", "boolean"] } },
          },
        },
      ],
    };
    await expect(
      emitResult(warnOnly, undefined, {
        method: "tools/list",
        strict: true,
        format: "text",
      }),
    ).resolves.toBeUndefined();
    expect(stderr).toContain('Warning: tool "w"');
  });

  it("prints only the hint, and does not fail, without --strict", async () => {
    await expect(
      emitResult(DIRTY_LIST, undefined, {
        method: "tools/list",
        format: "text",
      }),
    ).resolves.toBeUndefined();
    expect(stderr).toContain("Re-run with --strict");
    expect(stderr).not.toContain("Suggestion:");
  });

  it("folds findings into the --format json envelope under --strict", async () => {
    await emitResult(DIRTY_LIST, undefined, {
      method: "tools/list",
      strict: true,
      format: "json",
    }).catch(() => {
      // exit 6 is expected here; the envelope is what this test asserts.
    });
    const envelope = JSON.parse(stdout) as {
      result: unknown;
      schemaFindings?: { toolName: string }[];
    };
    expect(envelope.result).toEqual(DIRTY_LIST);
    expect(envelope.schemaFindings?.[0]?.toolName).toBe("info");
  });

  it("leaves the json envelope alone when nothing was found", async () => {
    await emitResult(CLEAN_LIST, undefined, {
      method: "tools/list",
      strict: true,
      format: "json",
    });
    expect(JSON.parse(stdout)).toEqual({ result: CLEAN_LIST });
    expect(stderr).toBe("");
  });

  it("does not lint a method other than tools/list", async () => {
    // The same payload under `tools/call` must produce no report at all —
    // `--strict` is a tools/list flag and the CLI rejects it elsewhere.
    await emitResult(DIRTY_LIST, undefined, {
      method: "tools/call",
      strict: true,
      format: "text",
    });
    expect(stderr).toBe("");
  });

  it("does not lint an --app-info run", async () => {
    // `runCli` rejects `--strict --app-info` outright (see below), so this is
    // the defensive half: any other Node runner reusing `emitResult` gets the
    // app-info early return rather than a report interleaved with its NDJSON.
    await emitResult(
      DIRTY_LIST,
      { hasApp: true, toolName: "info" },
      { method: "tools/list", strict: true, appInfo: true, format: "text" },
    );
    expect(stderr).toBe("");
  });

  it("reports isError before the schema verdict", async () => {
    // Both would throw; the tool-level failure is the more specific one and
    // must win, so a caller branching on exit 5 is not shadowed by exit 6.
    const promise = emitResult({ ...DIRTY_LIST, isError: true }, undefined, {
      method: "tools/list",
      strict: true,
      toolName: "info",
      format: "text",
    });
    await promise.catch((e: CliExitCodeError) => {
      expect(e.exitCode).toBe(EXIT_CODES.TOOL_ERROR);
    });
    await expect(promise).rejects.toBeInstanceOf(CliExitCodeError);
  });
});

describe("--strict argument validation", () => {
  it("is rejected with a method other than tools/list", async () => {
    await expect(
      runCli([
        "node",
        "cli",
        "--cli",
        "--method",
        "tools/call",
        "--tool-name",
        "x",
        "--strict",
        "--server-url",
        "http://127.0.0.1:1/mcp",
      ]),
    ).rejects.toThrow("--strict requires --method tools/list.");
  });

  it.each([
    ["servers/list", ["--method", "servers/list"]],
    ["--list-stored-auth", ["--method", "servers/list", "--list-stored-auth"]],
  ])(
    "is rejected on the %s short-circuit path, which never reaches the lint",
    async (_label, extra) => {
      // These return from `parseArgs` before any connect, so a validation
      // placed further down would let `--strict` be accepted and ignored.
      await expect(
        runCli(["node", "cli", "--cli", "--strict", ...extra]),
      ).rejects.toThrow("--strict requires --method tools/list.");
    },
  );

  it("is rejected alongside --app-info rather than silently ignored", async () => {
    // `tools/list --app-info` returns NDJSON straight from `runMethod` and
    // never reaches `emitResult`, so accepting the pair would hand a CI caller
    // a `--strict` gate that can never fail.
    await expect(
      runCli([
        "node",
        "cli",
        "--cli",
        "--method",
        "tools/list",
        "--strict",
        "--app-info",
        "--server-url",
        "http://127.0.0.1:1/mcp",
      ]),
    ).rejects.toThrow("--strict cannot be combined with --app-info");
  });
});
