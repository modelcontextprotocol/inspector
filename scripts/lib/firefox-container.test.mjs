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

it("names the tracking issue", () => {
  assert.equal(ISSUE, "#2625");
});
