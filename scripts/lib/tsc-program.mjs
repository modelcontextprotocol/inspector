// What a `tsc` project actually pulls into its program — the shared measurement
// behind two guards, so the two can never disagree about what a program holds.
//
//   • `verify:typecheck-coverage` (#1791) asks which FIRST-PARTY files land in a
//     program, to prove every tracked source file gets a `tsc` pass.
//   • `verify:dep-lockstep` (#1965) asks which INSTALLED PACKAGES land in one, to
//     find the packages that can appear twice — from two different installs — in
//     a single program, which is the whole failure mode #1896 was about.
//
// Both answers come from the same `tsc --listFilesOnly` run: it reports every
// file the program resolves, including the ones reached only through another
// file's imports and the `.d.ts` files under `node_modules`. That is the accurate
// measure — a tsconfig's `include` names only the roots.
//
// The listing is memoized per (client, project) for the life of the process. It
// is deliberately NOT cached to disk across the two guard processes: a stale
// cache would make either guard measure a program that no longer exists and pass
// on a real miss — failing open, the one way these gates must never fail. The
// second pass costs ~14s (measured, #1965); that is cheaper than the class of
// bug a fingerprint that misses one input would introduce.

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { reachableScripts, tokenize } from "./npm-scripts.mjs";
import { resolveNodeBin } from "./resolve-node-bin.mjs";

export const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);

// Match `tsc` by token basename so a path-invoked binary (`node_modules/.bin/
// tsc`, `./node_modules/.bin/tsc.cmd`) counts, not just the bare `tsc` token.
export const isTsc = (t) => /(?:^|[\\/])tsc(?:\.(?:cmd|exe|ps1))?$/.test(t);

