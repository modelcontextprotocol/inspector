// Tests for the pure halves of the skill trigger eval (#2163).
//
// Everything else in `skill-eval.mjs` spawns a real `claude` CLI, so its stream
// parsing and its process-outcome handling are unreachable from an eval run's
// happy path — they would only ever be exercised by the very measurement they
// are supposed to make trustworthy. A nonzero exit read as "no skill invoked"
// (the bug these cases pin) passes every negative case and reads as a trigger
// miss on every positive one, so a rate-limited run reports a plausible number
// instead of failing.

import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  caseHit,
  chainHit,
  collectCases,
  collectSkillInvocations,
  runRejection,
  invokedSkillNames,
  runPrompt,
  sampleHit,
} from "./skill-eval.mjs";
import { MIN_POSITIVE_CASES } from "./lib/skill-manifest.mjs";

/** The payloads a run records, in the order the skills fired. */
const fired = (...names) => names.map((n) => JSON.stringify({ skill: n }));

const assistant = (...blocks) =>
  JSON.stringify({ type: "assistant", message: { content: blocks } });
const skillUse = (name) => ({
  type: "tool_use",
  name: "Skill",
  input: { skill: name },
});

test("collectSkillInvocations finds Skill tool_use payloads", () => {
  const { invoked } = collectSkillInvocations(
    assistant(skillUse("testing")) + "\n",
  );
  assert.equal(invoked.length, 1);
  assert.ok(invoked[0].includes("testing"));
});

test("collectSkillInvocations ignores other tools and other event types", () => {
  const text =
    assistant({ type: "tool_use", name: "Read", input: { file_path: "a" } }) +
    "\n" +
    JSON.stringify({ type: "result", result: "Skill" }) +
    "\n";
  assert.equal(collectSkillInvocations(text).invoked.length, 0);
});

test("collectSkillInvocations survives malformed and blank lines", () => {
  const text = "not json\n\n" + assistant(skillUse("local-dev")) + "\n";
  const { invoked } = collectSkillInvocations(text);
  assert.equal(invoked.length, 1);
});

test("collectSkillInvocations holds back a trailing partial line", () => {
  const whole = assistant(skillUse("local-dev"));
  const first = collectSkillInvocations(whole.slice(0, 20));
  assert.equal(first.invoked.length, 0);
  assert.equal(first.rest, whole.slice(0, 20));
  // Feeding the remainder back with the held-over prefix completes the event.
  const second = collectSkillInvocations(first.rest + whole.slice(20) + "\n");
  assert.equal(second.invoked.length, 1);
});

test("collectSkillInvocations tolerates a tool_use with no input", () => {
  const text = assistant({ type: "tool_use", name: "Skill" }) + "\n";
  assert.deepEqual([...collectSkillInvocations(text).invoked], ["{}"]);
});

test("sampleHit scores positive and negative cases", () => {
  const hit = fired("testing");
  const none = [];
  assert.equal(sampleHit("testing", hit), true);
  assert.equal(sampleHit("local-dev", hit), false);
  assert.equal(sampleHit(null, none), true);
  assert.equal(sampleHit(null, hit), false);
  assert.equal(sampleHit("testing", none), false);
});

test("collectSkillInvocations preserves order and repeats", () => {
  // A hand-off case asserts one skill was loaded AFTER another, so occurrence
  // order is the observation. Deduplicating into a Set would make the B, A, B
  // run below indistinguishable from one that never reached B from A.
  const text =
    [
      assistant(skillUse("test-servers")),
      assistant(skillUse("testing")),
      assistant(skillUse("test-servers")),
    ].join("\n") + "\n";
  const { invoked } = collectSkillInvocations(text);
  assert.deepEqual(
    invoked.map((p) => JSON.parse(p).skill),
    ["test-servers", "testing", "test-servers"],
  );
});

test("chainHit wants the links in order", () => {
  assert.equal(chainHit(["testing", "test-servers"], fired("testing")), false);
  assert.equal(
    chainHit(["testing", "test-servers"], fired("testing", "test-servers")),
    true,
  );
  // The reverse hand-off is a different claim and must not score.
  assert.equal(
    chainHit(["testing", "test-servers"], fired("test-servers", "testing")),
    false,
  );
  assert.equal(chainHit(["testing", "test-servers"], []), false);
});

