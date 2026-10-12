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
 *   - `--version` / `-V`, bare and after each mode flag → the root package
 *     version alone, without starting a server (#2632).
 *
 * Each must exit 0 and print the mode's distinctive usage banner, which also
 * confirms the launcher resolved and loaded that client's build. Exits non-zero
 * on the first failing check.
 *
 * Expects `clients/{launcher,web,cli,tui}/build` to exist (the validate / CI
 * ordering guarantees this) — every dispatch, the default web mode included,
 * dynamically imports the respective client build.
 */

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const repoRoot = resolve(import.meta.dirname, "..");
const launcher = join(repoRoot, "clients", "launcher", "build", "index.js");

function fail(message) {
  console.error(`smoke:launcher FAILED — ${message}`);
  process.exit(1);
}

for (const client of ["launcher", "web", "cli", "tui"]) {
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

// `--version` must print exactly the root version and exit 0 in every mode —
// before #2632 the bare form fell through to web and bound a port. The output
// is matched whole, so a server banner printed alongside it also fails.
const { version } = JSON.parse(
  readFileSync(join(repoRoot, "package.json"), "utf8"),
);
for (const prefix of [[], ["--web"], ["--cli"], ["--tui"]]) {
  for (const flag of ["--version", "-V"]) {
    checks.push({
      args: [...prefix, flag],
      exact: version,
      label: `${[...prefix, flag].join(" ")} prints the version`,
    });
  }
}

for (const { args, marker, exact } of checks) {
  const r = spawnSync(process.execPath, [launcher, ...args], {
    cwd: repoRoot,
    encoding: "utf8",
    // A regressed `--version` starts a server that never exits on its own.
    timeout: 30_000,
  });
  const output = `${r.stdout ?? ""}${r.stderr ?? ""}`;
  if (r.status !== 0) {
    fail(
      `\`${args.join(" ")}\` exited with code ${r.status}\n${output.slice(0, 800)}`,
    );
  }
  if (exact !== undefined) {
    if (output.trim() !== exact) {
      fail(
        `\`${args.join(" ")}\` printed something other than "${exact}"\n${output.slice(0, 800)}`,
      );
    }
  } else if (!output.includes(marker)) {
    fail(
      `\`${args.join(" ")}\` did not print "${marker}"\n${output.slice(0, 800)}`,
    );
  }
}

console.log(`smoke:launcher OK — ${checks.map((c) => c.label).join("; ")}`);
