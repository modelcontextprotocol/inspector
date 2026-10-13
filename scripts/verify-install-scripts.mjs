#!/usr/bin/env node
// Guard: no dependency install script is left unreviewed (#2712).
//
// npm 11.19 gates dependency install scripts behind an `allowScripts` policy
// in the installing project's `package.json`, but in 11.x a package that is
// neither allowed nor denied still RUNS its script, with only a warning — only
// an explicit `false` blocks it. So until npm makes blocking the default, a new
// dependency that brings a `postinstall` runs it on every install, silently.
// This guard turns each one into a decision made in review: every package with
// an install script must carry an explicit `true` or `false` in the
// `allowScripts` of the install that holds it.
//
// v2 is not a workspace, and npm reads `allowScripts` only from the manifest of
// the install it is running in, so each install (the root plus every
// `clients/*` with a manifest — the enrolment `verify:install-fresh` uses) is
// checked against its own policy and no other.
//
// It reads the LOCKFILE's `hasInstallScript` rather than shelling out to
// `npm install-scripts ls`, which is what the issue first proposed: that
// subcommand only exists from npm 11.19, and CI's `build` job runs Node 22's
// bundled npm 10.x, where it is absent — so the guard would either fail in CI
// for an unrelated reason or skip there and enforce nothing. The lockfile flag
// is what npm itself records for exactly this question (preinstall, install,
// postinstall, or an implicit `node-gyp rebuild` from a `binding.gyp`), and
// reading it keeps the guard offline and independent of the npm on PATH. The
// `""` entry is the install's own project — the root `postinstall` that
// cascades into every client — which is not a dependency script and is out of
// scope.
//
// Policy keys are matched the way the issue's denials are written: a bare name
// covers every version, and `name@<range>` covers the versions the range
// satisfies (an exact version being the narrowest range). A key that names the
// package but whose value is neither `true` nor `false` does not count as a
// review.

import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import semver from "semver";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

/** `node_modules/a/node_modules/@s/b` → `@s/b`. */
export function packageNameOf(entryPath) {
  const marker = "node_modules/";
  return entryPath.slice(entryPath.lastIndexOf(marker) + marker.length);
}

/**
 * Has `allowScripts` made a decision about `name@version`? A bare-name key
 * covers every version; `name@<range>` covers what the range satisfies.
 */
export function isReviewed(allowScripts, name, version) {
  for (const [key, value] of Object.entries(allowScripts ?? {})) {
    if (typeof value !== "boolean") continue;
    if (key === name) return true;
    if (!key.startsWith(`${name}@`)) continue;
    const range = key.slice(name.length + 1);
    if (semver.validRange(range) && semver.satisfies(version, range))
      return true;
  }
  return false;
}

/**
 * Every lockfile entry with an install script that `allowScripts` has not
 * decided on, as `{ entryPath, name, version }`.
 */
export function unreviewedScripts(lock, allowScripts) {
  const found = [];
  for (const [entryPath, entry] of Object.entries(lock?.packages ?? {})) {
    if (!entryPath.startsWith("node_modules/")) continue;
    if (!entry?.hasInstallScript) continue;
    const name = packageNameOf(entryPath);
    const version = typeof entry.version === "string" ? entry.version : "";
    if (!isReviewed(allowScripts, name, version))
      found.push({ entryPath, name, version });
  }
  return found;
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
  let scripted = 0;
  const installs = installDirs(root);
  for (const rel of installs) {
    const dir = path.join(root, rel);
    const lockPath = path.join(dir, "package-lock.json");
    // A missing lockfile is `verify:dep-lockstep`'s finding, not this guard's.
    if (!existsSync(lockPath)) continue;
    const lock = JSON.parse(readFileSync(lockPath, "utf8"));
    const manifest = JSON.parse(
      readFileSync(path.join(dir, "package.json"), "utf8"),
    );
    scripted += Object.entries(lock.packages ?? {}).filter(
      ([p, e]) => p.startsWith("node_modules/") && e?.hasInstallScript,
    ).length;
    for (const u of unreviewedScripts(lock, manifest.allowScripts))
      problems.push(`  ${rel}: ${u.name}@${u.version} (${u.entryPath})`);
  }
  if (problems.length > 0) {
    console.error(
      `verify:install-scripts — ${problems.length} dependency install script(s) are unreviewed:\n` +
        problems.join("\n") +
        "\n\nnpm 11.x still RUNS an install script that `allowScripts` neither allows nor" +
        "\ndenies. Decide each one in the `allowScripts` of the package.json beside that" +
        '\nlockfile: `"<name>": false` to block it (a bare name covers every version),' +
        '\nor `"<name>@<version>": true` to approve it. Each install reads only its own' +
        "\nmanifest, so a package in several installs needs an entry in each.",
    );
    return 1;
  }
  console.log(
    `verify:install-scripts — OK (${scripted} dependency install script(s) across ${installs.length} installs, all reviewed)`,
  );
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  process.exit(main());
