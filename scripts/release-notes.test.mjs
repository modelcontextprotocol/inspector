// Tests for scripts/release-notes.mjs (#2550) — the issue-author mapping and
// its exclusions (maintainers by permission, bots, PRs, other repos), the
// paginated closing references, fail-fast on every API error, the note
// layout 2.9.0 shipped with, that nothing is created without an explicit
// --draft / --publish, and the --advisory security section and credits
// (#2766). Run via `npm run test:scripts`.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  REPO,
  THANKS_LEAD_IN,
  THANKS_LEAD_IN_ADVISORIES,
  THANKS_LEAD_IN_BOTH,
  advisoryReporters,
  assembleNotes,
  closingKeywordIssues,
  formatKnownIssues,
  formatThanks,
  main,
  parseAdvisoryArg,
  parseNotesArgs,
  previousStableTag,
  pullNumbersFrom,
  withSecurityFixes,
} from "./release-notes.mjs";

const BASE = [
  "--merge-branch",
  "v2/chore/mm",
  "--ledger-url",
  "https://l.example/x",
];
const SHA = "abc123";
const PULL = (n) => `https://github.com/${REPO}/pull/${n}`;

test("parseNotesArgs defaults to a preview and validates its inputs", () => {
  assert.deepEqual(parseNotesArgs(BASE), {
    mergeBranch: "v2/chore/mm",
    ledgerUrl: "https://l.example/x",
    knownIssues: [],
    advisories: [],
    version: undefined,
    previousTag: undefined,
    mode: "preview",
  });
  assert.equal(parseNotesArgs([...BASE, "--draft"]).mode, "draft");
  assert.equal(parseNotesArgs([...BASE, "--publish"]).mode, "publish");
  assert.deepEqual(
    parseNotesArgs([...BASE, "--known-issue", "a", "--known-issue", "b"])
      .knownIssues,
    ["a", "b"],
  );
  assert.throws(() => parseNotesArgs([]), /both required/);
  assert.throws(
    () => parseNotesArgs(["--merge-branch", "b", "--ledger-url", "ftp://x"]),
    /not an https URL/,
  );
  assert.throws(
    () => parseNotesArgs([...BASE, "--draft", "--publish"]),
    /mutually exclusive/,
  );
  assert.throws(
    () => parseNotesArgs([...BASE, "--version", "v2.9.0"]),
    /--version "v2.9.0" is not a bare x.y.z/,
  );
  assert.throws(
    () => parseNotesArgs([...BASE, "--previous-tag", "2.0.0-rc.1"]),
    /--previous-tag/,
  );
  for (const mode of ["--draft", "--publish"]) {
    assert.throws(
      () => parseNotesArgs([...BASE, "--previous-tag", "2.8.0", mode]),
      /--previous-tag is preview-only/,
    );
  }
  assert.equal(
    parseNotesArgs([...BASE, "--previous-tag", "2.8.0"]).previousTag,
    "2.8.0",
  );
});

test("previousStableTag skips RC, hotfix and v-prefixed tags", () => {
  const tags = [
    "2.8.0",
    "2.9.0",
    "2.10.0-rc.1",
    "2.9.1-hotfix",
    "v2-alpha-1",
    "2.10.0",
    "",
  ];
  assert.equal(previousStableTag(tags, "2.10.0"), "2.9.0");
  assert.equal(previousStableTag(tags, "2.9.0"), "2.8.0");
  assert.equal(previousStableTag(tags, "2.11.0"), "2.10.0");
  assert.throws(() => previousStableTag(tags, "1.0.0"), /no stable/);
});

test("pullNumbersFrom takes this repo's PR links only, deduplicated", () => {
  const generated = [
    `* a by @x in ${PULL(12)}`,
    `* b by @y in ${PULL(3)}`,
    `* @y made their first contribution in ${PULL(3)}`,
    "* c in https://github.com/other/repo/pull/7",
  ].join("\n");
  assert.deepEqual(pullNumbersFrom(generated), [3, 12]);
});

