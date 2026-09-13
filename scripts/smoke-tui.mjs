#!/usr/bin/env node
/**
 * Boot smoke test for the prod TUI launcher path (#1347).
 *
 * `npm run smoke:launcher` only checks `--tui --help`; it never actually starts
 * the Ink app, so the launcher → TUI → core path and `--catalog` loading went
 * unverified by the launcher smokes. This script launches the built launcher in
 * `--tui` mode against a temp `--catalog`, waits for the app to render its first
 * frame (the "MCP Servers" panel), waits again to confirm it is *still running*,
 * then sends SIGTERM and exits.
 *
 * It asserts the TUI boots, renders, and keeps running — not full interaction
 * (driving an Ink UI deterministically is flaky, so this is intentionally a
 * shallow check). Exits non-zero on a crash before or after first paint, or on
 * a render timeout.
 *
 * ## Why it runs under a pseudoterminal (#2147)
 *
 * It used to spawn the TUI with its stdin on `/dev/null` and settle OK the
 * moment the marker appeared. Ink mounts `useInput`, `useInput` needs raw mode,
 * and raw mode is a property of the file descriptor — so the TUI painted one
 * frame and died ~40ms later with "Raw mode is not supported on the current
 * process.stdin". The smoke won that race and reported OK, on every machine,
 * TTY or not: what it actually asserted was *first paint*, not survival.
 *
 * Two changes, and the second is the fix: `scripts/lib/pty.mjs` gives the child
 * a real terminal via `script(1)`, and `scripts/lib/render-smoke.mjs` requires
 * it to outlive its first frame. Without the survival assertion a future
 * harness change reintroduces exactly this false green and nothing notices —
 * which is why that assertion lives in a tested module rather than here.
 *
 * Expects `clients/launcher/build` and `clients/tui/build` to be built first
 * (the validate / CI ordering guarantees this). The bundled stdio test server
 * (`test-servers/build`) is rebuilt on every run — see
 * `scripts/lib/ensure-test-servers.mjs` for why presence isn't freshness.
 */

