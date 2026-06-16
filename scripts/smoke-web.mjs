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
 * Requires `clients/web/dist` and `clients/launcher/build` to be built first
 * (the validate / CI ordering guarantees this). If `dist` is missing the
 * launcher's build-on-demand path (ensure-web-build.ts) builds it.
 */

import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";

const HOST = "127.0.0.1";
const PORT = process.env.SMOKE_WEB_PORT ?? "6299";
const TOKEN = "smoke-web-token";
// Mirrors INSPECTOR_API_TOKEN_GLOBAL in core/mcp/remote/constants.ts; kept as a
// literal because this plain .mjs script can't import the TS source.
const TOKEN_GLOBAL = "__INSPECTOR_API_TOKEN__";
const BASE_URL = `http://${HOST}:${PORT}`;

const child = spawn(
  process.execPath,
  ["clients/launcher/build/index.js", "--web"],
  {
    env: {
      ...process.env,
      CLIENT_PORT: PORT,
      HOST,
      MCP_INSPECTOR_API_TOKEN: TOKEN,
      // Don't pop a browser in CI.
      MCP_AUTO_OPEN_ENABLED: "false",
    },
    stdio: ["ignore", "inherit", "inherit"],
  },
);

let exited = false;
let exitCode = null;
child.on("exit", (code) => {
  exited = true;
  exitCode = code;
});

function shutdown() {
  if (!exited) child.kill("SIGTERM");
}

function fail(message) {
  console.error(`smoke:web FAILED — ${message}`);
  shutdown();
  process.exit(1);
}

async function fetchRoot() {
  for (let attempt = 0; attempt < 120; attempt++) {
    if (exited) {
      throw new Error(
        `launcher exited (code ${exitCode}) before serving — see output above`,
      );
    }
    try {
      return await fetch(`${BASE_URL}/`);
    } catch {
      await delay(500);
    }
  }
  throw new Error("server did not start within 60s");
}

try {
  const res = await fetchRoot();
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
    `smoke:web OK — GET / => 200 with injected ${TOKEN_GLOBAL} at ${BASE_URL}`,
  );
  shutdown();
  process.exit(0);
} catch (err) {
  fail(err instanceof Error ? err.message : String(err));
}
