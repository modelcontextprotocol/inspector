/**
 * Unit tests for `verify-test-timeouts.mjs`'s pure decision logic.
 *
 * The guard's own resolution half needs a real Vitest and four real configs, so
 * it is exercised by running it (it is in `validate`). What is tested here is
 * everything that decides PASS or FAIL once a project is resolved — including
 * the two failure modes a green repo can never produce on its own: an unknown
 * project, and a `retry` someone added.
 *
 * ⚠️ Keep the filename exactly `verify-test-timeouts.test.mjs`. `node --test`
 * silently SKIPS a file its glob misses and still exits 0, so a typo here reads
 * as a passing suite.
 */

import test from "node:test";
import assert from "node:assert/strict";

import {
  ASYNC_UTIL_SITES,
  CONFIG_ROOTS,
  EXPECTED_ASYNC_UTIL_TIMEOUT,
  EXPECTED_INTEGRATION_TIMEOUTS,
  EXPECTED_PROJECTS,
  EXPECTED_TIMEOUTS,
  checkAsyncUtilSource,
  checkConfigRootCoverage,
  checkProject,
  checkSetupFilesWiring,
  discoverConfigRoots,
  findScriptRetries,
  findTestLevelRetries,
  identifyProject,
  stripComments,
  VITEST_CONFIG_FILENAMES,
} from "./verify-test-timeouts.mjs";

const ok = { ...EXPECTED_TIMEOUTS };

test("a project on the stated budgets passes", () => {
  assert.deepEqual(checkProject("unit", ok), []);
  assert.deepEqual(checkProject("cli", ok), []);
  assert.deepEqual(
    checkProject("integration", { ...EXPECTED_INTEGRATION_TIMEOUTS }),
    [],
  );
});

test("each budget is checked independently", () => {
  for (const key of Object.keys(EXPECTED_TIMEOUTS)) {
    const failures = checkProject("unit", { ...ok, [key]: 1234 });
    assert.equal(failures.length, 1, `${key} was not checked`);
    assert.match(failures[0], new RegExp(`${key} to 1234, expected`));
  }
});

test("a budget left on a library default is a failure, not an omission", () => {
  // The exact shape this guard exists for: Vitest's own 5000/10000, which is
  // what five of the six projects resolved to before #2323.
  const failures = checkProject("tui", {
    testTimeout: 5000,
    hookTimeout: 10000,
    teardownTimeout: 10000,
  });
  assert.equal(failures.length, 3);
});

test("an absent budget fails rather than being treated as fine", () => {
  // `undefined !== 15000`. Worth pinning: a config that stopped being loaded
  // resolves every key to undefined, and that must not read as a pass.
  assert.equal(checkProject("unit", {}).length, 3);
});

test("a project with no row fails loudly", () => {
  const failures = checkProject("brand-new", ok);
  assert.equal(failures.length, 1);
  assert.match(failures[0], /no row in EXPECTED_PROJECTS/);
});

test("retry is allowed to be unset or 0, and nothing else", () => {
  assert.deepEqual(checkProject("unit", { ...ok }), []);
  assert.deepEqual(checkProject("unit", { ...ok, retry: 0 }), []);
  for (const retry of [1, 2]) {
    const failures = checkProject("unit", { ...ok, retry });
    assert.equal(failures.length, 1);
    assert.match(failures[0], /retry/);
  }
});

test("every project in the table is one the configs are asked for", () => {
  const declared = CONFIG_ROOTS.flatMap((c) => c.projects).sort();
  assert.deepEqual(declared, Object.keys(EXPECTED_PROJECTS).sort());
});

test("a nameless single project takes its name from the config entry", () => {
  // The node clients set no `name`, so their one project resolves as "".
  assert.equal(identifyProject({ name: "" }, ["cli"]), "cli");
});

test("a browser project is matched past its instance suffix", () => {
  assert.equal(
    identifyProject({ name: "storybook (chromium)" }, [
      "unit",
      "integration",
      "storybook",
    ]),
    "storybook",
  );
});

test("an unrecognized project name is not silently matched", () => {
  assert.equal(
    identifyProject({ name: "e2e" }, ["unit", "storybook"]),
    undefined,
  );
  // Nameless only resolves when the entry expects exactly one project —
  // otherwise the guard cannot tell which row it belongs to.
  assert.equal(identifyProject({ name: "" }, ["unit", "storybook"]), undefined);
});

