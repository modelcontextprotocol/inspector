#!/usr/bin/env node
// Tag a release on origin/main (#2558) — `npm run release:tag [-- --push]`.
// The tag block the release skill previously transcribed inline.
//
// The hazard this exists for: the tag must point at `origin/main`'s commit,
// NEVER at a local HEAD — a local branch that is ahead or behind tags the
// wrong tree. So the SHA and the version both come from `origin/main` after
// an explicit fetch, and the default run is a DRY RUN that prints what would
// be tagged; `--push` is the human gate on the decision, not on the
// composition.
//
// The tag is the BARE `x.y.z` — this repo's release tags carry no `v` prefix
// (the release skill's rule; npm's own default would have minted `vx.y.z`).

import { spawnSync } from "node:child_process";
import { parseArgs } from "node:util";

export function parseTagArgs(argv) {
  const { values } = parseArgs({
    args: argv,
    options: { push: { type: "boolean" } },
  });
  return { push: values.push === true };
}

function git(spawn, args) {
  const result = spawn("git", args, { encoding: "utf8" });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(
      `git ${args.join(" ")} failed: ${(result.stderr ?? "").trim()}`,
    );
  }
  return (result.stdout ?? "").trim();
}

/** The version from a raw package.json, validated as x.y.z. */
export function versionFrom(packageJson) {
  const version = JSON.parse(packageJson).version;
  if (typeof version !== "string" || !/^\d+\.\d+\.\d+$/.test(version)) {
    throw new Error(
      `origin/main package.json version "${version}" is not x.y.z`,
    );
  }
  return version;
}

export function main(argv = process.argv.slice(2), spawn = spawnSync) {
  const { push } = parseTagArgs(argv);

  git(spawn, ["fetch", "origin", "main"]);
  // Read the SHA from FETCH_HEAD — what that fetch literally just retrieved.
  // `rev-parse origin/main` would read the tracking ref, which a source-only
  // `fetch origin main` updates only opportunistically — a stale tracking
  // ref could be tagged while the output claims an explicit fetch made it
  // current. Resolve the SHA once and read everything else FROM that SHA:
  // worktrees share refs, so a fetch elsewhere can move things between
  // commands — reading package.json off a ref name could pair commit A's
  // version with commit B's tag target, the exact mismatch this helper
  // exists to prevent.
  const sha = git(spawn, ["rev-parse", "FETCH_HEAD"]);
  const version = versionFrom(git(spawn, ["show", `${sha}:package.json`]));
  const tag = version; // bare x.y.z — no v prefix on this repo's release tags

  if (!push) {
    console.log(
      `would tag: ${tag} → ${sha} (origin/main) — re-run with --push`,
    );
    return;
  }
  // Push the ref directly from the SHA — no local tag is created, so a
  // failed push leaves nothing behind and a retry starts clean (a local
  // `git tag` first would make the retry fail with "already exists").
  git(spawn, ["push", "origin", `${sha}:refs/tags/${tag}`]);
  console.log(`tagged: ${tag} → ${sha}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
