#!/usr/bin/env node
// DCO signoff check (#2566) — `npm run dco:check -- --base <rev> [--head <rev>]`.
//
// Replaces the probot DCO app, which was suspended and whose check simply
// stopped appearing after #1981 (2026-08-12). Nothing failed when it vanished,
// because it was never a required check — so this is a check the repo owns,
// run by `.github/workflows/dco.yml` on every v2 PR — any `v2/**` base, so
// stacked PRs too — and, as a backstop, on every push that lands on `v2/main`
// (#2616; v1 and milestone PRs into `main` are out of its scope). The PR job
// is meant to be made REQUIRED so a future outage blocks merges instead of
// passing silently.
//
// The rule is the app's: every commit in `base..head` must carry a
// `Signed-off-by: Name <email>` line whose name AND email match the commit's
// author or its committer (one identity — a name from one and an email from
// the other is not a match). Names and emails compare case-insensitively,
// after trimming. One relaxation: for a commit GitHub itself committed (a
// squash merge), an author EMAIL match is enough — see `webFlowAuthorMatch`.
// The app's two exemptions are kept:
//
//   - merge commits (more than one parent), which certify nothing new; and
//   - bot-authored commits — an author email of the GitHub noreply shape
//     `<id>+<login>[bot]@users.noreply.github.com`.
//
// ⚠️ The bot exemption reads an email any committer can set, so it is not a
// security control — but neither is the trailer: `Signed-off-by:` is
// self-asserted text either way. The check exists to catch a FORGOTTEN
// signoff, which is the failure that actually happens, not a forged one.
//
// The range is read from local git, not the API, so the workflow needs only
// `contents: read` and a full-history checkout, and the same command works
// before pushing. `base..head` is exactly the commit list GitHub shows on a
// PR: everything reachable from head that the base branch does not already
// contain.

import { spawnSync } from "node:child_process";
import { parseArgs } from "node:util";

// Records are NUL-separated (`git log -z`): `git commit` refuses a NUL in a
// message, so no body can split a record. Fields use \x1f, and the message
// is the LAST field and is re-joined, so a body that happens to contain \x1f
// still parses whole.
const FS = "\x1f";
const RS = "\0";
const LOG_FORMAT = ["%H", "%P", "%an", "%ae", "%cn", "%ce", "%B"].join("%x1f");

const SIGNOFF = /^\s*Signed-off-by:\s*(.+?)\s*<([^<>]+)>\s*$/gim;
const BOT_EMAIL = /^\d+\+[^@\s]+\[bot\]@users\.noreply\.github\.com$/i;

export function parseDcoArgs(argv) {
  const { values } = parseArgs({
    args: argv,
    options: { base: { type: "string" }, head: { type: "string" } },
  });
  if (!values.base) {
    throw new Error("--base <rev> is required (e.g. origin/v2/main)");
  }
  return { base: values.base, head: values.head ?? "HEAD" };
}

/** Split `git log -z --format=<LOG_FORMAT>` output into commit records. */
export function parseLog(stdout) {
  return stdout
    .split(RS)
    .filter((record) => record.trim() !== "")
    .map((record) => {
      const [sha, parents, an, ae, cn, ce, ...body] = record.split(FS);
      return {
        sha,
        parents: parents.split(" ").filter(Boolean),
        author: { name: an, email: ae },
        committer: { name: cn, email: ce },
        message: body.join(FS),
      };
    });
}

/** Every `Signed-off-by:` identity in a commit message. */
export function signoffs(message) {
  return [...message.matchAll(SIGNOFF)].map(([, name, email]) => ({
    name,
    email,
  }));
}

const norm = (value) => value.trim().toLowerCase();
const sameIdentity = (a, b) =>
  norm(a.name) === norm(b.name) && norm(a.email) === norm(b.email);

// The identity GitHub commits as when it creates a commit itself — a squash
// merge, a rebase merge, a web edit.
const GITHUB_WEB_FLOW_EMAIL = "noreply@github.com";

