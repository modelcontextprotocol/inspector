#!/usr/bin/env node
/**
 * End-to-end smoke test for the experimental mcpdo daemon CLI
 * (`clients/mcpdo`). The unit/integration suite covers the daemon and
 * command surface piecewise; this script drives the BUILT binary the way an
 * agent shell would — non-TTY, catalog-based — and asserts the headline
 * lifecycle end to end:
 *
 *   1. `connect <entry>` resolves a catalog entry and spawns/uses the
 *      background daemon (auto-ensure path).
 *   2. `@entry tools/call` round-trips a real stdio MCP server.
 *   3. A tool that elicits (`submit_ticket`) parks: the CLI returns
 *      immediately with an `elicitation/respond <id>` handle instead of
 *      hanging (the skill's non-TTY contract).
 *   4. `elicitation/respond <id> field:=value ...` resumes the parked call
 *      and the original tool result comes back.
 *   5. `daemon status --format json` reports the connection and
 *      `stopping: false`.
 *   6. `disconnect` + `daemon stop` tear down, and the daemon process
 *      actually exits (socket file released).
 *
 * Fully hermetic: private daemon dir/socket, storage dir, catalog, and
 * daemon token under a temp dir — the developer's real mcpdo daemon (if
 * any) is untouched. Exits non-zero on any mismatch.
 *
 * Expects `clients/mcpdo/build` to be built first (the validate / CI
 * ordering guarantees this). The composed test server (`test-servers/build`)
 * is rebuilt on every run — see `scripts/lib/ensure-test-servers.mjs`.
 */

import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { ensureTestServers } from "./lib/ensure-test-servers.mjs";

const repoRoot = resolve(import.meta.dirname, "..");
const mcpdoBin = join(repoRoot, "clients", "mcpdo", "build", "mcp-bin.js");
const serverLauncher = join(
  repoRoot,
  "scripts",
  "lib",
  "mcpdo-eval-server-launcher.mjs",
);

function fail(message) {
  console.error(`smoke:mcpdo FAILED — ${message}`);
  process.exit(1);
}

if (!existsSync(mcpdoBin)) {
  fail(`missing build artifact ${mcpdoBin} — run \`npm run build\` first`);
}

// Rebuilt on every run — presence is not freshness (#2111). The launcher
// imports `test-servers/build/index.js`, which the same tsc pass emits;
// `fixtures` is the named entry that pins the emit actually happened.
try {
  ensureTestServers({
    repoRoot,
    label: "smoke:mcpdo",
    requires: ["fixtures"],
  });
} catch (e) {
  fail(e.message);
}
const testServersIndex = join(repoRoot, "test-servers", "build", "index.js");
if (!existsSync(testServersIndex)) {
  fail(`test-servers build did not emit ${testServersIndex}`);
}

// Hermetic sandbox: everything the daemon touches lives under here.
const sandbox = mkdtempSync(join(tmpdir(), "mcpdo-smoke-"));
const daemonDir = join(sandbox, "daemon");
const storageDir = join(sandbox, "storage");
mkdirSync(daemonDir);
mkdirSync(storageDir);

// One composed stdio server: a plain tool (get_sum) for the basic call and
// an intrinsically-eliciting tool (submit_ticket) for the park round-trip.
const serverConfigPath = join(sandbox, "server-config.json");
writeFileSync(
  serverConfigPath,
  JSON.stringify(
    {
      transport: { type: "stdio" },
      serverInfo: { name: "helpdesk", version: "1.0.0" },
      tools: [{ preset: "get_sum" }, { preset: "submit_ticket" }],
    },
    null,
    2,
  ),
);
const catalogPath = join(sandbox, "catalog.json");
writeFileSync(
  catalogPath,
  JSON.stringify(
    {
      mcpServers: {
        helpdesk: {
          type: "stdio",
          command: process.execPath,
          args: [serverLauncher, serverConfigPath],
        },
      },
    },
    null,
    2,
  ),
);

