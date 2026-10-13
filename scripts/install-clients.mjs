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
 *
 * The child installs run with `npm_config_allow_scripts` stripped from their
 * environment (#2518). npm exports every non-default config value to lifecycle
 * scripts as `npm_config_*`, whichever npmrc set it, and a child npm reads that
 * env var as if it were `--allow-scripts` on the command line — which npm
 * 11.19+ rejects outright in a project install (EALLOWSCRIPTS). So a user with
 * `allow-scripts` in their ~/.npmrc could install the root and then fail on
 * the first client. Stripping it loses nothing: each child npm reads the same
 * npmrc files itself, as npmrc, where the setting is allowed.
 */

import { spawnSync } from "node:child_process";
import { existsSync, realpathSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CLIENTS = ["web", "cli", "mcpdo", "tui", "launcher"];

/**
 * The environment for a per-client `npm install`: the parent's, minus the
 * config npm refuses to receive through the environment in a project install.
 * npm matches `npm_config_*` case-insensitively, so the strip does too.
 * @param {NodeJS.ProcessEnv} env
 * @returns {NodeJS.ProcessEnv}
 */
export function childInstallEnv(env) {
  const next = { ...env };
  for (const key of Object.keys(next)) {
    if (key.toLowerCase() === "npm_config_allow_scripts") {
      delete next[key];
    }
  }
  return next;
}

function main() {
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
      env: childInstallEnv(process.env),
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
}

// Compare real paths on both sides. By default Node resolves symlinks for
// import.meta.url but not for argv[1], and --preserve-symlinks-main reverses
// that, so a checkout reached through a symlink (macOS /var -> /private/var)
// would otherwise skip the cascade silently.
if (
  process.argv[1] &&
  realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))
) {
  main();
}
