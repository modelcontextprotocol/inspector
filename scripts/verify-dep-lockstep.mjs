#!/usr/bin/env node
// Durable guard for the "one version per install-crossing dependency" invariant
// (#1896). v2 is not an npm workspace: the root and each `clients/*` carry their
// own `node_modules`, so the *same* package can resolve to two different
// versions in one process — or, worse, in one `tsc` program.
//
// That second case is what this guard exists for. A client's
// `tsconfig.test.json` compiles first-party sources that live *outside* the
// client (`test-servers/src`, `core/`), and those files resolve their
// dependencies from the **root** install while the client's own sources resolve
// from the client install. When the two copies are the same version the
// duplication is harmless; when they skew, TypeScript must relate two
// structurally-distinct declarations of the same type.
//
// For most packages that is merely redundant work. For a deeply
// recursive-generic type surface it is exponential: zod `4.3.6` (root) against
// zod `4.4.3` (clients/web) made `tsc -b` in `clients/web` exhaust the 4GB
// default heap outright (`FATAL ERROR: Ineffective mark-compacts near heap
// limit`) via `TS2589 Type instantiation is excessively deep`, because every
// `@modelcontextprotocol/*` schema is built out of zod generics. Aligning the
// two copies — changing nothing else — returned the build to its baseline cost.
//
// The candidate set is DERIVED from what actually enters each `tsc` program
// (#1965): every client tsconfig project is listed with `tsc --listFilesOnly`
// (the shared `lib/tsc-program.mjs` machinery `verify:typecheck-coverage` reads
// too), each resolved `node_modules` file is mapped to its owning install and
// package, and a package that reaches ONE program from TWO installs is a
// candidate. That is exactly the set that can put two structurally-distinct
// copies of a type in front of one type checker — no more, no less.
//
// It replaced a derivation that read the packages the shared sources named
// *directly*, which could not see a package whose declarations arrive only
// through another package's `.d.ts`. `@modelcontextprotocol/sdk` was the live
// example: it is never written in first-party code (the shared sources import
// the split `@modelcontextprotocol/client|core|…`), yet 16 of its `.d.ts` files
// land in `clients/web`'s test program, so a second copy under
// `clients/web/node_modules` would have skewed unseen. The other derivation
// measured for #1965 — expanding the direct imports over the lockfiles'
// `dependencies` — was unusable: 155 packages, 25 of them skewed, nearly all
// irrelevant transitive tooling (`chai`, `qs`, `iconv-lite`), and it missed the
// SDK anyway.
//
// Skew among the candidates is then denied by default, with an allowlist of
// packages verified to tolerate it (below). A dependency that starts skewing
// fails `validate` and forces a decision, rather than surfacing months later as
// an unexplained OOM.
//
// ## The second tier: declared packages, whatever any program loads (#2226)
//
// The program-derived tier above is deliberately narrow — it asks only "can two
// structurally-distinct copies of a type meet inside ONE `tsc` program", because
// that is the question the #1896 heap exhaustion turned on. That narrowness is a
// real blind spot, and `AGENTS.md` documented it before anything measured it:
// `clients/cli` resolved `@types/node` 24.13.1 against the root's 24.13.3, and
// this guard reported OK — correctly, since no one program sees both copies.
//
// So a SECOND tier runs alongside it, asking the weaker but broader question
// `AGENTS.md`'s "one version per install-crossing dependency" rule actually
// states: does a package that this repo DECLARES somewhere resolve to two
// different versions across our installs at all? The candidate set is every name
// in any install's `dependencies`/`devDependencies` (root or client) that more
// than one install holds a top-level copy of — 17 packages today, against the
// program tier's much smaller set.
//
// The two tiers are complementary and neither subsumes the other:
//
//   • The program tier sees a copy NO manifest names — the `@modelcontextprotocol/sdk`
//     case, whose `.d.ts` files arrive only through another package's types.
//   • The declared tier sees a copy that arrives TRANSITIVELY into one install
//     and is therefore constrained by no range of ours: cli's `@types/node` is
//     hoisted via `@types/express`, so nothing pulled it forward when the root
//     moved. It also sees two CLIENTS disagreeing (`@types/react` in web against
//     tui), which no single program can, and the tool copies `AGENTS.md` calls
//     out as ungated — `eslint`, `typescript`, `vitest` — which are peer shadows
//     that no `tsc` program loads at all.
//
// The declared tier is the weaker signal, so it is the one to reach for an
// allowlist entry on. It is still deny-by-default: the cost of a false alarm is
// one `npm update <pkg>` in the stale install, and the cost of a miss is the
// class of bug that reproduces on one machine and not another.

