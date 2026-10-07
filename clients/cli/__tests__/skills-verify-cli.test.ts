import { describe, it, expect } from "vitest";
import {
  createTestServerHttp,
  createTestServerInfo,
} from "@modelcontextprotocol/inspector-test-server";
import type { SkillVerifyReport } from "@inspector/core/mcp/skillsVerification.js";
import { runCli } from "../src/cli.js";
import { consumeMethodOutcome } from "../src/handlers/consume-outcome.js";
import { EXIT_CODES } from "@inspector/core/cli/error-handler.js";
import {
  runCli as runCliCaptured,
  type CliResult,
} from "./helpers/cli-runner.js";
import { createTestConfig, deleteConfigFile } from "./helpers/fixtures.js";

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

  it("rejects --require-digests without --verify (#2405)", async () => {
    await expect(
      runCli([
        "node",
        "cli",
        "--cli",
        "--method",
        "skills/list",
        "--require-digests",
        "--server-url",
        "http://127.0.0.1:1/mcp",
      ]),
    ).rejects.toThrow("--require-digests requires --verify.");
  });

  it("accepts --require-digests alongside --verify", async () => {
    // Reaches the connect and fails there, as with skills/get below.
    await expect(
      runCli([
        "node",
        "cli",
        "--cli",
        "--method",
        "skills/list",
        "--verify",
        "--require-digests",
        "--server-url",
        "http://127.0.0.1:1/mcp",
      ]),
    ).rejects.not.toThrow(/--require-digests requires/);
  });

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

  it("drops the summary under --quiet but keeps the exit code and its message (#2435)", async () => {
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
        { quiet: true },
      );
    } catch (err) {
      thrown = err;
    } finally {
      streams.restore();
    }
    expect(streams.stdout.trim()).toBe('{"ok":false}');
    expect(streams.stderr).toBe("");
    // The error envelope still carries the verdict, so nothing is lost.
    expect(thrown).toMatchObject({
      exitCode: EXIT_CODES.SKILL_NONCONFORMANT,
      message: "one failed",
    });
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

  it("labels the envelope for an INCOMPLETE run, not a nonconformant one", async () => {
    // The envelope's `code` follows the exit code, so a caller reading one
    // never has to reconcile it against the other — and exit 8 means the
    // server broke no MUST.
    const streams = captureStreams();
    let thrown: unknown;
    try {
      await consumeMethodOutcome(
        {
          kind: "ndjson",
          lines: [{ outcome: "incomplete" }],
          summary: "not fully checked",
          exitCode: EXIT_CODES.SKILL_INCOMPLETE,
        },
        {},
      );
    } catch (err) {
      thrown = err;
    } finally {
      streams.restore();
    }
    expect(thrown).toMatchObject({
      exitCode: EXIT_CODES.SKILL_INCOMPLETE,
      envelope: { code: "skills_incomplete" },
    });
  });

  it("labels the envelope for an UNVERIFIABLE run (#2405)", async () => {
    const streams = captureStreams();
    let thrown: unknown;
    try {
      await consumeMethodOutcome(
        {
          kind: "ndjson",
          lines: [{ outcome: "unverifiable" }],
          summary: "no digests",
          exitCode: EXIT_CODES.SKILL_UNVERIFIABLE,
        },
        {},
      );
    } catch (err) {
      thrown = err;
    } finally {
      streams.restore();
    }
    expect(thrown).toMatchObject({
      exitCode: EXIT_CODES.SKILL_UNVERIFIABLE,
      envelope: { code: "skills_unverifiable" },
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

/**
 * The catalog-budget escape hatch round-trips (#2428).
 *
 * A skill past the run's catalog budget is reported `incomplete` with a message
 * naming the command that verifies it on its own. That text is the only route a
 * user has to a verdict for the skipped skill, so it is run back through the
 * real argument parser against a real server rather than trusted as prose. The
 * first version named `--method skills/get --uri` alone, which fetches the
 * skill and checks nothing — a command that parsed, succeeded, and gave no
 * verdict.
 */
describe("the catalog-budget escape hatch (#2428)", () => {
  /**
   * The backticked command in a report's `incomplete` message, as argv, with
   * its `<uri>` placeholder filled from the report's own `uri`. Substituted as
   * one argv element — the way a user's quoting would — because the message
   * deliberately never splices the server-controlled URI into the command.
   */
  function suggestedArgs(report: SkillVerifyReport): string[] {
    const command = /`([^`]+)`/.exec(report.incomplete ?? "")?.[1];
    if (!command) throw new Error(`no command in: ${report.incomplete}`);
    const args = command.split(/\s+/);
    if (!args.includes("<uri>"))
      throw new Error(`no <uri> placeholder in: ${command}`);
    return args.map((arg) => (arg === "<uri>" ? report.uri : arg));
  }

  /**
   * The NDJSON report lines of a `--verify` run. Anything else — a usage
   * error, or a fetched skill printed as one JSON document because the
   * command lacked `--verify` — fails here naming what the run printed.
   */
  function reportsOf(result: CliResult): SkillVerifyReport[] {
    try {
      return result.stdout
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line) as SkillVerifyReport);
    } catch {
      throw new Error(
        `not a --verify report (exit ${result.exitCode}):\n${result.output}`,
      );
    }
  }

  it("verifies a skill skipped for budget with the command the message names", async () => {
    const server = createTestServerHttp({
      serverInfo: createTestServerInfo("skills-budget", "1.0.0"),
      skills: true,
    });
    let catalogPath: string | undefined;
    try {
      await server.start();
      // A budget of one skill, so every skill after the first is skipped —
      // and the SAME budget applies to the follow-up run, which is what proves
      // the command works for a skill this configuration skipped.
      catalogPath = createTestConfig({
        mcpServers: {
          skills: {
            type: "streamable-http",
            url: server.url,
            skillCatalogMaxSkills: 1,
          },
        },
      });
      const target = ["--catalog", catalogPath, "--server", "skills", "--cli"];

      const listed = await runCliCaptured([
        ...target,
        "--method",
        "skills/list",
        "--verify",
      ]);
      const skipped = reportsOf(listed).find((report) =>
        report.incomplete?.includes("catalog budget"),
      );
      if (!skipped) throw new Error(`no skipped skill in: ${listed.stdout}`);
      expect(skipped.files).toHaveLength(0);

      const suggested = suggestedArgs(skipped);
      const got = await runCliCaptured([...target, ...suggested]);

      // A verdict for exactly the skipped skill, from files actually read —
      // not the skill echoed back, and not the budget message again.
      const reports = reportsOf(got);
      expect(reports).toHaveLength(1);
      expect(reports[0].uri).toBe(skipped.uri);
      expect(reports[0].incomplete ?? "").not.toMatch(/catalog budget/);
      expect(reports[0].files.length).toBeGreaterThan(0);
    } finally {
      await server.stop();
      if (catalogPath) deleteConfigFile(catalogPath);
    }
  });
});