test("a setup file that configures asyncUtilTimeout passes", () => {
  const source = `import { cleanup, configure } from "@testing-library/react";
configure({ asyncUtilTimeout: 1000 });`;
  assert.deepEqual(checkAsyncUtilSource(source, "@testing-library/react"), []);
});

test("configure() without the timeout is caught", () => {
  const source = `import { configure } from "storybook/test";
configure({ testIdAttribute: "data-testid" });`;
  assert.deepEqual(checkAsyncUtilSource(source, "storybook/test"), [
    "calls configure() without an asyncUtilTimeout",
  ]);
});

test("a split import does not satisfy the check", () => {
  // The hole this closes: checking "imports from X" and "calls configure()"
  // independently passes when `configure` comes from a *different* Testing
  // Library copy than the one the tests use, which is a configuration nothing
  // reads — and green by inspection (Copilot).
  const source = `import { cleanup } from "@testing-library/react";
import { configure } from "@testing-library/dom";
configure({ asyncUtilTimeout: 1000 });`;
  assert.deepEqual(checkAsyncUtilSource(source, "@testing-library/react"), [
    'does not import configure from "@testing-library/react"',
  ]);
});

test("configure imported under an alias is followed to its call", () => {
  const source = `import { configure as cfg } from "storybook/test";
cfg({ asyncUtilTimeout: 1000 });`;
  assert.deepEqual(checkAsyncUtilSource(source, "storybook/test"), []);

  const unused = `import { configure as cfg } from "storybook/test";
configure({ asyncUtilTimeout: 1000 });`;
  assert.deepEqual(checkAsyncUtilSource(unused, "storybook/test"), [
    "does not call cfg()",
  ]);
});

test("the timeout is read from the configure call, not from anywhere in the file", () => {
  // A matching number elsewhere in the module must not stand in for the
  // argument actually passed.
  const source = `import { configure } from "storybook/test";
const asyncUtilTimeout = 1000;
configure({ testIdAttribute: "data-testid" });`;
  assert.deepEqual(checkAsyncUtilSource(source, "storybook/test"), [
    "calls configure() without an asyncUtilTimeout",
  ]);
});

test("the import is checked, not just the call", () => {
  // Storybook instruments its own Testing Library copy, so configuring
  // `@testing-library/*` from a story setup configures a copy no play function
  // ever calls — green by inspection, dead in practice.
  const source = `import { configure } from "@testing-library/dom";
configure({ asyncUtilTimeout: 1000 });`;
  assert.deepEqual(checkAsyncUtilSource(source, "storybook/test"), [
    'does not import from "storybook/test"',
  ]);
});

test("a setup file with no configure() at all is caught", () => {
  // Reported as the missing import and nothing else: once the module is not
  // imported there is no binding to look for a call to, so listing a second
  // failure would be guesswork about which of the two the author meant.
  assert.deepEqual(
    checkAsyncUtilSource("export const nothing = 1;\n", "storybook/test"),
    ['does not import from "storybook/test"'],
  );
});

test("both web projects have an asyncUtilTimeout site", () => {
  assert.deepEqual(ASYNC_UTIL_SITES.map((s) => s.project).sort(), [
    "storybook",
    "unit",
  ]);
});

test("a commented-out configure() does not satisfy the check", () => {
  // The most likely way this stops being configured is someone disabling it in
  // place, and a raw-source scan would read that as configured (Copilot).
  const lineComment = `import { configure } from "storybook/test";
// configure({ asyncUtilTimeout: 1000 });`;
  assert.deepEqual(checkAsyncUtilSource(lineComment, "storybook/test"), [
    "does not call configure()",
  ]);

  const blockComment = `import { configure } from "storybook/test";
/* configure({ asyncUtilTimeout: 1000 }); */`;
  assert.deepEqual(checkAsyncUtilSource(blockComment, "storybook/test"), [
    "does not call configure()",
  ]);
});

test("the configured value must be the expected one, not merely present", () => {
  const source = `import { configure } from "storybook/test";
configure({ asyncUtilTimeout: 9000 });`;
  assert.deepEqual(checkAsyncUtilSource(source, "storybook/test"), [
    `configures asyncUtilTimeout as 9000, expected ${EXPECTED_ASYNC_UTIL_TIMEOUT}`,
  ]);
});

test("a numeric separator in the configured value is read, not rejected", () => {
  const source = `import { configure } from "storybook/test";
configure({ asyncUtilTimeout: 1_000 });`;
  assert.deepEqual(checkAsyncUtilSource(source, "storybook/test"), []);
});

