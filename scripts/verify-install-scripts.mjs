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
// Matching mirrors npm 11.19's own (`@npmcli/arborist/lib/script-allowed.js`),
// because a guard that accepts a key npm ignores passes a script npm still
// runs:
//
//  - Identity comes from the lockfile's `resolved` registry URL
//    (`<registry>/<name>/-/<base>-<version>.tgz`), never from the
//    `node_modules` folder name — an alias puts a package under a name it is
//    not, and npm deliberately looks through that.
//  - Only three key shapes are honoured for a registry package: a bare name or
//    `name@*` (every version), and exact versions joined by `||`
//    (`name@1.2.3 || 1.2.4`). npm rejects `^`/`~`/`>=` ranges as policy keys,
//    so they are no review here either.
//  - A package with no provable registry identity (git, tarball, file) is
//    reviewed only by a key equal to its `resolved` spec; otherwise it fails
//    closed, as unreviewed.
//  - A bundled dependency (`inBundle`) never runs its script, so it is skipped.
//
// A matching key counts as a review whether it allows or denies; a value that
// is neither `true` nor `false` does not count.

import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import semver from "semver";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

/** `node_modules/a/node_modules/@s/b` → `@s/b`, for display only. */
export function packageNameOf(entryPath) {
  const marker = "node_modules/";
  return entryPath.slice(entryPath.lastIndexOf(marker) + marker.length);
}

/**
 * The `{ name, version }` a registry tarball URL proves, or `null` — the same
 * parse as npm's `versionFromTgz`, including a registry mounted below the root
 * and a scope written as `%2f`.
 */
export function registryIdentity(resolved) {
  if (typeof resolved !== "string" || !/^https?:\/\//.test(resolved))
    return null;
  const pathname = new URL(resolved).pathname.slice(1);
  const parts = pathname.split("/-/");
  if (parts.length < 2) return null;
  const base = parts.pop();
  if (base.includes("/") || !base.endsWith(".tgz")) return null;
  const segments = parts.pop().split(/\/|%2f/i);
  const project = segments.pop();
  const scope = segments.pop();
  if (!project || !base.startsWith(`${project}-`)) return null;
  const parsed = semver.parse(base.slice(project.length + 1, -".tgz".length));
  if (!parsed) return null;
  const name = scope?.startsWith("@") ? `${scope}/${project}` : project;
  return { name, version: parsed.version };
}

/** `name` and the spec after it, for a bare or scoped key. */
function splitKey(key) {
  const at = key.indexOf("@", key.startsWith("@") ? 1 : 0);
  return at === -1
    ? { name: key, spec: "" }
    : { name: key.slice(0, at), spec: key.slice(at + 1).trim() };
}

/** One or more exact versions joined by `||` — npm's only versioned key. */
function isExactVersionDisjunction(spec) {
  return spec
    .split("||")
    .map((p) => p.trim())
    .every((p) => p !== "" && semver.valid(p) !== null);
}

/** Does this registry-style key cover `identity` the way npm reads it? */
export function keyMatches(key, identity) {
  const { name, spec } = splitKey(key);
  if (name !== identity.name) return false;
  if (spec === "" || spec === "*") return true;
  return (
    isExactVersionDisjunction(spec) && semver.satisfies(identity.version, spec)
  );
}

/** Has `allowScripts` decided on this lockfile entry? */
export function isReviewed(allowScripts, entry) {
  const identity = registryIdentity(entry.resolved);
  return Object.entries(allowScripts ?? {}).some(
    ([key, value]) =>
      typeof value === "boolean" &&
      (identity ? keyMatches(key, identity) : key === entry.resolved),
  );
}

/**
 * Every lockfile entry with an install script that `allowScripts` has not
 * decided on, as `{ entryPath, name, version }` — `name` being the identity
 * npm matches, or the folder name when none can be proven.
 */
export function unreviewedScripts(lock, allowScripts) {
  const found = [];
  for (const [entryPath, entry] of Object.entries(lock?.packages ?? {})) {
    if (!entryPath.startsWith("node_modules/")) continue;
    if (!entry?.hasInstallScript || entry.inBundle) continue;
    if (isReviewed(allowScripts, entry)) continue;
    const identity = registryIdentity(entry.resolved);
    found.push({
      entryPath,
      name: identity?.name ?? packageNameOf(entryPath),
      version: identity?.version ?? entry.version ?? "",
    });
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
      ([p, e]) =>
        p.startsWith("node_modules/") && e?.hasInstallScript && !e.inBundle,
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
        '\nor `"<name>@<version>": true` to approve it — npm ignores `^`/`~` ranges here.' +
        "\nEach install reads only its own manifest, so a package in several installs" +
        "\nneeds an entry in each.",
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