test("chainHit matches a subsequence, not a prefix or a contiguous run", () => {
  // The model is free to load something before the chain starts, and something
  // unrelated in between — neither changes the fact that A led to B.
  assert.equal(
    chainHit(
      ["testing", "test-servers"],
      fired("local-dev", "testing", "board-ops", "test-servers"),
    ),
    true,
  );
  // And a repeat of the first link before it does not consume the match.
  assert.equal(
    chainHit(
      ["testing", "test-servers"],
      fired("test-servers", "testing", "test-servers"),
    ),
    true,
  );
});

test("caseHit routes each case shape to its own scorer", () => {
  const ours = new Set(["testing", "test-servers"]);
  const run = fired("testing", "test-servers");
  assert.equal(
    caseHit({ chain: ["testing", "test-servers"] }, run, ours),
    true,
  );
  assert.equal(
    caseHit({ chain: ["test-servers", "testing"] }, run, ours),
    false,
  );
  assert.equal(caseHit({ expect: "testing" }, run, ours), true);
  assert.equal(caseHit({ expect: null }, run, ours), false);
  // A chained case says nothing about foreign skills, unlike a negative one.
  assert.equal(
    caseHit(
      { chain: ["testing", "test-servers"] },
      fired("testing", "my-personal-notes", "test-servers"),
      ours,
    ),
    true,
  );
});

test("invokedSkillNames matches structurally, not by substring", () => {
  // `{"skill":"not-testing"}` contains "testing" and must NOT count — a
  // substring match inflates the measured hit rate with invocations of a
  // different skill.
  assert.deepEqual(invokedSkillNames('{"skill":"not-testing"}'), [
    "not-testing",
  ]);
  assert.equal(sampleHit("testing", fired("not-testing")), false);
  assert.equal(sampleHit("testing", fired("testing")), true);
  // The field name is not assumed, so any string value is a candidate.
  assert.equal(sampleHit("testing", ['{"name":"testing","args":""}']), true);
});

test("invokedSkillNames tolerates payloads it cannot read", () => {
  for (const payload of ["not json", "[1,2]", "null", '"testing"']) {
    assert.deepEqual(invokedSkillNames(payload), []);
  }
});

/** Minimal stand-in for a ChildProcess: emits stdout chunks, then closes. */
function fakeSpawn({ chunks = [], code = 0, error = null }) {
  return () => {
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    // The prompt is written to stdin rather than passed in argv, so the
    // stand-in needs one or `runPrompt` throws before the child can close.
    child.stdin = { end: () => {} };
    queueMicrotask(() => {
      if (error) {
        child.emit("error", error);
        return;
      }
      for (const c of chunks) child.stdout.emit("data", Buffer.from(c));
      child.emit("close", code);
    });
    return child;
  };
}

const resultEvent = (subtype) =>
  JSON.stringify({ type: "result", subtype }) + "\n";

test("collectSkillInvocations reports the terminal result subtype", () => {
  assert.equal(
    collectSkillInvocations(resultEvent("success")).result,
    "success",
  );
  assert.equal(collectSkillInvocations("").result, null);
});

test("runRejection accepts a run that hit the turn limit", () => {
  // With `--max-turns 1`, a run in which a skill FIRES necessarily hits the
  // limit and the CLI exits 1. Rejecting on the exit code alone would throw away
  // exactly the observations the eval exists to count — verified against the
  // real CLI, which ends such a run `error_max_turns` with `num_turns: 2`.
  assert.equal(runRejection({ result: "error_max_turns", code: 1 }), null);
  assert.equal(runRejection({ result: "success", code: 0 }), null);
});

test("runRejection rejects a run that observed nothing", () => {
  // An auth failure, a rate limit, or a CLI that never started. Counting these
  // as "no skill invoked" passes every negative case and reads as a trigger
  // miss on every positive one.
  assert.match(runRejection({ result: null, code: 1 }) ?? "", /no terminal/);
  assert.match(runRejection({ result: null, code: 0 }) ?? "", /no terminal/);
  assert.match(
    runRejection({ result: "error_during_execution", code: 1 }) ?? "",
    /ended `error_during_execution`/,
  );
});

test("runPrompt collects invocations across chunk boundaries", async () => {
  const whole =
    JSON.stringify({
      type: "assistant",
      message: {
        content: [
          { type: "tool_use", name: "Skill", input: { skill: "testing" } },
        ],
      },
    }) + "\n";
  const invoked = await runPrompt("p", {
    spawnFn: fakeSpawn({
      chunks: [
        whole.slice(0, 30),
        whole.slice(30),
        resultEvent("error_max_turns"),
      ],
      code: 1,
    }),
  });
  assert.equal(sampleHit("testing", invoked), true);
});

