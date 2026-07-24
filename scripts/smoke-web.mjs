#!/usr/bin/env node
/**
 * End-to-end smoke test for the prod web launcher path (#1486).
 *
 * `npm run smoke:launcher` only checks `--help` for each mode; it never starts
 * the prod web server, so the static-asset / injected-token path went unverified
 * in CI. This script launches `mcp-inspector --web` (prod, no `--dev`) against
 * the built `clients/web/dist`, waits for it to listen, and asserts that `/`
 * returns HTTP 200 with the injected auth-token global. It exits non-zero
 * (failing CI / `npm run validate`) on any failure, then shuts the server down.
 *
 * This checks the served HTML only — it does not execute the bundle. The
 * companion `smoke:web:browser` (scripts/smoke-web-browser.mjs, #1615) boots the
 * same server and actually runs the app in headless Chromium; both share the
 * spawn/readiness helper in ./lib/prod-web-server.mjs.
 *
 * Expects `clients/web/dist` and `clients/launcher/build` to be built first —
 * the validate / CI ordering guarantees this, so the readiness wait is sized for
 * an already-built `dist`. (If `dist` happened to be missing, the launcher's
 * build-on-demand path would build it on startup, which a cold `vite build`
 * could push past that wait — not a scenario this script targets.)
 */

import { startProdWebServer } from "./lib/prod-web-server.mjs";

const HOST = "127.0.0.1";
const PORT = process.env.SMOKE_WEB_PORT ?? "6299";
const TOKEN = "smoke-web-token";
// Mirrors INSPECTOR_API_TOKEN_GLOBAL in core/mcp/remote/constants.ts; kept as a
// literal because this plain .mjs script can't import the TS source.
const TOKEN_GLOBAL = "__INSPECTOR_API_TOKEN__";

const server = startProdWebServer({ host: HOST, port: PORT, token: TOKEN });

function fail(message) {
  console.error(`smoke:web FAILED — ${message}`);
  server.stop();
  process.exit(1);
}

try {
  const res = await server.waitForReady();
  if (res.status !== 200) {
    fail(`GET / returned HTTP ${res.status}, expected 200`);
  }
  const body = await res.text();
  if (!body.includes(TOKEN_GLOBAL)) {
    fail(
      `served HTML is missing the ${TOKEN_GLOBAL} global (token not injected)`,
    );
  }
  if (!body.includes(TOKEN)) {
    fail("served HTML is missing the injected auth-token value");
  }
  console.log(
    `smoke:web OK — GET / => 200 with injected ${TOKEN_GLOBAL} at ${server.baseUrl}`,
  );
  server.stop();
  process.exit(0);
} catch (err) {
  fail(err instanceof Error ? err.message : String(err));
}
