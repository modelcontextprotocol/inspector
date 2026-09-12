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
  EXPECTED_INTEGRATION_TIMEOUTS,
  EXPECTED_PROJECTS,
  EXPECTED_TIMEOUTS,
  checkAsyncUtilSource,
  checkProject,
  identifyProject,
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
configure({ asyncUtilTimeout: 5000 });`;
  assert.deepEqual(checkAsyncUtilSource(source, "@testing-library/react"), []);
});

test("configure() without the timeout is caught", () => {
  const source = `import { configure } from "storybook/test";
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
configure({ asyncUtilTimeout: 5000 });`;
  assert.deepEqual(checkAsyncUtilSource(source, "storybook/test"), [
    'does not import from "storybook/test"',
  ]);
});

test("a setup file with no configure() at all is caught", () => {
  const failures = checkAsyncUtilSource(
    "export const nothing = 1;\n",
    "storybook/test",
  );
  assert.equal(failures.length, 2);
});

test("both web projects have an asyncUtilTimeout site", () => {
  assert.deepEqual(ASYNC_UTIL_SITES.map((s) => s.project).sort(), [
    "storybook",
    "unit",
  ]);
});
