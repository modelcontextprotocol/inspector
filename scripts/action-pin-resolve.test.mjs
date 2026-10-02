// Tests for scripts/action-pin-resolve.mjs (#2558) — the SHA and the exact
// version come from the SAME tag listing (the offline guard cannot check they
// agree), numeric semver selection, and the no-exact-tag refusal. Run via
// `npm run test:scripts`.

import { test } from "node:test";
import assert from "node:assert/strict";
import { exactVersionFor, main, parsePinArgs } from "./action-pin-resolve.mjs";

test("parsePinArgs validates the repo slug and the tag shape", () => {
  assert.deepEqual(
    parsePinArgs(["--repo", "actions/checkout", "--tag", "v5"]),
    {
      repo: "actions/checkout",
      tag: "v5",
      major: 5,
    },
  );
  assert.equal(parsePinArgs(["--repo", "a/b", "--tag", "v5.1.2"]).major, 5);
  assert.throws(
    () => parsePinArgs(["--repo", "checkout", "--tag", "v5"]),
    /owner\/name/,
  );
  assert.throws(() => parsePinArgs(["--repo", "a/b"]), /--tag/);
  assert.throws(
    () => parsePinArgs(["--repo", "a/b", "--tag", "main"]),
    /vN moving tag/,
  );
});

const SHA = "deadbeef";
const tag = (name, sha = SHA) => ({ name, commit: { sha } });

test("exactVersionFor picks the highest exact tag on the SHA, numerically", () => {
  // v5.10.0 > v5.9.1 numerically though not lexically.
  assert.equal(
    exactVersionFor(
      [tag("v5"), tag("v5.9.1"), tag("v5.10.0"), tag("v4.9.9", "other")],
      SHA,
      5,
    ),
    "v5.10.0",
  );
  assert.equal(exactVersionFor([tag("v5")], SHA, 5), undefined);
});

test("exactVersionFor stays within the requested major", () => {
  // One commit can carry exact tags from several majors (a lagging line
  // re-released from the same tree) — the comment must name the line asked
  // for, not the numerically highest.
  const tags = [tag("v5.2.0"), tag("v6.0.0")];
  assert.equal(exactVersionFor(tags, SHA, 5), "v5.2.0");
  assert.equal(exactVersionFor(tags, SHA, 6), "v6.0.0");
  assert.equal(exactVersionFor(tags, SHA, 4), undefined);
});

function spawnScript({ tags }) {
  return (cmd, args) => {
    const joined = args.join(" ");
    let payload;
    if (joined.includes("/commits/")) {
      payload = { sha: SHA };
    } else if (joined.includes("/tags")) {
      payload = [tags];
    } else {
      assert.fail(`unexpected gh call: ${joined}`);
    }
    return { status: 0, stdout: JSON.stringify(payload), stderr: "" };
  };
}

test("main prints the uses: line with SHA and matching exact version", (t) => {
  const lines = [];
  t.mock.method(console, "log", (line) => lines.push(line));
  main(
    ["--repo", "actions/checkout", "--tag", "v5"],
    spawnScript({ tags: [tag("v5"), tag("v5.0.1")] }),
  );
  assert.deepEqual(lines, [`uses: actions/checkout@${SHA} # v5.0.1`]);
});

test("main throws when no exact tag in the requested major points at the SHA", () => {
  assert.throws(
    () =>
      main(
        ["--repo", "actions/checkout", "--tag", "v5"],
        spawnScript({ tags: [tag("v5"), tag("v6.0.0")] }),
      ),
    /no exact v5\.Y\.Z tag/,
  );
});
