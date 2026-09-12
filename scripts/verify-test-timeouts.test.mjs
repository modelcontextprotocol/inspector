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
  identifyProject,
  stripComments,
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