/**
 * GitHub writes a squash-merge commit's author NAME from the merger's GitHub
 * profile ("Cliff Hall"), while the squashed trailers carry their git
 * `user.name` ("cliffhall") — same person, same email, different name. Four
 * such squash merges sit on `v2/main` (#2213, #2322, #2379, #2383), and the
 * push job (#2616) sees every one of them. So for a commit GitHub itself
 * committed, an author EMAIL match is accepted. A signoff is still required,
 * and every other commit still needs name and email from one identity.
 */
const webFlowAuthorMatch = (sig, commit) =>
  norm(commit.committer.email) === GITHUB_WEB_FLOW_EMAIL &&
  norm(sig.email) === norm(commit.author.email);

/**
 * Why this commit fails the check, or `null` when it passes or is exempt.
 * Exempt commits return `null` as well — they are reported separately by
 * `classify`.
 */
export function failureReason(commit) {
  const found = signoffs(commit.message);
  if (found.length === 0) return "no Signed-off-by trailer";
  const matches = found.some(
    (sig) =>
      sameIdentity(sig, commit.author) ||
      sameIdentity(sig, commit.committer) ||
      webFlowAuthorMatch(sig, commit),
  );
  if (matches) return null;
  const listed = found.map((sig) => `${sig.name} <${sig.email}>`).join(", ");
  return (
    `Signed-off-by (${listed}) matches neither the author ` +
    `(${commit.author.name} <${commit.author.email}>) nor the committer ` +
    `(${commit.committer.name} <${commit.committer.email}>)`
  );
}

/** `"merge"`, `"bot"`, or `null` when the commit must be signed off. */
export function exemption(commit) {
  if (commit.parents.length > 1) return "merge";
  if (BOT_EMAIL.test(commit.author.email.trim())) return "bot";
  return null;
}

/** Partition commits into checked/exempt and collect the failures. */
export function classify(commits) {
  const failures = [];
  let exempt = 0;
  for (const commit of commits) {
    if (exemption(commit)) {
      exempt++;
      continue;
    }
    const reason = failureReason(commit);
    if (reason) failures.push({ commit, reason });
  }
  return { checked: commits.length - exempt, exempt, failures };
}

function readRange(spawn, base, head) {
  const result = spawn(
    "git",
    ["log", "-z", `--format=${LOG_FORMAT}`, `${base}..${head}`],
    { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(
      `git log ${base}..${head} failed: ${(result.stderr ?? "").trim()}`,
    );
  }
  return parseLog(result.stdout);
}

/** Returns the process exit code: 0 when every commit passes, 1 otherwise. */
export function main(argv = process.argv.slice(2), spawn = spawnSync) {
  const { base, head } = parseDcoArgs(argv);
  const commits = readRange(spawn, base, head);
  const { checked, exempt, failures } = classify(commits);

  if (failures.length === 0) {
    console.log(
      `dco: OK — ${checked} commit(s) signed off in ${base}..${head}` +
        (exempt ? ` (${exempt} merge/bot commit(s) exempt)` : ""),
    );
    return 0;
  }

  console.error(
    `dco: FAIL — ${failures.length} of ${checked} commit(s) in ${base}..${head} lack a matching signoff:\n`,
  );
  for (const { commit, reason } of failures) {
    const subject = commit.message.split("\n", 1)[0];
    console.error(`  ${commit.sha.slice(0, 12)} ${subject}\n    ${reason}`);
  }
  console.error(
    // `--rebase-merges` keeps any merge commit (and a conflict resolution
    // that lives only in it) instead of flattening the branch; the merges
    // themselves stay unsigned, which is fine since they are exempt.
    `\nRepair (sole author, nobody building on the branch):\n` +
      `  git rebase --rebase-merges --signoff ${base}\n` +
      `  git push --force-with-lease\n` +
      `Prevent it next time with \`git commit -s\`.`,
  );
  return 1;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    process.exitCode = main();
  } catch (error) {
    console.error(`dco: ${error.message}`);
    process.exitCode = 2;
  }
}
