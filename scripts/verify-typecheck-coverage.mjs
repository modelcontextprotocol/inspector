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
// --listFiles` (the accurate measure — it includes import-reached files), unions
// the result, and asserts every tracked first-party `.ts`/`.tsx` under the
// client is in that union. Exits non-zero, listing the offenders, on any miss.
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
// graph (app/node/storybook/test) that already reaches its whole tree.
const CLIENTS = ["clients/cli", "clients/tui", "clients/launcher"];

// Ambient declaration files are excluded from the required set: an unreferenced
// `*.d.ts` shim (e.g. a `vitest.shims.d.ts`) is type-only and not a real gap.
const isRequiredSource = (rel) =>
  /\.(ts|tsx)$/.test(rel) && !rel.endsWith(".d.ts");

/** The tsconfig projects a client's `typecheck` script names via `-p <file>`. */
function typecheckProjects(clientDir) {
  const pkg = JSON.parse(
    readFileSync(path.join(repoRoot, clientDir, "package.json"), "utf8"),
  );
  const script = pkg.scripts?.typecheck ?? "";
  const projects = [];
  for (const m of script.matchAll(/-p\s+(\S+)/g)) projects.push(m[1]);
  return projects;
}

/**
 * Repo-relative POSIX paths of the files a project typechecks, restricted to
 * those under `clientDir` (drops lib.d.ts, node_modules, and the aliased
 * `core/` + `test-servers/` sources — those are gated by their own owners).
 */
function projectFiles(clientDir, project) {
  const absClient = path.join(repoRoot, clientDir);
  let stdout;
  try {
    stdout = execFileSync(
      "npx",
      ["tsc", "--noEmit", "-p", project, "--listFiles"],
      { cwd: absClient, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    );
  } catch (err) {
    // A type error makes tsc exit non-zero but it still prints the file list to
    // stdout; keep it so a failing project doesn't mask a coverage gap. The
    // type error itself is the `typecheck` script's job to fail on.
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

let totalChecked = 0;
const failures = [];
for (const clientDir of CLIENTS) {
  const projects = typecheckProjects(clientDir);
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
