/**
 * Unit tests for `verify-test-timeouts.mjs`'s pure decision logic.
 *
 * The guard's own resolution half needs a real Vitest and four real configs, so
 * it is exercised by running it (it is in `validate`). What is tested here is
 * everything that decides PASS or FAIL once a project is resolved — including
 * the two failure modes a green repo can never produce on its own: an unknown
 * project, and a `retry` someone added.
 *
 * ⚠️ This suite used to be twice this size, pinning the edge cases of a source
 * scanner that no longer exists — a commented-out call, a nested paren in a
 * chain argument, an aliased import. Those rules are asserted at runtime now
 * (`vitest.setup.shared.mts`, `clients/web/src/test/asyncUtilTimeout.test.ts`),
 * where there is no spelling to anticipate and so nothing to pin.
 *
 * ⚠️ Keep the filename exactly `verify-test-timeouts.test.mjs`. `node --test`
 * silently SKIPS a file its glob misses and still exits 0, so a typo here reads
 * as a passing suite.
 */

import test from "node:test";
import assert from "node:assert/strict";

import {
  CONFIG_ROOTS,
  EXPECTED_INTEGRATION_TIMEOUTS,
  EXPECTED_PROJECTS,
  EXPECTED_TIMEOUTS,
  checkConfigRootCoverage,
  checkNoRetrySetupLoaded,
  checkProject,
  discoverConfigRoots,
  identifyProject,
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

test("a project that does not load the no-retry setup is caught", () => {
  // The runtime assertion binds only a project that loads it, so a dropped
  // setupFiles entry would un-enforce the rule while everything still looked
  // configured. This is the one thing about that assertion a resolved config
  // can answer.
  const failures = checkNoRetrySetupLoaded("unit", []);
  assert.equal(failures.length, 1);
  assert.match(failures[0], /does not load vitest\.setup\.shared\.mts/);

  assert.deepEqual(
    checkNoRetrySetupLoaded("unit", [
      "/repo/clients/web/src/test/setup.ts",
      "/repo/vitest.setup.shared.mts",
    ]),
    [],
  );
});