import { mkdtempSync, existsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { removeSafe } from "./lib/child-cleanup.mjs";
import { ensureTestServers } from "./lib/ensure-test-servers.mjs";
import { resolvePtyWrapper } from "./lib/pty.mjs";
import { DEFAULTS, normalizeMs, runRenderSmoke } from "./lib/render-smoke.mjs";

const repoRoot = resolve(import.meta.dirname, "..");
const launcher = join(repoRoot, "clients", "launcher", "build", "index.js");
const RENDER_MARKER = "MCP Servers";
// `??` does not cover the two holes that matter here: an env var set to the
// empty string parses as 0, and a typo as NaN, and `setTimeout` fires
// immediately on both. For SURVIVE_MS that would silently restore the
// first-paint false green on a run that still prints OK, so every duration goes
// through `normalizeMs` — which is also where the defaults live, so this file
// and the module cannot drift on what they are.
const envMs = (name, fallback) =>
  normalizeMs(Number(process.env[name]), fallback);

const TIMEOUT_MS = envMs("SMOKE_TUI_TIMEOUT_MS", DEFAULTS.timeoutMs);
// How long past first paint the TUI must still be running. Generous relative to
// the failure it catches (the raw-mode crash landed ~40ms after the marker) —
// the cost of a longer window is only wall-clock on a passing run.
const SURVIVE_MS = envMs("SMOKE_TUI_SURVIVE_MS", DEFAULTS.surviveMs);
const EXIT_GRACE_MS = envMs("SMOKE_TUI_EXIT_GRACE_MS", DEFAULTS.exitGraceMs);
// Ink's own error text when it is asked for raw mode on a non-terminal fd.
const RAW_MODE_ERROR = /Raw mode is not supported/;

function fail(message) {
  console.error(`smoke:tui FAILED — ${message}`);
  process.exit(1);
}

function skip(message) {
  console.log(`smoke:tui SKIPPED — ${message}`);
  process.exit(0);
}

// Kept out of GitHub CI by decision, not by capability. The PTY above removes
// the technical blocker this skip used to cite (a headless runner has no TTY),
// but whether this smoke joins CI is a separate call for the maintainers, and
// #2146 is deliberately keeping the other local-only smokes out. Making it
// *valid* stands on its own: it is a local-only gate, which is exactly where a
// false green is least likely to be caught by anything else.
if (process.env.CI) {
  skip(
    "local-only by decision (see the header); the TUI is built and unit-tested in CI",
  );
}

if (!existsSync(launcher)) {
  fail(`launcher build not found at ${launcher} — run \`npm run build\` first`);
}

// No `script(1)` (Windows). Running without a PTY is not a weaker check, it is
// a guaranteed failure — so say why rather than report a crash as a defect.
// `node-pty` is the portable answer if this ever needs to run there.
let pty;
try {
  pty = resolvePtyWrapper();
} catch (err) {
  // The probe timed out: `script(1)` exists and the machine did not let it
  // finish. That is a starved gate, not a platform without a PTY — reported as
  // a failure so a load spike cannot quietly turn this smoke into a skip
  // (#2333). The budget and the measurement are on `SCRIPT_PROBE_TIMEOUT_MS`.
  fail(err instanceof Error ? err.message : String(err));
}
if (!pty.ok) {
  skip(
    `${pty.reason} — the Ink TUI needs raw mode, which requires a real ` +
      `terminal fd (see scripts/lib/pty.mjs)`,
  );
}

// Rebuilt on every run — presence is not freshness (#2111).
let testServer;
try {
  [testServer] = ensureTestServers({
    repoRoot,
    label: "smoke:tui",
    requires: ["stdio"],
  });
} catch (e) {
  fail(e.message);
}

const work = mkdtempSync(join(tmpdir(), "smoke-tui-"));
const catalogPath = join(work, "catalog.json");
writeFileSync(
  catalogPath,
  JSON.stringify({
    mcpServers: {
      test: { type: "stdio", command: process.execPath, args: [testServer] },
    },
  }),
);

const { command, args } = pty.wrap({
  command: process.execPath,
  args: [launcher, "--tui", "--catalog", catalogPath],
});

let result;
try {
  result = await runRenderSmoke({
    command,
    args,
    marker: RENDER_MARKER,
    timeoutMs: TIMEOUT_MS,
    surviveMs: SURVIVE_MS,
    exitGraceMs: EXIT_GRACE_MS,
    spawnOptions: {
      cwd: repoRoot,
      // Redirect HOME so the TUI's storage never touches the real
      // ~/.mcp-inspector. Pin MCP_OAUTH_CALLBACK_URL="" (empty reads as unset)
      // so an ambient non-loopback value can't crash the TUI before render via
      // the loopback callback guard — same class smoke-cli.mjs's
      // SMOKE_BASE_ENV neutralizes.
      env: {
        ...process.env,
        MCP_OAUTH_CALLBACK_URL: "",
        HOME: work,
        USERPROFILE: work,
      },
    },
    // Belt and braces for the acceptance criterion this fix is measured
    // against. Survival already implies it today, since the raw-mode throw is
    // fatal — but if Ink ever degrades it to a warning, a TUI with no keyboard
    // input would survive happily, and this smoke is the only thing watching.
    forbidOutput: {
      pattern: RAW_MODE_ERROR,
      reason:
        `TUI rendered and survived, but still logged the raw-mode error — ` +
        `the pseudoterminal did not take effect (flavor: ${pty.flavor})`,
    },
    warn: (m) => console.warn(m.replace(/^render-smoke/, "smoke:tui")),
  });
} finally {
  // Never turn a passing smoke into a failure over a leftover temp dir; the OS
  // reclaims tmpdir anyway. runRenderSmoke resolves only after the child's
  // `close`, so on the normal path the #1801 ENOTEMPTY race is already closed
  // and a warning here should not fire — its give-up branches resolve without
  // that guarantee, so it is expected rather than anomalous on those.
  removeSafe(work, { label: "smoke:tui" });
}

if (result.code === 0) {
  console.log(`smoke:tui OK — ${result.message}`);
  process.exit(0);
}
fail(result.message);
