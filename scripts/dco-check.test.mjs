// Tests for scripts/dco-check.mjs (#2566) — the signoff rule one case per
// clause (identity match, the two exemptions, the failure report), plus a
// run of `main()` against a real throwaway git repository, since the log
// format and its parser only mean anything together. Run via
// `npm run test:scripts`.

import { after, test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  classify,
  exemption,
  failureReason,
  main,
  parseDcoArgs,
  signoffs,
} from "./dco-check.mjs";

const ADA = { name: "Ada Lovelace", email: "ada@example.com" };
const BOB = { name: "Bob Builder", email: "bob@example.com" };

function commit({
  author = ADA,
  committer = author,
  parents = ["p1"],
  message = "subject\n",
} = {}) {
  return { sha: "a".repeat(40), parents, author, committer, message };
}

const signed = (who, subject = "subject") =>
  `${subject}\n\nbody\n\nSigned-off-by: ${who.name} <${who.email}>\n`;

test("parseDcoArgs requires --base and defaults --head to HEAD", () => {
  assert.deepEqual(parseDcoArgs(["--base", "origin/v2/main"]), {
    base: "origin/v2/main",
    head: "HEAD",
  });
  assert.deepEqual(parseDcoArgs(["--base", "a", "--head", "b"]), {
    base: "a",
    head: "b",
  });
  assert.throws(() => parseDcoArgs([]), /--base/);
});

test("signoffs reads every trailer, tolerating case and spacing", () => {
  assert.deepEqual(
    signoffs(
      "x\n\nsigned-off-by:   Ada Lovelace   <ada@example.com>  \nSigned-off-by: Bob Builder <bob@example.com>\n",
    ),
    [ADA, BOB],
  );
  assert.deepEqual(signoffs("x\n\nSigned-off-by: no email here\n"), []);
  // Mid-line text is not a trailer.
  assert.deepEqual(
    signoffs("mentions Signed-off-by: Ada <ada@example.com> inline\n"),
    [],
  );
});

test("a signoff matching the author passes", () => {
  assert.equal(failureReason(commit({ message: signed(ADA) })), null);
});

test("a signoff matching the committer passes", () => {
  assert.equal(
    failureReason(
      commit({ author: BOB, committer: ADA, message: signed(ADA) }),
    ),
    null,
  );
});

test("matching ignores case and surrounding whitespace", () => {
  assert.equal(
    failureReason(
      commit({
        message: signed({ name: "ada lovelace", email: "ADA@Example.com" }),
      }),
    ),
    null,
  );
});

test("a missing trailer fails", () => {
  assert.equal(failureReason(commit()), "no Signed-off-by trailer");
});

test("a trailer for someone else fails and names every identity", () => {
  const reason = failureReason(commit({ message: signed(BOB) }));
  assert.match(reason, /Bob Builder <bob@example.com>/);
  assert.match(reason, /author \(Ada Lovelace <ada@example.com>\)/);
});

test("name from one identity and email from the other is not a match", () => {
  const reason = failureReason(
    commit({
      author: ADA,
      committer: BOB,
      message: signed({ name: ADA.name, email: BOB.email }),
    }),
  );
  assert.notEqual(reason, null);
});

test("exemption: merge commits and noreply bot authors only", () => {
  assert.equal(exemption(commit({ parents: ["p1", "p2"] })), "merge");
  assert.equal(
    exemption(
      commit({
        author: {
          name: "github-actions[bot]",
          email: "41898282+github-actions[bot]@users.noreply.github.com",
        },
      }),
    ),
    "bot",
  );
  // A noreply address that is not a bot's is not exempt.
  assert.equal(
    exemption(
      commit({
        author: { name: "Ada", email: "123+ada@users.noreply.github.com" },
      }),
    ),
    null,
  );
  // A root commit (no parents) is checked like any other.
  assert.equal(exemption(commit({ parents: [] })), null);
});

test("classify: one unsigned commit fails the range — no partial credit", () => {
  const result = classify([
    commit({ message: signed(ADA) }),
    commit({ message: "unsigned\n" }),
    commit({ parents: ["p1", "p2"] }),
  ]);
  assert.equal(result.checked, 2);
  assert.equal(result.exempt, 1);
  assert.equal(result.failures.length, 1);
  assert.equal(result.failures[0].reason, "no Signed-off-by trailer");
});

