#!/usr/bin/env node
// Durable guard for the "every tracked source file gets a `tsc` pass" invariant
// that #1791 established for the Node clients (cli, tui, launcher). A tsconfig
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
// unions the result, and asserts every tracked first-party `.ts`/`.tsx` under
// the client is in that union. Exits non-zero, listing the offenders, on any
// miss.
//
// Like its sibling it also asserts the gate is actually WIRED: each client's
// `typecheck` must be reachable from that client's `validate`, and the root
// `validate` chain must invoke each client's `validate` — otherwise the guard
// could measure a `typecheck` script that CI no longer runs and stay green while
// nothing is typechecked ("gate silently stops gating").
//
// Source of truth is the `typecheck` scripts themselves — this parser reads the
// `-p <project>` args out of them, so adding/removing a project is reflected
// here with no second list to keep in sync.

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

// The clients whose `typecheck` runs explicit `-p <project>` passes (#1791).
// web is intentionally out: it typechecks via `tsc -b` over a project-reference
// graph (app/node/storybook/test) that already reaches its whole tree. Kept an
// explicit list, mirroring `verify-format-coverage.mjs`'s `MANIFESTS`.
const CLIENTS = ["clients/cli", "clients/tui", "clients/launcher"];

// Ambient declaration files are excluded from the required set: an unreferenced
// `*.d.ts` shim (e.g. a `vitest.shims.d.ts`) is type-only and not a real gap.
const isRequiredSource = (rel) =>
  /\.(ts|tsx)$/.test(rel) && !rel.endsWith(".d.ts");

/**
 * Names of scripts transitively reachable from `entry` by following `npm run
 * <name>` references within a manifest. Used to assert a client's `typecheck`
 * is actually invoked by its `validate` — a `typecheck` script nothing runs
 * gates nothing, and measuring its projects would let the gate be silently
 * unwired. (Same technique as `verify-format-coverage.mjs`.)
 */
function reachableScripts(scripts, entry = "validate") {
  const reached = new Set();
  const queue = [entry];
  const runRef = /npm run ([\w:-]+)/g;
  while (queue.length > 0) {
    const name = queue.shift();
    if (reached.has(name)) continue;
    reached.add(name);
    const cmd = scripts?.[name];
    if (typeof cmd !== "string") continue;
    for (const m of cmd.matchAll(runRef)) queue.push(m[1]);
  }
  return reached;
}

/** The tsconfig projects a client's `typecheck` script names via `-p <file>`. */
function typecheckProjects(scripts) {
  const script = scripts?.typecheck ?? "";
  const projects = [];
  for (const m of script.matchAll(/-p\s+(\S+)/g)) projects.push(m[1]);
  return projects;
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
    // list; keep stdout so a broken config doesn't mask a coverage gap. The
    // config error itself is the `typecheck` script's job to fail on.
    stdout = typeof err.stdout === "string" ? err.stdout : "";
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

/** Tracked first-party `.ts`/`.tsx` under a client (excludes build output). */
function trackedSourceFiles(clientDir) {
  const out = execFileSync("git", ["ls-files", "*.ts", "*.tsx"], {
    cwd: path.join(repoRoot, clientDir),
    encoding: "utf8",
  });
  return out
    .split("\n")
    .filter(Boolean)
    .map((f) => path.posix.join(clientDir, f))
    .filter(isRequiredSource)
    .filter((f) => !f.includes("/build/") && !f.includes("/dist/"));
}

/**
 * Assert the gate is wired: the root `validate` chain invokes each client's
 * `validate`, and each client's `validate` reaches its `typecheck`. Returns a
 * list of human-readable wiring failures. Without this the guard could run a
 * `typecheck` script that CI never invokes and still report OK.
 */
function wiringFailures() {
  const failures = [];
  const rootPkg = JSON.parse(
    readFileSync(path.join(repoRoot, "package.json"), "utf8"),
  );
  const rootReachedCommands = [...reachableScripts(rootPkg.scripts)]
    .map((n) => rootPkg.scripts?.[n])
    .filter((c) => typeof c === "string");

  for (const clientDir of CLIENTS) {
    if (
      !rootReachedCommands.some(
        (c) => c.includes(`cd ${clientDir}`) && /npm run validate/.test(c),
      )
    ) {
      failures.push(
        `${clientDir}: the root \`validate\` chain no longer runs \`cd ${clientDir} && npm run validate\` — its typecheck isn't invoked by CI.`,
      );
      continue;
    }
    const scripts = JSON.parse(
      readFileSync(path.join(repoRoot, clientDir, "package.json"), "utf8"),
    ).scripts;
    if (!reachableScripts(scripts, "validate").has("typecheck")) {
      failures.push(
        `${clientDir}: \`typecheck\` is not reachable from its \`validate\` — the typecheck it measures gates nothing.`,
      );
    }
  }
  return failures;
}

const wiring = wiringFailures();
if (wiring.length > 0) {
  console.error(
    `verify:typecheck-coverage — ${wiring.length} wiring issue(s): a typecheck gate is not actually run:\n`,
  );
  for (const f of wiring) console.error("  " + f);
  console.error(
    "\nRestore the `typecheck` link in the client's `validate` (and the `validate:<client>` link in the root `validate`).",
  );
  process.exit(1);
}

let totalChecked = 0;
const failures = [];
for (const clientDir of CLIENTS) {
  const scripts = JSON.parse(
    readFileSync(path.join(repoRoot, clientDir, "package.json"), "utf8"),
  ).scripts;
  const projects = typecheckProjects(scripts);
  if (projects.length === 0) {
    failures.push(
      `${clientDir}: its \`typecheck\` script names no \`-p <project>\` — nothing is typechecked.`,
    );
    continue;
  }
  const covered = new Set();
  for (const project of projects)
    for (const f of projectFiles(clientDir, project)) covered.add(f);

  const tracked = trackedSourceFiles(clientDir);
  totalChecked += tracked.length;
  for (const f of tracked)
    if (!covered.has(f)) failures.push(`${f} — in no tsconfig project`);
}

if (failures.length > 0) {
  console.error(
    `verify:typecheck-coverage — ${failures.length} issue(s): tracked source files that get no \`tsc\` pass:\n`,
  );
  for (const f of failures) console.error("  " + f);
  console.error(
    "\nAdd the file to a client's `tsconfig.json` / `tsconfig.test.json` `include`",
  );
  console.error(
    "(a top-level config file that the build config's `rootDir` rejects goes in the test project). See AGENTS.md.",
  );
  process.exit(1);
}

console.log(
  `verify:typecheck-coverage — OK: all ${totalChecked} tracked source files across ${CLIENTS.length} clients get a tsc pass.`,
);
