/**
 * Unit tests for the shared deep-link connect step (#2148).
 *
 * These cover what no smoke can check itself. Every consumer only ever drives
 * the happy path — the page connects — so both failure branches below are dead
 * code from their point of view, and the link's *shape* is asserted by nothing
 * once it is built rather than inlined. Those are exactly the parts that rot
 * silently: `parseDeepLink` **ignores** a link it cannot validate rather than
 * reporting one, so a dropped `autoConnect` token or a mangled `serverUrl`
 * produces a page that simply never connects, reported as an opaque 45s
 * timeout in whichever smoke was not updated.
 *
 * `connectViaDeepLink` is driven against a stand-in page rather than a real
 * browser — it takes only `goto` and `locator(...)` →
 * `waitFor`/`getAttribute`/`count`,
 * which is what makes that possible.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { BROWSER_TIMEOUTS } from "./browser-timeouts.mjs";
import {
  buildConnectDeepLink,
  connectViaDeepLink,
} from "./deep-link-connect.mjs";

/**
 * Minimal Playwright `page` stand-in. `plan` maps a selector to its behavior.
 * `gotoTimeouts` and `waits` record the budget each call was given, so a test
 * can pin the defaults without a real browser.
 */
function fakePage(plan, { gotoStatus = 200 } = {}) {
  const gotos = [];
  const gotoTimeouts = [];
  const waits = {};
  return {
    gotos,
    gotoTimeouts,
    waits,
    goto: async (url, opts) => {
      gotos.push(url);
      gotoTimeouts.push(opts?.timeout);
      return { ok: () => gotoStatus === 200, status: () => gotoStatus };
    },
    locator: (selector) => {
      const entry = plan[selector] ?? {};
      return {
        waitFor: async (opts) => {
          waits[selector] = opts?.timeout;
          if (entry.waitFails) throw new Error(`timeout: ${selector}`);
        },
        getAttribute: async (name) => entry.attrs?.[name] ?? null,
        count: async () => entry.count ?? 1,
      };
    },
  };
}

const STATUS = '[data-testid="connection-status"]';
const CONNECTED = '[data-testid="connection-status"][data-status="connected"]';

const happyPlan = () => ({
  [STATUS]: { attrs: { "data-deeplink": "parsed" } },
  [CONNECTED]: {},
});

describe("buildConnectDeepLink", () => {
  const link = buildConnectDeepLink({
    baseUrl: "http://127.0.0.1:6399",
    mcpUrl: "http://127.0.0.1:3130/mcp?a=1",
    token: "tok",
  });
  const params = new URL(link).searchParams;

  it("percent-encodes the server URL so its own query can't leak", () => {
    // Unencoded, the fixture's `?a=1` would terminate `serverUrl` and become a
    // sibling param — the link would still parse, just against a different
    // server than the caller asked for.
    assert.ok(
      link.includes(encodeURIComponent("http://127.0.0.1:3130/mcp?a=1")),
    );
    assert.equal(params.get("serverUrl"), "http://127.0.0.1:3130/mcp?a=1");
  });

  it("carries the session token on the CSRF gate", () => {
    assert.equal(params.get("autoConnect"), "tok");
  });

  it("defaults to streamable HTTP and honors an explicit transport", () => {
    assert.equal(params.get("transport"), "http");
    assert.equal(
      new URL(
        buildConnectDeepLink({
          baseUrl: "http://x",
          mcpUrl: "http://y",
          token: "t",
          transport: "sse",
        }),
      ).searchParams.get("transport"),
      "sse",
    );
  });
});

