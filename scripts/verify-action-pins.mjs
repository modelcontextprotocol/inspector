#!/usr/bin/env node
// Guard: every action a CREDENTIALED job runs is pinned to a commit SHA (#2484).
//
// #2235 settled that this repo's actions stay on moving major tags (`@v7`),
// with the monthly `dependency-refresh` sweep reporting a new major. That is
// still the rule for the ordinary job. It is the wrong rule for a job holding a
// credential: a tag is mutable, so whoever can move `v7` replaces the code that
// runs next to the credential, on the next run, with no change in this repo.
// A SHA cannot be moved. So the narrower rule is: a job holding a credential
// runs only SHA-pinned actions, each with a trailing `# vX.Y.Z` comment naming
// the release the SHA was resolved from — which is what lets the sweep keep
// watching it (`parseActionRefs` in `dependency-refresh.mjs`).
//
// A job counts as credentialed when it
//
//   1. can mint an OIDC token or push a package — `id-token: write` or
//      `packages: write` (or `write-all`), in its own `permissions:` or, absent
//      one, the workflow's;
//   2. is handed any secret other than `GITHUB_TOKEN`, its own or through the
//      workflow-level `env:` — in any spelling of the
//      expression (`secrets.X`, `secrets['X']`, `secrets[matrix.name]`), or as
//      a reusable-workflow call's `secrets: inherit` (a `secrets:` mapping is
//      read like any other expression, so one passing only `GITHUB_TOKEN`
//      does not count); or
//   3. uploads an artifact that a credentialed job downloads and `needs` —
//      transitively, so every hop of a `source → package → publish` chain
//      counts, not only the last —
//      `package` builds the tarball `publish` hands to `npm publish` under
//      provenance, so a moved tag in `package` publishes as surely as one in
//      `publish` would (#2483 split the two to keep the token out of the
//      install; this keeps a tag out of what gets published).
//
// `GITHUB_TOKEN` alone does not count: every job holds one, so counting it
// would re-open #2235 for the whole repo, which #2484 explicitly does not ask.
//
// Parsed with `yaml` (already a root dependency), for the reason
// `scripts/lib/workflow-gate.mjs` records: hand-rolled workflow parsing lost
// rounds to spellings it had not anticipated. Comments are not data to the
// parser, so the many comments here that quote `id-token: write` while
// explaining why a job does NOT hold it cannot trip rule 1 — and the one
// comment that matters, the `# vX.Y.Z` after a `uses:`, is read off its node.
//
// Checked offline: a SHA that does not match its comment's release cannot be
// seen without the network. Resolve both from the same lookup when bumping.
//
// ⚠️ Local `./…` actions and reusable workflows are skipped, not traced: the
// remote `uses:` INSIDE one runs under its caller's credentials but is not
// associated with the caller here, and composite-action files are not read at
// all. None exists in this repo; adding the first one to a credentialed job
// means extending this guard to follow it, or it is a silent bypass.

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { isAlias, isMap, isScalar, isSeq, parseDocument, visit } from "yaml";
import { SHA_REF } from "./dependency-refresh.mjs";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

