#!/usr/bin/env node
// Look up — or create only when absent — a security advisory's private fork
// (#2558) — `npm run advisory:fork -- --ghsa GHSA-xxxx-yyyy-zzzz [--create]`.
// The fork block the security-advisory skill previously transcribed inline.
//
// The ordering is the entire point of scripting this: the POST **creates** a
// private fork as a side effect, and an accidentally created fork needs the
// `delete_repo` scope to remove. So the advisory is READ FIRST, an existing
// fork is printed and the POST never runs, and creating one at all requires
// the explicit `--create` flag — a bare lookup can never mutate anything.

import { spawnSync } from "node:child_process";
import { parseArgs } from "node:util";
import { REPO_SLUG, ghJson } from "./lib/gh.mjs";

const GHSA_PATTERN =
  /^GHSA-[23456789cfghjmpqrvwx]{4}-[23456789cfghjmpqrvwx]{4}-[23456789cfghjmpqrvwx]{4}$/;

export function parseForkArgs(argv) {
  const { values } = parseArgs({
    args: argv,
    options: { ghsa: { type: "string" }, create: { type: "boolean" } },
  });
  if (!values.ghsa || !GHSA_PATTERN.test(values.ghsa)) {
    throw new Error(
      `--ghsa must be a full GHSA id (GHSA-xxxx-yyyy-zzzz), got ${values.ghsa ?? "nothing"}`,
    );
  }
  return { ghsa: values.ghsa, create: values.create === true };
}

export function main(argv = process.argv.slice(2), spawn = spawnSync) {
  const { ghsa, create } = parseForkArgs(argv);

  // Read first — the create endpoint is never touched when a fork exists.
  const advisory = ghJson(spawn, [
    "api",
    `repos/${REPO_SLUG}/security-advisories/${ghsa}`,
  ]);
  const existing = advisory?.private_fork?.full_name;
  if (existing) {
    console.log(`fork: ${existing} (existing)`);
    return;
  }
  if (!create) {
    console.log(`fork: none — re-run with --create to make one for ${ghsa}`);
    return;
  }

  const fork = ghJson(spawn, [
    "api",
    "-X",
    "POST",
    `repos/${REPO_SLUG}/security-advisories/${ghsa}/forks`,
  ]);
  if (!fork?.full_name) {
    throw new Error(
      `fork creation returned no full_name: ${JSON.stringify(fork)}`,
    );
  }
  console.log(`fork: ${fork.full_name} (created)`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