test("runPrompt gives a hand-off case a wider turn budget", () => {
  // `--max-turns 1` is what makes a first-move case a first-move case; a chain
  // that only ever gets one turn can never observe a second-hop load.
  const seen = [];
  for (const opts of [{}, { maxTurns: 14 }]) {
    runPrompt("p", {
      ...opts,
      spawnFn: (_c, args) => {
        seen.push(args[args.indexOf("--max-turns") + 1]);
        const c = new EventEmitter();
        c.stdout = new EventEmitter();
        c.stdin = { end: () => {} };
        queueMicrotask(() => c.emit("close", 0));
        return c;
      },
    }).catch(() => {});
  }
  assert.deepEqual(seen, ["1", "14"]);
});

test("runPrompt keeps the run read-only across every turn", () => {
  // A wider budget removes the containment `--max-turns 1` was doing on its
  // own, so the deny list has to cover the agentic and network tools too —
  // `Task` in particular, whose subagent this flag does not reach.
  let denied;
  runPrompt("p", {
    spawnFn: (_c, args) => {
      denied = args[args.indexOf("--disallowedTools") + 1].split(",");
      const c = new EventEmitter();
      c.stdout = new EventEmitter();
      c.stdin = { end: () => {} };
      queueMicrotask(() => c.emit("close", 0));
      return c;
    },
  }).catch(() => {});
  for (const tool of ["Bash", "Write", "Edit", "NotebookEdit", "Task"]) {
    assert.ok(denied.includes(tool), `${tool} must be denied`);
  }
});

test("runPrompt rejects a run that produced no terminal result", async () => {
  await assert.rejects(
    runPrompt("p", { spawnFn: fakeSpawn({ code: 1 }) }),
    /no terminal `result` event \(exit 1\) for prompt: p/,
  );
});

test("runPrompt rejects a run that ended in an unusable state", async () => {
  await assert.rejects(
    runPrompt("p", {
      spawnFn: fakeSpawn({
        chunks: [resultEvent("error_during_execution")],
        code: 1,
      }),
    }),
    /ended `error_during_execution`/,
  );
});

test("runPrompt propagates a spawn error", async () => {
  await assert.rejects(
    runPrompt("p", { spawnFn: fakeSpawn({ error: new Error("ENOENT") }) }),
    /ENOENT/,
  );
});

test("a negative case ignores skills that are not this repo's", () => {
  // A contributor's own `~/.claude/skills` entry, or a bundled skill, firing on
  // a negative prompt says nothing about these skills — failing on it would be
  // a false failure about someone else's environment.
  const ours = new Set(["testing", "local-dev"]);
  const foreign = fired("my-personal-notes");
  const mine = fired("testing");

  assert.equal(sampleHit(null, foreign, ours), true);
  assert.equal(sampleHit(null, mine, ours), false);
  assert.equal(sampleHit(null, [], ours), true);
  // A positive case is unaffected: it names the skill it wants.
  assert.equal(sampleHit("testing", mine, ours), true);
  assert.equal(sampleHit("testing", foreign, ours), false);
  // With no repo set, any invocation still fails a negative case.
  assert.equal(sampleHit(null, foreign), false);
});

test("runPrompt sends the prompt on stdin, never in argv", () => {
  // On Windows the CLI is a `.cmd` shim and can only start through a shell,
  // where `cmd.exe` re-parses any metacharacter in an argument as syntax. Off
  // Windows it also keeps the prompt out of the process table.
  const prompt = "does it? (yes & no)";
  let seen;
  let written = null;
  runPrompt(prompt, {
    spawnFn: (command, args, options) => {
      seen = { command, args, options };
      const c = new EventEmitter();
      c.stdout = new EventEmitter();
      c.stdin = {
        end: (text) => {
          written = text;
        },
      };
      queueMicrotask(() => c.emit("close", 0));
      return c;
    },
    platform: "linux",
  }).catch(() => {});
  assert.equal(seen.command, "claude");
  assert.ok(!seen.args.includes(prompt), "prompt must not appear in argv");
  assert.deepEqual(seen.options.stdio, ["pipe", "pipe", "inherit"]);
  assert.equal(written, prompt);
});

test("runPrompt asks for a shell on Windows", () => {
  let seen;
  runPrompt("p", {
    spawnFn: (_c, _a, options) => {
      seen = options;
      const c = new EventEmitter();
      c.stdout = new EventEmitter();
      c.stdin = { end: () => {} };
      queueMicrotask(() => c.emit("close", 0));
      return c;
    },
    platform: "win32",
  }).catch(() => {});
  assert.equal(seen.shell, true);
});