// `GITHUB_TOKEN` in either accessor spelling; removed before looking for any
// other `secrets` reference, so every spelling of every other name — a dynamic
// index included — still reads as a secret (Copilot).
const DEFAULT_TOKEN =
  /\bsecrets\s*(?:\.\s*GITHUB_TOKEN\b|\[\s*(['"])GITHUB_TOKEN\1\s*\])/g;
const EXPRESSION = /\$\{\{([\s\S]*?)\}\}/g;
const EXACT_VERSION = /^v\d+\.\d+\.\d+$/;

/** Does this `permissions:` value let the job mint a token or push a package? */
function mints(permissions) {
  if (permissions === "write-all") return true;
  if (permissions === null || typeof permissions !== "object") return false;
  return (
    permissions["id-token"] === "write" || permissions.packages === "write"
  );
}

/** Every string anywhere in a parsed value — keys excluded, as they hold no expression. */
function stringsIn(value) {
  if (typeof value === "string") return [value];
  if (value === null || typeof value !== "object") return [];
  return Object.values(value).flatMap(stringsIn);
}

/**
 * Is this job handed any secret but `GITHUB_TOKEN`? `inherited` is the
 * workflow-level `env:`, which every job receives the way a job with no
 * `permissions:` of its own receives the workflow's (Copilot).
 */
function handedSecret(job, inherited) {
  // `inherit` hands over every secret with no expression to scan. A mapping
  // is scanned below with everything else.
  if (job.secrets === "inherit") return true;
  return stringsIn([job, inherited]).some((text) =>
    [...text.matchAll(EXPRESSION)].some(([, body]) =>
      /\bsecrets\b/.test(body.replace(DEFAULT_TOKEN, "")),
    ),
  );
}

const needsOf = (job) =>
  job.needs == null ? [] : [job.needs].flat().map(String);

const stepsUsing = (job, action) =>
  (job.steps ?? []).some(
    (step) => typeof step?.uses === "string" && step.uses.startsWith(action),
  );

/**
 * @param {string} yaml raw contents of a workflow file
 * @param {string} [file] only for the parse-error message
 */
function parseWorkflow(yaml, file = "<workflow>") {
  const doc = parseDocument(yaml);
  if (doc.errors.length > 0)
    throw new Error(
      `verify:action-pins: could not parse ${file}: ${doc.errors[0].message}`,
    );
  return doc;
}

/**
 * The names of the jobs in this workflow that hold a credential, per the rules
 * in the header.
 *
 * @param {string} yaml raw contents of a workflow file
 * @param {string} [file] only for the parse-error message
 * @returns {Set<string>}
 */
export function credentialedJobs(yaml, file) {
  const workflow = parseWorkflow(yaml, file).toJS() ?? {};
  const jobs = Object.entries(workflow.jobs ?? {});
  const held = new Set();
  for (const [name, job] of jobs) {
    const permissions =
      "permissions" in job ? job.permissions : workflow.permissions;
    if (mints(permissions) || handedSecret(job, workflow.env)) held.add(name);
  }
  // To a fixed point: marking a producer credentialed can make ITS producers
  // credentialed, and job order in the file says nothing about the chain.
  for (let grew = true; grew; ) {
    grew = false;
    for (const [name, job] of jobs) {
      if (!held.has(name) || !stepsUsing(job, "actions/download-artifact@"))
        continue;
      for (const producer of needsOf(job)) {
        const upstream = workflow.jobs[producer];
        if (
          upstream &&
          !held.has(producer) &&
          stepsUsing(upstream, "actions/upload-artifact@")
        ) {
          held.add(producer);
          grew = true;
        }
      }
    }
  }
  return held;
}

/**
 * Every `uses:` in a credentialed job that is not a 40-hex SHA followed by a
 * `# vX.Y.Z` comment — each step's, and the job's own when it calls a reusable
 * workflow, whose ref is just as mutable (Copilot). Local (`./…`) actions and
 * workflows are repository code, not a ref.
 *
 * A YAML alias anywhere in a credentialed job is itself a finding. Resolving it
 * here would accept a pin the monthly sweep's line parser cannot see, so the
 * pin would pass this guard and then silently drop out of the sweep; spelling
 * the ref out is the only form both can read.
 *
 * @param {string} yaml raw contents of a workflow file
 * @param {string} [file] only for the parse-error message
 * @returns {Array<{job: string, uses: string}>}
 */
export function unpinnedRefs(yaml, file) {
  const held = credentialedJobs(yaml, file);
  const jobs = parseWorkflow(yaml, file).get("jobs", true);
  const problems = [];
  if (!isMap(jobs)) return problems;
  for (const { key, value } of jobs.items) {
    const name = String(isScalar(key) ? key.value : key);
    if (!held.has(name)) continue;
    if (!isMap(value)) {
      if (isAlias(value))
        problems.push({ job: name, uses: `*${value.source}` });
      continue;
    }
    visit(value, {
      Alias: (_, node) => {
        problems.push({ job: name, uses: `*${node.source}` });
      },
    });
    const steps = value.get("steps", true);
    const nodes = [
      value.get("uses", true),
      ...(isSeq(steps) ? steps.items : []).map((step) =>
        isMap(step) ? step.get("uses", true) : undefined,
      ),
    ];
    for (const node of nodes) {
      if (!isScalar(node) || typeof node.value !== "string") continue;
      const uses = node.value;
      if (uses.startsWith("./")) continue;
      const ref = uses.slice(uses.lastIndexOf("@") + 1);
      const version = (node.comment ?? "").trim();
      if (
        !uses.includes("@") ||
        !SHA_REF.test(ref) ||
        !EXACT_VERSION.test(version)
      )
        problems.push({ job: name, uses });
    }
  }
  return problems;
}

export function main(root = repoRoot) {
  const dir = path.join(root, ".github", "workflows");
  const files = readdirSync(dir).filter((f) => /\.ya?ml$/.test(f));
  const problems = [];
  let jobs = 0;
  for (const file of files) {
    const yaml = readFileSync(path.join(dir, file), "utf8");
    jobs += credentialedJobs(yaml, file).size;
    for (const p of unpinnedRefs(yaml, file))
      problems.push(`  ${file} → ${p.job}: ${p.uses}`);
  }
  if (problems.length > 0) {
    console.error(
      `verify:action-pins — ${problems.length} action ref(s) in a credentialed job are not SHA-pinned:\n` +
        problems.join("\n") +
        "\n\nA job holding `id-token`/`packages: write`, a non-default secret, or building an" +
        "\nartifact such a job consumes runs only immutable refs (#2484). Pin each as" +
        "\n  uses: owner/repo@<40-hex sha> # vX.Y.Z" +
        "\nresolving the SHA and the exact release from the same tag lookup. The comment" +
        "\nis what lets the monthly dependency-refresh sweep keep reporting it.",
    );
    return 1;
  }
  console.log(
    `verify:action-pins — OK (${jobs} credentialed job(s) across ${files.length} workflows, every action SHA-pinned)`,
  );
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  process.exit(main());
