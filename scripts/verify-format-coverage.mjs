#!/usr/bin/env node
// Durable guard for the "every first-party source file is format-gated" invariant
// that #1789 established by a one-shot manual audit (PR #1792). A prettier
// `format`/`format:check` glob that stops covering a file fails silently — the
// file is simply skipped, not reported — so a nested dir (`.storybook/`, a
// client `scripts/`) or a new extension can re-open the gap unnoticed. This is
// the format-coverage analog of `verify:build-gate`: it enumerates every tracked
// source file and asserts each is matched by at least one `prettier --check`
// glob declared across the repo's `package.json`s. Exits non-zero, listing the
// offenders, on any miss.
//
// Source of truth is the `format:check*` scripts themselves — this parser reads
// the globs out of them, so widening/narrowing a glob is reflected here with no
// second list to keep in sync.

import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  reachableScripts,
  rootReachesScript,
  rootRunsClientValidate,
} from "./lib/npm-scripts.mjs";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

// File extensions prettier formats as first-party source here. Kept in sync with
// the union of the format globs; a file with one of these extensions that no
// glob matches is the failure this guard exists to catch.
const SOURCE_EXTENSIONS = [
  "ts",
  "tsx",
  "mts",
  "cts",
  "js",
  "jsx",
  "mjs",
  "cjs",
];

// The `package.json`s whose `format:check*` scripts define the gate. The root
// carries the split `format:check:core|scripts|shared`; each client carries a
// single `format:check`. Paths are relative to the repo root; each glob resolves
// relative to its manifest's directory (prettier's cwd for that script).
const MANIFESTS = [
  ".",
  "clients/web",
  "clients/cli",
  "clients/tui",
  "clients/launcher",
];

/** Split a shell-ish command string into args, honoring double quotes. */
function tokenize(command) {
  const tokens = [];
  const re = /"([^"]*)"|(\S+)/g;
  let m;
  while ((m = re.exec(command)) !== null) {
    tokens.push(m[1] !== undefined ? m[1] : m[2]);
  }
  return tokens;
}

/**
 * Extract the path/glob args from every `prettier --check …` in a manifest's
 * scripts that is reachable from `validate`. Restricting to reachable scripts is
 * what makes the guard assert "this file is checked by CI", not merely "some
 * glob covers it".
 */
function prettierCheckArgs(scripts) {
  const reachable = reachableScripts(scripts);
  const args = [];
  for (const [name, value] of Object.entries(scripts ?? {})) {
    if (!reachable.has(name)) continue;
    if (typeof value !== "string" || !value.includes("prettier --check"))
      continue;
    // A manifest may chain `prettier --check …` inside a larger script; take the
    // segment starting at each occurrence up to the next `&&`/`||`/`;`.
    for (const segment of value.split(/&&|\|\||;/)) {
      const trimmed = segment.trim();
      if (!trimmed.startsWith("prettier --check")) continue;
      const tokens = tokenize(trimmed).slice(2); // drop `prettier` `--check`
      for (const t of tokens) {
        if (t.startsWith("-")) continue; // a flag, not a path
        args.push(t);
      }
    }
  }
  return args;
}

const GLOB_CHARS = /[*?{}[\]]/;

/** Convert a prettier glob to an anchored RegExp over repo-relative POSIX paths. */
function globToRegExp(glob) {
  let re = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === "*") {
      if (glob[i + 1] === "*") {
        // `**` (optionally `**/`) crosses path separators.
        if (glob[i + 2] === "/") {
          re += "(?:.*/)?";
          i += 2;
        } else {
          re += ".*";
          i += 1;
        }
      } else {
        re += "[^/]*"; // `*` stays within a segment
      }
    } else if (c === "?") {
      re += "[^/]";
    } else if (c === "{") {
      re += "(?:";
    } else if (c === "}") {
      re += ")";
    } else if (c === ",") {
      re += "|";
    } else if (".+^$()|\\/".includes(c)) {
      re += "\\" + c;
    } else {
      re += c;
    }
  }
  return new RegExp("^" + re + "$");
}