test("a call disabled in a TRAILING line comment does not satisfy the check", () => {
  // The anchored regex this replaced only stripped `//` at the start of a line,
  // so a call commented out after code survived and the guard passed with no
  // effective configuration (Copilot).
  const source = `import { configure } from "storybook/test";
const disabled = true; // configure({ asyncUtilTimeout: 1000 });`;
  assert.deepEqual(checkAsyncUtilSource(source, "storybook/test"), [
    "does not call configure()",
  ]);
});

test("a // inside a string literal is not treated as a comment", () => {
  // The failure mode in the other direction: an unanchored strip would truncate
  // any line holding a URL, which could remove the real call.
  const source = `import { configure } from "storybook/test";
const docs = "https://testing-library.com/docs";
configure({ asyncUtilTimeout: 1000 });`;
  assert.deepEqual(checkAsyncUtilSource(source, "storybook/test"), []);
  assert.match(stripComments(source), /https:\/\/testing-library/);
});

test("stripComments handles escapes and mid-line block comments", () => {
  assert.equal(stripComments("a /* x */ b"), "a  b");
  // A backslash-escaped quote must not close the string early, or everything
  // after it would be scanned as code.
  assert.match(stripComments('const s = "a\\" // b";\nkeep'), /keep/);
});

test("stripComments leaves executable code alone", () => {
  const source = `/** header */
import { configure } from "storybook/test"; // trailing
configure({ asyncUtilTimeout: 1000 });`;
  const code = stripComments(source);
  assert.match(code, /configure\(\{ asyncUtilTimeout: 1000 \}\)/);
  assert.doesNotMatch(code, /header/);
});

test("a project that does not load its declared setup file is caught", () => {
  // Reading the file proves it configures the timeout; only this proves the
  // project ever loads it. Deleting the setupFiles entry used to leave the
  // guard reporting both projects configured (Copilot).
  const failures = checkSetupFilesWiring("unit", []);
  assert.equal(failures.length, 1);
  assert.match(failures[0], /does not load .*setup\.ts as a setupFile/);
});

test("a setup file loaded under an absolute path is recognized", () => {
  assert.deepEqual(
    checkSetupFilesWiring("unit", [
      "/repo/clients/web/src/test/setup.ts",
      "/repo/other.ts",
    ]),
    [],
  );
});

test("a project with no declared site is not required to load one", () => {
  assert.deepEqual(checkSetupFilesWiring("cli", []), []);
  assert.deepEqual(checkSetupFilesWiring("cli", undefined), []);
});

test("a Vitest config this guard does not check is an error", () => {
  const failures = checkConfigRootCoverage([
    "clients/web",
    "clients/cli",
    "clients/tui",
    "clients/launcher",
    "clients/desktop",
  ]);
  assert.equal(failures.length, 1);
  assert.match(failures[0], /clients\/desktop has a Vitest config/);
});

test("a stale row naming a config that no longer exists is an error", () => {
  const failures = checkConfigRootCoverage(["clients/web", "clients/cli"]);
  assert.equal(failures.length, 2);
  for (const f of failures) assert.match(f, /has no Vitest config on disk/);
});

test("discovery finds exactly the configs this guard is set up to check", () => {
  // The two halves have to agree against the real repo, not only against
  // fixtures — that agreement is what makes the unknown-project check below
  // mean anything.
  assert.deepEqual(
    discoverConfigRoots().sort(),
    CONFIG_ROOTS.map((c) => c.root).sort(),
  );
  assert.deepEqual(checkConfigRootCoverage(discoverConfigRoots()), []);
});

test("a retry on an individual test or suite is caught", () => {
  // The project-level check cannot see these, and the decision is about the
  // behavior rather than about one config key (Copilot).
  for (const src of [
    `it("x", { retry: 2 }, async () => {});`,
    `test("x", { retry: 1 }, () => {});`,
    `describe("x", { retry: 3 }, () => {});`,
    `it.each([1])("x %i", { retry: 2 }, () => {});`,
    'describe.each([[1, 2]])("x", { retry: 1 }, () => {});',
    // Nested parentheses in the chain's own argument. A character class cannot
    // step over either of these, so both were blind spots (Copilot).
    'it.each([makeCase()])("x", { retry: 2 }, () => {});',
    'it.skipIf(() => isWindows())("x", { retry: 2 }, () => {});',
    'it.each`a|b`("x", { retry: 3 }, () => {});',
    `it('single quoted', { timeout: 100, retry: 2 }, () => {});`,
  ]) {
    assert.equal(findTestLevelRetries(src).length, 1, src);
  }
});

