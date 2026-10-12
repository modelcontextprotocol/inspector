/**
 * The Firefox container routing (#2625).
 *
 * What can rot silently here: the host check widening to hosts that launch
 * Firefox fine (a ~2GB image pull for nothing), narrowing so macOS 27 is back
 * to a 180s launch timeout, or the image tag drifting from the lockfile. The
 * Docker invocation itself is pinned so the in-container run cannot recurse
 * into another container.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  ISSUE,
  MODE_ENV,
  dockerRunArgs,
  exportablePaths,
  pinnedPlaywrightVersion,
  playwrightImage,
  runInContainer,
  shouldUseContainer,
} from "./firefox-container.mjs";

const repoRoot = join(import.meta.dirname, "..", "..");

describe("shouldUseContainer", () => {
  const host = (overrides) => ({
    engine: "firefox",
    platform: "darwin",
    release: "27.0.0",
    env: {},
    ...overrides,
  });

  it("routes Firefox on Darwin 27 and later", () => {
    assert.equal(shouldUseContainer(host()), true);
    assert.equal(shouldUseContainer(host({ release: "28.1.0" })), true);
  });

  it("launches natively on earlier macOS and on other platforms", () => {
    assert.equal(shouldUseContainer(host({ release: "26.4.0" })), false);
    assert.equal(shouldUseContainer(host({ platform: "linux" })), false);
    assert.equal(shouldUseContainer(host({ platform: "win32" })), false);
    assert.equal(shouldUseContainer(host({ release: "garbage" })), false);
  });

  it("never routes another engine, whatever the override says", () => {
    for (const engine of ["chromium", "webkit"]) {
      assert.equal(shouldUseContainer(host({ engine })), false);
      assert.equal(
        shouldUseContainer(host({ engine, env: { [MODE_ENV]: "container" } })),
        false,
      );
    }
  });

  it("honors the override in both directions", () => {
    assert.equal(
      shouldUseContainer(host({ env: { [MODE_ENV]: "native" } })),
      false,
    );
    assert.equal(
      shouldUseContainer(
        host({ platform: "linux", env: { [MODE_ENV]: "container" } }),
      ),
      true,
    );
    // An unrecognized value falls through to the host check.
    assert.equal(
      shouldUseContainer(host({ env: { [MODE_ENV]: "maybe" } })),
      true,
    );
  });
});

describe("the image tag", () => {
  it("is derived from the lockfile's exact Playwright version", () => {
    const lock = JSON.stringify({
      packages: { "node_modules/playwright": { version: "1.62.1" } },
    });
    assert.equal(pinnedPlaywrightVersion(lock), "1.62.1");
    assert.equal(
      playwrightImage("1.62.1"),
      "mcr.microsoft.com/playwright:v1.62.1-noble",
    );
  });

  it("throws rather than guessing when the lockfile has no exact version", () => {
    assert.throws(() => pinnedPlaywrightVersion("{}"), /no exact/);
    assert.throws(
      () =>
        pinnedPlaywrightVersion(
          JSON.stringify({
            packages: { "node_modules/playwright": { version: "^1.62.1" } },
          }),
        ),
      /no exact/,
    );
  });

  it("resolves from the real clients/web lockfile", () => {
    const text = readFileSync(
      join(repoRoot, "clients/web/package-lock.json"),
      "utf8",
    );
    assert.match(pinnedPlaywrightVersion(text), /^\d+\.\d+\.\d+$/);
  });
});

describe("dockerRunArgs", () => {
  const args = dockerRunArgs({
    exportDir: "/tmp/x",
    image: "img:tag",
    engine: "firefox",
  });

  it("mounts the export, not the checkout, and runs the image", () => {
    assert.ok(args.includes("/tmp/x:/src"));
    assert.equal(args[args.indexOf("-w") + 1], "/src");
    assert.ok(args.includes("img:tag"));
    assert.ok(args.includes("--rm"));
  });

  it("forces a native launch inside so the run cannot recurse", () => {
    assert.ok(args.includes(`${MODE_ENV}=native`));
  });

  it("hands the tree back to the caller on exit when the owner is known", () => {
    const owned = dockerRunArgs({
      exportDir: "/tmp/x",
      image: "img:tag",
      engine: "firefox",
      owner: "501:20",
    });
    assert.match(
      owned.at(-1),
      /^trap 'chown -R 501:20 \/src' EXIT; npm install /,
    );
    assert.doesNotMatch(args.at(-1), /chown/);
  });

  it("installs, builds, then runs the same runner for the same engine", () => {
    assert.match(
      args.at(-1),
      /^npm install .*&& npm run build && node scripts\/run-engine-smokes\.mjs firefox$/,
    );
  });
});

describe("exportablePaths", () => {
  it("dedupes and drops tracked files deleted from the working tree", () => {
    const out = "a.txt\0b/c.mjs\0gone.md\0a.txt\0";
    assert.deepEqual(
      exportablePaths(out, (p) => p !== "gone.md"),
      ["a.txt", "b/c.mjs"],
    );
  });

  it("handles empty output", () => {
    assert.deepEqual(
      exportablePaths("", () => true),
      [],
    );
  });
});

describe("runInContainer", () => {
  const LOCK = JSON.stringify({
    packages: { "node_modules/playwright": { version: "1.62.1" } },
  });

  /** Fakes for every side effect, recording what was called. */
  function fakes(overrides = {}) {
    const calls = { docker: [], removed: [], warned: [], errored: [] };
    const deps = {
      dockerAvailable: () => true,
      readLockfile: () => LOCK,
      makeTempDir: () => "/tmp/export",
      exportWorkingTree: () => 3,
      runDocker: (args) => {
        calls.docker.push(args);
        return { status: 0 };
      },
      removeDir: (dir) => calls.removed.push(dir),
      hostOwner: () => "501:20",
      log: () => {},
      warn: (msg) => calls.warned.push(msg),
      error: (msg) => calls.errored.push(msg),
      ...overrides,
    };
    return { calls, deps };
  }
  const run = (deps) =>
    runInContainer({ repoRoot: "/repo", engine: "firefox" }, deps);

  it("skips loudly and exits 0 when no Docker daemon answers", () => {
    const { calls, deps } = fakes({ dockerAvailable: () => false });
    assert.equal(run(deps), 0);
    assert.equal(calls.docker.length, 0, "must not try to run docker");
    assert.equal(calls.removed.length, 0, "nothing was created to remove");
    const banner = calls.warned.join("\n");
    assert.match(banner, /SKIPPING the firefox engine pass/);
    assert.match(banner, /NOT a pass/);
    assert.match(banner, new RegExp(ISSUE));
  });

  it("runs the pinned image over the export as the caller, then cleans up", () => {
    const { calls, deps } = fakes();
    assert.equal(run(deps), 0);
    const [args] = calls.docker;
    assert.ok(args.includes("mcr.microsoft.com/playwright:v1.62.1-noble"));
    assert.ok(args.includes("/tmp/export:/src"));
    assert.match(args.at(-1), /chown -R 501:20/);
    assert.deepEqual(calls.removed, ["/tmp/export"]);
  });

  it("propagates a failing container's status and still cleans up", () => {
    const { calls, deps } = fakes({ runDocker: () => ({ status: 7 }) });
    assert.equal(run(deps), 7);
    assert.match(calls.errored.join(), /failed inside/);
    assert.deepEqual(calls.removed, ["/tmp/export"]);
  });

  it("fails on a docker spawn error and on a signal-killed container", () => {
    const spawnErr = fakes({
      runDocker: () => ({ status: null, error: new Error("ENOENT") }),
    });
    assert.equal(run(spawnErr.deps), 1);
    assert.match(spawnErr.calls.errored.join(), /docker failed: ENOENT/);
    assert.equal(run(fakes({ runDocker: () => ({ status: null }) }).deps), 1);
  });

  it("cleans up even when the export throws", () => {
    const { calls, deps } = fakes({
      exportWorkingTree: () => {
        throw new Error("git ls-files failed");
      },
    });
    assert.throws(() => run(deps), /git ls-files failed/);
    assert.deepEqual(calls.removed, ["/tmp/export"]);
  });

  it("only warns when cleanup fails, keeping the run's status", () => {
    const { calls, deps } = fakes({
      removeDir: () => {
        throw new Error("EACCES");
      },
    });
    assert.equal(run(deps), 0);
    assert.match(calls.warned.join(), /could not remove \/tmp\/export: EACCES/);
  });
});

it("names the tracking issue", () => {
  assert.equal(ISSUE, "#2625");
});
