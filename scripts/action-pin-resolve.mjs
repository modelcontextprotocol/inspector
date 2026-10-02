#!/usr/bin/env node
// Resolve an action's SHA pin and its exact-version comment from ONE tag
// lookup (#2558) — `npm run action:resolve-pin -- --repo actions/checkout
// --tag v5`. The resolver block the pre-push-gate skill previously
// transcribed inline.
//
// `verify:action-pins` is offline: it checks a credentialed job's `uses:`
// lines are `SHA # vX.Y.Z` pins but cannot check the SHA and the comment
// agree. This script is what makes them agree by construction — the SHA and
// the exact release both come from the same tag listing, so the comment the
// monthly sweep ranks by can never drift from the commit actually pinned.

import { spawnSync } from "node:child_process";
import { parseArgs } from "node:util";
import { ghPaginatedList } from "./lib/gh.mjs";

const EXACT_TAG = /^v\d+\.\d+\.\d+$/;

export function parsePinArgs(argv) {
  const { values } = parseArgs({
    args: argv,
    options: { repo: { type: "string" }, tag: { type: "string" } },
  });
  if (!values.repo || !/^[\w.-]+\/[\w.-]+$/.test(values.repo)) {
    throw new Error(
      `--repo must be owner/name, got ${values.repo ?? "nothing"}`,
    );
  }
  // The tag names a release line (a vN moving tag, or an exact vX.Y.Z) —
  // its major is what the exact-version lookup is restricted to below.
  // ONLY those two forms: a partial tag like v5.1 is an undocumented minor
  // moving tag the exact-tag preservation above cannot reason about.
  const major = /^v(\d+)(?:\.\d+\.\d+)?$/.exec(values.tag ?? "")?.[1];
  if (major === undefined) {
    throw new Error(
      `--tag must be a vN moving tag or exact vX.Y.Z, got ${values.tag ?? "nothing"}`,
    );
  }
  return { repo: values.repo, tag: values.tag, major: Number(major) };
}

/**
 * The highest exact vX.Y.Z tag pointing at `sha` WITHIN the requested major
 * — a commit can carry exact tags from several majors (a lagging line
 * re-released from the same tree), and the comment must identify the release
 * line that was asked for, not the numerically highest.
 */
export function exactVersionFor(tags, sha, major) {
  const exact = tags
    .filter(
      (tag) =>
        EXACT_TAG.test(tag?.name ?? "") &&
        tag?.commit?.sha === sha &&
        Number(tag.name.slice(1).split(".")[0]) === major,
    )
    .map((tag) => tag.name)
    .sort((a, b) => {
      const pa = a.slice(1).split(".").map(Number);
      const pb = b.slice(1).split(".").map(Number);
      return pa[0] - pb[0] || pa[1] - pb[1] || pa[2] - pb[2];
    });
  return exact.at(-1);
}

export function main(argv = process.argv.slice(2), spawn = spawnSync) {
  const { repo, tag, major } = parsePinArgs(argv);

  // ONE listing resolves both the SHA and the exact version. Resolving the
  // moving tag through /commits/<tag> in a separate request would race an
  // upstream retag between the two calls — the printed comment could name
  // the previous release while the SHA pins the new one.
  const tags = ghPaginatedList(spawn, `repos/${repo}/tags?per_page=100`);
  const sha = tags.find((candidate) => candidate?.name === tag)?.commit?.sha;
  if (!sha) {
    throw new Error(
      `could not resolve ${repo}@${tag} to a commit — no such tag`,
    );
  }
  const version = exactVersionFor(tags, sha, major);
  if (!version) {
    throw new Error(
      `no exact v${major}.Y.Z tag in ${repo} points at ${sha} — pin by hand from the release page`,
    );
  }
  // An exact requested tag IS the version — re-deriving it from the SHA
  // could mislabel it when several exact tags share one commit (v5.1.2
  // re-released unchanged as v5.2.0): the comment must name what was asked
  // for, not the highest tag that happens to sit on the same tree.
  console.log(`uses: ${repo}@${sha} # ${EXACT_TAG.test(tag) ? tag : version}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
