#!/usr/bin/env node
// Durable guard for the "every tracked source file gets a `tsc` pass" invariant
// that #1791 established for the Node clients — every `clients/*`, enrolled via
// its `typecheck` script's projects (cli, tui, launcher) or, for a client with
// no `typecheck` script (clients/web), via its `tsconfig.json` `references`; a
// new client is picked up from disk automatically (nodeClients). Either way a
// `tsc -b` solution config is reduced to the real projects it references
// (resolveLeafProjects), so coverage and the non-inertness check both follow it.
// A tsconfig
// project only typechecks the files its `include`/`files` name plus whatever
// those transitively import — so a new top-level `.ts` (a fresh config file, a
// new test helper) can silently fall outside every project and get no
// type-checking, exactly the hole that surfaced twice during #1791's review
// (`launcher/__tests__`, then `launcher/vitest.config.ts`). launcher is the most
// exposed: its build config's `rootDir: "./src"` actively rejects anything at
// the package root.
//
// This is the typecheck-coverage analog of `verify:format-coverage`: for each
// client it runs every project its `typecheck` script names with `tsc
// --listFilesOnly` (the accurate measure — it includes import-reached files),
// unions the result, and asserts every tracked first-party `.ts`/`.tsx`/`.mts`/
// `.cts` under the client is in that union. It also covers, deny-by-default, the
// tracked TS that lives OUTSIDE any client — the shared surface (`test-servers/
// src`, `vitest.shared.mts`), all of `core/` (covered by web's enrolled `tsc -b`
// projects), plus anything at a new top-level location — requiring each to land
// in the global union of client projects. Exits non-zero, listing the offenders,
// on any miss.
//
// Like its sibling it also asserts the gate is actually WIRED: each client's
// `typecheck` must be reachable from that client's `validate`, and the root
// `validate` chain must invoke each client's `validate` — otherwise the guard
// could measure a `typecheck` script that CI no longer runs and stay green while
// nothing is typechecked ("gate silently stops gating").
//
// Source of truth is the `typecheck` scripts themselves — this parser reads the
// `-p`/`--project`/`-b`/`--build` args (and the implicit `./tsconfig.json` a
// bare `tsc` resolves) out of every script reachable from `typecheck`, so
// adding/removing a project is reflected here with no second list to keep in sync.

import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  reachableScripts,
  rootReachesScript,
  rootRunsClientValidate,
  tokenize,
} from "./lib/npm-scripts.mjs";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

// Clients this guard deliberately does NOT gate, with the reason. The escape
// hatch for a genuinely-ungateable client. Empty today: `clients/web` used to be
// here (it has no `typecheck` script — its `build` runs `tsc -b`) but is now
// ENROLLED through its `tsconfig.json` `references`, so its package-root files
// are checked rather than whole-tree-exempted (an exemption wider than the gate
// it defers to — #1799 review r24).
const EXEMPT = new Map();

// TypeScript source extensions this guard requires a tsc pass for. Matches its
// sibling's TS set (`verify-format-coverage.mjs` — `.mts` is already the idiom
// for shared config here, e.g. `vitest.shared.mts`, so a client `.mts`/`.cts`
// must be gated too). Ambient declaration files are excluded: an unreferenced
// `*.d.{ts,mts,cts}` shim (e.g. web's `vitest.shims.d.ts`) is type-only and not
// a real gap. There are no client `.mts`/`.cts` today; this pre-empts one.
export const isRequiredSource = (rel) =>
  /\.(ts|tsx|mts|cts)$/.test(rel) && !/\.d\.(ts|mts|cts)$/.test(rel);

// Match `tsc` by token basename so a path-invoked binary (`node_modules/.bin/
// tsc`, `./node_modules/.bin/tsc.cmd`) counts, not just the bare `tsc` token.
export const isTsc = (t) => /(?:^|[\\/])tsc(?:\.(?:cmd|exe|ps1))?$/.test(t);

// A flag that makes a `tsc` pass list files without type-checking them (so it
// gates nothing). Case-insensitive — tsc's own option parsing is. Shared by the
// `typecheck`-script path and the reference (`tsc -b`) path.
export const isDisablingFlag = (t) => /^--(noCheck|listFilesOnly)$/i.test(t);

/**
 * Whether a tracked test file is matched by one of the `test:scripts` command's
 * globs. Delegates to node's own `path.matchesGlob` (22.5.0+; the repo floor is
 * `>=22.19.0`) rather than hand-translating the glob to a RegExp — `node --test`
 * is the thing whose matching we're modeling, so measuring with node's matcher
 * is exact for every form it accepts (`**` incl. zero depth, `*`, `?` as exactly
 * one non-separator char, brace alternation, character classes) instead of
 * false-failing on whichever form the translator hadn't covered yet.
 */
export const matchesTestGlob = (file, glob) => path.matchesGlob(file, glob);

// `node --test` flags that make it execute only PART of the suite its globs
// match, while still exiting 0. This is `--noCheck` for the test runner: the
// gate runs, but gates less than it appears to.
const NARROWING_TEST_FLAGS = new Set([
  "--test-shard",
  "--test-only",
  "--test-name-pattern",
  "--test-skip-pattern",
]);