/**
 * Assert the root `validate` chain actually invokes each non-root manifest's
 * `validate` (via `cd <dir> && npm run validate`). Without this, a client's
 * globs would still be harvested from its own `validate` and count as coverage
 * even if the root chain stopped running that client — the same "gate silently
 * stops gating" failure as the reachable-script check, one level up. Returns the
 * list of manifest dirs the root chain does NOT reach.
 */
function clientsUnreachedFromRoot() {
  const rootPkg = JSON.parse(
    readFileSync(path.join(repoRoot, "package.json"), "utf8"),
  );
  return MANIFESTS.filter((dir) => dir !== ".").filter(
    (dir) => !rootRunsClientValidate(rootPkg.scripts, dir),
  );
}

/** Build the set of coverage predicates from all manifests' format globs. */
function buildMatchers() {
  const matchers = [];
  for (const manifestDir of MANIFESTS) {
    const manifestPath = path.join(repoRoot, manifestDir, "package.json");
    const pkg = JSON.parse(readFileSync(manifestPath, "utf8"));
    for (const arg of prettierCheckArgs(pkg.scripts)) {
      const rel = manifestDir === "." ? arg : path.posix.join(manifestDir, arg);
      if (GLOB_CHARS.test(arg)) {
        const re = globToRegExp(rel);
        matchers.push((f) => re.test(f));
      } else {
        // A bare path: a directory prettier recurses into, or an exact file.
        matchers.push((f) => f === rel || f.startsWith(rel + "/"));
      }
    }
  }
  return matchers;
}

function trackedSourceFiles() {
  const out = execFileSync(
    "git",
    ["ls-files", ...SOURCE_EXTENSIONS.map((e) => `*.${e}`)],
    { cwd: repoRoot, encoding: "utf8" },
  );
  return out.split("\n").filter(Boolean);
}

// Vouch for the sibling guard: a guard can't detect being unrun itself, but the
// two coverage guards can each assert the other is still wired into `validate`,
// so dropping either is caught here. Only deleting both slips through.
const rootScripts = JSON.parse(
  readFileSync(path.join(repoRoot, "package.json"), "utf8"),
).scripts;
if (!rootReachesScript(rootScripts, "verify:typecheck-coverage")) {
  console.error(
    "verify:format-coverage — the root `validate` no longer runs `verify:typecheck-coverage` (its sibling guard). Restore it.",
  );
  process.exit(1);
}

const unreachedClients = clientsUnreachedFromRoot();
if (unreachedClients.length > 0) {
  console.error(
    `verify:format-coverage — the root \`validate\` chain does not invoke ${unreachedClients.length} client validation(s):\n`,
  );
  for (const dir of unreachedClients)
    console.error(`  ${dir} (expected \`cd ${dir} && npm run validate\`)`);
  console.error(
    "\nA client whose `validate` the root chain never runs is not format-gated by CI,",
  );
  console.error(
    "even though its globs exist. Restore the `validate:<client>` link in the root `validate`.",
  );
  process.exit(1);
}

const matchers = buildMatchers();
const files = trackedSourceFiles();
const ungated = files.filter((f) => !matchers.some((m) => m(f)));

if (ungated.length > 0) {
  console.error(
    `verify:format-coverage — ${ungated.length} tracked source file(s) are not covered by any prettier format glob:\n`,
  );
  for (const f of ungated) console.error("  " + f);
  console.error(
    "\nAdd the file's directory (or a matching glob) to the relevant `format`/`format:check` script,",
  );
  console.error("or widen the extension set. See AGENTS.md.");
  process.exit(1);
}

console.log(
  `verify:format-coverage — OK: all ${files.length} tracked source files are format-gated.`,
);