// --- main() against a real repository -------------------------------------

const repos = [];
after(() => {
  for (const dir of repos) rmSync(dir, { recursive: true, force: true });
});

function git(cwd, args, env = {}) {
  const result = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    env: { ...process.env, ...env },
  });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

/** A repo whose `base` branch holds one unsigned commit (outside any range). */
function makeRepo() {
  const dir = mkdtempSync(path.join(tmpdir(), "dco-check-"));
  repos.push(dir);
  git(dir, ["init", "-q", "-b", "base"]);
  git(dir, ["config", "user.name", ADA.name]);
  git(dir, ["config", "user.email", ADA.email]);
  git(dir, ["config", "commit.gpgsign", "false"]);
  git(dir, ["commit", "-q", "--allow-empty", "-m", "base, unsigned"]);
  git(dir, ["checkout", "-q", "-b", "feature"]);
  return dir;
}

const spawnIn = (cwd) => (cmd, args, opts) =>
  spawnSync(cmd, args, { ...opts, cwd });

function runMain(dir) {
  const out = [];
  const err = [];
  const log = console.log;
  const error = console.error;
  console.log = (line) => out.push(line);
  console.error = (line) => err.push(line);
  try {
    const code = main(["--base", "base"], spawnIn(dir));
    return { code, out: out.join("\n"), err: err.join("\n") };
  } finally {
    console.log = log;
    console.error = error;
  }
}

test("main passes a range of signed commits and ignores the base's history", () => {
  const dir = makeRepo();
  git(dir, ["commit", "-q", "-s", "--allow-empty", "-m", "one"]);
  git(dir, ["commit", "-q", "-s", "--allow-empty", "-m", "two\n\nbody"]);
  const { code, out } = runMain(dir);
  assert.equal(code, 0);
  assert.match(out, /dco: OK — 2 commit\(s\) signed off in base\.\.HEAD/);
});

test("main fails on one unsigned commit and prints the repair", () => {
  const dir = makeRepo();
  git(dir, ["commit", "-q", "-s", "--allow-empty", "-m", "signed"]);
  git(dir, ["commit", "-q", "--allow-empty", "-m", "forgot the signoff"]);
  const { code, err } = runMain(dir);
  assert.equal(code, 1);
  assert.match(err, /1 of 2 commit\(s\)/);
  assert.match(err, /forgot the signoff\n {4}no Signed-off-by trailer/);
  assert.match(err, /git rebase --rebase-merges --signoff base/);
  assert.match(err, /git push --force-with-lease/);
});

test("main exempts a merge commit and a bot-authored commit", () => {
  const dir = makeRepo();
  git(dir, ["commit", "-q", "-s", "--allow-empty", "-m", "signed"]);
  git(dir, ["checkout", "-q", "-b", "side", "base"]);
  git(dir, ["commit", "-q", "-s", "--allow-empty", "-m", "side, signed"]);
  git(dir, ["checkout", "-q", "feature"]);
  git(dir, ["merge", "-q", "--no-ff", "--no-edit", "side"]);
  git(dir, ["commit", "-q", "--allow-empty", "-m", "bot, unsigned"], {
    GIT_AUTHOR_NAME: "github-actions[bot]",
    GIT_AUTHOR_EMAIL: "41898282+github-actions[bot]@users.noreply.github.com",
  });
  const { code, out } = runMain(dir);
  assert.equal(code, 0);
  assert.match(
    out,
    /2 commit\(s\) signed off .* \(2 merge\/bot commit\(s\) exempt\)/,
  );
});

test("main parses a message containing the old separators intact", () => {
  const dir = makeRepo();
  git(dir, [
    "commit",
    "-q",
    "-s",
    "--allow-empty",
    "-m",
    "odd \x1e record \x1f field bytes\n\nbody \x1e\x1f too",
  ]);
  git(dir, ["commit", "-q", "-s", "--allow-empty", "-m", "next"]);
  const { code, out } = runMain(dir);
  assert.equal(code, 0);
  assert.match(out, /2 commit\(s\) signed off/);
});

test("main throws on a revision git cannot resolve", () => {
  const dir = makeRepo();
  assert.throws(
    () => main(["--base", "no-such-ref"], spawnIn(dir)),
    /git log no-such-ref\.\.HEAD failed/,
  );
});