describe("connectViaDeepLink", () => {
  it("resolves once the gate passes and the status reads connected", async () => {
    const page = fakePage(happyPlan());
    await connectViaDeepLink({ page, url: "http://x/" });
    assert.deepEqual(page.gotos, ["http://x/"]);
  });

  it("defaults each budget to the shared BROWSER_TIMEOUTS entry (#2333)", async () => {
    // These used to be 30_000 / 45_000 literals of the helper's own — the same
    // values `browser-timeouts.mjs` names `ui` and `roundTrip`, kept in step by
    // hand. Pinning the defaults to the constants is what makes a raise there
    // reach this helper and `driveAppFlow` at once.
    const page = fakePage(happyPlan());
    await connectViaDeepLink({ page, url: "http://x/" });
    assert.deepEqual(page.gotoTimeouts, [BROWSER_TIMEOUTS.ui]);
    assert.equal(page.waits[STATUS], BROWSER_TIMEOUTS.ui);
    assert.equal(page.waits[CONNECTED], BROWSER_TIMEOUTS.roundTrip);
  });

  it("reports a non-200 document instead of waiting on selectors", async () => {
    await assert.rejects(
      connectViaDeepLink({
        page: fakePage(happyPlan(), { gotoStatus: 500 }),
        url: "http://x/",
      }),
      /GET \/ returned HTTP 500/,
    );
  });

  it("distinguishes a rejected deep link from an absent one", async () => {
    // The whole reason the gate is asserted separately: both `rejected` and
    // `none` leave the connection idle, and only this attribute says which.
    for (const value of ["rejected", "none"]) {
      await assert.rejects(
        connectViaDeepLink({
          page: fakePage({
            ...happyPlan(),
            [STATUS]: { attrs: { "data-deeplink": value } },
          }),
          url: "http://x/",
        }),
        new RegExp(`data-deeplink="${value}"`),
      );
    }
  });

  it("skips the gate assertion when the caller opts out", async () => {
    // A re-navigate of an already-proven page: the gate was established on the
    // first navigate, and a rejected one still fails at the connect wait.
    await connectViaDeepLink({
      page: fakePage({
        ...happyPlan(),
        [STATUS]: { attrs: { "data-deeplink": "none" } },
      }),
      url: "http://x/",
      expectDeepLink: false,
    });
  });

  it("propagates a connect timeout", async () => {
    await assert.rejects(
      connectViaDeepLink({
        page: fakePage({ ...happyPlan(), [CONNECTED]: { waitFails: true } }),
        url: "http://x/",
      }),
      /timeout/,
    );
  });

  it("names the app's own connect error on a connect timeout (#2496)", async () => {
    // The #2482 shape: `POST /api/servers` returned 503, the app recorded it on
    // the status element, and the smoke reported only Playwright's timeout.
    const plan = happyPlan();
    plan[STATUS].attrs["data-status"] = "error";
    plan[STATUS].attrs["data-error-message"] = "Failed to add server: HTTP 503";
    plan[CONNECTED] = { waitFails: true };
    await assert.rejects(
      connectViaDeepLink({ page: fakePage(plan), url: "http://x/" }),
      (err) => {
        assert.match(
          err.message,
          /^connection never reached data-status="connected" \(last: "error", data-error-message="Failed to add server: HTTP 503"\)/,
        );
        // Playwright's message stays on the line — it names the budget spent.
        assert.match(err.message, /timeout: .*data-status="connected"/);
        assert.ok(err.cause instanceof Error);
        return true;
      },
    );
  });

  it("omits the error message when the app recorded none", async () => {
    const plan = happyPlan();
    plan[STATUS].attrs["data-status"] = "connecting";
    plan[CONNECTED] = { waitFails: true };
    await assert.rejects(
      connectViaDeepLink({ page: fakePage(plan), url: "http://x/" }),
      (err) => {
        assert.match(err.message, /\(last: "connecting"\)/);
        assert.doesNotMatch(err.message, /data-error-message/);
        return true;
      },
    );
  });

  it("says so when the status element never mounted", async () => {
    // Only reachable with the gate skipped — the gate's own `attached` wait
    // would have failed first otherwise.
    const plan = happyPlan();
    plan[STATUS] = { count: 0 };
    plan[CONNECTED] = { waitFails: true };
    await assert.rejects(
      connectViaDeepLink({
        page: fakePage(plan),
        url: "http://x/",
        expectDeepLink: false,
      }),
      /\(no connection-status element\)/,
    );
  });
});