/** A skills directory with two model-invoked skills and one name-only skill. */
function skillsFixture() {
  const root = mkdtempSync(path.join(tmpdir(), "skill-eval-"));
  const write = (name, frontmatter, evals) => {
    const dir = path.join(root, name);
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      path.join(dir, "SKILL.md"),
      `---\nname: ${name}\ndescription: d\n${frontmatter}---\n\nBody\n`,
    );
    if (evals) {
      mkdirSync(path.join(dir, "evals"), { recursive: true });
      writeFileSync(
        path.join(dir, "evals", "evals.json"),
        JSON.stringify(evals),
      );
    }
  };
  // Enough positives to satisfy the same MIN_POSITIVE_CASES floor the real eval
  // files must clear; the prompts stay predictable so assertions can name them.
  const evalsFor = (letter, skill) => [
    ...Array.from({ length: MIN_POSITIVE_CASES }, (_, i) => ({
      prompt: `${letter}+${i}`,
      expect: skill,
    })),
    { prompt: `${letter}-`, expect: null },
  ];
  write("alpha", "disable-model-invocation: false\n", evalsFor("a", "alpha"));
  write("beta", "disable-model-invocation: false\n", evalsFor("b", "beta"));
  write("gamma", "disable-model-invocation: true\n");
  return root;
}

test("focused mode narrows the cases but not the repo's own skill set", () => {
  // `ours` decides what a NEGATIVE case counts as a false trigger. Narrowing it
  // with `only` would let `skills:eval -- alpha` score a `beta` invocation as
  // somebody else's skill and pass a negative case it should fail.
  const root = skillsFixture();

  const all = collectCases(undefined, root);
  assert.deepEqual([...all.ours].sort(), ["alpha", "beta"]);
  assert.equal(all.cases.length, (MIN_POSITIVE_CASES + 1) * 2);

  const focused = collectCases("alpha", root);
  assert.deepEqual([...focused.ours].sort(), ["alpha", "beta"]);
  assert.deepEqual(
    focused.cases.map((c) => c.prompt),
    ["a+0", "a+1", "a+2", "a+3", "a+4", "a-"],
  );
  // The consequence, stated as the assertion that matters:
  assert.equal(sampleHit(null, fired("beta"), focused.ours), false);

  rmSync(root, { recursive: true, force: true });
});

test("focused mode accepts several skill names", () => {
  const root = skillsFixture();

  const focused = collectCases(["alpha", "beta"], root);
  assert.deepEqual(
    focused.cases.map((c) => c.prompt).sort(),
    [
      "a+0",
      "a+1",
      "a+2",
      "a+3",
      "a+4",
      "a-",
      "b+0",
      "b+1",
      "b+2",
      "b+3",
      "b+4",
      "b-",
    ].sort(),
  );
  // Narrowing to every skill is still not the same as no filter — `ours` is
  // unchanged either way, which is what keeps negative scoring honest.
  assert.deepEqual([...focused.ours].sort(), ["alpha", "beta"]);

  // A single name keeps working, so the one-argument form is unaffected.
  assert.deepEqual(
    collectCases("beta", root).cases.map((c) => c.prompt),
    ["b+0", "b+1", "b+2", "b+3", "b+4", "b-"],
  );

  rmSync(root, { recursive: true, force: true });
});

test("an unknown skill name is an error, not an empty run", () => {
  // A typo would otherwise enqueue zero cases and report a green 0/0, which
  // reads exactly like a clean pass of the skill that was meant.
  const root = skillsFixture();
  assert.throws(
    () => collectCases(["alpha", "aplha"], root),
    /no model-invoked skill named `aplha`/,
  );
  // A name-only skill is not model-invoked, so asking for it is the same error.
  assert.throws(() => collectCases(["gamma"], root), /no model-invoked skill/);
  rmSync(root, { recursive: true, force: true });
});

test("a name-only skill is not part of the repo's model-invoked set", () => {
  const root = skillsFixture();
  const { ours } = collectCases(undefined, root);
  assert.equal(ours.has("gamma"), false);
  // So its firing does not fail a negative case — it cannot fire on its own.
  assert.equal(sampleHit(null, fired("gamma"), ours), true);
  rmSync(root, { recursive: true, force: true });
});

test("collection fails loudly rather than silently shrinking the set", () => {
  const root = skillsFixture();
  // A model-invoked skill whose evals vanished.
  rmSync(path.join(root, "beta", "evals"), { recursive: true, force: true });
  assert.throws(
    () => collectCases(undefined, root),
    /beta is model-invoked but has no/,
  );
  rmSync(root, { recursive: true, force: true });
});
