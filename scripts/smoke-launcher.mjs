#!/usr/bin/env node
/**
 * Dispatch smoke test for the launcher (#1347).
 *
 * Verifies that the built launcher boots and routes `--help` to each mode
 * without crashing — the cheap first line of defense before the heavier prod
 * smokes (`smoke:cli` / `smoke:tui` / `smoke:web`):
 *
 *   - `--help`        → the launcher's own usage (mode flags).
 *   - `--cli --help`  → dispatched to the CLI binary's help.
 *   - `--tui --help`  → dispatched to the TUI binary's help.
 *
 * Each must exit 0 and print the mode's distinctive usage banner, which also
 * confirms the launcher resolved and loaded that client's build. Exits non-zero
 * on the first failing check.
 *
 * Expects `clients/{launcher,cli,tui}/build` to exist (the validate / CI
 * ordering guarantees this) — `--cli`/`--tui` dispatch dynamically imports the
 * respective client build.
 */

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";

const repoRoot = resolve(import.meta.dirname, "..");
const launcher = join(repoRoot, "clients", "launcher", "build", "index.js");

function fail(message) {
  console.error(`smoke:launcher FAILED — ${message}`);
  process.exit(1);
}

for (const client of ["launcher", "cli", "tui"]) {
  const build = join(repoRoot, "clients", client, "build", "index.js");
  if (!existsSync(build)) {
    fail(`${client} build not found at ${build} — run \`npm run build\` first`);
  }
}

// Each check: launcher args, a distinctive marker proving the right mode's help
// was reached, and a human label for the success/failure message.
const checks = [
  {
    args: ["--help"],
    marker: "Mode flags (--web, --cli, --tui)",
    label: "--help shows launcher usage",
  },
  {
    args: ["--cli", "--help"],
    marker: "Usage: inspector-cli",
    label: "--cli dispatches to the CLI",
  },
  {
    args: ["--tui", "--help"],
    marker: "Usage: mcp-inspector-tui",
    label: "--tui dispatches to the TUI",
  },
];

for (const { args, marker, label } of checks) {
  const r = spawnSync(process.execPath, [launcher, ...args], {
    cwd: repoRoot,
    encoding: "utf8",
  });
  const output = `${r.stdout ?? ""}${r.stderr ?? ""}`;
  if (r.status !== 0) {
    fail(
      `\`${args.join(" ")}\` exited with code ${r.status}\n${output.slice(0, 800)}`,
    );
  }
  if (!output.includes(marker)) {
    fail(
      `\`${args.join(" ")}\` did not print "${marker}"\n${output.slice(0, 800)}`,
    );
  }
}

console.log(`smoke:launcher OK — ${checks.map((c) => c.label).join("; ")}`);