const SMOKE_ENV = {
  MCP_INSPECTOR_DAEMON_DIR: daemonDir,
  MCP_INSPECTOR_DAEMON_TOKEN: randomBytes(32).toString("base64url"),
  MCP_STORAGE_DIR: storageDir,
  MCP_CATALOG_PATH: catalogPath,
  // Memory store keeps the smoke off the host keychain (no OAuth here, but
  // the store is probed at startup) — mirrors smoke-cli.mjs.
  MCP_INSPECTOR_SECRET_STORE: "memory",
};

/** Run one mcpdo invocation. Returns { status, stdout, stderr }. */
function runMcpdo(args) {
  const r = spawnSync(process.execPath, [mcpdoBin, ...args], {
    cwd: repoRoot,
    env: { ...process.env, ...SMOKE_ENV },
    encoding: "utf-8",
    timeout: 60_000,
  });
  if (r.error) fail(`mcpdo ${args.join(" ")} did not run: ${r.error.message}`);
  return r;
}

function step(name, args, { expectStatus = 0, match = [] } = {}) {
  const r = runMcpdo(args);
  if (r.status !== expectStatus) {
    fail(
      `${name}: expected exit ${expectStatus}, got ${r.status}\nstdout:\n${r.stdout}\nstderr:\n${r.stderr}`,
    );
  }
  for (const m of match) {
    if (!m.test(r.stdout)) {
      fail(`${name}: stdout did not match ${m}\nstdout:\n${r.stdout}`);
    }
  }
  console.log(`smoke:mcpdo ok — ${name}`);
  return r;
}

const sleep = (ms) =>
  new Promise((resolveSleep) => setTimeout(resolveSleep, ms));

try {
  // 1. Connect the catalog entry (auto-spawns the private daemon).
  step("connect", ["connect", "helpdesk"], {
    match: [/@helpdesk/],
  });

  // 2. Plain tool call round-trip.
  step("tools/call", ["@helpdesk", "tools/call", "get_sum", "a:=2", "b:=3"], {
    match: [/"result":\s*5/],
  });

  // 3. Eliciting tool parks instead of hanging; the CLI hands back a
  //    respond command with the elicitation id.
  const parked = step(
    "tools/call parks on elicitation",
    ["@helpdesk", "tools/call", "submit_ticket", "summary:=Printer jammed"],
    { match: [/Input required|elicitationPending/, /elicitation\/respond/] },
  );
  const idMatch = parked.stdout.match(/elicitation\/respond (\S+)/);
  if (!idMatch) {
    fail(`could not extract elicitation id from:\n${parked.stdout}`);
  }

  // 4. Respond resumes the parked call; the tool's real result comes back.
  step(
    "elicitation/respond resumes the call",
    [
      "elicitation/respond",
      idMatch[1],
      "contact_name:=Ada Lovelace",
      "contact_email:=ada@example.com",
    ],
    { match: [/TCK-\d+/, /Ada Lovelace/] },
  );

  // 5. Status sees the live connection and a non-stopping daemon.
  const status = step("daemon status", [
    "--format",
    "json",
    "daemon",
    "status",
  ]);
  const parsedStatus = JSON.parse(status.stdout);
  if (parsedStatus.connections?.[0]?.name !== "helpdesk") {
    fail(`daemon status missing helpdesk connection:\n${status.stdout}`);
  }
  if (parsedStatus.stopping !== false) {
    fail(`daemon status should report stopping: false:\n${status.stdout}`);
  }

  // 6. Teardown: disconnect, stop, and confirm the daemon really exits
  //    (socket removed once shutdown completes).
  step("disconnect", ["disconnect", "helpdesk"]);
  step("daemon stop", ["daemon", "stop"]);
  const socketPath = join(daemonDir, "mcpdod.sock");
  const deadline = Date.now() + 10_000;
  while (existsSync(socketPath)) {
    if (Date.now() > deadline)
      fail("daemon socket still present 10s after stop");
    await sleep(100);
  }
  console.log("smoke:mcpdo ok — daemon exited (socket released)");

  console.log("smoke:mcpdo PASSED");
} finally {
  // Belt and braces: if a step failed mid-flight, don't leak the daemon.
  spawnSync(process.execPath, [mcpdoBin, "daemon", "stop"], {
    env: { ...process.env, ...SMOKE_ENV },
    encoding: "utf-8",
    timeout: 30_000,
  });
  rmSync(sandbox, { recursive: true, force: true });
}
