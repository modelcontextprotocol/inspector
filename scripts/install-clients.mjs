#!/usr/bin/env node
/**
 * Root postinstall: install dependencies for each client package.
 *
 * v2 deliberately does not use npm workspaces (see the rationale in
 * specification/v2_cli_tui_launcher.md), so each client under clients/* keeps
 * its own package.json and node_modules. Without this cascade a from-source
 * checkout would have to run `npm install` in every client directory by hand —
 * the install-friction gap. Running it from the root `postinstall` makes a
 * single `npm install` at the repo root populate every client.
 *
 * Safe outside a source checkout:
 *  - When this package is installed as a dependency it lives under a
 *    node_modules directory; we detect that and exit early.
 *  - The published tarball ships only each client's build/ output (see the
 *    root package.json `files` array), not their package.json, so even if the
 *    node_modules check were bypassed the per-client guard finds nothing to
 *    install and the script no-ops.
 *
 * Set INSPECTOR_SKIP_CLIENT_INSTALL=1 to skip explicitly — e.g. CI that
 * installs each client itself and wants to avoid the redundant pass.
 */

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CLIENTS = ["web", "cli", "tui", "launcher"];

if (process.env.INSPECTOR_SKIP_CLIENT_INSTALL) {
  console.log(
    "[install-clients] INSPECTOR_SKIP_CLIENT_INSTALL set — skipping client installs.",
  );
  process.exit(0);
}

// Installed as a dependency (lives under node_modules) → nothing to do.
if (repoRoot.split(sep).includes("node_modules")) {
  process.exit(0);
}

for (const name of CLIENTS) {
  const dir = join(repoRoot, "clients", name);
  // The published tarball ships build/ output only, no client package.json.
  if (!existsSync(join(dir, "package.json"))) {
    continue;
  }
  console.log(
    `[install-clients] Installing dependencies for clients/${name}...`,
  );
  const result = spawnSync("npm", ["install"], {
    cwd: dir,
    stdio: "inherit",
    // npm is npm.cmd on Windows, which needs a shell to resolve.
    shell: process.platform === "win32",
  });
  if (result.status !== 0) {
    console.error(
      `[install-clients] npm install failed in clients/${name} (exit ${result.status ?? "unknown"}).`,
    );
    process.exit(result.status ?? 1);
  }
}