import { readFileSync, existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { rootReachesScript } from "./lib/npm-scripts.mjs";
import {
  clientTsconfigReferences,
  crossInstallPackages,
  projectListingError,
  projectPackageFiles,
  resolveLeafProjects,
  typecheckProjects,
} from "./lib/tsc-program.mjs";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

// Packages whose cross-install skew is verified benign, each with the reason.
// This is an allowlist of *names*, not of version pairs, so an ordinary patch
// float within one of these does not churn the file — while any package NOT
// listed here failing the check is a genuine, unreviewed new skew.
//
// Being listed is NOT a blanket exemption: it tolerates skew only *within a
// major version*. A rationale establishes that a patch/minor difference is
// harmless, which is not evidence that a React 18-vs-19 or Hono 4-vs-5 split
// across installs would be — that is a different type surface, and it fails like
// anything else (Copilot, #1962).
//
// The admission test is the one the zod incident established: does the
// package's public type surface consist of deeply recursive generics that
// first-party code relates across the boundary? If yes it must stay in
// lockstep; if no, a patch-level difference costs nothing.
//
// **Empty today**, and that is a consequence of the #1965 derivation rather than
// a relaxation. The four former entries were all admitted under the old
// direct-import derivation, which asked only "is this name written in shared
// source and held at two versions somewhere" — a question two installs can
// answer yes to without any program ever seeing both copies:
//
//   • `jose` and `@modelcontextprotocol/ext-apps` are declared only at the root
//     since #1970, so neither can skew at all now.
//   • `react` ships no types of its own, so what lands in a program is
//     `@types/react`, and it lands from a single install; the `react` package's
//     own files never enter one. `hono` likewise resolves from one install per
//     program (`clients/web` in web's node project).
//
// If any of them ever does reach one program from two installs, the guard fails
// and forces the decision then — with the actual version pair in hand, which is
// a better basis for a rationale than a pre-emptive entry.
const TOLERATED_SKEW = new Map();

// The declared tier's allowlist, same shape and same within-a-major rule as
// TOLERATED_SKEW above, and empty for the same reason: an entry is worth writing
// only with a real version pair in hand.
//
// Note what is deliberately NOT listed. `react` and `react-dom` are pinned per
// client on purpose (`AGENTS.md`, so a client's renderer and the React it calls
// into come from one install) — but "two copies by design" is not "two versions
// by design", and the rule that survives is still one version everywhere. The
// same holds for `vite` and `tsup`, declared by several clients each.
const TOLERATED_DECLARED_SKEW = new Map();

/**
 * Installed versions in a parsed lockfile, keyed by the **install path** npm
 * writes — `node_modules/zod`, `node_modules/a/node_modules/zod`.
 *
 * Keyed by path rather than by package name so a version is read from the exact
 * copy a program resolved (Copilot, #1965 r1). Reading only top-level entries
 * would mean a nested copy that entered the program got compared against
 * whatever sits at the install's top level — a different version, or nothing at
 * all — and a real pair could pass. Nested copies are still not a *candidate* on
 * their own (`classifyModulePath` folds them onto their outermost install); this
 * is about pricing a copy correctly once a program has loaded it.
 */
export function lockVersionsByPath(lock) {
  const versions = new Map();
  for (const [entryPath, entry] of Object.entries(lock?.packages ?? {})) {
    if (!entryPath.startsWith("node_modules/")) continue;
    if (typeof entry?.version !== "string") continue;
    versions.set(entryPath, entry.version);
  }
  return versions;
}

/**
 * Whether a parsed lockfile has the shape this guard can read: a
 * `lockfileVersion` 2+ `packages` table, keyed by install path with `""` for
 * the root project.
 *
 * This is checked rather than tolerated because the gate is deny-by-default and
 * `lockVersionsByPath` returns an empty map for anything else. An unreadable
 * lockfile would otherwise contribute no holders, and a real skew among the
 * remaining installs would be reported as aligned — the gate failing *open*,
 * which is the one way it must never fail (Copilot, #1962). A v1 lockfile
 * (`dependencies` only, no `packages`) lands here too, correctly: this guard
 * cannot read it, so it must say so rather than skip the install.
 */
export function hasReadableLockShape(lock) {
  // The declared version is checked, not just inferred from the presence of a
  // `packages` key: this function and the diagnostic it drives both promise
  // "lockfileVersion 2+", so a file claiming v1 while carrying a `packages`
  // table must be rejected rather than half-trusted (Copilot, #1962).
  const version = lock?.lockfileVersion;
  if (typeof version !== "number" || !Number.isFinite(version) || version < 2)
    return false;
  const packages = lock.packages;
  if (typeof packages !== "object" || packages === null) return false;
  return Object.prototype.hasOwnProperty.call(packages, "");
}

/**
 * Price each co-occurrence and keep the ones whose copies disagree.
 *
 * `found` is {@link crossInstallPackages}' output —
 * `Map<name, Map<program, Map<installRoot, Set<entryPath>>>>` — and `versions`
 * maps an install dir to that install's {@link lockVersionsByPath}. A package is
 * skewed when the copies **one program** loaded, from two different installs,
 * carry more than one version. Only the installs that actually met in that
 * program are compared: a third install's copy that no program loads is not
 * evidence of anything (Copilot, #1965 r1).
 *
 * Returns `{ skewed, unresolved }`, sorted by name. `unresolved` names a copy
 * whose lockfile entry is missing — the tree and the lockfile disagree, so the
 * comparison cannot be trusted and the caller must fail rather than skip it.
 */
export function findSkew(found, versions) {
  const skewed = [];
  const unresolved = [];
  for (const name of [...found.keys()].sort()) {
    const occurrences = [];
    for (const [program, byRoot] of found.get(name)) {
      const holders = [];
      for (const [dir, entryPaths] of byRoot)
        for (const entryPath of entryPaths) {
          const version = versions.get(dir)?.get(entryPath);
          if (version === undefined) unresolved.push({ name, dir, entryPath });
          else holders.push({ dir, entryPath, version });
        }
      if (new Set(holders.map((h) => h.version)).size > 1)
        occurrences.push({ program, holders });
    }
    if (occurrences.length > 0) skewed.push({ name, occurrences });
  }
  return { skewed, unresolved };
}

/** Every holder across a skewed package's occurrences, deduped by install + path. */
export function skewHolders(entry) {
  const byKey = new Map();
  for (const { holders } of entry.occurrences)
    for (const holder of holders)
      byKey.set(`${holder.dir}|${holder.entryPath}`, holder);
  return [...byKey.values()];
}

/**
 * The major-version component of a lockfile version string. Prerelease and
 * build metadata are irrelevant here (`2.0.0-beta.5` → `2`). Returns null for
 * anything not starting with an integer, which is treated as "cannot prove same
 * major" and therefore fails rather than passes.
 */
export function majorOf(version) {
  const m = /^(\d+)\./.exec(String(version ?? ""));
  return m ? m[1] : null;
}

/**
 * Split skewed packages into the tolerated ones and the failures.
 *
 * Being on the allowlist tolerates skew only *within a major version*: each
 * entry's rationale establishes that a patch/minor difference is benign, which
 * says nothing about a major split, where the type surface itself changes. So a
 * listed package whose holders disagree on major is still a failure.
 */
export function partitionSkew(skewed, tolerated = TOLERATED_SKEW) {
  const isTolerated = (s) => toleratesSkew(s.name, skewHolders(s), tolerated);
  return {
    failures: skewed.filter((s) => !isTolerated(s)),
    ignored: skewed.filter(isTolerated),
  };
}

/**
 * Whether `tolerated` excuses this package's skew: it must be listed, AND its
 * holders must agree on major. Shared by both tiers so the within-a-major rule
 * cannot be stated twice and drift — a listed package that splits across a major
 * fails in either tier.
 */
export function toleratesSkew(name, holders, tolerated) {
  if (!tolerated.has(name)) return false;
  const majors = new Set(holders.map((h) => majorOf(h.version)));
  return majors.size === 1 && !majors.has(null);
}

/**
 * Every package name any install declares, across `dependencies` and
 * `devDependencies`.
 *
 * `manifests` is `[{ dir, manifest }]`. Both fields count because the boundary
 * this tier polices is "does the repo name it", not "does it ship": a
 * devDependency skew is exactly the `@types/*` and toolchain case #2226 is
 * about. `peerDependencies` and `optionalDependencies` are NOT declarations of
 * what this repo installs — a peer range is a constraint on the consumer, and
 * the copy npm auto-installs to satisfy one is caught anyway, because it lands
 * top-level in an install whose sibling declares the same name.
 */
export function declaredPackages(manifests) {
  const names = new Set();
  for (const { manifest } of manifests)
    for (const field of ["dependencies", "devDependencies"])
      for (const name of Object.keys(manifest?.[field] ?? {})) names.add(name);
  return names;
}

/**
 * An install's TOP-LEVEL installed versions — `node_modules/<name>`, with
 * nested copies (`node_modules/a/node_modules/<name>`) excluded.
 *
 * Top-level is the right depth here: it is what the install's own code resolves,
 * and it is the single copy a `<name>` range in that manifest governs. A nested
 * copy exists precisely because some dependency asked for a different version,
 * so it is constrained by that dependency's range rather than by anything we
 * own — reporting it would fail the gate on a decision that is not ours to make.
 * (The program tier prices nested copies, because a program that actually loads
 * one is a different question.)
 */
export function topLevelVersions(lock) {
  const versions = new Map();
  for (const [entryPath, version] of lockVersionsByPath(lock)) {
    const rest = entryPath.slice("node_modules/".length);
    if (rest.includes("node_modules/")) continue;
    versions.set(rest, version);
  }
  return versions;
}

/**
 * Declared packages whose top-level copies disagree across installs.
 *
 * `declared` is {@link declaredPackages}' output and `versions` maps an install
 * dir to that install's {@link topLevelVersions}. An install that holds no
 * top-level copy of a name simply is not a holder — absence is not skew, and a
 * package only one install holds cannot cross an install boundary at all.
 *
 * Returns `[{ name, holders: [{ dir, version }] }]` sorted by name, holders in
 * install order.
 */
export function findDeclaredSkew(declared, versions) {
  const skewed = [];
  for (const name of [...declared].sort()) {
    const holders = [];
    for (const [dir, byName] of versions) {
      const version = byName.get(name);
      if (version !== undefined) holders.push({ dir, version });
    }
    if (holders.length < 2) continue;
    if (new Set(holders.map((h) => h.version)).size > 1)
      skewed.push({ name, holders });
  }
  return skewed;
}

/** {@link partitionSkew} for the declared tier's `{ name, holders }` entries. */
export function partitionDeclaredSkew(
  skewed,
  tolerated = TOLERATED_DECLARED_SKEW,
) {
  const isTolerated = (s) => toleratesSkew(s.name, s.holders, tolerated);
  return {
    failures: skewed.filter((s) => !isTolerated(s)),
    ignored: skewed.filter(isTolerated),
  };
}

/**
 * The tsconfig projects whose programs a client contributes, from its own
 * `package.json` scripts and its root `tsconfig.json` `references` — the same
 * two enrollment paths `verify:typecheck-coverage` uses, so the two guards
 * measure the same programs.
 *
 * A `neutered` project (its `typecheck` command carries `--noCheck` /
 * `--listFilesOnly`) counts here even though its sibling guard rejects it:
 * whether that pass type-checks is that guard's question, while this one only
 * asks what the program *resolves*, and a program still resolves its imports
 * either way. Dropping them would shrink what this guard measures on the
 * strength of a defect the other guard is already failing on.
 */
export function clientProjects(scripts, references) {
  if (typeof scripts?.typecheck === "string") {
    const { projects, neutered } = typecheckProjects(scripts);
    return [...projects, ...neutered.map((n) => n.project)];
  }
  return references;
}

/**
 * The `clients/*` directories that are real installs — one with a
 * `package.json`. Enrolment is by manifest, NOT by the presence of a lockfile
 * (Copilot, #1962): filtering on the lockfile made a missing one silently drop
 * that install from the comparison.
 */
function clientDirs() {
  const dir = path.join(repoRoot, "clients");
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => `clients/${e.name}`)
    .filter((rel) => existsSync(path.join(repoRoot, rel, "package.json")))
    .sort();
}

