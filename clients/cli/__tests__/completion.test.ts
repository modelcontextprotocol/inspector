/**
 * Shell completion (#2434): the generated scripts are derived from the real
 * commander program, offer the method names, and actually complete in each
 * shell. The shell-level tests spawn bash / zsh / fish when installed and are
 * skipped otherwise; the structural tests below always run.
 */
import { describe, it, expect, afterAll } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Command, Option } from "commander";
import { runCli } from "./helpers/cli-runner.js";
import {
  CATALOG_METHODS,
  COMPLETION_SHELLS,
  VALUE_CHOICES,
  collectCompletionFlags,
  emitCompletionIfRequested,
  isCompletionShell,
  parseCompletionShell,
  registerCompletionOption,
  renderCompletion,
  type CompletionShell,
} from "../src/completion.js";
import { ONE_SHOT_METHODS } from "../src/handlers/method-types.js";

async function script(shell: CompletionShell): Promise<string> {
  const result = await runCli(["--completion", shell]);
  expect(result.exitCode).toBe(0);
  expect(result.stderr).toBe("");
  return result.stdout;
}

const tmp = mkdtempSync(join(tmpdir(), "cli-completion-"));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

function hasShell(shell: string): boolean {
  return spawnSync(shell, ["-c", "exit 0"]).status === 0;
}

function writeScript(shell: CompletionShell, body: string): string {
  const path = join(tmp, `completion.${shell}`);
  writeFileSync(path, body);
  return path;
}