test("closingKeywordIssues reads every closing keyword, never a cross-repo ref", () => {
  const body = [
    "Closes #1",
    "fixes: #2, Resolved #3",
    "close #4 and FIXED #5",
    "Refs #6",
    "Closes other/repo#7",
    "prefixes #8",
  ].join("\n");
  assert.deepEqual(closingKeywordIssues(body), [1, 2, 3, 4, 5]);
  assert.deepEqual(closingKeywordIssues(null), []);
});

test("closingKeywordIssues ignores keywords GitHub ignores: code, quotes, comments", () => {
  const body = [
    "Closes #1",
    "<!-- Closes #2 -->",
    "<!--",
    "Fixes #3",
    "-->",
    "Documents `Closes #4` and ``fixes #5``.",
    "```sh",
    "Closes #6",
    "```",
    "~~~",
    "resolves #7",
    "~~~",
    "> Closes #8",
    "   > fixes #9",
    "Resolves #10",
  ].join("\n");
  assert.deepEqual(closingKeywordIssues(body), [1, 10]);
  // An unterminated fence or comment swallows the rest, as GitHub renders it.
  assert.deepEqual(closingKeywordIssues("Closes #1\n```\nCloses #2"), [1]);
  assert.deepEqual(closingKeywordIssues("Closes #1\n<!-- Closes #2"), [1]);
  // A "fence" with text after it does not close the block; a longer one does.
  assert.deepEqual(
    closingKeywordIssues("```\n```sh\nCloses #2\n`````\nCloses #3"),
    [3],
  );
  assert.deepEqual(
    closingKeywordIssues("~~~\n```\nCloses #2\n~~~ \t\nFixes #3"),
    [3],
  );
});

const issuesOnly = (...issues) => ({ issues, advisories: [] });

test("formatThanks orders by issue count, then name case-insensitively", () => {
  const reporters = new Map([
    ["zed", issuesOnly(5)],
    ["Amy", issuesOnly(9)],
    ["many", issuesOnly(1, 2, 3)],
    ["bob", issuesOnly(4)],
  ]);
  assert.equal(
    formatThanks(reporters),
    [
      "## Thanks for helping us improve",
      "",
      THANKS_LEAD_IN,
      "",
      "* @many (#1, #2, #3)",
      "* @Amy (#9)",
      "* @bob (#4)",
      "* @zed (#5)",
    ].join("\n"),
  );
  assert.equal(formatThanks(new Map()), "");
});

test("formatThanks lists advisories after issues and sorts advisory-only reporters last", () => {
  const reporters = new Map([
    ["0xParth", { issues: [], advisories: ["GHSA-aaaa-bbbb-cccc"] }],
    ["Clone", { issues: [1, 2], advisories: ["GHSA-dddd-eeee-ffff"] }],
    ["amy", issuesOnly(3)],
  ]);
  assert.equal(
    formatThanks(reporters),
    [
      "## Thanks for helping us improve",
      "",
      THANKS_LEAD_IN_BOTH,
      "",
      "* @Clone (#1, #2, GHSA-dddd-eeee-ffff)",
      "* @amy (#3)",
      "* @0xParth (GHSA-aaaa-bbbb-cccc)",
    ].join("\n"),
  );
  // Advisory reporters alone still earn the section, with their own lead-in.
  assert.match(
    formatThanks(
      new Map([
        ["b", { issues: [], advisories: ["GHSA-1111-2222-3333"] }],
        ["A", { issues: [], advisories: ["GHSA-4444-5555-6666"] }],
      ]),
    ),
    new RegExp(
      `${THANKS_LEAD_IN_ADVISORIES}\n\n\\* @A \\(GHSA-4444-5555-6666\\)\n\\* @b `,
    ),
  );
});