/**
 * The installs to compare: the repo root plus every `clients/*` install.
 * Discovered from disk rather than listed, so a new client is covered without
 * editing this guard (the same enrollment style as `verify:typecheck-coverage`).
 * The root is always enrolled: it is this repo, so its manifest is a given.
 */
function installDirs() {
  return ["."].concat(clientDirs());
}

/**
 * List every client program and reduce it to the packages that reach one program
 * from two installs. Returns `{ found, programs, problems }` — `found` is the
 * {@link crossInstallPackages} map, `programs` the labels listed (for the
 * success line), `problems` any reason the measurement itself can't be trusted.
 *
 * A program that resolves NO installed file at all is a problem, not an empty
 * result: every real program pulls in at least the toolchain's own `.d.ts` from
 * some `node_modules`, so an empty listing means `tsc` never ran (a missing
 * install) or the config is broken. Treating it as "no candidates here" is the
 * gate failing open.
 */
function deriveCandidates() {
  const problems = [];
  const programs = [];
  for (const clientDir of clientDirs()) {
    let scripts;
    try {
      scripts = JSON.parse(
        readFileSync(path.join(repoRoot, clientDir, "package.json"), "utf8"),
      ).scripts;
    } catch (cause) {
      throw new Error(
        `verify:dep-lockstep — could not parse ${clientDir}/package.json.`,
        { cause },
      );
    }
    const projects = clientProjects(
      scripts,
      clientTsconfigReferences(clientDir),
    );
    if (projects.length === 0) {
      problems.push(
        `${clientDir}: names no tsconfig project (no \`typecheck\` script, no \`tsconfig.json\` references) — none of its programs is measured.`,
      );
      continue;
    }
    const leaves = new Set();
    for (const project of projects)
      for (const leaf of resolveLeafProjects(clientDir, project))
        leaves.add(leaf);
    for (const leaf of leaves) {
      // A failed config is not a program: tsc still prints a file list, but it
      // is whatever its fallback resolved rather than what the project declares,
      // so measuring it would narrow the candidate set for a reason that has
      // nothing to do with the dependency tree.
      const error = projectListingError(clientDir, leaf);
      if (error) {
        problems.push(
          `${clientDir}: \`tsc -p ${leaf} --listFilesOnly\` exited non-zero — ${error.split("\n")[0]}`,
        );
        continue;
      }
      const files = projectPackageFiles(clientDir, leaf);
      if (files.size === 0) {
        problems.push(
          `${clientDir}: \`tsc -p ${leaf} --listFilesOnly\` resolved no installed file — the program could not be listed.`,
        );
        continue;
      }
      programs.push({ label: `${clientDir}/${leaf}`, files });
    }
  }
  // No program at all means the enumeration itself broke (a moved `clients/`
  // dir), not that there is nothing to check — and an empty candidate set from a
  // broken enumeration is indistinguishable from a clean bill of health.
  if (programs.length === 0 && problems.length === 0)
    problems.push(
      "found no client program to measure — every `clients/*` install must contribute at least one tsconfig project.",
    );
  return { found: crossInstallPackages(programs), programs, problems };
}

