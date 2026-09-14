/**
 * Unit tests for the headless-browser engine selection (#2086).
 *
 * The smokes cannot check this themselves: each one resolves exactly one engine
 * per process and then spends its whole run inside the happy path, so the branch
 * that matters most — an unrecognized `SMOKE_BROWSER` — is dead code from their
 * point of view. It is also the branch whose failure is silent rather than loud:
 * a fallback to Chromium there would report a green run to a caller who asked
 * for another engine — coverage claimed that never ran.
 *
 * `loadBrowser`'s failure branches are covered here too, through its injectable
 * `loadPlaywright`. The smokes cannot reach them by construction —
 * `install-smoke-browser` fetches the binary before the smoke runs, so a passing
 * smoke says nothing about what a failing one would print. And that message is
 * the deliverable: #2086's acceptance criterion is that a missing browser fails
 * naming *that engine* and its own `playwright install` command, which is
 * exactly the kind of string that rots into naming the wrong one.
 *
 * The successful path is covered here too, with distinct per-engine spies — the
 * failure-path stand-in rejects identically for every engine, so it cannot tell
 * a correct dispatch from a mis-dispatch that happens to print the right label.
 * Only a launch against a REAL binary is left to the smokes.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  BROWSER_ENV_VAR,
  DEFAULT_BROWSER,
  SUPPORTED_BROWSERS,
  attachPageDiagnostics,
  loadBrowser,
  resolveBrowserName,
} from "./headless-browser.mjs";

describe("resolveBrowserName", () => {
  it("defaults to chromium when the variable is unset", () => {
    assert.equal(resolveBrowserName({}), DEFAULT_BROWSER);
  });

  it("rejects a present-but-empty value instead of defaulting", () => {
    // This is the case worth being strict about. `SMOKE_BROWSER="$ENGINE"` with
    // ENGINE unset — or a CI expression naming a key that does not exist — sets
    // the variable to "" rather than removing it, so defaulting here would
    // silently run Chromium for a caller who asked for something else. That is
    // the same false-coverage outcome the unrecognized-value branch exists to
    // stop. Only an ABSENT variable may select the default.
    for (const raw of ["", "   ", "\t\n"]) {
      assert.throws(
        () => resolveBrowserName({ [BROWSER_ENV_VAR]: raw }),
        (err) => {
          assert.match(err.message, /set but empty/);
          // Names the actual remedy — "unset it", which is different from
          // "set it to nothing" and is the whole point here.
          assert.match(err.message, /did not resolve/);
          assert.match(err.message, /Unset it/);
          return true;
        },
        `expected ${JSON.stringify(raw)} to be rejected`,
      );
    }
  });

  it("accepts every supported engine", () => {
    for (const name of SUPPORTED_BROWSERS) {
      assert.equal(resolveBrowserName({ [BROWSER_ENV_VAR]: name }), name);
    }
  });

  it("normalizes surrounding whitespace and case", () => {
    assert.equal(
      resolveBrowserName({ [BROWSER_ENV_VAR]: " WebKit " }),
      "webkit",
    );
  });

  it("rejects an unrecognized engine rather than falling back", () => {
    assert.throws(
      () => resolveBrowserName({ [BROWSER_ENV_VAR]: "safari" }),
      // The message must quote what was asked for AND list what is accepted —
      // "safari" is the most likely typo here and its fix is not guessable.
      (err) =>
        /safari/.test(err.message) &&
        SUPPORTED_BROWSERS.every((name) => err.message.includes(name)),
    );
  });
});

describe("loadBrowser", () => {
  /** A Playwright stand-in whose every engine rejects on launch. */
  const launchAlwaysFails = (message) => () => ({
    chromium: { launch: () => Promise.reject(new Error(message)) },
    firefox: { launch: () => Promise.reject(new Error(message)) },
    webkit: { launch: () => Promise.reject(new Error(message)) },
  });

  it("rejects an unsupported engine before touching Playwright", async () => {
    let loaded = false;
    await assert.rejects(
      () =>
        loadBrowser("/nonexistent-repo-root", "safari", {
          loadPlaywright: () => {
            loaded = true;
            return {};
          },
        }),
      /unsupported browser "safari"/,
    );
    // Pins the ORDER, not just the message: validating first is what makes the
    // error name the real mistake instead of a downstream resolution failure.
    assert.equal(loaded, false);
  });

  it("launches the engine that was asked for, and returns it", async () => {
    // The load-bearing assertion, and the one the failure-path tests below
    // CANNOT make (Copilot, #2133): their stand-in rejects identically for every
    // engine, so `loadBrowser(root, "firefox")` could call `chromium.launch()`
    // and still produce a correctly Firefox-labelled error. The smokes cannot
    // catch that either — the Firefox gate runs after Chromium is already
    // installed, so a mis-dispatched launch would succeed and report Firefox
    // coverage that never happened. Only distinct per-engine spies pin it.
    const launched = [];
    const spyPlaywright = () =>
      Object.fromEntries(
        SUPPORTED_BROWSERS.map((name) => [
          name,
          {
            launch: async (options) => {
              launched.push({ name, options });
              return { engine: name };
            },
          },
        ]),
      );

    for (const name of SUPPORTED_BROWSERS) {
      launched.length = 0;
      const browser = await loadBrowser("/repo", name, {
        loadPlaywright: spyPlaywright,
      });
      assert.deepEqual(
        launched.map((l) => l.name),
        [name],
        `loadBrowser(…, "${name}") must launch ${name} and nothing else`,
      );
      // The returned handle is that engine's, not some other engine's.
      assert.deepEqual(browser, { engine: name });
      assert.deepEqual(launched[0].options, { headless: true });
    }
  });

  it("names the engine that failed, and its own install command", async () => {
    // The whole point of #2086's acceptance criterion: a reader whose WebKit
    // binary is missing must not be sent to install chromium.
    for (const name of SUPPORTED_BROWSERS) {
      await assert.rejects(
        () =>
          loadBrowser("/repo", name, {
            loadPlaywright: launchAlwaysFails("Executable doesn't exist"),
          }),
        (err) => {
          assert.match(err.message, new RegExp(`^${name} failed to launch`));
          // Names a remedy that works from where the caller is: the npm
          // script, and the raw command scoped to clients/web (Playwright is
          // pinned there; a bare root-level `npx playwright` can fetch a
          // different version and install a revision this cannot launch).
          assert.match(err.message, new RegExp(`npm run smoke:web:${name}`));
          assert.match(err.message, /from clients\/web/);
          assert.match(
            err.message,
            new RegExp(
              `--with-deps ${name}\\\`(?![\\s\\S]*--with-deps (?!${name}))`,
            ),
          );
          // The underlying cause survives, so the reader can tell a missing
          // binary from a sandbox/permissions problem.
          assert.match(err.message, /Executable doesn't exist/);
          // And no OTHER engine is named anywhere in the message.
          for (const other of SUPPORTED_BROWSERS.filter((b) => b !== name)) {
            assert.ok(
              !err.message.includes(other),
              `message for ${name} must not mention ${other}: ${err.message}`,
            );
          }
          return true;
        },
      );
    }
  });

  it("sends an unresolvable Playwright to `npm install`, not `playwright install`", async () => {
    // Two different failures with two different remedies. Suggesting
    // `playwright install` here would be actively wrong — it fetches browser
    // binaries and cannot install the missing npm package.
    await assert.rejects(
      () =>
        loadBrowser("/repo", "firefox", {
          loadPlaywright: () => {
            throw new Error("Cannot find module 'playwright'");
          },
        }),
      (err) => {
        assert.match(err.message, /could not resolve the Playwright package/);
        assert.match(err.message, /npm install/);
        assert.ok(
          !/playwright install/.test(err.message),
          `must not suggest \`playwright install\` for a missing package: ${err.message}`,
        );
        assert.match(err.message, /Cannot find module 'playwright'/);
        return true;
      },
    );
  });
});

