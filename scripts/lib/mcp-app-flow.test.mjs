/**
 * Unit tests for the shared MCP Apps flow (#2003).
 *
 * These cover the halves neither consumer can check itself. `smoke:web:app` and
 * `pack:verify` only ever exercise the happy path — the widget reaches `ready`,
 * so every failure branch below is dead code from their point of view, and the
 * deep-link shape is asserted by nothing at all once it is built rather than
 * inlined. Both are exactly the parts that rot silently: a mangled `appArgs`
 * encoding or a dropped `autoOpen` token produces a page that simply never
 * connects, reported as an opaque timeout.
 *
 * `driveAppFlow` is driven against a stand-in page rather than Chromium — it
 * takes only `goto` and `locator(...)` → `waitFor`/`getAttribute`/`count`,
 * which is what makes that possible.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { BROWSER_TIMEOUTS } from "./browser-timeouts.mjs";
import {
  buildAppDeepLink,
  driveAppFlow,
  encodeAppArgs,
  sandboxProxyPageFor,
} from "./mcp-app-flow.mjs";

/**
 * Minimal Playwright `page` stand-in. `plan` maps a selector to its behavior.
 * `waits` records the budget each `waitFor` was given, so a test can pin the
 * defaults without a real browser.
 */
function fakePage(plan, { gotoStatus = 200 } = {}) {
  const waits = {};
  return {
    waits,
    goto: async () => ({
      ok: () => gotoStatus === 200,
      status: () => gotoStatus,
    }),
    locator: (selector) => {
      const entry = plan[selector] ?? {};
      return {
        waitFor: async (opts) => {
          waits[selector] = opts?.timeout;
          if (entry.waitFails) throw new Error(`timeout: ${selector}`);
        },
        getAttribute: async (name) => entry.attrs?.[name] ?? null,
        count: async () => entry.count ?? 0,
      };
    },
  };
}

const STATUS = '[data-testid="connection-status"]';
const CONNECTED = '[data-testid="connection-status"][data-status="connected"]';
const FORM = '[data-testid="apps-form"]';
const READY = '[data-testid="apps-form"][data-app-status="ready"]';

/** The plan under which every stage succeeds. */
const happyPlan = () => ({
  [STATUS]: { attrs: { "data-deeplink": "parsed" } },
  [CONNECTED]: {},
  [READY]: {},
});

describe("encodeAppArgs", () => {
  it("encodes JSON as base64url with no padding", () => {
    const encoded = encodeAppArgs({ title: "a/b+c?" });
    assert.doesNotMatch(encoded, /[+/=]/);
    assert.deepEqual(JSON.parse(Buffer.from(encoded, "base64url").toString()), {
      title: "a/b+c?",
    });
  });
});

describe("buildAppDeepLink", () => {
  const link = buildAppDeepLink({
    baseUrl: "http://127.0.0.1:6399",
    mcpUrl: "http://127.0.0.1:3130/mcp",
    token: "tok",
    appArgs: { title: "t" },
  });
  const params = new URL(link).searchParams;

  it("percent-encodes the server URL so its own query/scheme can't leak", () => {
    assert.ok(link.includes(encodeURIComponent("http://127.0.0.1:3130/mcp")));
    assert.equal(params.get("serverUrl"), "http://127.0.0.1:3130/mcp");
  });

  it("carries the session token on BOTH gates", () => {
    // autoConnect and autoOpen are separate CSRF gates; dropping either leaves
    // the page silently idle rather than erroring.
    assert.equal(params.get("autoConnect"), "tok");
    assert.equal(params.get("autoOpen"), "tok");
  });

  it("defaults to the fixture's app tool and round-trips appArgs", () => {
    assert.equal(params.get("openApp"), "mcp_app_demo");
    assert.equal(params.get("transport"), "http");
    assert.deepEqual(
      JSON.parse(Buffer.from(params.get("appArgs"), "base64url").toString()),
      { title: "t" },
    );
  });
});

describe("sandboxProxyPageFor", () => {
  it("resolves relative to the runner dir, as sandbox-controller.ts does", () => {
    assert.match(
      sandboxProxyPageFor("/pkg/clients/web/build").replace(/\\/g, "/"),
      /\/pkg\/clients\/web\/(build\/\.\.\/)?static\/sandbox_proxy\.html$/,
    );
  });
});

