// Tests for the behavior-eval matcher library: every spelling mcpdo accepts
// for the same call must normalize to the same parse, and a matcher must
// fail for the reasons a case exists to catch (wrong tool, wrong argument,
// wrong server, nonzero exit) with a reason a human can act on.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseMcpdoArgv,
  valuesMatch,
  matchCall,
  evalExpectCalls,
  streamText,
  validateBehaviorCase,
} from "./mcpdo-eval-matchers.mjs";

const record = (argv, { exit = 0, stdout = "", stderr = "" } = {}) => ({
  argv,
  exit,
  start: 1,
  end: 2,
  events: [
    ...(stdout ? [{ t: 1, stream: "stdout", data: stdout }] : []),
    ...(stderr ? [{ t: 1, stream: "stderr", data: stderr }] : []),
  ],
});

test("parseMcpdoArgv: every tools/call spelling normalizes the same", () => {
  const spellings = [
    ["tools/call", "get_sum", "a:=2", "b:=3", "--connection", "test-stdio"],
    ["tools/call", "--conn", "test-stdio", "get_sum", "a:=2", "b:=3"],
    ["@test-stdio", "tools/call", "get_sum", '{"a":2,"b":3}'],
    [
      "tools/call",
      "--tool-name",
      "get_sum",
      "--tool-arg",
      "a=2",
      "b=3",
      "--connection",
      "test-stdio",
    ],
    [
      "tools/call",
      "get_sum",
      "--tool-args-json",
      '{"a":2,"b":3}',
      "--connection",
      "test-stdio",
    ],
  ];
  for (const argv of spellings) {
    const p = parseMcpdoArgv(argv);
    assert.equal(p.cmd, "tools/call", argv.join(" "));
    assert.equal(p.connection, "test-stdio", argv.join(" "));
    assert.equal(p.tool, "get_sum", argv.join(" "));
    assert.ok(valuesMatch(2, p.args.a), argv.join(" "));
    assert.ok(valuesMatch(3, p.args.b), argv.join(" "));
  }
});

test("parseMcpdoArgv: global flags do not become positionals", () => {
  const p = parseMcpdoArgv([
    "--format",
    "json",
    "--plain",
    "tools/list",
    "--connection",
    "x",
  ]);
  assert.equal(p.cmd, "tools/list");
  assert.equal(p.connection, "x");
  assert.equal(p.tool, null);
});

test("parseMcpdoArgv: daemon subcommand folds into cmd", () => {
  assert.equal(parseMcpdoArgv(["daemon", "stop"]).cmd, "daemon stop");
  assert.equal(parseMcpdoArgv(["daemon", "status"]).cmd, "daemon status");
});

test("parseMcpdoArgv: boolean flag does not swallow the tool name", () => {
  const p = parseMcpdoArgv(["tools/call", "--task", "slow_tool", "n:=1"]);
  assert.equal(p.tool, "slow_tool");
  assert.ok(valuesMatch(1, p.args.n));
});

test("valuesMatch: canonical across strings, numbers, and key order", () => {
  assert.ok(valuesMatch(2, "2"));
  assert.ok(valuesMatch("hello", "hello"));
  assert.ok(valuesMatch({ b: 1, a: "2" }, { a: 2, b: 1 }));
  assert.ok(!valuesMatch(2, 3));
  assert.ok(!valuesMatch("2", "2x"));
});

test("matchCall: full match on the add case", () => {
  const r = record(
    ["tools/call", "get_sum", "a:=2", "b:=3", "--connection", "test-stdio"],
    { stdout: '{"result":5}' },
  );
  assert.equal(
    matchCall(
      {
        cmd: "tools/call",
        connection: "test-stdio",
        tool: "get_sum",
        args: { a: 2, b: 3 },
        result: { result: 5 },
      },
      r,
    ),
    null,
  );
});

test("matchCall: implicit MRU connection is accepted, explicit wrong one is not", () => {
  const m = { cmd: "tools/list", connection: "test-stdio" };
  assert.equal(matchCall(m, record(["tools/list"])), null);
  const wrong = matchCall(m, record(["tools/list", "--connection", "other"]));
  assert.match(wrong, /connection is `other`/);
});

test("matchCall: connect names its connection positionally", () => {
  const m = { cmd: "connect", connection: "test-stdio" };
  assert.equal(matchCall(m, record(["connect", "test-stdio"])), null);
  assert.equal(matchCall(m, record(["connect", "@test-stdio"])), null);
  assert.equal(
    matchCall(m, record(["connect", "--connection", "test-stdio"])),
    null,
  );
  assert.match(
    matchCall(m, record(["connect", "other-entry"])),
    /connection is `other-entry`/,
  );
});

