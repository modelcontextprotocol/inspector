#!/usr/bin/env node
// Durable guard for the "every tracked source file gets a `tsc` pass" invariant
// that #1791 established for the Node clients — every `clients/*` that declares a
// `typecheck` script (cli, tui, launcher today; a new one is picked up from disk
// automatically, see nodeClients). A tsconfig
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
// `.cts` under the client is in that union. Exits non-zero, listing the
// offenders, on any miss.
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
import { fileURLToPath } from "node:url";
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

const rootPkg = JSON.parse(
  readFileSync(path.join(repoRoot, "package.json"), "utf8"),
);

// Clients this guard deliberately does NOT gate, with the reason. `clients/web`
// typechecks via `tsc -b` over a project-reference graph (app/node/storybook/
// test) this guard can't model. An exemption is explicit so it's a stated
// decision, not an accident of which scripts a manifest happens to declare.
const EXEMPT = new Map([
  ["clients/web", "typechecks via `tsc -b` over project references"],
]);

// TypeScript source extensions this guard requires a tsc pass for. Matches its
// sibling's TS set (`verify-format-coverage.mjs` — `.mts` is already the idiom
// for shared config here, e.g. `vitest.shared.mts`, so a client `.mts`/`.cts`
// must be gated too). Ambient declaration files are excluded: an unreferenced
// `*.d.{ts,mts,cts}` shim (e.g. web's `vitest.shims.d.ts`) is type-only and not
// a real gap. There are no client `.mts`/`.cts` today; this pre-empts one.
const isRequiredSource = (rel) =>
  /\.(ts|tsx|mts|cts)$/.test(rel) && !/\.d\.(ts|mts|cts)$/.test(rel);

/**
 * The Node clients this guard covers (#1791): every `clients/<name>` dir with a
 * readable `package.json` is required to **either** declare a `typecheck` script
 * (→ enrolled) **or** be in {@link EXEMPT} (→ skipped, with a reason). Anything
 * else is a gate-integrity failure. Enumerated from **disk** so it's fail-closed
 * on every axis: a new client is auto-required (a hardcoded list wouldn't pick
 * it up), a client can't be dropped by a root-chain edit (the chain isn't the
 * source), renaming the `typecheck` script doesn't silently drop the client (it
 * hard-fails — no longer enrolled, not exempt), and a `clients/*` dir holding
 * tracked TS but no manifest hard-fails too (rather than being taken for
 * "not a client"). Returns `{ clients, problems }`.
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
    if (typeof scripts?.typecheck === "string") clients.push(dir);
    else
      problems.push(
        `${dir}: declares no \`typecheck\` script and isn't in the EXEMPT set — it gets no tsc pass. Add a \`typecheck\` (or exempt it with a reason).`,
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

const { clients: CLIENTS, problems: enrollmentProblems } = nodeClients();

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
 * Two limitations, both unreachable today (cli/tui/launcher use plain `-p`
 * `--noEmit` passes; web, the only `tsc -b` client, is out of scope): a
 * **solution-style** `-b` config (`"files": []` + `references`) is run here as
 * `-p … --listFilesOnly`, which lists nothing — a client adopting it would need
 * its `references` expanded to their paths. And the implicit-`./tsconfig.json`
 * fallback assumes **no file operands** — `tsc <file>` ignores the config and
 * checks only that file, but would be credited the whole config's file list.
 */