// `node --test` flags whose VALUE is a separate token — never a positional glob.
const VALUE_TAKING_TEST_FLAGS = new Set([
  "--test-coverage-include",
  "--test-coverage-exclude",
  "--test-reporter",
  "--test-reporter-destination",
  "--test-name-pattern",
  "--test-skip-pattern",
  "--test-shard",
  // Threshold flags: numeric values, so harvesting one is inert rather than a
  // suppression (a number can't be a BROADER glob) — listed for completeness.
  "--test-coverage-lines",
  "--test-coverage-branches",
  "--test-coverage-functions",
]);

/**
 * The path/glob arguments `test:scripts` hands `node --test`, harvested across
 * every script reachable FROM it — not just its own literal string. A delegating
 * `test:scripts` ("npm run test:scripts:lib && npm run test:scripts:guard", the
 * way other scripts here split) genuinely runs every test, and reading the one
 * string would instead harvest `npm`/`run`/`test:scripts:lib` and report each
 * test file as unmatched with unfollowable advice. Reachability also picks up a
 * `pretest:scripts` hook for free.
 *
 * Scoped per COMMAND SEGMENT to the ones that actually invoke `node --test`,
 * exactly as `typecheckProjects` gates on `tokens.some(isTsc)` before harvesting
 * `-p` args. Without that scoping a glob belonging to a *neighbouring* command
 * is attributed to the test runner — and since `.some()` only needs ONE glob to
 * match, a broader one silently suppresses a real miss rather than adding an
 * inert pattern. A `pretest:scripts` of `prettier --check "scripts/**\/*.mjs"`
 * is enough to do it: that glob matches a renamed `*.spec.mjs`, so the rename
 * `node --test` skips would pass the check. Reachability widened what's read;
 * this keeps what's *harvested* to the runner's own arguments.
 *
 * Within a kept segment only the POSITIONAL args count. `--test-coverage-include
 * "scripts/**\/*.mjs"` is the same suppression one level in — a glob-valued flag
 * broader than the test glob, which would vouch for the very file the runner
 * skips (and it's the obvious next addition here, since `scripts/` sits outside
 * the ≥90 coverage gate). A leading `./` is normalized off because `git ls-files`
 * emits none, so `./scripts/…` — the common npm-script idiom, which `node --test`
 * accepts — would otherwise match nothing and blame every file for a rename that
 * never happened (`rootRunsClientValidate` normalizes it for the same reason).
 */
const testRunnerSegments = (scripts) =>
  [...reachableScripts(scripts, "test:scripts")]
    .map((n) => scripts?.[n])
    .filter((c) => typeof c === "string")
    .flatMap((c) => c.split(/&&|\|\||;/))
    .map((segment) => tokenize(segment))
    .filter((tokens) => tokens.includes("--test")); // only `node --test` names test files

