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
//   2. is handed any secret other than `GITHUB_TOKEN`; or
//   3. uploads an artifact that a job from (1) or (2) downloads and `needs` —
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

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { isMap, isScalar, isSeq, parseDocument } from "yaml";
import { SHA_REF } from "./dependency-refresh.mjs";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

const NON_DEFAULT_SECRET = /\bsecrets\.(?!GITHUB_TOKEN\b)[A-Za-z_]\w*/;
const EXACT_VERSION = /^v\d+\.\d+\.\d+$/;

/** Does this `permissions:` value let the job mint a token or push a package? */
function mints(permissions) {
  if (permissions === "write-all") return true;
  if (permissions === null || typeof permissions !== "object") return false;
  return (
    permissions["id-token"] === "write" || permissions.packages === "write"
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
    if (mints(permissions) || NON_DEFAULT_SECRET.test(JSON.stringify(job)))
      held.add(name);
  }
  for (const [name, job] of jobs) {
    if (!held.has(name) || !stepsUsing(job, "actions/download-artifact@"))
      continue;
    for (const producer of needsOf(job)) {
      const upstream = workflow.jobs[producer];
      if (upstream && stepsUsing(upstream, "actions/upload-artifact@"))
        held.add(producer);
    }
  }
  return held;
}

/**
 * Every `uses:` in a credentialed job that is not a 40-hex SHA followed by a
 * `# vX.Y.Z` comment. Local (`./…`) actions are repository code, not a ref.
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
    if (!held.has(name) || !isMap(value)) continue;
    const steps = value.get("steps", true);
    if (!isSeq(steps)) continue;
    for (const step of steps.items) {
      const node = isMap(step) ? step.get("uses", true) : undefined;
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
