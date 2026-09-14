/**
 * Unit tests for the smoke browser installer's argument resolution (#2086).
 *
 * The installer's I/O half — resolving the Playwright CLI and spawning it — is
 * exercised on every `npm run smoke:web:*`, so it fails loudly the moment it
 * breaks. Its *argument* half is not: every caller in the repo passes either
 * nothing or the literal `chromium`, so the precedence rule below is asserted by
 * nothing at runtime, and getting it wrong produces a mismatch (install one
 * engine, launch another) that surfaces as a misleading "Executable doesn't
 * exist" rather than as the wiring error it is.
 *
 * Importing this module must not run an install; `main()` is behind an
 * entrypoint guard for exactly that reason, and these tests are also what would
 * catch that guard regressing — an unguarded module would try to install a
 * browser the moment the suite imported it.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resolveRequestedBrowser } from "./install-smoke-browser.mjs";
import {
  BROWSER_ENV_VAR,
  DEFAULT_BROWSER,
  SUPPORTED_BROWSERS,
} from "./lib/headless-browser.mjs";

describe("resolveRequestedBrowser", () => {
  it("falls back to the environment when no argument is given", () => {
    assert.equal(resolveRequestedBrowser([], {}), DEFAULT_BROWSER);
    assert.equal(
      resolveRequestedBrowser([], { [BROWSER_ENV_VAR]: "webkit" }),
      "webkit",
    );
  });

  it("lets an explicit argument beat the environment", () => {
    // The `pack:verify` invariant. It passes `chromium` because it LAUNCHES
    // chromium; if the environment won here, `SMOKE_BROWSER=webkit npm run
    // pack:verify` would install WebKit and then launch Chromium.
    assert.equal(
      resolveRequestedBrowser(["chromium"], { [BROWSER_ENV_VAR]: "webkit" }),
      "chromium",
    );
    for (const name of SUPPORTED_BROWSERS) {
      assert.equal(
        resolveRequestedBrowser([name], { [BROWSER_ENV_VAR]: "firefox" }),
        name,
      );
    }
  });

  it("rejects an unsupported argument, naming it and the allowed set", () => {
    assert.throws(
      () => resolveRequestedBrowser(["safari"], {}),
      (err) => {
        assert.match(err.message, /unsupported browser "safari"/);
        SUPPORTED_BROWSERS.forEach((name) =>
          assert.ok(err.message.includes(name)),
        );
        return true;
      },
    );
  });

  it("does not let a bad argument fall through to the environment", () => {
    // Silently using SMOKE_BROWSER after ignoring a typo'd argument would
    // install an engine nobody asked for, and the npm script's typo would
    // survive unnoticed.
    assert.throws(
      () =>
        resolveRequestedBrowser(["chrome"], { [BROWSER_ENV_VAR]: "firefox" }),
      /unsupported browser "chrome"/,
    );
  });

  it("propagates the environment's own validation, empty included", () => {
    // Delegation, not a second copy of the rules — so the deny-by-default
    // behavior cannot drift between the two entry points.
    assert.throws(
      () => resolveRequestedBrowser([], { [BROWSER_ENV_VAR]: "safari" }),
      /is not a supported browser/,
    );
    assert.throws(
      () => resolveRequestedBrowser([], { [BROWSER_ENV_VAR]: "" }),
      /set but empty/,
    );
  });
});