describe("--completion", () => {
  it.each(COMPLETION_SHELLS)("prints a %s script and exits 0", async (s) => {
    const out = await script(s);
    expect(out).toContain("mcp-inspector");
    expect(out).toMatch(/--method|-l method/);
  });

  it("rejects an unsupported shell", async () => {
    const result = await runCli(["--completion", "pwsh"]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain(
      "Invalid shell: pwsh. Supported shells are: bash, zsh, fish",
    );
  });

  it("short-circuits ahead of method validation", async () => {
    // No --method and no server: a normal run would fail "Method is required".
    const result = await runCli(["--completion", "fish"]);
    expect(result.exitCode).toBe(0);
  });

  it("lists every CLI flag, including ones it was not told about", async () => {
    const out = await script("bash");
    for (const flag of [
      "--catalog",
      "--config",
      "--server",
      "-e",
      "--tool-arg",
      "--format",
      "--relogin",
      "--no-revoke",
      "--print-handoff",
      "--completion",
      "--help",
      "-h",
    ]) {
      expect(out).toContain(` ${flag}`);
    }
    // Spot-check one flag from the far end of the definition too.
    expect(out).toContain(" --wait-for-auth");
  });

  it("offers every --method the CLI accepts", async () => {
    const out = await script("bash");
    for (const method of [...ONE_SHOT_METHODS, ...CATALOG_METHODS]) {
      expect(out).toContain(method);
    }
  });
});

describe("collectCompletionFlags", () => {
  it("derives value, path and choice metadata from the commander definition", () => {
    const program = new Command()
      .option("--plain", "A boolean switch value. Second sentence")
      .option("--terse", "Needs --x. Then does a thing. Third")
      .option("--file <path>", "A path")
      .option("--name <value>", "Free text (e.g. foo).")
      .option("--method <m>", "Method")
      .option("-x <v>", "Short only")
      .option("--secret", "Hidden");
    program.options.find((o) => o.long === "--secret")!.hidden = true;
    registerCompletionOption(program);

    const flags = collectCompletionFlags(program);
    const byName = (n: string) =>
      flags.find((f) => f.long === n || f.short === n);

    expect(byName("--plain")).toEqual({
      long: "--plain",
      takesValue: false,
      description: "A boolean switch value",
    });
    expect(byName("--terse")?.description).toBe("Needs --x. Then does a thing");
    expect(byName("--file")).toMatchObject({ takesValue: true, path: true });
    expect(byName("--name")).toMatchObject({
      takesValue: true,
      description: "Free text (e.g. foo)",
    });
    expect(byName("--name")?.path).toBeUndefined();
    expect(byName("--method")?.choices).toBe(VALUE_CHOICES["--method"]);
    expect(byName("-x")).toMatchObject({ takesValue: true });
    expect(byName("-x")?.long).toBeUndefined();
    expect(byName("--secret")).toBeUndefined();
    expect(byName("--completion")?.choices).toEqual(COMPLETION_SHELLS);
    expect(byName("--help")).toMatchObject({ short: "-h" });
  });

  it("prefers commander choices when an option declares them", () => {
    const program = new Command().addOption(
      new Option("--color <c>", "Color").choices(["red", "blue"]),
    );
    expect(collectCompletionFlags(program)[0]!.choices).toEqual([
      "red",
      "blue",
    ]);
  });

  it("handles an empty description", () => {
    const program = new Command().option("--bare");
    expect(collectCompletionFlags(program)[0]!.description).toBe("");
  });

  it("every stated value choice is accepted by the real option parser", async () => {
    // Drift guard: VALUE_CHOICES restates sets the CLI validates in custom
    // parsers. A value the parser would reject must not be offered.
    for (const [flag, values] of Object.entries(VALUE_CHOICES)) {
      if (flag === "--method" || flag === "--completion") continue;
      for (const value of values) {
        const result = await runCli([flag, value, "--completion", "bash"]);
        expect(result.exitCode, `${flag} ${value}`).toBe(0);
      }
    }
  });
});

describe("shell helpers", () => {
  it("parseCompletionShell / isCompletionShell", () => {
    expect(isCompletionShell("zsh")).toBe(true);
    expect(isCompletionShell("csh")).toBe(false);
    expect(parseCompletionShell("fish")).toBe("fish");
    expect(() => parseCompletionShell("csh")).toThrow(/Invalid shell: csh/);
  });

  it("emitCompletionIfRequested is a no-op without --completion", async () => {
    const program = new Command();
    registerCompletionOption(program);
    program.parse([], { from: "user" });
    expect(await emitCompletionIfRequested(program)).toBe(false);
  });

  it("quotes descriptions containing quotes and backslashes", () => {
    const flags = [
      {
        long: "--q",
        takesValue: false,
        description: `it's a \\ "test"`,
      },
    ];
    expect(renderCompletion("bash", flags)).toContain("--q");
    expect(renderCompletion("zsh", flags)).toContain(
      `'--q:it'\\''s a \\ "test"'`,
    );
    expect(renderCompletion("fish", flags)).toContain(
      `-d 'it\\'s a \\\\ "test"'`,
    );
  });
});

describe.skipIf(!hasShell("bash"))("bash script", () => {
  async function complete(words: string[]): Promise<string[]> {
    const path = writeScript("bash", await script("bash"));
    const quoted = words.map((w) => `'${w}'`).join(" ");
    const res = spawnSync(
      "bash",
      [
        "--norc",
        "-c",
        `source '${path}'; COMP_WORDS=(${quoted}); COMP_CWORD=$((\${#COMP_WORDS[@]}-1)); _mcp_inspector; printf '%s\\n' "\${COMPREPLY[@]}"`,
      ],
      { encoding: "utf8" },
    );
    expect(res.stderr).toBe("");
    return res.stdout.split("\n").filter(Boolean);
  }

  it("is valid bash", async () => {
    const path = writeScript("bash", await script("bash"));
    expect(spawnSync("bash", ["-n", path]).status).toBe(0);
  });

  it("completes mode flags, CLI flags and method names", async () => {
    expect(await complete(["mcp-inspector", "--c"])).toEqual(["--cli"]);
    expect(await complete(["mcp-inspector", "--cli", "--meth"])).toEqual([
      "--method",
    ]);
    expect(
      await complete(["mcp-inspector", "--cli", "--method", "tools/"]),
    ).toEqual(["tools/list", "tools/call"]);
    expect(
      await complete(["mcp-inspector", "--cli", "--transport", ""]),
    ).toEqual(["stdio", "sse", "http"]);
    // A free-form value offers nothing (the shell falls back to files).
    expect(
      await complete(["mcp-inspector", "--cli", "--tool-name", "--"]),
    ).toEqual([]);
    // Flags still complete after a stdio target command.
    expect(
      await complete(["mcp-inspector", "--cli", "node", "s.js", "--comp"]),
    ).toEqual(["--completion"]);
    // Non-CLI modes are out of scope.
    expect(await complete(["mcp-inspector", "--web", "--meth"])).toEqual([]);
  });
});

describe.skipIf(!hasShell("zsh"))("zsh script", () => {
  /**
   * Drive `_mcp_inspector` with the completion builtins stubbed to print what
   * they were handed, so the test needs no interactive shell or compinit.
   */
  async function complete(words: string[]): Promise<string> {
    const path = writeScript("zsh", await script("zsh"));
    const quoted = words.map((w) => `'${w}'`).join(" ");
    const stubs = [
      'compdef() { print -r -- "compdef $*" }',
      'compadd() { shift; print -r -- "compadd $*" }',
      "_files() { print -r -- _files }",
      '_message() { print -r -- "_message $*" }',
      '_describe() { print -r -- "_describe ${(P)4}" }',
    ].join("\n");
    const res = spawnSync(
      "zsh",
      [
        "-f",
        "-c",
        `${stubs}\nsource '${path}'\nwords=(${quoted}); CURRENT=\${#words}; _mcp_inspector`,
      ],
      { encoding: "utf8" },
    );
    expect(res.stderr).toBe("");
    return res.stdout;
  }

  it("is valid zsh", async () => {
    const path = writeScript("zsh", await script("zsh"));
    expect(spawnSync("zsh", ["-n", path]).status).toBe(0);
  });

  it("completes mode flags, CLI flags and method names", async () => {
    expect(await complete(["mcp-inspector", "--c"])).toContain(
      "--cli:Run the CLI",
    );
    const flags = await complete(["mcp-inspector", "--cli", "--meth"]);
    expect(flags).toContain("--method:Method to invoke");
    expect(flags).toContain("-e:Environment variables");
    expect(
      await complete(["mcp-inspector", "--cli", "--method", ""]),
    ).toContain("compadd initialize tools/list tools/call");
    expect(await complete(["mcp-inspector", "--cli", "--config", ""])).toBe(
      "compdef _mcp_inspector mcp-inspector\n_files\n",
    );
    expect(await complete(["mcp-inspector", "--cli", "--uri", ""])).toContain(
      "_message value",
    );
    expect(await complete(["mcp-inspector", "--cli", "node"])).toContain(
      "_files",
    );
    expect(await complete(["mcp-inspector", "--tui", "--x"])).toContain(
      "_files",
    );
  });
});

describe.skipIf(!hasShell("fish"))("fish script", () => {
  async function complete(line: string): Promise<string[]> {
    const path = writeScript("fish", await script("fish"));
    const res = spawnSync(
      "fish",
      ["--no-config", "-c", `source '${path}'; complete -C '${line}'`],
      { encoding: "utf8" },
    );
    expect(res.stderr).toBe("");
    return res.stdout
      .split("\n")
      .filter(Boolean)
      .map((l) => l.split("\t")[0]!);
  }

  it("is valid fish", async () => {
    const path = writeScript("fish", await script("fish"));
    expect(spawnSync("fish", ["-n", path]).status).toBe(0);
  });

  it("completes mode flags, CLI flags and method names", async () => {
    expect(await complete("mcp-inspector --c")).toEqual(["--cli"]);
    expect(await complete("mcp-inspector --cli --meth")).toEqual(["--method"]);
    expect(
      (await complete("mcp-inspector --cli --method tools/")).sort(),
    ).toEqual(["tools/call", "tools/list"]);
    expect(await complete("mcp-inspector --cli -")).toContain("-e");
    expect(await complete("mcp-inspector --web --meth")).toEqual([]);
  });
});