describe("driveAppFlow", () => {
  it("resolves when every stage succeeds", async () => {
    await driveAppFlow({ page: fakePage(happyPlan()), url: "http://x/" });
  });

  it("shares its connect budgets with connectViaDeepLink and waits a roundTrip for ready (#2333)", async () => {
    // The connect pair is handed straight through, so `ui`/`roundTrip` here
    // are the same two `connectViaDeepLink` defaults to; `ready` is a round
    // trip of its own (sandbox load + bridge handshake), not a `nested` render.
    const page = fakePage(happyPlan());
    await driveAppFlow({ page, url: "http://x/" });
    assert.equal(page.waits[STATUS], BROWSER_TIMEOUTS.ui);
    assert.equal(page.waits[CONNECTED], BROWSER_TIMEOUTS.roundTrip);
    assert.equal(page.waits[READY], BROWSER_TIMEOUTS.roundTrip);
  });

  it("reports a non-200 document instead of waiting on selectors", async () => {
    await assert.rejects(
      driveAppFlow({
        page: fakePage(happyPlan(), { gotoStatus: 500 }),
        url: "http://x/",
      }),
      /GET \/ returned HTTP 500/,
    );
  });

  it("names a rejected deep link rather than timing out on connect", async () => {
    // The token gate refusing the link is the failure a bad `autoConnect`
    // produces; without this branch it surfaces as a 45s connect timeout.
    const plan = happyPlan();
    plan[STATUS] = { attrs: { "data-deeplink": "rejected" } };
    await assert.rejects(
      driveAppFlow({ page: fakePage(plan), url: "http://x/" }),
      /deep link was not accepted \(data-deeplink="rejected"\)/,
    );
  });

  it("surfaces the last app status and error when ready never arrives", async () => {
    const plan = happyPlan();
    plan[READY] = { waitFails: true };
    plan[FORM] = {
      count: 1,
      attrs: {
        "data-app-status": "error",
        "data-app-error": "Sandbox not loaded",
      },
    };
    await assert.rejects(
      driveAppFlow({ page: fakePage(plan), url: "http://x/" }),
      (err) => {
        // The #1859 shape: the widget never renders because the proxy page the
        // runtime reads is not where it was shipped. The message has to name
        // that, not just "timeout".
        assert.match(err.message, /last: "error"/);
        assert.match(err.message, /data-app-error="Sandbox not loaded"/);
        return true;
      },
    );
  });

  it("skips the deep-link gate when the caller re-navigates an open page", async () => {
    // smoke:web:app phase 2 (#2056) re-navigates the SAME page to a second
    // server. The gate was proven on the first navigate, and a rejected
    // re-navigate fails at the connect wait anyway — so a stale/absent
    // data-deeplink must not fail the phase.
    const plan = happyPlan();
    plan[STATUS] = { attrs: {} };
    await driveAppFlow({
      page: fakePage(plan),
      url: "http://x/",
      expectDeepLink: false,
    });
  });

  it("names the phase and appends its diagnostics on a ready timeout", async () => {
    // A phase-2 timeout that read as a phase-1 one would send the reader to the
    // wrong half of the smoke; the frame list is what separates "never
    // rendered" from "rendered at the wrong origin".
    const plan = happyPlan();
    plan[READY] = { waitFails: true };
    plan[FORM] = { count: 1, attrs: { "data-app-status": "loading" } };
    await assert.rejects(
      driveAppFlow({
        page: fakePage(plan),
        url: "http://x/",
        what: "dedicated-origin app",
        extraDiagnostics: () => "frames: a, b",
      }),
      (err) => {
        assert.match(err.message, /^dedicated-origin app never reached/);
        assert.match(err.message, /frames: a, b$/);
        return true;
      },
    );
  });

  it("says so when the apps form never mounted at all", async () => {
    const plan = happyPlan();
    plan[READY] = { waitFails: true };
    plan[FORM] = { count: 0 };
    await assert.rejects(
      driveAppFlow({ page: fakePage(plan), url: "http://x/" }),
      /last: "\(no apps-form\)"/,
    );
  });
});
