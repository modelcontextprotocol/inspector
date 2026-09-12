/**
 * The local-gate-out-of-CI guard (#2146), in two halves.
 *
 * The table-driven half pins one case per rule the parser encodes — including
 * the negative cases, which are the ones that matter most here: a guard that
 * also rejected `npm run smoke` or `smoke:web:chromium` would be "fixed" by
 * deleting it, taking the real protection with it.
 *
 * The second half runs the parser over the repository's ACTUAL workflow files.
 * That is the assertion the issue asks for: it fails the moment a workflow
 * invokes the pre-push gate, a non-Chromium engine pass, or `smoke:web:engine`,
 * or points `SMOKE_BROWSER` at something else.
 */

import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  FORBIDDEN_ENGINE_SCRIPTS,
  VIOLATION,
  extractExecutableRegions,
  findWorkflowViolations,
  formatWorkflowViolations,
} from "./workflow-gate.mjs";
import { reachableScripts } from "./npm-scripts.mjs";

const repoRoot = join(import.meta.dirname, "..", "..");
const workflowDir = join(repoRoot, ".github", "workflows");

/**
 * A minimal but SCHEMA-VALID workflow around some step YAML.
 *
 * The fixtures have to be real workflows now that the walk is structural
 * rather than key-name based: a bare `- run: …` fragment sits in no job and no
 * step, so it is correctly invisible, and a table built out of fragments would
 * pass while asserting nothing.
 */
const workflow = (steps) =>
  [
    "on: push",
    "jobs:",
    "  build:",
    "    runs-on: ubuntu-latest",
    "    steps:",
    steps,
  ].join("\n");

