/**
 * The engine-smoke runner's list (#2086).
 *
 * `ENGINE_SMOKES` is the single home for "which smokes are engine-sensitive",
 * and the thing that can silently rot about it is a smoke going missing — the
 * suite still passes, just covering less. Nothing at runtime notices, because a
 * shorter list is a *successful* run.
 *
 * Importing the module must not spawn anything; `main()` is behind an entrypoint
 * guard, and this test would catch that regressing by running three browser
 * smokes the moment the suite imported it.
 */

import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { ENGINE_SMOKES } from "./run-engine-smokes.mjs";
import { SUPPORTED_BROWSERS } from "./lib/headless-browser.mjs";
import { scriptChainRuns } from "./lib/npm-scripts.mjs";

const scriptDir = import.meta.dirname;
const scripts = JSON.parse(
  readFileSync(join(scriptDir, "..", "package.json"), "utf8"),
).scripts;

describe("ENGINE_SMOKES", () => {
  it("names every browser-driven smoke, and each one exists", () => {
    // Deliberately spelled out rather than derived: this list IS the coverage
    // claim, so a test that computed it from disk would agree with any mistake.
    assert.deepEqual(ENGINE_SMOKES, [
      "smoke-web-browser.mjs",
      "smoke-web-app.mjs",
      "smoke-web-elicitation.mjs",
    ]);
    for (const smoke of ENGINE_SMOKES) {
      assert.ok(
        existsSync(join(scriptDir, smoke)),
        `${smoke} is listed but missing — a rename would silently shrink the run`,
      );
    }
  });

  it("runs the cheapest smoke first", () => {
    // smoke-web-browser only boots the bundle; the other two drive a whole App
    // flow with 45s waits. Ordering it first is what makes "this engine cannot
    // run the bundle at all" fail in seconds rather than after two timeouts.
    assert.equal(ENGINE_SMOKES[0], "smoke-web-browser.mjs");
  });
});

describe("every engine tier consumes ENGINE_SMOKES", () => {
  // The point of the list is defeated if any tier enumerates the smokes itself.
  // `npm run smoke` used to do exactly that (Copilot, #2133): a fourth entry in
  // ENGINE_SMOKES would have reached the Firefox and on-demand runs and silently
  // skipped the DEFAULT Chromium run — which is the one GitHub CI executes. That
  // is invisible at runtime, because a tier running fewer smokes still passes.

  it("the Chromium tier goes through the runner, not its own list", () => {
    assert.match(scripts["smoke:web:chromium"], /run-engine-smokes\.mjs/);
    assert.match(scripts.smoke, /smoke:web:chromium/);
    for (const individual of [
      "smoke:web:browser",
      "smoke:web:app",
      "smoke:web:elicit",
    ]) {
      assert.ok(
        !scripts.smoke.includes(individual),
        `\`smoke\` names ${individual} directly — it must route through ` +
          "`smoke:web:chromium` so every tier reads one list",
      );
    }
  });

  it("the Firefox tier goes through the runner and is in the pre-push gate", () => {
    assert.match(scripts["smoke:web:firefox"], /run-engine-smokes\.mjs/);
    // Through the #2339 lease wrapper, which `scriptChainRuns` looks past.
    assert.ok(scriptChainRuns(scripts, "local:gate", "smoke:web:firefox"));
  });

  it("every supported engine has a `smoke:web:<engine>` script", () => {
    // loadBrowser's launch-failure message tells the reader to run
    // `npm run smoke:web:<engine>`. If a supported engine has no such script,
    // that remedy is unrunnable — which is how the message shipped naming
    // `smoke:web:webkit` before it existed (Copilot, #2133).
    for (const name of SUPPORTED_BROWSERS) {
      assert.match(
        scripts[`smoke:web:${name}`] ?? "",
        new RegExp(`run-engine-smokes\\.mjs ${name}$`),
        `npm run smoke:web:${name} is promised by the launch-failure message`,
      );
    }
  });

  it("the Chromium-only tab smoke pins its engine on BOTH halves", () => {
    // `smoke:web:tabs` is not engine-sensitive and deliberately stays out of
    // ENGINE_SMOKES — but "Chromium-only" is a claim the script has to keep.
    // Without the literal engine it followed ambient `SMOKE_BROWSER`, so
    // `SMOKE_BROWSER=firefox npm run local:gate` would have run it under Firefox
    // (Copilot, #2148). Both halves are pinned because they must AGREE: an
    // install of one engine and a launch of another surfaces as a confusing
    // "Executable doesn't exist" rather than as the wiring error it is.
    assert.match(
      scripts["smoke:web:tabs"],
      /install-smoke-browser\.mjs chromium .*smoke-web-tabs\.mjs chromium$/,
    );
    // And it must not be in ENGINE_SMOKES, or the Firefox tier would pick it
    // up regardless of what its own script pins.
    assert.ok(!ENGINE_SMOKES.includes("smoke-web-tabs.mjs"));
  });

  it("each gated tier names its engine explicitly rather than reading the env", () => {
    // An ambient SMOKE_BROWSER must not be able to redirect a gate: without the
    // literal engine, `SMOKE_BROWSER=firefox npm run local:gate` would run Firefox twice
    // and never exercise Chromium at all.
    assert.match(
      scripts["smoke:web:chromium"],
      /run-engine-smokes\.mjs chromium$/,
    );
    assert.match(
      scripts["smoke:web:firefox"],
      /run-engine-smokes\.mjs firefox$/,
    );
    // The on-demand entry point is the one that SHOULD follow the environment.
    assert.match(scripts["smoke:web:engine"], /run-engine-smokes\.mjs$/);
  });
});

describe("each smoke's own docs point at its own command", () => {
  /** The npm script that runs each engine-sensitive smoke on its own. */
  const OWN_SCRIPT = {
    "smoke-web-browser.mjs": "smoke:web:browser",
    "smoke-web-app.mjs": "smoke:web:app",
    "smoke-web-elicitation.mjs": "smoke:web:elicit",
  };

  it("never tells the reader to run a sibling smoke", () => {
    // `smoke-web-elicitation.mjs` shipped an on-demand example invoking
    // `smoke:web:app` (Copilot, #2133) — a direct cost of my deciding the two
    // App headers should be word-for-word identical so they could not drift.
    // The shared PROSE should be identical; the example command is the one line
    // that must not be, and copy-paste does not distinguish them.
    //
    // Following such an example does not fail — it runs a real smoke and passes.
    // It just never exercises the file you were reading about, which is why
    // nothing else catches this.
    for (const [file, own] of Object.entries(OWN_SCRIPT)) {
      const source = readFileSync(join(scriptDir, file), "utf8");
      const siblings = Object.values(OWN_SCRIPT).filter((s) => s !== own);
      for (const sibling of siblings) {
        assert.ok(
          !source.includes(`npm run ${sibling}`),
          `${file} tells the reader to run \`npm run ${sibling}\` — a sibling ` +
            `smoke. Its examples must use \`${own}\`, or the reader never ` +
            `exercises the path this file documents.`,
        );
      }
    }
  });

  it("every command it does name is a real script", () => {
    // A command that does not exist is worse than none, and the header is the
    // one place nothing executes to find out.
    for (const file of Object.keys(OWN_SCRIPT)) {
      const source = readFileSync(join(scriptDir, file), "utf8");
      for (const [, name] of source.matchAll(/npm run ([\w:]+)/g)) {
        assert.ok(
          Object.hasOwn(scripts, name),
          `${file} names \`npm run ${name}\`, which is not a script`,
        );
      }
    }
  });
});
