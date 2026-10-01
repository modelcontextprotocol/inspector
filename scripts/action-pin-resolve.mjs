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
import { ghJson, ghPaginatedList } from "./lib/gh.mjs";

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
  if (!values.tag) {
    throw new Error("--tag is required (e.g. --tag v5)");
  }
  return { repo: values.repo, tag: values.tag };
}

/** The highest exact vX.Y.Z tag pointing at `sha`, by numeric semver. */
export function exactVersionFor(tags, sha) {
  const exact = tags
    .filter(
      (tag) => EXACT_TAG.test(tag?.name ?? "") && tag?.commit?.sha === sha,
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
  const { repo, tag } = parsePinArgs(argv);

  const sha = ghJson(spawn, ["api", `repos/${repo}/commits/${tag}`]).sha;
  if (!sha) {
    throw new Error(`could not resolve ${repo}@${tag} to a commit`);
  }
  const version = exactVersionFor(
    ghPaginatedList(spawn, `repos/${repo}/tags?per_page=100`),
    sha,
  );
  if (!version) {
    throw new Error(
      `no exact vX.Y.Z tag in ${repo} points at ${sha} — pin by hand from the release page`,
    );
  }
  console.log(`uses: ${repo}@${sha} # ${version}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
