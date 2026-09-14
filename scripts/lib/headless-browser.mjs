/**
 * The headless browser the web smokes drive: which engine, how it is launched,
 * and the two error channels a page reports on (#2086).
 *
 * All three smokes (`smoke:web:browser`, `smoke:web:app`, `smoke:web:elicit`)
 * and `pack:verify` go through here, so the engine is a parameter in exactly
 * one place and the diagnostics split is stated once rather than hand-rolled
 * four times.
 *
 * Every browser-driven check in this repo used to be Chromium-only. That is
 * fine for most of the web client, whose behavior is React and Mantine — and it
 * is NOT fine for the MCP Apps sandbox, which is built out of exactly the
 * primitives that diverge between engines: a CSP `<meta>` injected into a
 * `srcdoc` document, a nested sandboxed iframe, a `Permissions-Policy` `allow`
 * attribute, and `postMessage` origin discipline across those two frames. A
 * regression in any of those is invisible unless it also reproduces in Chromium.
 *
 * The unit tests cannot cover it either: `sandbox-csp.test.ts` asserts which
 * policy STRING is built, which would pass identically on an engine that
 * ignores `<meta>` CSP entirely. And no Storybook story reaches the sandbox at
 * all — all three App stories point the iframe at a `data:` placeholder and hand
 * the renderer a mock bridge. So the smokes are the only place the sandbox is
 * genuinely exercised, and this module is what lets them be pointed at another
 * engine.
 *
 * ⚠️ Playwright's WebKit is a WebKit build, not Safari. It is close enough to
 * catch engine-level CSP and iframe divergence, and not close enough to certify
 * Safari specifically — a green run here is not a Safari guarantee.
 *
 * **And that cuts both ways: a RED run here is not a Safari indictment.** The
 * WebKit App-smoke failure was once written up as a Safari bug on the strength
 * of a failure in this build alone; a manual check in Safari did not reproduce
 * it, an isolated repro of the claimed mechanism did not reproduce it here
 * either, and the whole line of investigation was dropped. Reproduce in the real
 * browser before describing a finding as one users hit.
 *
 * Playwright is resolved with a `createRequire` based at
 * clients/web/package.json rather than a bare `import("playwright")`: a bare ESM
 * specifier resolves relative to `scripts/`, not the cwd, so a `cd clients/web`
 * in the npm script would NOT make it resolvable. See smoke-web-browser.mjs's
 * header for the full gotcha.
 */

import { createRequire } from "node:module";
import { join } from "node:path";

/**
 * Console messages that are the async half of the uncaught-crash class (an
 * unhandled rejection or a failed dynamic import). Hard failures; every other
 * console error is a diagnostic, so benign font-CDN / React-warning noise can't
 * flake CI. smoke-web-browser.mjs's header documents the reasoning at length.
 */
export const FATAL_CONSOLE =
  /^Uncaught\b|Failed to fetch dynamically imported module/;

/**
 * Attach the two error channels a headless page reports on.
 *
 * An uncaught *synchronous* page error fires `pageerror`; its async twin — an
 * unhandled rejection or a failed dynamic import — is not a `pageerror` at all
 * and arrives on the console channel instead. Both are captured, and both are
 * read on every engine rather than branching per browser: which channel an
 * engine picks is exactly the kind of detail that differs between them, and
 * reading both makes that difference irrelevant. Only `fatal()` is a failure, so
 * ordinary console noise stays a diagnostic.
 */
export function attachPageDiagnostics(page) {
  const pageErrors = [];
  const consoleErrors = [];
  page.on("pageerror", (err) =>
    pageErrors.push(err instanceof Error ? err.message : String(err)),
  );
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  return {
    pageErrors,
    consoleErrors,
    fatalConsole: () => consoleErrors.filter((m) => FATAL_CONSOLE.test(m)),
    benignConsole: () => consoleErrors.filter((m) => !FATAL_CONSOLE.test(m)),
    fatal: () => [
      ...pageErrors,
      ...consoleErrors.filter((m) => FATAL_CONSOLE.test(m)),
    ],
  };
}

/** The supported engine set. Anything else is a typo, not a request. */
export const SUPPORTED_BROWSERS = ["chromium", "firefox", "webkit"];

/** The engine used when nothing asks for another one. */
export const DEFAULT_BROWSER = "chromium";

/** The env var each smoke reads to pick its engine. */
export const BROWSER_ENV_VAR = "SMOKE_BROWSER";