describe("attachPageDiagnostics", () => {
  /** Minimal Playwright `page` stand-in: records handlers, replays events. */
  function fakePage() {
    const handlers = {};
    return {
      on: (event, fn) => {
        (handlers[event] ??= []).push(fn);
      },
      emit: (event, arg) => handlers[event]?.forEach((fn) => fn(arg)),
    };
  }

  const consoleMessage = (type, text) => ({
    type: () => type,
    text: () => text,
  });

  it("splits fatal console errors from benign noise", () => {
    const page = fakePage();
    const diagnostics = attachPageDiagnostics(page);

    page.emit("console", consoleMessage("error", "Uncaught (in promise) boom"));
    page.emit(
      "console",
      consoleMessage("error", "Failed to fetch dynamically imported module x"),
    );
    // The two shapes that used to flake CI, and must stay diagnostics.
    page.emit(
      "console",
      consoleMessage("error", "Failed to load resource: net::ERR_FAILED"),
    );
    page.emit(
      "console",
      consoleMessage("error", "Warning: each child needs a key"),
    );
    // Non-error console output is ignored entirely.
    page.emit("console", consoleMessage("log", "Uncaught looking but a log"));

    assert.deepEqual(diagnostics.fatalConsole(), [
      "Uncaught (in promise) boom",
      "Failed to fetch dynamically imported module x",
    ]);
    assert.deepEqual(diagnostics.benignConsole(), [
      "Failed to load resource: net::ERR_FAILED",
      "Warning: each child needs a key",
    ]);
  });

  it("counts every pageerror as fatal, whatever it was thrown as", () => {
    const page = fakePage();
    const diagnostics = attachPageDiagnostics(page);

    page.emit("pageerror", new Error("sync boom"));
    page.emit("pageerror", "thrown as a string");
    page.emit("console", consoleMessage("error", "benign"));

    assert.deepEqual(diagnostics.pageErrors, [
      "sync boom",
      "thrown as a string",
    ]);
    assert.deepEqual(diagnostics.fatal(), ["sync boom", "thrown as a string"]);
  });

  it("reports nothing on a clean page", () => {
    const diagnostics = attachPageDiagnostics(fakePage());
    assert.deepEqual(diagnostics.fatal(), []);
    assert.deepEqual(diagnostics.benignConsole(), []);
  });
});