describe("findWorkflowViolations", () => {
  const cases = [
    {
      name: "flags the pre-push gate itself",
      text: workflow("      - run: npm run local:gate"),
      rules: [VIOLATION.LOCAL_SCRIPT],
    },
    {
      name: "flags any other local: script, without being edited for it",
      text: workflow("      - run: npm run local:storybook"),
      rules: [VIOLATION.LOCAL_SCRIPT],
    },
    {
      name: "flags the Firefox engine pass",
      text: workflow("      - run: npm run smoke:web:firefox"),
      rules: [VIOLATION.ENGINE_SCRIPT],
    },
    {
      name: "flags the WebKit engine pass",
      text: workflow("      - run: npm run smoke:web:webkit"),
      rules: [VIOLATION.ENGINE_SCRIPT],
    },
    {
      name: "flags the env-driven runner, whose engine cannot be read statically",
      text: workflow("      - run: npm run smoke:web:engine"),
      rules: [VIOLATION.ENGINE_SCRIPT],
    },
    {
      // Copilot, first review: the matrix form is exactly how a forbidden
      // engine reaches CI without anyone typing its name.
      name: "flags an engine pass whose name is built from an expression",
      text: workflow("      - run: npm run smoke:web:${{ matrix.browser }}"),
      rules: [VIOLATION.ENGINE_SCRIPT],
    },
    {
      name: "flags a local: script whose name is built from an expression",
      text: workflow("      - run: npm run local:${{ matrix.task }}"),
      rules: [VIOLATION.LOCAL_SCRIPT],
    },
    {
      // Copilot, second review: an expression body can itself contain braces,
      // so a brace-balanced regex stops at the first `}` and misses the one
      // case worth catching. The rule keys off the `${{` prefix instead.
      name: "flags an expression whose own body contains braces",
      text: workflow(
        "      - run: npm run smoke:web:${{ format('{0}', matrix.browser) }}",
      ),
      rules: [VIOLATION.ENGINE_SCRIPT],
    },
    {
      name: "flags a command inside a block scalar",
      text: workflow("      - run: |\n          npm run local:gate"),
      rules: [VIOLATION.LOCAL_SCRIPT],
    },
    {
      // Copilot, third review: a hand-rolled opener could not see either of
      // these, and each is a forbidden invocation that would have passed.
      name: "flags a block scalar opened with a trailing comment",
      text: workflow(
        "      - run: | # why this step exists\n          npm run local:gate",
      ),
      rules: [VIOLATION.LOCAL_SCRIPT],
    },
    {
      // Copilot, fourth review: an alias carries no `.value`, so reading one as
      // a scalar sees an empty string — with the command anchored somewhere the
      // walk never visits, this invoked the gate while the guard saw nothing.
      name: "flags a command reached through a YAML alias",
      text: workflow(
        [
          "      - name: &cmd npm run local:gate",
          "        run: echo documenting the gate",
          "      - run: *cmd",
        ].join("\n"),
      ),
      rules: [VIOLATION.LOCAL_SCRIPT],
    },
    {
      name: "flags a command passed as an action input",
      text: workflow("      - with:\n          args: npm run local:gate"),
      rules: [VIOLATION.LOCAL_SCRIPT],
    },
    {
      name: "flags SMOKE_BROWSER pointed at another engine",
      text: workflow(
        "      - env:\n          SMOKE_BROWSER: firefox\n        run: npm run smoke",
      ),
      rules: [VIOLATION.BROWSER_ENV],
    },
    {
      name: "flags a quoted SMOKE_BROWSER value",
      text: workflow(
        '      - env:\n          SMOKE_BROWSER: "webkit"\n        run: npm run smoke',
      ),
      rules: [VIOLATION.BROWSER_ENV],
    },
    {
      name: "flags a shell-assigned SMOKE_BROWSER",
      text: workflow("      - run: SMOKE_BROWSER=firefox npm run smoke"),
      rules: [VIOLATION.BROWSER_ENV],
    },
    {
      name: "flags an expression, which cannot be checked statically",
      text: workflow(
        "      - env:\n          SMOKE_BROWSER: ${{ matrix.browser }}\n        run: npm run smoke",
      ),
      rules: [VIOLATION.BROWSER_ENV],
    },
    {
      // Copilot, third review: the flow spelling of the same mapping.
      name: "flags an env override written as a flow mapping",
      text: workflow(
        "      - env: { SMOKE_BROWSER: firefox }\n        run: npm run smoke",
      ),
      rules: [VIOLATION.BROWSER_ENV],
    },
    {
      // Present-but-empty is not unset: `resolveBrowserName` rejects it rather
      // than falling back to chromium, so a workflow must not write it either.
      name: "flags SMOKE_BROWSER set to nothing at all",
      text: workflow(
        "      - env:\n          SMOKE_BROWSER:\n        run: npm run smoke",
      ),
      rules: [VIOLATION.BROWSER_ENV],
    },
    {
      name: "flags an empty shell assignment too",
      text: workflow("      - run: SMOKE_BROWSER= npm run smoke"),
      rules: [VIOLATION.BROWSER_ENV],
    },
    {
      // Copilot, seventh review: a shell resolves the name itself, so the
      // engine is just as unreadable as it is behind a `${{ }}` expression.
      name: "flags an engine pass named through a shell variable",
      text: workflow(
        "      - env:\n          ENGINE: firefox\n        run: npm run smoke:web:$ENGINE",
      ),
      rules: [VIOLATION.ENGINE_SCRIPT],
    },
    {
      name: "flags the braced and cmd spellings of that too",
      text: workflow(
        "      - run: npm run smoke:web:${ENGINE}\n      - run: npm run smoke:web:%ENGINE%",
      ),
      rules: [VIOLATION.ENGINE_SCRIPT, VIOLATION.ENGINE_SCRIPT],
    },
    {
      name: "flags a local: script named through a shell variable",
      text: workflow("      - run: npm run local:$TASK"),
      rules: [VIOLATION.LOCAL_SCRIPT],
    },
    {
      // Copilot, seventh review: Windows environment variables are
      // case-insensitive, so this sets the very variable Node reads as
      // SMOKE_BROWSER.
      name: "flags a lower-cased env key, which Windows treats as the same var",
      text: workflow(
        "      - env: { smoke_browser: firefox }\n        run: npm run smoke",
      ),
      rules: [VIOLATION.BROWSER_ENV],
    },
    {
      name: "allows a lower-cased key set to chromium",
      text: workflow(
        "      - env: { smoke_browser: chromium }\n        run: npm run smoke",
      ),
      rules: [],
    },
    {
      // Copilot, sixth review: PowerShell is the DEFAULT shell on a Windows
      // runner, so a POSIX-only pattern is silent on exactly the workflow least
      // likely to be read closely.
      name: "flags a PowerShell assignment",
      text: workflow(
        '      - run: |\n          $env:SMOKE_BROWSER = "firefox"\n          npm run smoke',
      ),
      rules: [VIOLATION.BROWSER_ENV],
    },
    {
      name: "flags the PowerShell ${env:NAME} spelling too",
      text: workflow(
        '      - run: ${env:SMOKE_BROWSER}="webkit"; npm run smoke',
      ),
      rules: [VIOLATION.BROWSER_ENV],
    },
    {
      // Copilot, ninth review: an unquoted second argument sets the environment
      // just the same, and an engine the guard cannot read is forbidden for the
      // reason `smoke:web:engine` is.
      name: "flags a SetEnvironmentVariable call with a dynamic value",
      text: workflow(
        '      - run: |\n          [Environment]::SetEnvironmentVariable("SMOKE_BROWSER", $engine)\n          npm run smoke',
      ),
      rules: [VIOLATION.BROWSER_ENV],
    },
    {
      name: "allows a SetEnvironmentVariable call pinning chromium",
      text: workflow(
        '      - run: |\n          [Environment]::SetEnvironmentVariable("SMOKE_BROWSER", "chromium", "Process")\n          npm run smoke',
      ),
      rules: [],
    },
    {
      name: "flags a .NET SetEnvironmentVariable call",
      text: workflow(
        '      - run: |\n          [Environment]::SetEnvironmentVariable("SMOKE_BROWSER", "firefox")\n          npm run smoke',
      ),
      rules: [VIOLATION.BROWSER_ENV],
    },
    {
      // Copilot, eighth review: the bare-value pattern used to run to
      // whitespace, so a QUOTED assignment captured the closing quote —
      // rejecting a permitted `chromium`. A false positive on the allowed value
      // fails a workflow that is doing the right thing, which is the worse
      // direction to be wrong in.
      name: "allows a quoted chromium appended to $GITHUB_ENV",
      text: workflow(
        '      - run: echo "SMOKE_BROWSER=chromium" >> $GITHUB_ENV',
      ),
      rules: [],
    },
    {
      name: "allows a quoted chromium in a cmd-style set",
      text: workflow('      - run: set "SMOKE_BROWSER=chromium"'),
      rules: [],
    },
    {
      name: "allows a single-quoted chromium in PowerShell",
      text: workflow(
        "      - run: $env:SMOKE_BROWSER = 'chromium'; npm run smoke",
      ),
      rules: [],
    },
    {
      // cmd's `set NAME=value` and the GitHub-native `>> $GITHUB_ENV` append
      // both carry the POSIX `NAME=value` substring, so one pattern covers all
      // three — worth pinning, since that is not obvious from reading it.
      name: "flags a cmd-style set",
      text: workflow("      - run: set SMOKE_BROWSER=firefox && npm run smoke"),
      rules: [VIOLATION.BROWSER_ENV],
    },
    {
      name: "flags an append to $GITHUB_ENV",
      text: workflow(
        '      - run: echo "SMOKE_BROWSER=firefox" >> $GITHUB_ENV',
      ),
      rules: [VIOLATION.BROWSER_ENV],
    },
    {
      name: "allows a PowerShell assignment of chromium",
      text: workflow(
        '      - run: |\n          $env:SMOKE_BROWSER = "chromium"\n          npm run smoke',
      ),
      rules: [],
    },
    {
      // Copilot, ninth review: a custom `shell:` is a COMMAND TEMPLATE Actions
      // runs around every script, so the invocation hides beside a `run:` value
      // that looks harmless.
      name: "flags a command in a step's shell template",
      text: [
        "on: push",
        "jobs:",
        "  build:",
        "    steps:",
        "      - shell: npm run local:gate && bash {0}",
        "        run: echo hello",
      ].join("\n"),
      rules: [VIOLATION.LOCAL_SCRIPT],
    },
    {
      name: "flags one in a job's defaults.run.shell",
      text: [
        "on: push",
        "jobs:",
        "  build:",
        "    defaults:",
        "      run:",
        "        shell: npm run smoke:web:firefox && bash {0}",
        "    steps:",
        "      - run: echo hello",
      ].join("\n"),
      rules: [VIOLATION.ENGINE_SCRIPT],
    },
    {
      name: "flags one in the workflow-level defaults.run.shell",
      text: [
        "on: push",
        "defaults:",
        "  run:",
        "    shell: npm run local:gate && bash {0}",
        "jobs:",
        "  build:",
        "    steps:",
        "      - run: echo hello",
      ].join("\n"),
      rules: [VIOLATION.LOCAL_SCRIPT],
    },
    {
      name: "leaves an ordinary shell name alone",
      text: workflow("      - shell: pwsh\n        run: npm run smoke"),
      rules: [],
    },
    {
      // Copilot, eleventh review: PowerShell's Env: drive is the other standard
      // way to write the environment there.
      name: "flags a Set-Item write to the Env: drive",
      text: workflow(
        "      - run: Set-Item Env:SMOKE_BROWSER firefox; npm run smoke",
      ),
      rules: [VIOLATION.BROWSER_ENV],
    },
    {
      name: "flags the named -Path/-Value spelling too",
      text: workflow(
        '      - run: New-Item -Path Env:SMOKE_BROWSER -Value "firefox"',
      ),
      rules: [VIOLATION.BROWSER_ENV],
    },
    {
      name: "allows a Set-Item write pinning chromium",
      text: workflow(
        '      - run: Set-Item -Path Env:SMOKE_BROWSER -Value "chromium"',
      ),
      rules: [],
    },
    {
      // Reading the variable is not setting it — the same distinction as
      // `echo "SMOKE_BROWSER: firefox"` from round 5.
      name: "does not flag a Get-Item read of the same variable",
      text: workflow("      - run: Get-Item Env:SMOKE_BROWSER; npm run smoke"),
      rules: [],
    },
    {
      // Copilot, tenth review: GitHub's multiline environment-file syntax.
      // Reported as unreadable rather than parsed — see the comment on the
      // pattern for why parsing it would be a coverage claim that only holds
      // for the shapes someone thought of.
      name: "flags a multi-line $GITHUB_ENV override",
      text: workflow(
        [
          "      - run: |",
          '          echo "SMOKE_BROWSER<<EOF" >> $GITHUB_ENV',
          '          echo "firefox" >> $GITHUB_ENV',
          '          echo "EOF" >> $GITHUB_ENV',
        ].join("\n"),
      ),
      rules: [VIOLATION.BROWSER_ENV],
    },
    {
      name: "flags a workflow-level env override",
      text: [
        "on: push",
        "env:",
        "  SMOKE_BROWSER: firefox",
        "jobs:",
        "  build:",
        "    steps:",
        "      - run: npm run smoke",
      ].join("\n"),
      rules: [VIOLATION.BROWSER_ENV],
    },
    {
      // Copilot, fifth review: `container.env` is job-wide too — every step in
      // the container sees it, so it redirects `npm run smoke` exactly as a
      // job-level `env` would.
      name: "flags a SMOKE_BROWSER override under container.env",
      text: [
        "on: push",
        "jobs:",
        "  build:",
        "    container:",
        "      image: node:22",
        "      env:",
        "        SMOKE_BROWSER: firefox",
        "    steps:",
        "      - run: npm run smoke",
      ].join("\n"),
      rules: [VIOLATION.BROWSER_ENV],
    },
    {
      name: "does not trip over a container given as a bare image string",
      text: [
        "on: push",
        "jobs:",
        "  build:",
        "    container: node:22",
        "    steps:",
        "      - run: npm run smoke",
      ].join("\n"),
      rules: [],
    },
    {
      // Copilot, fifth review: a blanket text match rejected a script that
      // merely PRINTS the variable name, which sets nothing.
      name: "does not read a script printing the variable as setting it",
      text: workflow(
        '      - run: |\n          echo "SMOKE_BROWSER: firefox"\n          npm run smoke',
      ),
      rules: [],
    },
    {
      name: "does not read an action input mentioning it as setting it",
      text: workflow(
        '      - with:\n          message: "SMOKE_BROWSER: firefox"',
      ),
      rules: [],
    },
    {
      name: "allows SMOKE_BROWSER set explicitly to chromium",
      text: workflow(
        "      - env:\n          SMOKE_BROWSER: chromium\n        run: npm run smoke",
      ),
      rules: [],
    },
    {
      name: "allows the smoke suite, which belongs in CI",
      text: workflow("      - run: npm run smoke"),
      rules: [],
    },
    {
      name: "allows the Chromium engine pass, which belongs in CI",
      text: workflow("      - run: npm run smoke:web:chromium"),
      rules: [],
    },
    {
      // #2148's tab smoke pins Chromium on both halves of its npm script and is
      // deliberately outside ENGINE_SMOKES — it is not an engine pass, and the
      // guard must not read `smoke:web:` as forbidden by itself.
      name: "allows the Chromium-only tab smoke",
      text: workflow("      - run: npm run smoke:web:tabs"),
      rules: [],
    },
    {
      name: "allows smoke:tui, which self-skips under CI on its own",
      text: workflow("      - run: npm run smoke:tui"),
      rules: [],
    },
    {
      name: "allows the rest of the CI chain",
      text: workflow(
        [
          "      - run: npm run validate",
          "      - run: npm run coverage",
          "      - run: npm run verify:build-gate",
          "      - run: npm run verify:bundle-externals",
          "      - run: npm run test:storybook",
        ].join("\n"),
      ),
      rules: [],
    },
    {
      // Copilot, second review: metadata executes nothing, so a finding there
      // is simply false — and the fastest way to get a guard deleted.
      name: "does not read a step name as an invocation",
      text: workflow(
        "      - name: Explain why smoke:web:firefox stays local\n        run: npm run smoke",
      ),
      rules: [],
    },
    {
      name: "does not read an `if:` condition as one either",
      text: workflow(
        "      - if: github.event_name == 'push'\n        run: npm run smoke",
      ),
      rules: [],
    },
    {
      // Copilot, fourth review: workflow input ids are user-defined, so an
      // input legitimately named `env` would have its own docs scanned by a
      // key-name match — failing the gate on documentation of the gate.
      name: "does not scan a workflow input that happens to be named env",
      text: [
        "on:",
        "  workflow_dispatch:",
        "    inputs:",
        "      env:",
        "        description: why smoke:web:firefox stays local",
        "        default: npm run local:gate",
        "jobs:",
        "  build:",
        "    steps:",
        "      - run: npm run smoke",
      ].join("\n"),
      rules: [],
    },
    {
      name: "does not read a similarly-named key as the override",
      text: workflow(
        "      - env:\n          SMOKE_BROWSER_DOC: firefox\n        run: npm run smoke",
      ),
      rules: [],
    },
    {
      name: "does not read a YAML comment as an invocation",
      text: workflow(
        "      # smoke:web:firefox runs in npm run local:gate, never here\n      - run: npm run smoke",
      ),
      rules: [],
    },
    {
      // Copilot, third review: this fixture used to be a YAML comment, which
      // the parser strips — so it asserted nothing. Inside a `run:` block the
      // comment text really does survive into the scalar, which is where the
      // "a comment invokes nothing" rule has to be applied.
      name: "does not read a shell comment inside a run block as one either",
      text: workflow(
        "      - run: |\n          # SMOKE_BROWSER=webkit is local-only\n          npm run smoke",
      ),
      rules: [],
    },
  ];

  for (const { name, text, rules } of cases) {
    it(name, () => {
      const found = findWorkflowViolations(text, "case.yml");
      assert.deepEqual(
        found.map((f) => f.rule),
        rules,
        formatWorkflowViolations(found),
      );
    });
  }

  it("reports the line a finding came from", () => {
    const [finding] = findWorkflowViolations(
      workflow("      - run: npm run local:gate"),
      "main.yml",
    );
    assert.equal(finding.line, 6);
    assert.equal(finding.file, "main.yml");
    assert.equal(finding.match, "local:gate");
  });

  it("names the file in a parse error, rather than a placeholder", () => {
    // The filename is passed in for diagnostics; forgetting to forward it left
    // a malformed real workflow reported as `<workflow>` (Copilot).
    assert.throws(
      () => findWorkflowViolations("jobs:\n  - a\n  b: c\n", "main.yml"),
      /could not parse main\.yml/,
    );
  });

  it("derives the forbidden engines rather than listing them by hand", () => {
    // Adding a fourth engine to SUPPORTED_BROWSERS must extend the guard, not
    // open a hole in it — which is why this reads the derived constant.
    assert.deepEqual(FORBIDDEN_ENGINE_SCRIPTS, [
      "smoke:web:firefox",
      "smoke:web:webkit",
      "smoke:web:engine",
    ]);
  });
});