/**
 * Resolve the engine name from the environment, deny-by-default.
 *
 * An unrecognized value FAILS rather than falling back to Chromium: a silent
 * fallback would report a green Chromium run under a job labelled "webkit",
 * which is worse than no coverage — it claims coverage that never ran.
 *
 * **Only an ABSENT variable selects the default. A present-but-empty one is an
 * error**, because empty is what a variable set from something that did not
 * resolve looks like — `SMOKE_BROWSER="$ENGINE"` with `ENGINE` unset, or a CI
 * expression naming a key that does not exist (GitHub Actions renders those as
 * the empty string rather than omitting the variable). Treating that as "not
 * set" would silently run Chromium for a caller who asked for something else,
 * which is the same false-coverage failure the unrecognized-value branch exists
 * to prevent, arriving through a typo instead of a bad value. Unsetting the
 * variable is how you ask for the default; setting it to nothing is not.
 */
export function resolveBrowserName(env = process.env) {
  const raw = env[BROWSER_ENV_VAR];
  if (raw === undefined) return DEFAULT_BROWSER;
  const name = raw.trim().toLowerCase();
  if (name === "") {
    throw new Error(
      `${BROWSER_ENV_VAR} is set but empty — a variable set from something ` +
        `that did not resolve looks exactly like this. ` +
        `Unset it to use ${DEFAULT_BROWSER}, or set one of ${SUPPORTED_BROWSERS.join(", ")}.`,
    );
  }
  if (!SUPPORTED_BROWSERS.includes(name)) {
    throw new Error(
      `${BROWSER_ENV_VAR}="${raw}" is not a supported browser — expected one of ${SUPPORTED_BROWSERS.join(", ")}`,
    );
  }
  return name;
}

/**
 * Resolve the Playwright package from the web client's install.
 *
 * Separate from `loadBrowser` so it can be substituted in tests — see the
 * `loadPlaywright` option there for why that seam has to exist.
 */
export function requirePlaywright(repoRoot) {
  const requireFromWeb = createRequire(
    join(repoRoot, "clients", "web", "package.json"),
  );
  return requireFromWeb("playwright");
}

/**
 * Launch a headless browser of `browserName`, resolved from the web client's
 * install.
 *
 * Both failure branches produce a message that names the actual remedy, and they
 * are different remedies — which is the whole reason they are separate branches:
 *
 *   - **not resolvable** means the Playwright *npm package* is missing, fixed by
 *     `npm install` at the repo root. `playwright install` (which fetches
 *     browser binaries) would not help and is the wrong thing to suggest.
 *   - **launch rejected** means the package is there but that engine's *binary*
 *     is not, fixed by `playwright install --with-deps <that engine>`. Naming
 *     "chromium" while WebKit was the missing one sends the reader off to
 *     install a browser they already have — the reason the engine is
 *     interpolated rather than hard-coded (#2086's acceptance criterion).
 *
 * `loadPlaywright` is injectable purely so those branches can be unit-tested.
 * They are unreachable from the smokes by construction: `install-smoke-browser`
 * runs first and fetches the binary, so a passing smoke proves nothing about the
 * message a failing one would print — and that message IS the deliverable here,
 * since its whole job is to be read by someone whose setup is broken.
 */
export async function loadBrowser(
  repoRoot,
  browserName = DEFAULT_BROWSER,
  { loadPlaywright = requirePlaywright } = {},
) {
  if (!SUPPORTED_BROWSERS.includes(browserName)) {
    throw new Error(
      `unsupported browser "${browserName}" — expected one of ${SUPPORTED_BROWSERS.join(", ")}`,
    );
  }
  let playwright;
  try {
    playwright = loadPlaywright(repoRoot);
  } catch (err) {
    throw new Error(
      `could not resolve the Playwright package from clients/web — run \`npm install\` at the repo root (${err instanceof Error ? err.message : String(err)})`,
    );
  }
  try {
    return await playwright[browserName].launch({ headless: true });
  } catch (err) {
    throw new Error(
      `${browserName} failed to launch — run \`npm run smoke:web:${browserName}\`, ` +
        `or from clients/web run \`npx playwright install --with-deps ${browserName}\` ` +
        `if you also need its system libraries. Playwright is pinned in ` +
        `clients/web, so running that from the repo root can fetch a different ` +
        `version and install a browser revision this one still cannot launch ` +
        `(${err instanceof Error ? err.message : String(err)})`,
    );
  }
}