test("a retry that is not a test option is not a false positive", () => {
  // All four shapes exist in this repo. A bare /\bretry\b/ scan would fail on
  // every one of them, and a guard that cries wolf gets disabled.
  for (const src of [
    `const fixture = { retry: 2 };`,
    `expect(client.retry).toBe(2);`,
    `it("x", async () => { await withRetries({ retry: 2 }); });`,
    `vi.mock("x", () => ({ retry: 2 }));`,
    `it("has retry: 2 in the name", () => {});`,
    `const o = { noRetry: 2 };`,
    // Shorthand for a DIFFERENT property must not match the shorthand form.
    `it("x", { retryCount }, () => {});`,
  ]) {
    assert.deepEqual(findTestLevelRetries(src), [], src);
  }
});

test("a retry hidden in a comment is not reported", () => {
  assert.deepEqual(
    findTestLevelRetries(`// it("x", { retry: 2 }, () => {});`),
    [],
  );
});

test("a --retry flag in an npm script is caught", () => {
  assert.deepEqual(findScriptRetries({ test: "vitest run --retry=2" }), [
    "test: vitest run --retry=2",
  ]);
  assert.equal(findScriptRetries({ test: "vitest run --retry 2" }).length, 1);
});

test("a script that merely contains the word retry is not a false positive", () => {
  assert.deepEqual(
    findScriptRetries({ test: "vitest run retry-helper.ts" }),
    [],
  );
  assert.deepEqual(findScriptRetries({ test: "vitest run --no-retry-x" }), []);
  assert.deepEqual(findScriptRetries({}), []);
  assert.deepEqual(findScriptRetries(undefined), []);
});

test("discovery knows every filename Vitest loads a config from", () => {
  // Deny-by-default only holds if discovery sees every config Vitest would; a
  // `vitest.config.mts` this list did not name would be invisible (Copilot).
  for (const ext of ["ts", "mts", "cts", "js", "mjs", "cjs"]) {
    assert.ok(
      VITEST_CONFIG_FILENAMES.includes(`vitest.config.${ext}`),
      `vitest.config.${ext}`,
    );
    assert.ok(
      VITEST_CONFIG_FILENAMES.includes(`vite.config.${ext}`),
      `vite.config.${ext}`,
    );
  }
  // vitest.config.* is preferred over vite.config.*, as Vitest itself does.
  assert.ok(
    VITEST_CONFIG_FILENAMES.indexOf("vitest.config.cjs") <
      VITEST_CONFIG_FILENAMES.indexOf("vite.config.ts"),
  );
});

test("every configure() call is inspected, not just the first", () => {
  // The later call wins at runtime, so approving a file on its first call would
  // approve one whose effective timeout is something else entirely (Copilot).
  const overridden = `import { configure } from "storybook/test";
configure({ asyncUtilTimeout: 1000 });
configure({ asyncUtilTimeout: 5000 });`;
  assert.deepEqual(checkAsyncUtilSource(overridden, "storybook/test"), [
    "configures asyncUtilTimeout as 5000, expected 1000",
  ]);
});

test("a configure() call that sets something else does not hide the real one", () => {
  const source = `import { configure } from "storybook/test";
configure({ testIdAttribute: "data-testid" });
configure({ asyncUtilTimeout: 1000 });`;
  assert.deepEqual(checkAsyncUtilSource(source, "storybook/test"), []);
});

test("the shorthand property form is caught", () => {
  // `{ retry }` is the same declaration as `{ retry: 2 }` with the value bound
  // above, and a colon-requiring pattern misses it entirely (Copilot).
  assert.deepEqual(
    findTestLevelRetries('const retry = 2; it("x", { retry }, () => {});'),
    ["retry (shorthand)"],
  );
  assert.deepEqual(
    findTestLevelRetries('it("x", { timeout: 100, retry }, () => {});'),
    ["retry (shorthand)"],
  );
});

test("a member call is not mistaken for the imported binding", () => {
  // `\\b` succeeds straight after a dot, so `other.configure(…)` satisfied the
  // check while the imported binding was never called at all (Copilot).
  const source = `import { configure } from "storybook/test";
other.configure({ asyncUtilTimeout: 1000 });`;
  assert.deepEqual(checkAsyncUtilSource(source, "storybook/test"), [
    "does not call configure()",
  ]);
});

test("a longer identifier ending in the binding name is not a call to it", () => {
  const source = `import { configure } from "storybook/test";
reconfigure({ asyncUtilTimeout: 1000 });`;
  assert.deepEqual(checkAsyncUtilSource(source, "storybook/test"), [
    "does not call configure()",
  ]);
});