test("parseAdvisoryArg splits the id from the markdown and validates the id", () => {
  assert.deepEqual(parseAdvisoryArg("GHSA-q978-78c7-phqw: **Fix** it: now"), {
    id: "GHSA-q978-78c7-phqw",
    description: "**Fix** it: now",
  });
  assert.deepEqual(parseAdvisoryArg("  GHSA-q978-78c7-phqw :x  "), {
    id: "GHSA-q978-78c7-phqw",
    description: "x",
  });
  for (const bad of [
    "GHSA-q978-78c7-phqw",
    "GHSA-q978-78c7-phqw:   ",
    "CVE-2026-1234: x",
    "GHSA-Q978-78C7-PHQW: x",
    ": x",
  ]) {
    assert.throws(() => parseAdvisoryArg(bad), /is not "<GHSA-xxxx-xxxx-xxxx>/);
  }
  assert.deepEqual(
    parseNotesArgs([...BASE, "--advisory", "GHSA-aaaa-bbbb-cccc: one"])
      .advisories,
    [{ id: "GHSA-aaaa-bbbb-cccc", description: "one" }],
  );
  assert.throws(
    () =>
      parseNotesArgs([
        ...BASE,
        "--advisory",
        "GHSA-aaaa-bbbb-cccc: one",
        "--advisory",
        "GHSA-aaaa-bbbb-cccc: two",
      ]),
    /--advisory GHSA-aaaa-bbbb-cccc is given twice/,
  );
});

test("advisoryReporters takes reporting users in every credit state", () => {
  const credit = (login, type, state, userType = "User") => ({
    user: { login, type: userType },
    type,
    state,
  });
  assert.deepEqual(
    advisoryReporters({
      credits_detailed: [
        credit("a", "reporter", "accepted"),
        credit("b", "reporter", "pending"),
        credit("c", "finder", "declined"),
        credit("d", "remediation_developer", "accepted"),
        credit("e", "reporter", "accepted", "Bot"),
        { type: "reporter", state: "accepted", user: null },
      ],
    }),
    ["a", "b", "c"],
  );
  assert.deepEqual(advisoryReporters({}), []);
});

test("withSecurityFixes puts the fixes first and the PRs under Other changes", () => {
  const advisories = [
    { id: "GHSA-aaaa-bbbb-cccc", description: "**A** fixed" },
    { id: "GHSA-dddd-eeee-ffff", description: "**D** fixed" },
  ];
  const link = (id) => `https://github.com/${REPO}/security/advisories/${id}`;
  assert.equal(
    withSecurityFixes(
      "## What's Changed\n* pr\n\n**Full Changelog**: c",
      advisories,
    ),
    [
      "## What's Changed",
      "",
      "### Security fixes",
      "",
      `* **A** fixed ([GHSA-aaaa-bbbb-cccc](${link("GHSA-aaaa-bbbb-cccc")}))`,
      `* **D** fixed ([GHSA-dddd-eeee-ffff](${link("GHSA-dddd-eeee-ffff")}))`,
      "",
      "### Other changes",
      "",
      "* pr",
      "",
      "**Full Changelog**: c",
    ].join("\n"),
  );
  // No PRs means no What's Changed heading to insert under: add one.
  assert.equal(
    withSecurityFixes("**Full Changelog**: c", advisories.slice(0, 1)),
    `## What's Changed\n\n### Security fixes\n\n* **A** fixed ([GHSA-aaaa-bbbb-cccc](${link("GHSA-aaaa-bbbb-cccc")}))\n\n**Full Changelog**: c`,
  );
  assert.equal(withSecurityFixes("G", []), "G");
});

test("formatKnownIssues pluralizes and is omitted when empty", () => {
  assert.equal(formatKnownIssues([]), "");
  assert.equal(formatKnownIssues(["one"]), "## Known issue\n\none");
  assert.equal(formatKnownIssues(["a", "b"]), "## Known issues\n\na\n\nb");
});

test("assembleNotes lays the parts out as 2.9.0 shipped them", () => {
  const notes = assembleNotes({
    generated: "## What's Changed\n* x\n\n**Full Changelog**: c\n",
    mergeBranch: "mm",
    ledgerUrl: "https://l",
    knownIssues: ["K"],
    thanks: "## Thanks for helping us improve\n\nT",
  });
  assert.equal(
    notes,
    [
      "## What's Changed",
      "* x",
      "",
      "**Full Changelog**: c",
      "**Smoke test ledger for milestone branch**: [mm](https://l)",
      "",
      "## Known issue",
      "",
      "K",
      "",
      "## Thanks for helping us improve",
      "",
      "T",
      "",
    ].join("\n"),
  );
  assert.equal(
    assembleNotes({
      generated: "G",
      mergeBranch: "mm",
      ledgerUrl: "https://l",
      knownIssues: [],
      thanks: "",
    }),
    "G\n**Smoke test ledger for milestone branch**: [mm](https://l)\n",
  );
});

// A fake `gh`/`git` over a small repo model. `failOn` makes the first call
// whose joined argv includes it fail, the way a rate limit or a 404 would.
function world({
  mainVersion = "2.10.0",
  tags = ["2.8.0", "2.9.0", "2.10.0-rc.1"],
  pulls = {},
  issues = {},
  perms = {},
  advisories = {},
  failOn,
} = {}) {
  const calls = [];
  const generated = [
    "## What's Changed",
    ...Object.keys(pulls).map((n) => `* change by @dev in ${PULL(n)}`),
    "",
    "**Full Changelog**: https://example/compare",
  ].join("\n");
  const ok = (stdout) => ({ status: 0, stdout, stderr: "" });
  const spawn = (cmd, args, opts) => {
    calls.push({ cmd, args, input: opts?.input });
    const joined = args.join(" ");
    if (failOn && joined.includes(failOn)) {
      return { status: 1, stdout: "", stderr: "API rate limit exceeded" };
    }
    if (cmd === "git") {
      if (joined === "rev-parse FETCH_HEAD") return ok(`${SHA}\n`);
      if (joined === `show ${SHA}:package.json`)
        return ok(JSON.stringify({ version: mainVersion }));
      if (joined === "tag -l") return ok(tags.join("\n"));
      return ok("");
    }
    assert.equal(cmd, "gh");
    if (args[1].endsWith("/releases/generate-notes")) return ok(generated);
    if (args[0] === "release") return ok("https://github.com/r/releases/1");
    const advisory = args[1].match(/\/security-advisories\/(.+)$/);
    if (advisory) {
      const found = advisories[advisory[1]];
      if (!found) return { status: 1, stdout: "", stderr: "HTTP 404" };
      return ok(JSON.stringify({ ghsa_id: advisory[1], ...found }));
    }
    if (args[1] === "graphql") {
      const vars = Object.fromEntries(
        args
          .filter((_, i) => args[i - 1] === "-F" || args[i - 1] === "-f")
          .map((kv) => kv.split(/=(.*)/s).slice(0, 2)),
      );
      const n = Number(vars.n);
      if (vars.query.includes("closingIssuesReferences")) {
        const pr = pulls[n];
        const pages = pr.pages ?? [pr.closing ?? []];
        const index = vars.after ? Number(vars.after) : 0;
        const hasNextPage = index + 1 < pages.length;
        return ok(
          JSON.stringify({
            data: {
              repository: {
                pullRequest: {
                  body: pr.body ?? "",
                  closingIssuesReferences: {
                    pageInfo: {
                      hasNextPage,
                      endCursor: hasNextPage ? String(index + 1) : null,
                    },
                    nodes: pages[index].map((ref) =>
                      typeof ref === "number"
                        ? { number: ref, repository: { nameWithOwner: REPO } }
                        : ref,
                    ),
                  },
                },
              },
            },
          }),
        );
      }
      return ok(
        JSON.stringify({
          data: { repository: { issueOrPullRequest: issues[n] ?? null } },
        }),
      );
    }
    const login = args[1].match(/collaborators\/([^/]+)\/permission/)[1];
    return ok(perms[login]);
  };
  spawn.calls = calls;
  return spawn;
}

const user = (login) => ({
  __typename: "Issue",
  author: { login, __typename: "User" },
});

function quiet(t) {
  const out = [];
  t.mock.method(console, "error", () => {});
  t.mock.method(process.stdout, "write", (chunk) => {
    out.push(chunk);
    return true;
  });
  return out;
}

test("credits community reporters only — no maintainers, bots, PRs or other repos", (t) => {
  const out = quiet(t);
  const spawn = world({
    pulls: {
      10: { body: "Closes #1\nFixes #2", closing: [3] },
      11: {
        body: "Resolves #4, closes #5, closes #6, closes #1",
        closing: [{ number: 7, repository: { nameWithOwner: "other/repo" } }],
      },
    },
    issues: {
      1: user("reporter"),
      2: user("maint"),
      3: user("reporter"),
      4: { __typename: "Issue", author: { login: "bot", __typename: "Bot" } },
      5: { __typename: "PullRequest" },
      6: { __typename: "Issue", author: null },
    },
    perms: { reporter: "read", maint: "write" },
  });
  const notes = main(BASE, spawn);
  assert.match(notes, /\* @reporter \(#1, #3\)\n$/);
  assert.doesNotMatch(notes, /@maint|@bot|#5|#7/);
  assert.equal(out.join(""), notes);
  // Each person's permission is looked up once, however many issues they filed.
  const permissionCalls = spawn.calls.filter((c) =>
    c.args[1]?.includes("/permission"),
  );
  assert.deepEqual(
    permissionCalls.map((c) => c.args[1].split("/")[4]),
    ["reporter", "maint"],
  );
  // The preview creates nothing.
  assert.equal(
    spawn.calls.some((c) => c.args[0] === "release"),
    false,
  );
});

test("generate-notes is asked for the previous STABLE tag to main", (t) => {
  quiet(t);
  const spawn = world();
  main(BASE, spawn);
  const call = spawn.calls.find((c) =>
    c.args[1]?.endsWith("/releases/generate-notes"),
  );
  assert.deepEqual(call.args.slice(2), [
    "-f",
    "tag_name=2.10.0",
    "-f",
    "target_commitish=main",
    "-f",
    "previous_tag_name=2.9.0",
    "--jq",
    ".body",
  ]);
  // The tags fetch precedes the main fetch, so FETCH_HEAD is main.
  const fetches = spawn.calls.filter((c) => c.args[0] === "fetch");
  assert.deepEqual(
    fetches.map((c) => c.args.join(" ")),
    ["fetch origin --tags", "fetch origin main"],
  );
});

test("an explicit --version/--previous-tag regenerates an older release's notes", (t) => {
  quiet(t);
  const spawn = world({ mainVersion: "2.10.0" });
  main([...BASE, "--version", "2.8.0", "--previous-tag", "2.7.0"], spawn);
  const call = spawn.calls.find((c) =>
    c.args[1]?.endsWith("/releases/generate-notes"),
  );
  assert.ok(call.args.includes("tag_name=2.8.0"));
  assert.ok(call.args.includes("previous_tag_name=2.7.0"));
  assert.equal(
    spawn.calls.some((c) => c.args.join(" ") === "tag -l"),
    false,
  );
});

test("the Thanks section is omitted when no community reporter remains", (t) => {
  quiet(t);
  const notes = main(
    BASE,
    world({
      pulls: { 10: { body: "Closes #1" } },
      issues: { 1: user("maint") },
      perms: { maint: "admin" },
    }),
  );
  assert.doesNotMatch(notes, /Thanks/);
});

test("closing references are followed across every page", (t) => {
  quiet(t);
  const spawn = world({
    pulls: { 10: { pages: [[1], [2], [3]] } },
    issues: { 1: user("a"), 2: user("b"), 3: user("c") },
    perms: { a: "read", b: "triage", c: "none" },
  });
  const notes = main(BASE, spawn);
  assert.match(notes, /@a \(#1\)\n\* @b \(#2\)\n\* @c \(#3\)/);
  const cursors = spawn.calls
    .filter((c) => c.args.some((a) => a.includes("closingIssuesReferences")))
    .map((c) => c.args.find((a) => a.startsWith("after=")) ?? null);
  assert.deepEqual(cursors, [null, "after=1", "after=2"]);
});

for (const [what, failOn] of [
  ["a permission lookup", "/permission"],
  ["a closing-references lookup", "closingIssuesReferences"],
  ["an issue-author lookup", "issueOrPullRequest"],
  ["generate-notes", "generate-notes"],
  ["the fetch", "fetch origin main"],
]) {
  test(`a failed ${what} aborts — never a partial Thanks list`, (t) => {
    quiet(t);
    const spawn = world({
      pulls: { 10: { body: "Closes #1" } },
      issues: { 1: user("maybe-maint") },
      perms: { "maybe-maint": "read" },
      failOn,
    });
    assert.throws(
      () => main([...BASE, "--publish"], spawn),
      /rate limit exceeded/,
    );
    assert.equal(
      spawn.calls.some((c) => c.args[0] === "release"),
      false,
    );
  });
}

const reporterCredit = (login, state = "accepted") => ({
  user: { login, type: "User" },
  type: "reporter",
  state,
});
const ADVISORY = "GHSA-aaaa-bbbb-cccc";
const ADVISORY_ARGS = ["--advisory", `${ADVISORY}: **Fixed** the thing`];
const patched = (...versions) => versions.map((v) => ({ patched_versions: v }));

test("--advisory lists the fix and merges its reporters with issue reporters", (t) => {
  quiet(t);
  const spawn = world({
    pulls: { 10: { body: "Closes #1" } },
    issues: { 1: user("both") },
    perms: { both: "read", solo: "none", maint: "admin" },
    advisories: {
      [ADVISORY]: {
        state: "published",
        vulnerabilities: patched("1.0.3", ">= 2.10.0"),
        credits_detailed: [
          reporterCredit("both"),
          reporterCredit("solo", "pending"),
          reporterCredit("maint"),
        ],
      },
    },
  });
  const notes = main([...BASE, ...ADVISORY_ARGS], spawn);
  assert.match(
    notes,
    /### Security fixes\n\n\* \*\*Fixed\*\* the thing \(\[GHSA-aaaa-bbbb-cccc\]\(.+\/security\/advisories\/GHSA-aaaa-bbbb-cccc\)\)\n\n### Other changes\n\n\* change/,
  );
  assert.match(
    notes,
    /\* @both \(#1, GHSA-aaaa-bbbb-cccc\)\n\* @solo \(GHSA-aaaa-bbbb-cccc\)\n$/,
  );
  assert.doesNotMatch(notes, /@maint/);
  // `both` is looked up once across the issue and the advisory.
  const permissionCalls = spawn.calls.filter((c) =>
    c.args[1]?.includes("/permission"),
  );
  assert.deepEqual(
    permissionCalls.map((c) => c.args[1].split("/")[4]),
    ["both", "solo", "maint"],
  );
});

test("an advisory that does not list this release as patched aborts", (t) => {
  quiet(t);
  for (const vulnerabilities of [patched("2.9.0", "2.10.1"), [], undefined]) {
    const spawn = world({
      advisories: { [ADVISORY]: { state: "published", vulnerabilities } },
    });
    assert.throws(
      () => main([...BASE, ...ADVISORY_ARGS, "--draft"], spawn),
      new RegExp(`${ADVISORY} does not list 2\\.10\\.0 as patched`),
    );
    assert.equal(
      spawn.calls.some((c) => c.args[0] === "release"),
      false,
    );
  }
});

test("a draft advisory warns but does not fail", (t) => {
  quiet(t);
  const spawn = world({
    advisories: {
      [ADVISORY]: { state: "draft", vulnerabilities: patched("2.10.0") },
    },
  });
  const notes = main([...BASE, ...ADVISORY_ARGS], spawn);
  assert.match(notes, /### Security fixes/);
  assert.ok(
    console.error.mock.calls.some((c) =>
      /warning: GHSA-aaaa-bbbb-cccc is still a draft/.test(c.arguments[0]),
    ),
  );
});

test("a failed advisory lookup aborts before any release is created", (t) => {
  quiet(t);
  const spawn = world();
  assert.throws(
    () => main([...BASE, ...ADVISORY_ARGS, "--publish"], spawn),
    /security-advisories\/GHSA-aaaa-bbbb-cccc failed: HTTP 404/,
  );
  assert.equal(
    spawn.calls.some((c) => c.args[0] === "release"),
    false,
  );
});

test("an unknown permission value aborts rather than reading as community", (t) => {
  quiet(t);
  assert.throws(
    () =>
      main(
        BASE,
        world({
          pulls: { 10: { body: "Closes #1" } },
          issues: { 1: user("who") },
          perms: { who: "" },
        }),
      ),
    /unexpected permission "" for @who/,
  );
});

test("GraphQL errors and missing nodes abort", (t) => {
  quiet(t);
  const missing = world({ pulls: { 10: { body: "Closes #99" } } });
  assert.throws(() => main(BASE, missing), /#99 not found/);

  const errors = world({ pulls: { 10: {} } });
  const inner = errors;
  const spawn = (cmd, args, opts) =>
    args[1] === "graphql"
      ? { status: 0, stdout: '{"errors":[{"message":"boom"}]}', stderr: "" }
      : inner(cmd, args, opts);
  assert.throws(() => main(BASE, spawn), /boom/);

  const noPull = (cmd, args, opts) =>
    args[1] === "graphql"
      ? {
          status: 0,
          stdout: '{"data":{"repository":{"pullRequest":null}}}',
          stderr: "",
        }
      : inner(cmd, args, opts);
  assert.throws(() => main(BASE, noPull), /PR #10 not found/);
});

test("a spawn error is rethrown", () => {
  const boom = new Error("ENOENT");
  assert.throws(
    () => main(BASE, () => ({ error: boom })),
    (e) => e === boom,
  );
});

test("--draft creates a draft at main under the bare tag, notes on stdin", (t) => {
  quiet(t);
  const spawn = world();
  const notes = main([...BASE, "--draft"], spawn);
  const create = spawn.calls.find((c) => c.args[0] === "release");
  assert.deepEqual(create.args, [
    "release",
    "create",
    "2.10.0",
    "--repo",
    REPO,
    "--target",
    "main",
    "--title",
    "2.10.0",
    "--notes-file",
    "-",
    "--draft",
  ]);
  assert.equal(create.input, notes);
});

test("--publish publishes as latest", (t) => {
  quiet(t);
  const spawn = world();
  main([...BASE, "--publish"], spawn);
  const create = spawn.calls.find((c) => c.args[0] === "release");
  assert.equal(create.args.at(-1), "--latest");
  assert.equal(create.args.includes("--draft"), false);
});

test("creating a version other than origin/main's is refused", (t) => {
  quiet(t);
  const spawn = world({ mainVersion: "2.10.0" });
  assert.throws(
    () => main([...BASE, "--version", "2.9.0", "--draft"], spawn),
    /--draft creates 2\.9\.0 on main, but origin\/main is 2\.10\.0/,
  );
  assert.equal(
    spawn.calls.some((c) => c.cmd === "gh"),
    false,
  );
});