/**
 * Run the guard. Prints its verdict and `process.exit(1)`s on any failure.
 * Called only when this file is executed directly — importing it (for tests)
 * gives access to the pure helpers above without running any of this.
 */
export function main() {
  const rootScripts = JSON.parse(
    readFileSync(path.join(repoRoot, "package.json"), "utf8"),
  ).scripts;

  // Vouch for a sibling guard: a guard cannot detect being unrun itself, but the
  // three can vouch for one another, so dropping any single one from `validate`
  // is caught by another. `verify:format-coverage` vouches for this one in turn.
  if (!rootReachesScript(rootScripts, "verify:format-coverage")) {
    console.error(
      "verify:dep-lockstep — the root `validate` no longer runs `verify:format-coverage` (a sibling guard). Restore it.",
    );
    process.exit(1);
  }

  const { found, programs, problems } = deriveCandidates();
  if (problems.length > 0) {
    console.error(
      `verify:dep-lockstep — ${problems.length} program(s) could not be measured:\n`,
    );
    for (const problem of problems) console.error(`  ${problem}`);
    console.error(
      "\nThe candidate set is derived from what each `tsc` program resolves, so an unmeasured program" +
        "\nmeans real skew could pass unseen. Run `npm install` at the repo root (the postinstall cascade" +
        "\ninstalls each client), and see `verify:typecheck-coverage` for the tsconfig-project enrollment rules.",
    );
    process.exit(1);
  }
  const dirs = installDirs();

  // A missing lockfile is a failure, not a skipped install: dropping one would
  // remove its versions from the comparison and could report a real skew as
  // aligned.
  const missing = dirs.filter(
    (dir) => !existsSync(path.join(repoRoot, dir, "package-lock.json")),
  );
  if (missing.length > 0) {
    console.error(
      `verify:dep-lockstep — ${missing.length} install(s) have a package.json but no lockfile:\n`,
    );
    for (const dir of missing) console.error(`  ${dir}/package-lock.json`);
    console.error(
      "\nEvery install must be compared; skipping one could report a real skew as aligned." +
        "\nRun `npm install` there, or remove the install if it is no longer part of the repo.",
    );
    process.exit(1);
  }

  const locks = dirs.map((dir) => {
    const file = path.join(repoRoot, dir, "package-lock.json");
    let lock;
    try {
      lock = JSON.parse(readFileSync(file, "utf8"));
    } catch (cause) {
      // Unparseable is the same failure as unreadable — say which file, rather
      // than dying on a raw SyntaxError with no path in it.
      throw new Error(
        `verify:dep-lockstep — could not parse ${dir}/package-lock.json.`,
        { cause },
      );
    }
    return { dir, lock };
  });

  // Refuse to compare against a lockfile whose shape we can't read, instead of
  // treating it as an install that holds nothing — see `hasReadableLockShape`.
  const unreadable = locks.filter(({ lock }) => !hasReadableLockShape(lock));
  if (unreadable.length > 0) {
    console.error(
      `verify:dep-lockstep — ${unreadable.length} lockfile(s) are not in a readable format:\n`,
    );
    for (const { dir } of unreadable)
      console.error(`  ${dir}/package-lock.json`);
    console.error(
      "\nThis guard reads the `packages` table of a lockfileVersion 2+ lockfile. Without it the install" +
        "\ncontributes no versions, so a real skew among the others would be reported as aligned — the gate" +
        "\nfailing open. Regenerate the lockfile with a current npm (`npm install`).",
    );
    process.exit(1);
  }

  const versions = new Map(
    locks.map(({ dir, lock }) => [dir, lockVersionsByPath(lock)]),
  );

  const { skewed, unresolved } = findSkew(found, versions);

  // A copy the program loaded but the lockfile doesn't list means the installed
  // tree and the lockfile disagree — the comparison would be reading a version
  // that isn't the one on disk, so refuse it rather than skip the copy.
  if (unresolved.length > 0) {
    console.error(
      `verify:dep-lockstep — ${unresolved.length} resolved package(s) have no lockfile entry:\n`,
    );
    for (const { name, dir, entryPath } of unresolved)
      console.error(`  ${name}  ${dir}/${entryPath}`);
    console.error(
      "\nThe program loaded these, so their versions decide the comparison — but the install's lockfile" +
        "\ndoesn't list them, which means the tree and the lockfile disagree. Run `npm install` at the repo" +
        "\nroot to re-sync every install.",
    );
    process.exit(1);
  }

  const { failures, ignored } = partitionSkew(skewed);

  if (failures.length > 0) {
    console.error(
      `verify:dep-lockstep — ${failures.length} ${failures.length === 1 ? "dependency resolves" : "dependencies resolve"} to different versions across installs:\n`,
    );
    let anyListed = false;
    for (const failure of failures) {
      // A package already on the allowlist reached here only by skewing across
      // a MAJOR boundary, so say that rather than advising an entry that exists.
      const listed = TOLERATED_SKEW.has(failure.name);
      anyListed ||= listed;
      console.error(
        `  ${failure.name}${listed ? "  (allowlisted — but this is a MAJOR skew)" : ""}`,
      );
      // Report per program: which copies met, and where. The program is the
      // whole reason the package is a candidate, and naming only the versions
      // would leave the reader unable to check the claim — or to tell a nested
      // copy from the install's top-level one.
      for (const { program, holders } of failure.occurrences) {
        console.error(`    in ${program}`);
        for (const { dir, entryPath, version } of holders)
          console.error(`      ${version}  (${dir}/${entryPath})`);
      }
    }
    console.error(
      "\nEach of these reaches a single `tsc` program from two installs (a client's own sources resolve" +
        "\nfrom the client install, the shared `core/` + `test-servers/src` they pull in resolve from the" +
        "\nroot), so a version skew makes TypeScript relate two structurally-distinct copies of the same" +
        "\ntype. For a recursive-generic surface like zod that is what exhausted the tsc heap in #1896.",
    );
    console.error(
      "\nAlign them — `npm install <pkg>@<version>` in each install that declares the package, so all" +
        "\nlockfiles agree. (Don't add it to an install that doesn't declare it: a package absent from an" +
        "\ninstall can't skew.) If instead its types genuinely cannot blow up, add it to TOLERATED_SKEW in" +
        "\nscripts/verify-dep-lockstep.mjs with the reason. See AGENTS.md.",
    );
    if (anyListed)
      console.error(
        "\nNote: an allowlisted package is tolerated only WITHIN a major version — the rationale for one" +
          "\nestablishes that a patch/minor difference is benign, not that a major split is. Align the major.",
      );
    process.exit(1);
  }

  // ---- Second tier: every DECLARED package held by more than one install.
  // Independent of what any `tsc` program loads, so it sees the transitive and
  // peer-shadow copies the program tier structurally cannot (#2226).
  const manifests = dirs.map((dir) => {
    const file = path.join(repoRoot, dir, "package.json");
    try {
      return { dir, manifest: JSON.parse(readFileSync(file, "utf8")) };
    } catch (cause) {
      throw new Error(
        `verify:dep-lockstep — could not parse ${dir}/package.json.`,
        { cause },
      );
    }
  });
  const declaredVersions = new Map(
    locks.map(({ dir, lock }) => [dir, topLevelVersions(lock)]),
  );
  const declared = declaredPackages(manifests);
  const declaredSkew = findDeclaredSkew(declared, declaredVersions);
  const { failures: declaredFailures, ignored: declaredIgnored } =
    partitionDeclaredSkew(declaredSkew);

  if (declaredFailures.length > 0) {
    console.error(
      `verify:dep-lockstep — ${declaredFailures.length} declared ${declaredFailures.length === 1 ? "dependency resolves" : "dependencies resolve"} to different versions across installs:\n`,
    );
    let anyListed = false;
    for (const failure of declaredFailures) {
      const listed = TOLERATED_DECLARED_SKEW.has(failure.name);
      anyListed ||= listed;
      console.error(
        `  ${failure.name}${listed ? "  (allowlisted — but this is a MAJOR skew)" : ""}`,
      );
      for (const { dir, version } of failure.holders)
        console.error(
          `      ${version}  (${dir}/node_modules/${failure.name})`,
        );
    }
    console.error(
      "\nThese are packages this repo declares somewhere, held at two versions across our installs —" +
        "\nthe `one version per install-crossing dependency` rule in AGENTS.md. Unlike the check above," +
        "\nthis tier does not require the copies to meet in one `tsc` program, so it catches a copy that" +
        "\narrives TRANSITIVELY into one install (cli's `@types/node`, hoisted via `@types/express`, #2226)" +
        "\nor as a peer shadow no program loads at all.",
    );
    console.error(
      "\nAlign them with `npm update <pkg>` in whichever install is behind — that moves the lockfile" +
        "\nwithin the declared range, without widening a range as `npm install <pkg>@<version>` would. If a" +
        "\ntransitive copy will not move, pin it with an `overrides` entry in that install (see" +
        "\nclients/cli). If the skew is genuinely benign, add it to TOLERATED_DECLARED_SKEW in" +
        "\nscripts/verify-dep-lockstep.mjs with the reason.",
    );
    if (anyListed)
      console.error(
        "\nNote: an allowlisted package is tolerated only WITHIN a major version. Align the major.",
      );
    process.exit(1);
  }

  const note = ignored.length > 0 ? `, ${ignored.length} tolerated` : "";
  const declaredNote =
    declaredIgnored.length > 0 ? `, ${declaredIgnored.length} tolerated` : "";
  console.log(
    `verify:dep-lockstep — OK: ${found.size} install-crossing dependencies agree across ${dirs.length} installs${note} ` +
      `(derived from ${programs.length} tsc programs); ` +
      `${countDeclaredHeld(declared, declaredVersions)} declared dependencies agree across those installs${declaredNote}.`,
  );
}

/** How many declared packages more than one install holds — the declared tier's candidate count. */
export function countDeclaredHeld(declared, versions) {
  let n = 0;
  for (const name of declared) {
    let holders = 0;
    for (const byName of versions.values()) if (byName.has(name)) holders += 1;
    if (holders > 1) n += 1;
  }
  return n;
}

// Run only when executed directly (`node scripts/verify-dep-lockstep.mjs`);
// importing this file (tests) exposes the pure helpers without running the guard.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  main();