// A flag that makes a `tsc` pass list files without type-checking them (so it
// gates nothing). Case-insensitive — tsc's own option parsing is.
export const isDisablingFlag = (t) => /^--(noCheck|listFilesOnly)$/i.test(t);

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
 * without type-checking them, which would otherwise satisfy the typecheck guard
 * while checking nothing.
 *
 * A harvested `tsc -b` **solution config** (`"files": []` + `references`) lists
 * nothing itself; {@link resolveLeafProjects} expands it to its references.
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
 * The `references` paths declared in a tsconfig's raw text (a `tsc -b` solution
 * config), or `[]` if it has none / isn't parseable. Paths are as written
 * (relative to that tsconfig's own directory).
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
 * client (like `clients/web`, which has no `typecheck` script) — the guards
 * enroll such a client through these instead of exempting the whole tree.
 */
export function clientTsconfigReferences(clientDir) {
  return tsconfigReferences(path.posix.join(clientDir, "tsconfig.json"));
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
 * it's reduced to the real projects — and doing it here (not inside a single
 * caller) is what lets every consumer follow the same graph.
 */
export function resolveLeafProjects(clientDir, project, seen = new Set()) {
  if (seen.has(project)) return [];
  seen.add(project);
  // Lists first-party files → a real leaf. (An empty set is a solution config,
  // or a config that errored — either way the reference expansion below is the
  // right next step: a broken config yields no references either.)
  if (projectSourceFiles(clientDir, project).size > 0) return [project];
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

/**
 * The tsc JS entry a client's programs are measured with, resolved from the
 * client dir up the node_modules tree exactly as `npx --no-install tsc` walked
 * — but spawnable shell-free on Windows, where `npx` is a `.cmd` shim that
 * `execFileSync` can't start (ENOENT — #1939). A resolution failure is a hard
 * "cannot measure" error rather than an empty file set: the old ENOENT was
 * doubly silent, echoing "(no diagnostic captured)" per project and then
 * reporting every tracked file in the repo as uncovered. Cached per client;
 * exported so a consumer's own tsc pass (`verify-typecheck-coverage`'s
 * `--showConfig`) spawns the same entry the listings do.
 */
const tscEntryCache = new Map();
export function tscEntry(clientDir) {
  const cached = tscEntryCache.get(clientDir);
  if (cached) return cached;
  let entry;
  try {
    entry = resolveNodeBin("typescript", "tsc", path.join(repoRoot, clientDir));
  } catch (err) {
    console.error(
      `cannot resolve \`typescript\` from ${clientDir} (${err.message}): no tsc program can be measured. Run \`npm install\` at the repo root first.`,
    );
    process.exit(1);
  }
  tscEntryCache.set(clientDir, entry);
  return entry;
}

/**
 * Every file ONE project's program resolves, as absolute POSIX paths and with no
 * filtering at all — first-party sources, `node_modules` declarations, and the
 * out-of-repo `lib.*.d.ts` — plus the config diagnostic if `tsc` exited
 * non-zero. The two consumers want different slices of the files, so the slicing
 * happens in {@link projectSourceFiles} / {@link projectPackageFiles} rather than
 * here; they differ on the `error` too, which is why it is reported rather than
 * only warned about. Memoized per (client, project): the same project is listed
 * by `resolveLeafProjects` and again by whichever slice the caller asks for.
 */
const listingCache = new Map();
export function rawProjectListing(clientDir, project) {
  const key = `${clientDir}|${project}`;
  const cached = listingCache.get(key);
  if (cached) return cached;
  let stdout;
  let error = null;
  try {
    stdout = execFileSync(
      process.execPath,
      [tscEntry(clientDir), "-p", project, "--listFilesOnly"],
      {
        cwd: path.join(repoRoot, clientDir),
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        maxBuffer: 1 << 28,
      },
    );
  } catch (err) {
    // `--listFilesOnly` doesn't type-check, but a config error (an unreadable or
    // malformed tsconfig) still exits non-zero while printing the resolved file
    // list; keep stdout so a broken config doesn't mask what the callers measure.
    // Echo the diagnostic — the guards run before any client's own `typecheck`,
    // so this is the first place a bad `-p` config surfaces, and without the
    // reason the resulting report is misleading. tsc prints config errors
    // (`error TS…`) to stdout, so scan both streams for them.
    stdout = typeof err.stdout === "string" ? err.stdout : "";
    const streams =
      stdout + "\n" + (typeof err.stderr === "string" ? err.stderr : "");
    error = streams
      .split("\n")
      .filter((l) => /error TS\d+/.test(l))
      .join("\n")
      .trim();
    console.warn(
      `tsc -p ${project} (in ${clientDir}) exited non-zero:\n${error || "(no diagnostic captured)"}\n`,
    );
    // An empty diagnostic still has to read as failure downstream, so the
    // caller sees a string either way — never `""`.
    error ||= "(no diagnostic captured)";
  }
  const files = stdout
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((abs) => abs.split(path.sep).join("/"));
  const listing = { files, error };
  listingCache.set(key, listing);
  return listing;
}

/**
 * The `tsc` diagnostic for a project whose listing exited non-zero, or null. A
 * failed config still prints a file list — a partial, wrong one — so a consumer
 * that must not measure a program it couldn't resolve has to ask.
 */
export function projectListingError(clientDir, project) {
  return rawProjectListing(clientDir, project).error;
}

/**
 * Whether a repo-relative path is an installed file rather than a first-party
 * one. Matched by path SEGMENT, not substring, so a first-party directory whose
 * name merely embeds the word (`core/node_modules_fixtures/`) is not mistaken
 * for an install — the same segment rule {@link classifyModulePath} applies.
 */
const isInstalledPath = (rel) => rel.split("/").includes("node_modules");

/**
 * Repo-relative POSIX paths of the first-party files ONE project (no reference
 * expansion) typechecks. Absolute paths outside the repo root (`lib.d.ts`) and
 * anything under `node_modules` are dropped; the aliased `core/` +
 * `test-servers/` sources stay in the set but are harmless — the set is only ever
 * queried with in-repo paths.
 */
export function projectSourceFiles(clientDir, project) {
  const covered = new Set();
  for (const abs of rawProjectListing(clientDir, project).files) {
    const rel = path.relative(repoRoot, abs).split(path.sep).join("/");
    if (rel.startsWith("..") || isInstalledPath(rel)) continue;
    covered.add(rel);
  }
  return covered;
}

/**
 * Repo-relative POSIX paths of the INSTALLED files ONE project's program
 * resolves — everything under some `node_modules` inside the repo. Out-of-repo
 * paths are dropped: an absolute `lib.d.ts` under the toolchain isn't an install
 * this repo can align.
 */
export function projectPackageFiles(clientDir, project) {
  const covered = new Set();
  for (const abs of rawProjectListing(clientDir, project).files) {
    const rel = path.relative(repoRoot, abs).split(path.sep).join("/");
    if (rel.startsWith("..") || !isInstalledPath(rel)) continue;
    covered.add(rel);
  }
  return covered;
}

/**
 * Where a repo-relative `node_modules` path came from — `{ installRoot, name,
 * entryPath }`, or null for a path that names no package.
 *
 * - `installRoot` is the prefix before the **first** `node_modules` segment
 *   (`.` for the repo root, `clients/web` for a client install). A *nested*
 *   `node_modules/a/node_modules/b` folds onto its outermost install, because it
 *   is npm resolving a transitive conflict **inside one install** — routine, and
 *   not the cross-install skew this feeds. Folding it is what keeps the
 *   candidate set the handful of genuinely install-crossing packages instead of
 *   every transitive duplicate in the tree.
 * - `name` comes from after the **last** `node_modules`, so the nested copy is
 *   still attributed to the package it actually is.
 * - `entryPath` is the package directory relative to that install — exactly the
 *   key npm writes in that install's lockfile (`node_modules/zod`,
 *   `node_modules/a/node_modules/zod`). Folding tells you *which install* loaded
 *   it; this tells you *which copy*, so the version can be read from the entry
 *   the program actually resolved rather than from whatever sits at the
 *   install's top level (Copilot, #1965 r1 — a nested copy at a different
 *   version would otherwise be compared against a top-level entry that is
 *   absent, or worse, present and aligned, and the real pair would pass).
 */
export function classifyModulePath(rel) {
  const parts = rel.split("/");
  const first = parts.indexOf("node_modules");
  if (first === -1) return null;
  const last = parts.lastIndexOf("node_modules");
  const head = parts[last + 1];
  // `node_modules/.bin/…`, `node_modules/.package-lock.json`: npm's own
  // bookkeeping, not a package.
  if (!head || head.startsWith(".")) return null;
  const scoped = head.startsWith("@");
  const name = scoped ? parts[last + 2] && `${head}/${parts[last + 2]}` : head;
  if (!name) return null; // a bare `node_modules/@scope` path names no package
  return {
    installRoot: first === 0 ? "." : parts.slice(0, first).join("/"),
    name,
    entryPath: parts.slice(first, last + (scoped ? 3 : 2)).join("/"),
  };
}

/**
 * The packages that enter a SINGLE program from two different installs — the
 * only ones whose version skew can put two structurally-distinct copies of one
 * type in front of the type checker.
 *
 * `programs` is an iterable of `{ label, files }`, one per leaf tsconfig project,
 * `files` being repo-relative `node_modules` paths. Returns
 * `Map<name, Map<programLabel, Map<installRoot, Set<entryPath>>>>` — the
 * co-occurrences themselves, not a flattened name list.
 *
 * Keeping the structure is what lets the caller compare only the copies that met
 * (Copilot, #1965 r1). Flattening to names hands the comparison a package that
 * is aligned wherever it co-occurs, and a third install holding a different
 * version of it then fails the guard even though no program ever loads that
 * copy — with a diagnostic naming an install that was never involved.
 *
 * The two-install test is applied **within one program**, not across the run: a
 * package reached from the root install in web's program and from the client
 * install in cli's program is two copies in two *separate* type checks, which
 * nothing has to relate.
 *
 * Note what TypeScript's own package-identity dedup does to this, because it
 * makes the measure self-correcting rather than leaky. Two copies of a package
 * at the **same** name@version are collapsed into a redirect, and a redirected
 * `.d.ts` does not resolve its own imports — so an aligned package's transitive
 * dependencies are loaded once, from one install, and never become candidates.
 * That is the right answer, not a miss: one copy in the program is one copy for
 * the checker to instantiate, whatever the tree looks like on disk. The moment
 * the pair skews, the redirect stops applying, both copies enter the program,
 * and the package becomes a candidate — which is exactly when it matters.
 */
export function crossInstallPackages(programs) {
  const found = new Map();
  for (const { label, files } of programs) {
    // Within THIS program: name -> installRoot -> the entry paths loaded from it.
    const seen = new Map();
    for (const rel of files) {
      const hit = classifyModulePath(rel);
      if (!hit) continue;
      if (!seen.has(hit.name)) seen.set(hit.name, new Map());
      const byRoot = seen.get(hit.name);
      if (!byRoot.has(hit.installRoot)) byRoot.set(hit.installRoot, new Set());
      byRoot.get(hit.installRoot).add(hit.entryPath);
    }
    for (const [name, byRoot] of seen) {
      if (byRoot.size < 2) continue; // one install — nothing to relate
      if (!found.has(name)) found.set(name, new Map());
      found.get(name).set(label, byRoot);
    }
  }
  return found;
}