describe("the gate's name", () => {
  const scripts = JSON.parse(
    readFileSync(join(repoRoot, "package.json"), "utf8"),
  ).scripts;

  it("is `local:gate`, and runs the local-only Storybook step", () => {
    assert.ok(scripts["local:gate"], "the pre-push gate must exist");
    assert.match(scripts["local:gate"], /local:storybook/);
  });

  describe("runs each client's test suite once, not twice (#2341)", () => {
    // CI runs each client's unit suite bare (inside `validate`) and again
    // instrumented (inside `coverage`) on two PARALLEL runners, so the second
    // pass is free there. The gate runs serially, where the bare pass was ~80s
    // of a ~370s run re-executing exactly the files `coverage` runs a few
    // minutes later. So the gate's first stage is `local:validate` — `validate`
    // minus every client's `test` leg — and these pin the three properties
    // that keep it honest: the gate no longer reaches a client's bare `test`,
    // it still reaches every non-test check `validate` reaches, and `validate`
    // itself (CI's inner loop) is untouched.
    const clients = ["web", "cli", "tui", "launcher"];
    const clientScripts = Object.fromEntries(
      clients.map((c) => [
        c,
        JSON.parse(
          readFileSync(join(repoRoot, "clients", c, "package.json"), "utf8"),
        ).scripts,
      ]),
    );

    it("starts from `local:validate`, and never from `validate`", () => {
      assert.match(scripts["local:gate"], /^npm run local:validate && /);
      assert.doesNotMatch(scripts["local:gate"], /\brun validate(?=$|[\s&;])/);
      // `local:validate` must not reach a client's `validate` either — that is
      // the one door through which the bare `test` leg would come back.
      const reached = reachableScripts(scripts, "local:validate");
      for (const c of clients)
        assert.ok(
          !reached.has(`validate:${c}`),
          `local:validate must not reach validate:${c}`,
        );
      // Each client is visited AND its `check` is the very next command —
      // matched together, so dropping one client's `npm run check` while the
      // `cd` and another client's `check` remain cannot stay green (Copilot).
      for (const c of clients)
        assert.match(
          scripts["local:validate"],
          new RegExp(
            `(?:cd (?:\\.\\./|clients/)${c} && npm run check|--prefix clients/${c} run check)(?=$|[\\s&;])`,
          ),
          `local:validate must run \`check\` in clients/${c}`,
        );
    });

    it("shares the guards and `validate:core` with `validate`", () => {
      // One list of durable guards, reached by both entry points — so a guard
      // added to `validate:guards` lands in CI and in the gate together.
      const gate = reachableScripts(scripts, "local:validate");
      const inner = reachableScripts(scripts, "validate");
      for (const name of ["validate:guards", "validate:core"]) {
        assert.ok(gate.has(name), `local:validate must reach ${name}`);
        assert.ok(inner.has(name), `validate must reach ${name}`);
      }
      // Everything `validate` reaches at the root that is not a client
      // delegation is reached by the gate too.
      for (const name of inner)
        if (
          name !== "validate" &&
          !/^validate:(web|cli|tui|launcher)$/.test(name)
        )
          assert.ok(gate.has(name), `local:validate must reach ${name}`);
    });

    it("each client's `validate` is `check` plus `test`, and `check` runs no tests", () => {
      for (const c of clients) {
        const s = clientScripts[c];
        assert.equal(
          s.validate,
          "npm run check && npm run test",
          `clients/${c} validate`,
        );
        const fromCheck = reachableScripts(s, "check");
        for (const name of fromCheck)
          assert.doesNotMatch(
            name,
            /^(pre|post)?test(:|$)/,
            `clients/${c} check must not reach ${name}`,
          );
        // `reachableScripts` follows `npm run <name>` only, so also reject the
        // spellings that reach the suite without one: a direct `vitest`, and
        // npm's built-in `npm test` / `npm t` / `npm tst` aliases (Copilot).
        const checkCommands = [...fromCheck].map((n) => s[n]).join(" ");
        assert.doesNotMatch(
          checkCommands,
          /\bvitest\b/,
          `clients/${c} check must not invoke vitest`,
        );
        assert.doesNotMatch(
          checkCommands,
          /\bnpm (?:test|t|tst)(?=$|[\s&;])/,
          `clients/${c} check must not invoke \`npm test\``,
        );
        // And `check` is the whole of `validate` minus the test leg: what
        // `validate` reaches is exactly itself, plus what `check` reaches, plus
        // what `test` reaches (its `pretest` build preambles included).
        assert.deepEqual(
          [...reachableScripts(s, "validate")].sort(),
          [
            ...new Set([
              "validate",
              ...fromCheck,
              ...reachableScripts(s, "test"),
            ]),
          ].sort(),
          `clients/${c} validate must reach exactly check + test`,
        );
      }
    });
  });

  it("has no `ci` alias, not even a deprecated one", () => {
    // The rename is only worth anything if the old name is GONE (#2146): an
    // alias preserves exactly the association being scrubbed, and leaves
    // something copy-pasteable for a workflow author. Nothing else notices a
    // reintroduced `ci`, so assert it here (Copilot).
    const revived = Object.keys(scripts).filter(
      (name) => name === "ci" || name.startsWith("ci:"),
    );
    assert.deepEqual(
      revived,
      [],
      `no root script may be named \`ci\` or \`ci:*\` — found ${revived.join(", ")}`,
    );
  });
});