export const testScriptGlobs = (scripts) =>
  testRunnerSegments(scripts)
    .flatMap((tokens) =>
      tokens.filter(
        (t, i) =>
          !t.startsWith("-") &&
          t !== "node" &&
          !VALUE_TAKING_TEST_FLAGS.has(tokens[i - 1]),
      ),
    )
    .map((g) => g.replace(/^\.\//, ""));

/**
 * Suite-narrowing flags the `test:scripts` runner is given. The other three axes
 * ask whether the tests are RUN, whether there are any, and whether the runner
 * is told about each — none asks what it then DOES with them. `--test-shard 1/2`
 * keeps every glob intact and executes half the suite, exiting 0; `--test-only`
 * and the name/skip patterns are the same shape. Three of these are already in
 * `VALUE_TAKING_TEST_FLAGS` — the guard knew them well enough to drop their
 * values, but not that they shrink the run.
 *
 * Known boundary: COMPLEMENTARY shards (`--test-shard 1/2` and `2/2` in two
 * reachable scripts) do run the whole suite, and this flags them anyway. Fail-
 * safe, and nobody shards a sub-100ms suite; reconstructing shard arithmetic to
 * allow it would cost more than the case is worth.
 */
export const testScriptNarrowingFlags = (scripts) =>
  testRunnerSegments(scripts)
    .flat()
    // `--flag=value` and `--flag value` both report as the bare flag name.
    .map((t) => t.split("=")[0])
    .filter((t) => NARROWING_TEST_FLAGS.has(t));

/**
 * Whether a tracked `scripts/` file is one of this guard's own test files, by
 * CONTENT rather than name: a JS file that registers tests with `node:test` is
 * a test whatever it's called.
 *
 * Deciding it by name would key the required set off the same pattern the
 * `test:scripts` glob uses, so a rename escaping BOTH is invisible to every axis
 * — a dot→hyphen slip (`npm-scripts.test.mjs` → `npm-scripts-test.mjs`) drops
 * the file from `testFiles` entirely, so nothing asks whether the runner is told
 * about it, and the surviving file satisfies the non-empty axis. Round 30 fixed
 * "renamed to a form the GLOB misses" by broadening the name pattern; a fifth
 * name pattern only moves that boundary again. `node --test` decides what a test
 * is by whether it registers tests, so read that instead of guessing.
 */
// The extension half, alone: `main()` needs it BEFORE reading a file, and the
// predicate needs it as part of its contract. One definition, two positions.
export const isJsFile = (file) => /\.(c|m)?js$/.test(file);

export const isScriptsTestFile = (file, source) =>
  isJsFile(file) &&
  // Node's actual criterion is REGISTERING tests, not mentioning the module: a
  // shared helper importing `node:test`'s `mock` registers none, and telling it
  // to rename itself to `*.test.mjs` would only make node run an empty file.
  /(?:\bfrom|\brequire\(\s*)\s*["']node:test["']/.test(source) &&
  /\b(?:test|it|describe|suite)\s*\(/.test(source);

/**
 * Gate-integrity problems with `test:scripts` — this guard's OWN parser tests —
 * given the root `scripts` and the tracked `scripts/**` test files. Vouched for
 * the same way the guard vouches for a `tsc` pass, on three axes: it must be run
 * from `validate`, its file set must be non-empty, and every one of those files
 * must be matched by a glob the runner is actually given — because `node --test`
 * SKIPS a file its glob misses and still exits 0, so a rename to `*.spec.mjs`
 * would shrink the suite with a green run.
 *
 * Pure, and separate from `main()`, so each branch below is reachable from the
 * test suite: every previous round put the newest branch inside `main()`, where
 * mutation testing found it untested three rounds running.
 */
export function testScriptProblems(scripts, testFiles) {
  if (!rootReachesScript(scripts, "test:scripts"))
    return [
      "the root `validate` no longer runs `test:scripts` — the guard's own parser tests run nowhere; restore it.",
    ];
  const problems = [];
  if (testFiles.length === 0)
    problems.push(
      "no `scripts/**/*.test.*` files are tracked — the guard's parser tests are gone.",
    );
  const globs = testScriptGlobs(scripts);
  if (globs.length === 0) {
    // A bare `node --test` (auto-discovery from the cwd) names no glob, and
    // `.some()` over an empty list would blame every file individually with
    // advice none of them can follow. Say the actual problem once instead.
    problems.push(
      '`test:scripts` names no path/glob — this guard can\'t tell which files `node --test` runs. Give it an explicit glob (e.g. `node --test "scripts/**/*.test.mjs"`).',
    );
    return problems;
  }
  for (const flag of testScriptNarrowingFlags(scripts))
    problems.push(
      `\`test:scripts\` passes \`${flag}\` — \`node --test\` then runs only part of the matched suite and still exits 0, so the parsers this guard gates are partly unrun. Drop it.`,
    );
  for (const f of testFiles)
    if (!globs.some((g) => matchesTestGlob(f, g)))
      problems.push(
        `${f}: not matched by the \`test:scripts\` glob — \`node --test\` won't run it (a rename to a form it skips). Rename it back to \`*.test.mjs\`.`,
      );
  return problems;
}

/**
 * The `references` paths declared in the tsconfig at repo-relative `tsconfigRel`
 * (a `tsc -b` solution config), or `[]` if it has none / isn't readable. Paths
 * are as written (relative to that tsconfig's own directory).
 */
export function parseTsconfigReferences(raw) {
  try {
    // Tolerate JSONC — block AND line comments + trailing commas (tsconfig
    // allows all; block comments are in fact the style of every other tsconfig
    // here). Block comments are stripped first so a `//` inside one doesn't
    // survive; a `//` inside a string value (e.g. an `https://` URL) is a
    // theoretical false strip this guard's tsconfigs never hit.
    const cfg = JSON.parse(
      raw
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/\/\/.*$/gm, "")
        .replace(/,(\s*[}\]])/g, "$1"),
    );
    return Array.isArray(cfg.references)
      ? cfg.references.map((r) => r?.path).filter((p) => typeof p === "string")
      : [];
  } catch {
    return [];
  }
}

export function tsconfigReferences(tsconfigRel) {
  try {
    return parseTsconfigReferences(
      readFileSync(path.join(repoRoot, tsconfigRel), "utf8"),
    );
  } catch {
    return []; // unreadable file (e.g. a directory / missing path)
  }
}

/**
 * The `references` in a client's root `tsconfig.json`. Non-empty for a `tsc -b`
 * client (like `clients/web`, which has no `typecheck` script) — this guard
 * enrolls it through these instead of exempting the whole tree.
 */
export function clientTsconfigReferences(clientDir) {
  return tsconfigReferences(path.posix.join(clientDir, "tsconfig.json"));
}

/**
 * How the client's `validate` runs `tsc -b` (the pass that typechecks a
 * reference client): `"ok"` (a real `tsc -b`), `"neutered"` (a `tsc -b` carrying
 * `--noCheck`/`--listFilesOnly` — lists files but checks nothing, the same hole
 * the `typecheck`-script path rejects), or `"none"` (no `tsc -b` at all).
 */
export function tscBuildStatus(scripts) {
  let status = "none";
  for (const name of reachableScripts(scripts, "validate")) {
    const cmd = scripts?.[name];
    if (typeof cmd !== "string") continue;
    for (const segment of cmd.split(/&&|\|\||;/)) {
      const tokens = tokenize(segment);
      if (!tokens.some(isTsc)) continue;
      if (!tokens.some((t) => t === "-b" || t === "--build")) continue;
      if (tokens.some(isDisablingFlag)) status = "neutered";
      else return "ok"; // a real, checking `tsc -b`
    }
  }
  return status;
}

/**
 * The Node clients this guard covers (#1791): every `clients/<name>` dir with a
 * readable `package.json` is required to be **enrolled** — either it declares a
 * `typecheck` script (measured through that script's projects) or its root
 * `tsconfig.json` has `references` (a `tsc -b` solution like `clients/web`,
 * measured through those reference projects) — **or** be in {@link EXEMPT}.
 * Anything else is a gate-integrity failure. Enumerated from **disk** so it's
 * fail-closed on every axis: a new client is auto-required (a hardcoded list
 * wouldn't pick it up), a client can't be dropped by a root-chain edit (the
 * chain isn't the source), renaming the `typecheck` script doesn't silently drop
 * the client (it hard-fails — no longer enrolled, not exempt), and a `clients/*`
 * dir holding tracked TS but no manifest hard-fails too. Returns
 * `{ clients, problems }`.
 */
function nodeClients() {
  const clientsDir = path.join(repoRoot, "clients");
  const clients = [];
  const problems = [];
  let entries;
  try {
    entries = readdirSync(clientsDir, { withFileTypes: true });
  } catch {
    return { clients, problems }; // `clients/` missing — the caller's bail fires.
  }
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (!entry.isDirectory()) continue;
    const dir = `clients/${entry.name}`;
    if (EXEMPT.has(dir)) continue;
    let scripts;
    try {
      scripts = JSON.parse(
        readFileSync(path.join(clientsDir, entry.name, "package.json"), "utf8"),
      ).scripts;
    } catch {
      // No readable manifest. If the dir still holds tracked TS its source gets
      // no tsc pass — a gate hole; otherwise it just isn't a client.
      if (trackedSourceFiles(dir).length > 0)
        problems.push(
          `${dir}: holds tracked TypeScript but has no readable \`package.json\` — its source gets no tsc pass. Add a client manifest with a \`typecheck\` (or exempt it).`,
        );
      continue;
    }
    if (
      typeof scripts?.typecheck === "string" ||
      clientTsconfigReferences(dir).length > 0
    )
      clients.push(dir);
    else
      problems.push(
        `${dir}: declares no \`typecheck\` script, has no \`tsconfig.json\` \`references\`, and isn't in the EXEMPT set — it gets no tsc pass. Add a \`typecheck\` (or exempt it with a reason).`,
      );
  }
  // A stale EXEMPT key would otherwise be asserted in the success line while
  // naming a dir that no longer exists — the exemption outliving its subject.
  const present = new Set(
    entries.filter((e) => e.isDirectory()).map((e) => `clients/${e.name}`),
  );
  for (const dir of EXEMPT.keys())
    if (!present.has(dir))
      problems.push(
        `${dir}: listed in EXEMPT but is not a \`clients/*\` directory — remove the stale exemption.`,
      );
  return { clients, problems };
}

/**
 * The tsconfig projects a client's `typecheck` names, harvested from **every**
 * script reachable from `typecheck` (not just the one string) so a delegating
 * `typecheck` (`npm run typecheck:src && …`) still counts — matching how
 * `verify-format-coverage.mjs` harvests globs across reachable scripts. Splits
 * each script on `&&`/`||`/`;` so a flag on one command doesn't leak onto
 * another. Each `tsc` command's project comes from `-p`/`--project` (or a
 * `-b`/`--build` path); a `tsc` command with **no** project flag resolves the
 * implicit `./tsconfig.json` (tsc's own default), so that idiomatic form counts
 * too. Returns `{ projects, neutered }`: `neutered` names any project whose own
 * command carries `--noCheck`/`--nocheck` or `--listFilesOnly` (matched
 * case-insensitively — tsc's option parsing is) — a pass that lists files
 * without type-checking them, which would otherwise satisfy the guard while
 * checking nothing. The config-file form (`noCheck` set in the tsconfig) is
 * caught separately by {@link projectDisablesChecking}.
 *
 * A harvested `tsc -b` **solution config** (`"files": []` + `references`) lists
 * nothing itself; {@link projectFiles} expands it to its references, so this
 * form is measured whether it reaches here (a `typecheck: "tsc -b"`) or the
 * dedicated reference path (`clients/web`, which declares no `typecheck`).
 *
 * Minor limitations, all unreachable with the plain `-p --noEmit` passes here:
 * the implicit-`./tsconfig.json` fallback assumes **no file operands** (`tsc
 * <file>` ignores the config and checks only that file, but would be credited
 * the whole config's file list); the `--noCheck`/`--listFilesOnly` detection
 * ignores a following boolean, so the contrived explicit `--noCheck false`
 * (checking *on*) is still treated as disabling; and the `&&`/`||`/`;` split
 * runs before tokenizing, so a quoted operator inside an arg would split
 * mid-token (project paths carry none of those).
 */
export function typecheckProjects(scripts) {
  const projects = [];
  const neutered = [];
  const isFlag = (t) => t.startsWith("-");
  const isProjectFlag = (t) => ["-p", "--project", "-b", "--build"].includes(t);
  for (const name of reachableScripts(scripts, "typecheck")) {
    const cmd = scripts?.[name];
    if (typeof cmd !== "string") continue;
    for (const segment of cmd.split(/&&|\|\||;/)) {
      const tokens = tokenize(segment);
      if (!tokens.some(isTsc)) continue; // only tsc commands name projects
      const disabling = tokens.find(isDisablingFlag);
      // A project path follows `-p`/`--project`/`-b`/`--build`; a tsc command
      // with none uses the implicit `./tsconfig.json` (tsc's own default).
      const named = [];
      for (let i = 0; i < tokens.length; i++)
        if (isProjectFlag(tokens[i]) && tokens[i + 1] && !isFlag(tokens[i + 1]))
          named.push(tokens[i + 1]);
      if (named.length === 0) named.push("tsconfig.json");
      for (const project of named) {
        if (disabling) neutered.push({ project, flag: disabling });
        else projects.push(project);
      }
    }
  }
  return { projects, neutered };
}

/**
 * Whether the tsconfig `project` sets `noCheck` (which disables type-checking as
 * thoroughly as the CLI flag, but can't be seen in the `typecheck` script
 * string). `tsc --showConfig` emits the merged compilerOptions, surfacing a
 * `noCheck` from the config or its `extends` chain. Best-effort: on any error
 * (e.g. an unreadable config, already reported elsewhere) it returns false.
 */
function projectDisablesChecking(clientDir, project) {
  try {
    const out = execFileSync(
      "npx",
      ["--no-install", "tsc", "-p", project, "--showConfig"],
      { cwd: path.join(repoRoot, clientDir), encoding: "utf8" },
    );
    return JSON.parse(out)?.compilerOptions?.noCheck === true;
  } catch {
    return false;
  }
}

/**
 * Repo-relative POSIX paths of the files ONE project (no reference expansion)
 * typechecks. Absolute paths outside the repo root (lib.d.ts) and anything under
 * `node_modules` are dropped; the aliased `core/` + `test-servers/` sources stay
 * in the set but are harmless — the set is only ever queried with client-relative
 * paths. Cached: `resolveLeafProjects` and `projectFiles` both list a project.
 */
const rawFilesCache = new Map();
function rawProjectFiles(clientDir, project) {
  const key = `${clientDir}|${project}`;
  const cached = rawFilesCache.get(key);
  if (cached) return cached;
  const absClient = path.join(repoRoot, clientDir);
  let stdout;
  try {
    stdout = execFileSync(
      "npx",
      ["--no-install", "tsc", "-p", project, "--listFilesOnly"],
      { cwd: absClient, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    );
  } catch (err) {
    // `--listFilesOnly` doesn't type-check, but a config error (an unreadable or
    // malformed tsconfig) still exits non-zero while printing the resolved file
    // list; keep stdout so a broken config doesn't mask a coverage gap. Echo the
    // diagnostic — since this guard runs before any client's own `typecheck`,
    // it's the first place a bad `-p` config surfaces, and without the reason
    // the resulting "file in no project" report is misleading. tsc prints config
    // errors (`error TS…`) to stdout, so scan both streams for them.
    stdout = typeof err.stdout === "string" ? err.stdout : "";
    const streams =
      stdout + "\n" + (typeof err.stderr === "string" ? err.stderr : "");
    const diagnostic = streams
      .split("\n")
      .filter((l) => /error TS\d+/.test(l))
      .join("\n")
      .trim();
    console.warn(
      `verify:typecheck-coverage — \`tsc -p ${project}\` (in ${clientDir}) exited non-zero:\n${diagnostic || "(no diagnostic captured)"}\n`,
    );
  }
  const covered = new Set();
  for (const line of stdout.split("\n")) {
    const abs = line.trim();
    if (!abs) continue;
    const rel = path.relative(repoRoot, abs);
    if (rel.startsWith("..") || rel.includes("node_modules")) continue;
    covered.add(rel.split(path.sep).join("/"));
  }
  rawFilesCache.set(key, covered);
  return covered;
}

/**
 * The repo-relative tsconfig FILE a `clientDir`-relative `project` entry names.
 * A directory-form entry (`{ "path": "./packages/a" }`, or `tsc -p src`) means
 * `<dir>/tsconfig.json` — tsc's own rule.
 */
export function projectConfigFile(clientDir, project) {
  const projectRel = path.posix.join(clientDir, project);
  return projectRel.endsWith(".json")
    ? projectRel
    : path.posix.join(projectRel, "tsconfig.json");
}

/**
 * A `references` entry `ref` (written relative to `fromConfigFile`'s own
 * directory) as a `clientDir`-relative project path, the form the rest of the
 * graph walk uses.
 */
export function refToProject(clientDir, fromConfigFile, ref) {
  return path.posix.relative(
    clientDir,
    path.posix.join(path.posix.dirname(fromConfigFile), ref),
  );
}

/**
 * The leaf tsconfig projects `project` resolves to (paths relative to
 * `clientDir`): itself if it lists files (or has no `references`), else its
 * `references` expanded recursively. A `tsc -b` **solution config** (`{"files":
 * [], "references": […]}`) lists nothing under `--listFilesOnly`, so this is how
 * it's reduced to the real projects — and doing it here (not just inside
 * `projectFiles`) is what lets BOTH coverage and the non-inertness check follow
 * the same graph, so a `noCheck` in a *referenced* project is caught no matter
 * which enrollment path harvested the solution.
 */
export function resolveLeafProjects(clientDir, project, seen = new Set()) {
  if (seen.has(project)) return [];
  seen.add(project);
  // Lists files → a real leaf. (An empty set is a solution config, or a config
  // that errored — either way the reference expansion below is the right next
  // step: a broken config yields no references too.)
  if (rawProjectFiles(clientDir, project).size > 0) return [project];
  const configFile = projectConfigFile(clientDir, project);
  const refs = tsconfigReferences(configFile);
  if (refs.length === 0) return [project]; // no files, no refs — itself
  return refs.flatMap((ref) =>
    resolveLeafProjects(
      clientDir,
      refToProject(clientDir, configFile, ref),
      seen,
    ),
  );
}

/** Repo-relative files a project covers, following a solution config's references. */
function projectFiles(clientDir, project) {
  const covered = new Set();
  for (const leaf of resolveLeafProjects(clientDir, project))
    for (const f of rawProjectFiles(clientDir, leaf)) covered.add(f);
  return covered;
}

/**
 * The leaf projects (across `projects`, solutions expanded) that genuinely
 * type-check — i.e. minus any whose tsconfig sets `noCheck`, each of which is
 * pushed to `integrity`. Shared by both enrollment paths so a `noCheck` in a
 * referenced project is caught whether the solution was harvested from a
 * `typecheck` script or is the reference-path client's own `tsconfig.json`.
 */
function checkingLeaves(clientDir, projects, integrity) {
  const checking = [];
  // Dedup across all harvested projects (a leaf can be reached from two of them
  // — `resolveLeafProjects` only dedups within one) so a shared leaf isn't
  // reported twice, nor `--showConfig`-spawned twice.
  const seen = new Set();
  for (const project of projects)
    for (const leaf of resolveLeafProjects(clientDir, project)) {
      if (seen.has(leaf)) continue;
      seen.add(leaf);
      if (projectDisablesChecking(clientDir, leaf))
        integrity.push(
          `${clientDir}: \`${leaf}\` sets \`noCheck\` in its tsconfig — that project lists files without type-checking them, so it gates nothing.`,
        );
      else checking.push(leaf);
    }
  return checking;
}

/** Tracked first-party TS (`.ts`/`.tsx`/`.mts`/`.cts`) under a client (excludes build output). */
function trackedSourceFiles(clientDir) {
  const out = execFileSync(
    "git",
    ["ls-files", "*.ts", "*.tsx", "*.mts", "*.cts"],
    { cwd: path.join(repoRoot, clientDir), encoding: "utf8" },
  );
  return out
    .split("\n")
    .filter(Boolean)
    .map((f) => path.posix.join(clientDir, f))
    .filter(isRequiredSource)
    .filter((f) => !f.includes("/build/") && !f.includes("/dist/"));
}

/**
 * Tracked first-party TS that is not under a `clients/*` dir (which the
 * per-client pass covers) — the shared surface no client owns (`test-servers/src`,
 * the root `vitest.shared.mts`), all of `core/` (which web's enrolled `tsc -b`
 * projects cover — measured, not hand-modeled), plus anything new at a fresh
 * top-level location. Deny-by-default: a new such file is required without
 * editing this guard, matching the repo-wide reach of the sibling
 * `verify-format-coverage`. Each must get a tsc pass from SOME client project
 * (cli aliases the test-server source; web's app/test projects include `core/`;
 * each client's `vitest.config.ts` imports `vitest.shared.mts`) — checked against
 * the GLOBAL union of client projects, which is why a new unimported
 * `test-servers/src` bin entry or a `core` `*.tsx` web doesn't reach is caught.
 */
function trackedNonClientSource() {
  const out = execFileSync(
    "git",
    ["ls-files", "*.ts", "*.tsx", "*.mts", "*.cts"],
    { cwd: repoRoot, encoding: "utf8" },
  );
  return out
    .split("\n")
    .filter(Boolean)
    .filter(isRequiredSource)
    .filter((f) => !f.includes("/build/") && !f.includes("/dist/"))
    .filter((f) => !f.startsWith("clients/"));
}

/**
 * The remediation footer for a set of gate-integrity problems, or `null` when
 * none of them is about the typecheck wiring. Not every phase-1 problem is: the
 * sibling-guard vouch (`verify:format-coverage`) and the `test:scripts` axes are
 * about OTHER gates, and appending `--noCheck`/`tsc -b` advice under one of them
 * sends the reader after the wrong thing. The criterion is "is this about the
 * typecheck pass at all", not "does it carry its own per-line advice" — several
 * typecheck problems do carry their own and still want the footer. Client
 * enrollment ("declares no `typecheck` script …") is therefore NOT excluded: the
 * footer's first clause is exactly its fix.
 *
 * Pure and outside `main()` on purpose — this is the third consecutive round in
 * which the newest branch in `main()` turned out to be the one mutation testing
 * couldn't reach, including the branch this function replaces.
 */
export function integrityAdvice(problems, nonTypecheckProblems) {
  const isTypecheck = (f) => !nonTypecheckProblems.includes(f);
  return problems.some(isTypecheck)
    ? "\nRestore the `typecheck` wiring (client `validate` → `typecheck`, root `validate` → each client), and drop any `--noCheck`/`--listFilesOnly`/`noCheck` from the typecheck pass."
    : null;
}

/**
 * Run the guard: enumerate clients, check gate integrity (phase 1), then file
 * coverage (phase 2). Prints its verdict and `process.exit(1)`s on any failure.
 * Called only when this file is executed directly — importing it (for tests)
 * gives access to the pure helpers above without running any of this.
 */
export function main() {
  const rootPkg = JSON.parse(
    readFileSync(path.join(repoRoot, "package.json"), "utf8"),
  );
  const { clients: CLIENTS, problems: enrollmentProblems } = nodeClients();

  // -------------------------------------------------------------------------
  // Phase 1 — gate integrity: is each client's `typecheck` actually run, and
  // does it actually type-check? Reported (and exited) before the file-coverage
  // pass so a mis-wired / inert gate isn't buried under a flood of consequent
  // "in no tsconfig project" lines. Records, per client, the projects that
  // genuinely type-check, for phase 2. Boundary: does NOT detect shell-level
  // failure suppression (`… || true`, `; exit 0`).
  // -------------------------------------------------------------------------
  // A client that declares no `typecheck` and isn't exempt is a gate-integrity
  // failure (seeded so a renamed/removed `typecheck` is loud, not a silent
  // drop). If that leaves nothing enrolled AND surfaced no such problem, the
  // enumeration itself is broken (a moved `clients/` dir) — fail, don't no-op.
  const integrity = [...enrollmentProblems];
  const checkingProjects = new Map();
  if (CLIENTS.length === 0 && integrity.length === 0) {
    console.error(
      "verify:typecheck-coverage — found no `clients/*` dir to check. The guard would check nothing; fix the enumeration.",
    );
    process.exit(1);
  }

  // Vouch for the sibling guard — a guard can't detect being unrun itself, but the
  // two can each assert the other is still wired into `validate`, so dropping
  // either is caught here (only deleting both slips through).
  const siblingVouchIssues = [];
  if (!rootReachesScript(rootPkg.scripts, "verify:format-coverage")) {
    siblingVouchIssues.push(
      "the root `validate` no longer runs `verify:format-coverage` (its sibling guard) — restore it.",
    );
  }
  integrity.push(...siblingVouchIssues);

  const testScriptIssues = testScriptProblems(
    rootPkg.scripts,
    execFileSync("git", ["ls-files", "scripts"], {
      cwd: repoRoot,
      encoding: "utf8",
    })
      .split("\n")
      .filter(Boolean)
      // Extension first, and the read guarded: a file in the index but not the
      // worktree (`rm` without `git rm`, an ordinary mid-work state) would
      // otherwise abort phase 1 with a raw ENOENT stack, masking every real
      // finding — the round-6 precedent, where a failed `tsc` echoes its
      // diagnostic instead of dying.
      .filter(isJsFile)
      .filter((f) => {
        let src;
        try {
          src = readFileSync(path.join(repoRoot, f), "utf8");
        } catch (err) {
          console.warn(
            `verify:typecheck-coverage — skipping tracked-but-unreadable ${f}: ${err.message}`,
          );
          return false;
        }
        return isScriptsTestFile(f, src);
      }),
  );
  integrity.push(...testScriptIssues);

  for (const clientDir of CLIENTS) {
    checkingProjects.set(clientDir, []);
    if (!rootRunsClientValidate(rootPkg.scripts, clientDir)) {
      integrity.push(
        `${clientDir}: the root \`validate\` chain no longer runs \`cd ${clientDir} && npm run validate\` (or \`npm --prefix ${clientDir} run validate\`) — its typecheck isn't invoked by CI.`,
      );
      continue;
    }
    const scripts = JSON.parse(
      readFileSync(path.join(repoRoot, clientDir, "package.json"), "utf8"),
    ).scripts;

    // Reference (`tsc -b`) client — no `typecheck` script; measured through its
    // `tsconfig.json` `references`, and wired iff its `validate` runs a real
    // (checking) `tsc -b`.
    if (typeof scripts?.typecheck !== "string") {
      const status = tscBuildStatus(scripts);
      if (status !== "ok") {
        integrity.push(
          status === "neutered"
            ? `${clientDir}: its \`validate\`'s \`tsc -b\` carries \`--noCheck\`/\`--listFilesOnly\` — it lists files without type-checking them, so its references are gated by nothing.`
            : `${clientDir}: no \`typecheck\` script and its \`validate\` never runs \`tsc -b\` — its \`tsconfig.json\` references are typechecked by nothing.`,
        );
        continue;
      }
      checkingProjects.set(
        clientDir,
        checkingLeaves(
          clientDir,
          clientTsconfigReferences(clientDir),
          integrity,
        ),
      );
      continue;
    }

    if (!reachableScripts(scripts, "validate").has("typecheck")) {
      integrity.push(
        `${clientDir}: \`typecheck\` is not reachable from its \`validate\` — the typecheck it measures gates nothing.`,
      );
      continue;
    }
    const { projects, neutered } = typecheckProjects(scripts);
    for (const { project, flag } of neutered)
      integrity.push(
        `${clientDir}: its \`typecheck\` runs \`-p ${project}\` with \`${flag}\` — that pass lists files without type-checking them, so it gates nothing.`,
      );
    // Fire only when nothing was harvested at all — not when projects WERE named
    // but every one is neutered (command flag) or config-disabled (`projects` was
    // non-empty in that case; those get their own lines above).
    if (projects.length === 0 && neutered.length === 0)
      integrity.push(
        `${clientDir}: its \`typecheck\` names no \`-p <project>\` — nothing is typechecked.`,
      );
    // Resolve each harvested project to its leaves (a `tsc -b` solution expands),
    // and disable-check each leaf — so a `noCheck` in a referenced project counts.
    checkingProjects.set(
      clientDir,
      checkingLeaves(clientDir, projects, integrity),
    );
  }

  if (integrity.length > 0) {
    console.error(
      `verify:typecheck-coverage — ${integrity.length} gate-integrity issue(s): a typecheck gate is not run, or runs but checks nothing:\n`,
    );
    for (const f of integrity) console.error("  " + f);
    // NOT `enrollmentProblems`: "declares no `typecheck` script …" IS about the
    // typecheck pass, and the footer's first clause is its canonical fix.
    const advice = integrityAdvice(integrity, [
      ...siblingVouchIssues,
      ...testScriptIssues,
    ]);
    if (advice) console.error(advice);
    process.exit(1);
  }

  // ---------------------------------------------------------------------------
  // Phase 2 — file coverage: every tracked source file lands in a checking project.
  // ---------------------------------------------------------------------------
  let totalChecked = 0;
  const failures = [];
  const globalCovered = new Set();
  for (const clientDir of CLIENTS) {
    const covered = new Set();
    for (const project of checkingProjects.get(clientDir))
      for (const f of projectFiles(clientDir, project)) {
        covered.add(f);
        globalCovered.add(f);
      }

    const tracked = trackedSourceFiles(clientDir);
    totalChecked += tracked.length;
    for (const f of tracked)
      if (!covered.has(f)) failures.push(`${f} — in no tsconfig project`);
  }

  // Non-client first-party TS (shared source, plus anything at a new top-level
  // location) gets no client of its own; require each to land in the GLOBAL union
  // of client projects, so it's deny-by-default rather than an allowlist that a
  // new location could fall outside.
  const otherTracked = trackedNonClientSource();
  totalChecked += otherTracked.length;
  const nonClientMisses = [];
  for (const f of otherTracked)
    if (!globalCovered.has(f)) {
      nonClientMisses.push(f);
      failures.push(`${f} — in no client's tsconfig project`);
    }

  if (failures.length > 0) {
    console.error(
      `verify:typecheck-coverage — ${failures.length} tracked source file(s) get no \`tsc\` pass:\n`,
    );
    for (const f of failures) console.error("  " + f);
    console.error(
      "\nAdd the file to a client's `tsconfig.json` / `tsconfig.test.json` `include` (a top-level config the build config's `rootDir` rejects goes in the test project).",
    );
    if (failures.some((f) => /\.test\./.test(f)))
      console.error(
        "For a co-located test, instead move it to `__tests__/` — adding it to the src `include` would make the build emit it.",
      );
    if (nonClientMisses.some((f) => f.startsWith("test-servers/")))
      console.error(
        "For a shared-source file no client imports (e.g. a `test-servers/src` bin entry), name it in a client `tsconfig.test.json`'s `include`, as `server-composable.ts` is.",
      );
    if (nonClientMisses.some((f) => f.startsWith("core/")))
      console.error(
        "For a `core/` file web's `tsc -b` doesn't reach, widen the web project that owns it — `tsconfig.test.json` for `core/**/__tests__/**`, else `tsconfig.app.json` — not a cli/tui project, which shouldn't own `core`.",
      );
    if (nonClientMisses.some((f) => f.startsWith("scripts/")))
      console.error(
        "For root tooling under `scripts/`, keep it `.mjs` (the convention there — prettier-gated via `format:check:scripts`, and `.mjs` isn't in this guard's required set), or give `scripts/` its own tsconfig project and enroll it here.",
      );
    console.error("See AGENTS.md.");
    process.exit(1);
  }

  const exemptNote = [...EXEMPT.entries()]
    .map(([dir, reason]) => `${dir} exempt: ${reason}`)
    .join("; ");
  console.log(
    `verify:typecheck-coverage — OK: all ${totalChecked} tracked source files ` +
      `(${CLIENTS.length} clients + non-client) get a tsc pass` +
      (exemptNote ? ` (${exemptNote}).` : "."),
  );
}

// Run only when executed directly (`node scripts/verify-typecheck-coverage.mjs`);
// importing this file (tests) exposes the pure helpers without running the guard.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  main();
