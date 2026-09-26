#!/usr/bin/env node
// Guard: every install's `node_modules` matches its own lockfile (#2494).
//
// Every other dependency guard here reads LOCKFILES — `verify:dep-lockstep`
// compares one install's lockfile against another's — so none of them can see a
// checkout whose `node_modules` is older than the lockfile it sits beside. That
// is the ordinary state of a long-lived checkout after `git pull` brings in a
// dependency bump and nobody re-runs `npm install`, and it fails far from its
// cause: when the MCP SDK moved 2.0.0 → 2.1.0 (5e0cc0fc), a checkout still
// holding 2.0.0 passed every guard, lint and typecheck, and went red only in
// `transportAuthorizationPrecedence.test.ts` — a behavioral test pinning the
// precedence flip 2.1.0 made, reporting the OLD behavior as a product defect.
//
// So this compares, for each install (the root plus every `clients/*` with a
// manifest — the same enrolment `verify:dep-lockstep` uses), every package entry
// in `package-lock.json` against the `version` in the installed copy's own
// `package.json`. It reads ground truth rather than npm's hidden lockfile
// (`node_modules/.package-lock.json`), which records what npm last wrote, not
// what is on disk now.
//
// CI installs from scratch on every run, so this never fires there; it runs
// inside `validate:guards` anyway so that `validate` and `local:gate` both fail
// in seconds, naming `npm install`, instead of minutes later on a test.

import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

/**
 * Compare a parsed lockfile against an install's `node_modules`.
 *
 * `readInstalledVersion(entryPath)` returns the installed copy's version, or
 * `undefined` when no copy is present. Returns `{ stale, missing }`:
 *
 *  - `stale` — present, but at a different version than the lockfile records.
 *  - `missing` — absent although the lockfile requires it. An `optional` or
 *    `devOptional` entry is exempt: npm skips those legitimately (a platform
 *    binary for another OS/CPU), so absence is not evidence of staleness.
 *
 * `link` entries carry no version (they point into the repo) and are skipped.
 */
export function compareInstall(lock, readInstalledVersion) {
  const stale = [];
  const missing = [];
  for (const [entryPath, entry] of Object.entries(lock?.packages ?? {})) {
    if (!entryPath.startsWith("node_modules/")) continue;
    if (entry?.link || typeof entry?.version !== "string") continue;
    const installed = readInstalledVersion(entryPath);
    if (installed === undefined) {
      if (!entry.optional && !entry.devOptional)
        missing.push({ entryPath, expected: entry.version });
    } else if (installed !== entry.version) {
      stale.push({ entryPath, expected: entry.version, installed });
    }
  }
  return { stale, missing };
}

/** The installed version at `<dir>/<entryPath>/package.json`, or `undefined`. */
function installedVersionReader(dir) {
  return (entryPath) => {
    const manifest = path.join(dir, entryPath, "package.json");
    if (!existsSync(manifest)) return undefined;
    const version = JSON.parse(readFileSync(manifest, "utf8")).version;
    return typeof version === "string" ? version : undefined;
  };
}

/** The root plus every `clients/*` directory with a `package.json`. */
function installDirs(root) {
  const clients = path.join(root, "clients");
  const dirs = existsSync(clients)
    ? readdirSync(clients, { withFileTypes: true })
        .filter((e) => e.isDirectory())
        .map((e) => `clients/${e.name}`)
        .filter((rel) => existsSync(path.join(root, rel, "package.json")))
        .sort()
    : [];
  return ["."].concat(dirs);
}

export function main(root = repoRoot) {
  const problems = [];
  let checked = 0;
  for (const rel of installDirs(root)) {
    const dir = path.join(root, rel);
    const lockPath = path.join(dir, "package-lock.json");
    // A missing lockfile is `verify:dep-lockstep`'s finding, not this guard's.
    if (!existsSync(lockPath)) continue;
    const lock = JSON.parse(readFileSync(lockPath, "utf8"));
    const { stale, missing } = compareInstall(
      lock,
      installedVersionReader(dir),
    );
    checked += Object.keys(lock.packages ?? {}).length;
    // A never-installed tree would list every package; one line says it better.
    // (An install with no dependencies — `clients/launcher` — has no
    // `node_modules` legitimately, and reaches here with nothing missing.)
    if (missing.length > 0 && !existsSync(path.join(dir, "node_modules"))) {
      problems.push(`  ${rel}: no node_modules at all`);
      continue;
    }
    for (const s of stale)
      problems.push(
        `  ${rel}/${s.entryPath}: installed ${s.installed}, lockfile ${s.expected}`,
      );
    for (const m of missing)
      problems.push(
        `  ${rel}/${m.entryPath}: not installed, lockfile ${m.expected}`,
      );
  }
  if (problems.length > 0) {
    console.error(
      `verify:install-fresh — ${problems.length} installed package(s) disagree with their lockfile:\n` +
        problems.join("\n") +
        "\n\nnode_modules is older than the lockfile beside it — usually a `git pull` that" +
        "\nbrought in a dependency bump. Run `npm install` at the repo root (it cascades" +
        "\ninto every client). Tests run against a stale install report the OLD" +
        "\ndependency's behavior as a product failure.",
    );
    return 1;
  }
  console.log(
    `verify:install-fresh — OK (${checked} lockfile entries across ${installDirs(root).length} installs match node_modules)`,
  );
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  process.exit(main());