describe("extractExecutableRegions", () => {
  it("descends the executable paths and skips the metadata beside them", () => {
    const regions = extractExecutableRegions(
      [
        "on: push",
        "jobs:",
        "  build:",
        "    steps:",
        "      - name: smoke:web:firefox is local-only",
        "        env:",
        "          SMOKE_BROWSER: chromium",
        "        run: npm run smoke",
      ].join("\n"),
    );
    // The step `name:` is absent, and the two executable values are not.
    // Order follows the walk (a step's `run` before its `env`), not the file.
    assert.deepEqual(
      regions.map((r) => [r.kind, r.text.trim()]),
      [
        ["run", "npm run smoke"],
        ["env", "SMOKE_BROWSER: chromium"],
      ],
    );
  });

  it("throws on a workflow it cannot parse, rather than finding nothing", () => {
    // A file that does not parse must not read as a file with nothing in it —
    // that is the one failure mode where an unreadable workflow passes.
    assert.throws(
      () => extractExecutableRegions("jobs:\n  - a\n  b: c\n", "broken.yml"),
      /could not parse broken\.yml/,
    );
  });
});

describe(".github/workflows", () => {
  const files = readdirSync(workflowDir).filter((f) => /\.ya?ml$/.test(f));

  it("has workflow files to check", () => {
    // Deny-by-default: an empty glob would otherwise make the check below pass
    // vacuously after a rename or a move of the workflow directory.
    assert.ok(
      files.length > 0,
      `no workflow files found in ${workflowDir} — the guard below would pass vacuously`,
    );
  });

  it("never invokes the local pre-push gate or a non-Chromium engine pass", () => {
    const findings = files.flatMap((file) =>
      findWorkflowViolations(
        readFileSync(join(workflowDir, file), "utf8"),
        file,
      ),
    );
    assert.deepEqual(
      findings,
      [],
      "GitHub CI must not run the local-only gate or a non-Chromium engine " +
        `pass (#2146):\n${formatWorkflowViolations(findings)}`,
    );
  });
});
