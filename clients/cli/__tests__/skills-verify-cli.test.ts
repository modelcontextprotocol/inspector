import { describe, it, expect } from "vitest";
import { runCli } from "../src/cli.js";
import { consumeMethodOutcome } from "../src/handlers/consume-outcome.js";
import { EXIT_CODES } from "../src/error-handler.js";

/**
 * `--verify`'s argument validation and its NDJSON consumption path (#2248).
 *
 * The validation sits with `--strict`'s, ahead of every short-circuit return in
 * `parseArgs`, for the same reason: the returns below it never reach
 * `runMethod`, so a check placed further down would let the flag be accepted
 * and then silently ignored.
 */
describe("--verify argument validation", () => {
  it("is rejected with a method other than skills/list or skills/get", async () => {
    await expect(
      runCli([
        "node",
        "cli",
        "--cli",
        "--method",
        "tools/list",
        "--verify",
        "--server-url",
        "http://127.0.0.1:1/mcp",
      ]),
    ).rejects.toThrow(
      "--verify requires --method skills/list or --method skills/get.",
    );
  });

  it.each([
    ["servers/list", ["--method", "servers/list"]],
    ["--list-stored-auth", ["--method", "servers/list", "--list-stored-auth"]],
  ])(
    "is rejected on the %s short-circuit path, which never reaches the report",
    async (_label, extra) => {
      await expect(
        runCli(["node", "cli", "--cli", "--verify", ...extra]),
      ).rejects.toThrow(
        "--verify requires --method skills/list or --method skills/get.",
      );
    },
  );

  it("is accepted with skills/get", async () => {
    // Reaches the connect and fails there — which is the point: the flag
    // itself was not what was rejected.
    await expect(
      runCli([
        "node",
        "cli",
        "--cli",
        "--method",
        "skills/get",
        "--uri",
        "skill://demo/SKILL.md",
        "--verify",
        "--server-url",
        "http://127.0.0.1:1/mcp",
      ]),
    ).rejects.not.toThrow(/--verify requires/);
  });
});

describe("consumeMethodOutcome NDJSON summary and exit code (#2248)", () => {
  function captureStreams() {
    let stdout = "";
    let stderr = "";
    const write = (sink: (s: string) => void) =>
      ((chunk: unknown, ...rest: unknown[]) => {
        sink(typeof chunk === "string" ? chunk : String(chunk));
        const cb = rest.find((r) => typeof r === "function") as
          | (() => void)
          | undefined;
        cb?.();
        return true;
      }) as typeof process.stdout.write;
    const originalOut = process.stdout.write;
    const originalErr = process.stderr.write;
    process.stdout.write = write((s) => (stdout += s));
    process.stderr.write = write((s) => (stderr += s));
    return {
      get stdout() {
        return stdout;
      },
      get stderr() {
        return stderr;
      },
      restore() {
        process.stdout.write = originalOut;
        process.stderr.write = originalErr;
      },
    };
  }

  it("writes the summary to stderr so it cannot contaminate the NDJSON", async () => {
    const streams = captureStreams();
    try {
      await consumeMethodOutcome(
        { kind: "ndjson", lines: [{ ok: true }], summary: "all good" },
        {},
      );
    } finally {
      streams.restore();
    }
    expect(JSON.parse(streams.stdout.trim())).toEqual({ ok: true });
    expect(streams.stderr).toBe("all good\n");
  });

  it("throws the exit code AFTER writing the report", async () => {
    // The report is the output a CI job reads; failing before writing it would
    // give the reader an exit code and nothing to act on.
    const streams = captureStreams();
    let thrown: unknown;
    try {
      await consumeMethodOutcome(
        {
          kind: "ndjson",
          lines: [{ ok: false }],
          summary: "one failed",
          exitCode: EXIT_CODES.SKILL_NONCONFORMANT,
        },
        {},
      );
    } catch (err) {
      thrown = err;
    } finally {
      streams.restore();
    }
    expect(streams.stdout.trim()).toBe('{"ok":false}');
    expect(thrown).toMatchObject({
      exitCode: EXIT_CODES.SKILL_NONCONFORMANT,
      envelope: { code: "skills_nonconformant" },
    });
  });

  it("leaves an --app-info NDJSON outcome unchanged", async () => {
    // No summary, no exit code — the field is additive and the older caller
    // must behave exactly as before.
    const streams = captureStreams();
    try {
      await consumeMethodOutcome({ kind: "ndjson", lines: [{ a: 1 }] }, {});
    } finally {
      streams.restore();
    }
    expect(streams.stderr).toBe("");
    expect(streams.stdout.trim()).toBe('{"a":1}');
  });
});