function typecheckProjects(scripts) {
  const projects = [];
  const neutered = [];
  const isFlag = (t) => t.startsWith("-");
  const isProjectFlag = (t) => ["-p", "--project", "-b", "--build"].includes(t);
  for (const name of reachableScripts(scripts, "typecheck")) {
    const cmd = scripts?.[name];
    if (typeof cmd !== "string") continue;
    for (const segment of cmd.split(/&&|\|\||;/)) {
      const tokens = tokenize(segment);
      if (!tokens.includes("tsc")) continue; // only tsc commands name projects
      const disabling = tokens.find((t) =>
        /^--(noCheck|listFilesOnly)$/i.test(t),
      );
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
 * Repo-relative POSIX paths of the files a project typechecks. Absolute paths
 * outside the repo root (lib.d.ts) and anything under `node_modules` are
 * dropped; the aliased `core/` + `test-servers/` sources stay in the set but
 * are harmless — the set is only ever queried with client-relative paths.
 */
function projectFiles(clientDir, project) {
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
  return covered;
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

// ---------------------------------------------------------------------------
// Phase 1 — gate integrity: is each client's `typecheck` actually run, and does
// it actually type-check? Reported (and exited) before the file-coverage pass
// so a mis-wired / inert gate isn't buried under a flood of consequent
// "in no tsconfig project" lines (which would list every file that gate covered).
// Also records, per client, the projects that genuinely type-check, for phase 2.
// Boundary: this does NOT detect shell-level failure suppression on the pass
// (`… || true`, `; exit 0`) — a pass that runs and checks but can't fail CI.
// ---------------------------------------------------------------------------
// A client that declares no `typecheck` and isn't exempt is a gate-integrity
// failure (seeded here so a renamed/removed `typecheck` is loud, not a silent
// drop). If that leaves nothing enrolled AND surfaced no such problem, the
// enumeration itself is broken (a moved `clients/` dir) — fail rather than no-op.
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
if (!rootReachesScript(rootPkg.scripts, "verify:format-coverage")) {
  integrity.push(
    "the root `validate` no longer runs `verify:format-coverage` (its sibling guard) — restore it.",
  );
}

for (const clientDir of CLIENTS) {
  checkingProjects.set(clientDir, []);
  if (!rootRunsClientValidate(rootPkg.scripts, clientDir)) {
    integrity.push(
      `${clientDir}: the root \`validate\` chain no longer runs \`cd ${clientDir} && npm run validate\` — its typecheck isn't invoked by CI.`,
    );
    continue;
  }
  const scripts = JSON.parse(
    readFileSync(path.join(repoRoot, clientDir, "package.json"), "utf8"),
  ).scripts;
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
  const checking = projects.filter((project) => {
    if (projectDisablesChecking(clientDir, project)) {
      integrity.push(
        `${clientDir}: \`-p ${project}\` sets \`noCheck\` in its tsconfig — that pass lists files without type-checking them, so it gates nothing.`,
      );
      return false;
    }
    return true;
  });
  // Fire only when nothing was harvested at all — not when projects WERE named
  // but every one is neutered (command flag) or config-disabled (`projects` was
  // non-empty in that case; those get their own lines above).
  if (projects.length === 0 && neutered.length === 0)
    integrity.push(
      `${clientDir}: its \`typecheck\` names no \`-p <project>\` — nothing is typechecked.`,
    );
  checkingProjects.set(clientDir, checking);
}

if (integrity.length > 0) {
  console.error(
    `verify:typecheck-coverage — ${integrity.length} gate-integrity issue(s): a typecheck gate is not run, or runs but checks nothing:\n`,
  );
  for (const f of integrity) console.error("  " + f);
  console.error(
    "\nRestore the `typecheck` wiring (client `validate` → `typecheck`, root `validate` → each client), and drop any `--noCheck`/`--listFilesOnly`/`noCheck` from the typecheck pass.",
  );
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Phase 2 — file coverage: every tracked source file lands in a checking project.
// ---------------------------------------------------------------------------
let totalChecked = 0;
const failures = [];
for (const clientDir of CLIENTS) {
  const covered = new Set();
  for (const project of checkingProjects.get(clientDir))
    for (const f of projectFiles(clientDir, project)) covered.add(f);

  const tracked = trackedSourceFiles(clientDir);
  totalChecked += tracked.length;
  for (const f of tracked)
    if (!covered.has(f)) failures.push(`${f} — in no tsconfig project`);
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
  console.error("See AGENTS.md.");
  process.exit(1);
}

const exemptNote = [...EXEMPT.entries()]
  .map(([dir, reason]) => `${dir} exempt: ${reason}`)
  .join("; ");
console.log(
  `verify:typecheck-coverage — OK: all ${totalChecked} tracked source files across ${CLIENTS.length} clients get a tsc pass` +
    (exemptNote ? ` (${exemptNote}).` : "."),
);