test("matchCall: wrong tool, wrong arg, missing arg, nonzero exit", () => {
  const base = {
    cmd: "tools/call",
    tool: "get_sum",
    args: { a: 2, b: 3 },
  };
  assert.match(
    matchCall(base, record(["tools/call", "echo", "a:=2", "b:=3"])),
    /tool is `echo`/,
  );
  assert.match(
    matchCall(base, record(["tools/call", "get_sum", "a:=2", "b:=4"])),
    /arg `b` is 4/,
  );
  assert.match(
    matchCall(base, record(["tools/call", "get_sum", "a:=2"])),
    /arg `b` missing/,
  );
  assert.match(
    matchCall(
      base,
      record(["tools/call", "get_sum", "a:=2", "b:=3"], { exit: 1 }),
    ),
    /exit is 1/,
  );
});

test("matchCall: result against text output is a distinct diagnostic", () => {
  const r = record(["tools/call", "get_sum", "a:=2", "b:=3"], {
    stdout: "result: 5\n",
  });
  assert.match(
    matchCall({ cmd: "tools/call", result: { result: 5 } }, r),
    /stdout is not JSON/,
  );
  assert.equal(matchCall({ cmd: "tools/call", stdoutMatch: "5" }, r), null);
});

test("matchCall: result reads dotted paths", () => {
  const r = record(["tools/list"], {
    stdout: '{"tools":[{"name":"get_sum"}]}',
  });
  assert.equal(
    matchCall({ cmd: "tools/list", result: { "tools.0.name": "get_sum" } }, r),
    null,
  );
});

test("evalExpectCalls: ordered subsequence with unrelated calls between", () => {
  const records = [
    record(["daemon", "status"]),
    record(["connect", "test-stdio"]),
    record(["tools/list"]),
    record(["tools/call", "get_sum", "a:=2", "b:=3"]),
  ];
  const { ok } = evalExpectCalls(
    [
      { cmd: "connect", connection: "test-stdio" },
      { cmd: "tools/call", tool: "get_sum", args: { a: 2, b: 3 } },
    ],
    records,
  );
  assert.ok(ok);
});

test("evalExpectCalls: order violations and misses carry diagnostics", () => {
  const records = [
    record(["tools/call", "get_sum", "a:=2", "b:=4"]),
    record(["connect", "test-stdio"]),
  ];
  const out = evalExpectCalls(
    [
      { cmd: "connect", connection: "test-stdio" },
      { cmd: "tools/call", args: { b: 3 } },
    ],
    records,
  );
  assert.ok(!out.ok);
  // connect matched (index 1), so the tools/call must come after it — the
  // earlier wrong call does not count and there is no later one.
  assert.equal(out.failures.length, 1);
  assert.match(out.failures[0], /expectCalls\[1\]/);
});

test("evalExpectCalls: empty transcript says so", () => {
  const out = evalExpectCalls([{ cmd: "connect" }], []);
  assert.match(out.failures[0], /no mcpdo invocations recorded/);
});

test("streamText concatenates one stream in order", () => {
  const r = {
    events: [
      { t: 1, stream: "stdout", data: "a" },
      { t: 2, stream: "stderr", data: "X" },
      { t: 3, stream: "stdout", data: "b" },
    ],
  };
  assert.equal(streamText(r, "stdout"), "ab");
  assert.equal(streamText(r, "stderr"), "X");
});

test("validateBehaviorCase: accepts the real shape", () => {
  assert.deepEqual(
    validateBehaviorCase(
      {
        kind: "behavior",
        prompt: "Add 2 and 3",
        expectCalls: [
          {
            cmd: "tools/call",
            connection: "test-stdio",
            tool: "get_sum",
            args: { a: 2, b: 3 },
            stdoutMatch: "5",
          },
        ],
      },
      0,
    ),
    [],
  );
});

test("validateBehaviorCase: catches typos, bad types, bad regex", () => {
  const errs = validateBehaviorCase(
    {
      prompt: "",
      expectCalls: [
        { cmd: "", tooll: "x" },
        { cmd: "ok", args: [], exit: "0", stdoutMatch: "(" },
        "nope",
      ],
    },
    3,
  );
  assert.ok(errs.some((e) => /`prompt`/.test(e)));
  assert.ok(errs.some((e) => /`cmd` is required/.test(e)));
  assert.ok(errs.some((e) => /unknown key `tooll`/.test(e)));
  assert.ok(errs.some((e) => /`args` must be an object/.test(e)));
  assert.ok(errs.some((e) => /`exit` must be an integer/.test(e)));
  assert.ok(errs.some((e) => /not a valid regex/.test(e)));
  assert.ok(errs.some((e) => /must be an object/.test(e)));
});

test("validateBehaviorCase: empty expectCalls is an error", () => {
  const errs = validateBehaviorCase({ prompt: "p", expectCalls: [] }, 0);
  assert.ok(errs.some((e) => /non-empty array/.test(e)));
});
