// Tests for the behavior-eval matcher library: every spelling mcpdo accepts
// for the same call must normalize to the same parse, and a matcher must
// fail for the reasons a case exists to catch (wrong tool, wrong argument,
// wrong server, nonzero exit) with a reason a human can act on.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  assistantReplyText,
  REPLY_TEXT_OPTIONS,
  parseMcpdoArgv,
  valuesMatch,
  matchCall,
  matchPhases,
  evalExpectCalls,
  streamText,
  validateBehaviorCase,
  validateCaseServers,
  validateServerSpec,
  claudeSessionId,
  lastCommandBefore,
  succeededBefore,
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
    [
      "tools/call",
      "--tool-name=get_sum",
      "--tool-arg=a=2",
      "b=3",
      "--connection=test-stdio",
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

test("validateBehaviorCase: autoConsent must be a boolean", () => {
  const base = { prompt: "p", expectCalls: [{ cmd: "connect" }] };
  assert.deepEqual(validateBehaviorCase({ ...base, autoConsent: true }, 0), []);
  assert.ok(
    validateBehaviorCase({ ...base, autoConsent: "yes" }, 0).some((e) =>
      /`autoConsent` must be a boolean/.test(e),
    ),
  );
});

test("validateBehaviorCase: consentDelayMs and expectReply", () => {
  const base = { prompt: "p", expectCalls: [{ cmd: "connect" }] };
  assert.deepEqual(
    validateBehaviorCase(
      { ...base, consentDelayMs: 20000, expectReply: "oauth/authorize\\?" },
      0,
    ),
    [],
  );
  assert.ok(
    validateBehaviorCase({ ...base, consentDelayMs: -1 }, 0).some((e) =>
      /`consentDelayMs` must be a non-negative integer/.test(e),
    ),
  );
  assert.ok(
    validateBehaviorCase({ ...base, consentDelayMs: 1.5 }, 0).some((e) =>
      /`consentDelayMs` must be a non-negative integer/.test(e),
    ),
  );
  assert.ok(
    validateBehaviorCase({ ...base, expectReply: "" }, 0).some((e) =>
      /`expectReply` must be a non-empty string/.test(e),
    ),
  );
  assert.ok(
    validateBehaviorCase({ ...base, expectReply: "(" }, 0).some((e) =>
      /`expectReply` is not a valid regex/.test(e),
    ),
  );
  assert.deepEqual(
    validateBehaviorCase({ ...base, consentAfterReply: true }, 0),
    [],
  );
  assert.ok(
    validateBehaviorCase({ ...base, consentAfterReply: "yes" }, 0).some((e) =>
      /`consentAfterReply` must be a boolean/.test(e),
    ),
  );
});

test("validateBehaviorCase: multi-turn fields (followUp, expectReplyFollowUp, expectLastCallTurn1)", () => {
  const base = { prompt: "p", expectCalls: [{ cmd: "connect" }] };
  // A valid multi-turn case: followUp paired with expectReplyFollowUp.
  assert.deepEqual(
    validateBehaviorCase(
      {
        ...base,
        followUp: "continue",
        expectReplyFollowUp: "add",
        expectLastCallTurn1: "connect",
      },
      0,
    ),
    [],
  );
  // followUp without expectReplyFollowUp is an error.
  assert.ok(
    validateBehaviorCase({ ...base, followUp: "go" }, 0).some((e) =>
      /`followUp` requires `expectReplyFollowUp`/.test(e),
    ),
  );
  // expectReplyFollowUp without followUp is an error.
  assert.ok(
    validateBehaviorCase({ ...base, expectReplyFollowUp: "add" }, 0).some((e) =>
      /`expectReplyFollowUp` requires `followUp`/.test(e),
    ),
  );
  // Empty / bad-regex / wrong-type checks.
  assert.ok(
    validateBehaviorCase(
      { ...base, followUp: "", expectReplyFollowUp: "add" },
      0,
    ).some((e) => /`followUp` must be a non-empty string/.test(e)),
  );
  assert.ok(
    validateBehaviorCase(
      { ...base, followUp: "go", expectReplyFollowUp: "(" },
      0,
    ).some((e) => /`expectReplyFollowUp` is not a valid regex/.test(e)),
  );
  assert.ok(
    validateBehaviorCase({ ...base, expectLastCallTurn1: "" }, 0).some((e) =>
      /`expectLastCallTurn1` must be a non-empty string/.test(e),
    ),
  );
  // expectLastCallTurn1 is valid on its own (a single-turn relay-and-stop gate).
  assert.deepEqual(
    validateBehaviorCase({ ...base, expectLastCallTurn1: "connect" }, 0),
    [],
  );
  // rejectCompletedTurn1 (the robust list-tools gate) has the same shape rules.
  assert.ok(
    validateBehaviorCase({ ...base, rejectCompletedTurn1: "" }, 0).some((e) =>
      /`rejectCompletedTurn1` must be a non-empty string/.test(e),
    ),
  );
  assert.deepEqual(
    validateBehaviorCase({ ...base, rejectCompletedTurn1: "tools/list" }, 0),
    [],
  );
});

test("claudeSessionId: last session_id wins, null when absent", () => {
  const raw =
    JSON.stringify({ type: "system", subtype: "init", session_id: "s-1" }) +
    "\n" +
    "not json\n" +
    JSON.stringify({ type: "assistant", message: { content: [] } }) +
    "\n" +
    JSON.stringify({ type: "result", session_id: "s-2" }) +
    "\n";
  assert.equal(claudeSessionId(raw), "s-2");
  assert.equal(claudeSessionId(""), null);
  assert.equal(claudeSessionId(JSON.stringify({ type: "assistant" })), null);
  // A torn final line (truncated mid-write) must not lose an earlier id.
  assert.equal(
    claudeSessionId(
      JSON.stringify({ session_id: "s-1" }) + '\n{"session_id":"s-',
    ),
    "s-1",
  );
});

test("lastCommandBefore: final command by start time, honoring the boundary", () => {
  const rec = (cmd, start) => ({ argv: [cmd], start });
  const records = [
    rec("tools/list", 10), // failed pre-connect probe
    rec("connect", 20), // relayed the URL, then stopped
    rec("tools/list", 40), // turn 2, after the follow-up
  ];
  // Before the follow-up (boundary 30): connect was the last thing.
  assert.equal(lastCommandBefore(records, 30), "connect");
  // Infinity covers every record (a single-turn case).
  assert.equal(lastCommandBefore(records, Infinity), "tools/list");
  // A later-exiting but earlier-starting record does not displace connect.
  assert.equal(
    lastCommandBefore(
      [rec("connect", 20), { argv: ["connections/show"], start: 15 }],
      30,
    ),
    "connect",
  );
  // Records with no numeric start are ignored; nothing qualifying is null.
  assert.equal(lastCommandBefore([{ argv: ["connect"] }], 30), null);
  assert.equal(lastCommandBefore([], 30), null);
});

test("succeededBefore: exit-0 task command before the boundary", () => {
  const rec = (cmd, start, exit) => ({ argv: [cmd], start, exit });
  // A chained `connect && tools/list` where tools/list errors (auth_required)
  // then succeeds in turn 2: NOT completed in turn 1.
  const chained = [
    rec("connect", 20, 0),
    rec("tools/list", 22, 3), // optimistic, errored — agent waited
    rec("tools/list", 40, 0), // turn 2, after sign-in
  ];
  assert.equal(succeededBefore(chained, 30, "tools/list"), false);
  // A poll that ran tools/list to success in turn 1: completed without waiting.
  const polled = [rec("connect", 20, 0), rec("tools/list", 25, 0)];
  assert.equal(succeededBefore(polled, 30, "tools/list"), true);
  // Argv carries a connection prefix (`@name tools/list`) — still matched.
  assert.equal(
    succeededBefore(
      [{ argv: ["@secure-add", "tools/list"], start: 25, exit: 0 }],
      30,
      "tools/list",
    ),
    true,
  );
  // Records with no numeric start, or at/after the boundary, are ignored.
  assert.equal(
    succeededBefore([{ argv: ["tools/list"], exit: 0 }], 30, "tools/list"),
    false,
  );
  assert.equal(
    succeededBefore([rec("tools/list", 40, 0)], 30, "tools/list"),
    false,
  );
});

test("assistantReplyText: reads both agents' event shapes, skips noise", () => {
  const claude =
    JSON.stringify({
      type: "assistant",
      message: {
        content: [
          { type: "text", text: "open http://127.0.0.1:1/oauth/authorize?x=1" },
          { type: "tool_use", name: "Bash", input: {} },
          {
            type: "thinking",
            thinking: "narrated aside with a secret-ish url",
          },
        ],
      },
    }) + "\n";
  const copilot =
    JSON.stringify({
      type: "assistant.message",
      data: { content: "then sign in", toolRequests: [] },
    }) + "\n";
  const noise =
    "not json\n" +
    JSON.stringify({ type: "tool_result", content: "secret url" }) +
    "\n" +
    JSON.stringify({ type: "assistant.message_delta", data: { content: 5 } }) +
    "\n";
  const text = assistantReplyText(claude + noise + copilot);
  assert.equal(
    text,
    "open http://127.0.0.1:1/oauth/authorize?x=1\nthen sign in",
  );
  // Tool results are what the agent SAW, not what it said — they must never
  // satisfy a reply matcher.
  assert.ok(!text.includes("secret url"));
  // Thinking blocks count only when the host displays them (Claude Code
  // narration) — opt-in via includeThinking, default off.
  assert.ok(!text.includes("narrated aside"));
  const withThinking = assistantReplyText(claude + noise + copilot, {
    includeThinking: true,
  });
  assert.ok(withThinking.includes("narrated aside"));
  assert.deepEqual(REPLY_TEXT_OPTIONS.claude, { includeThinking: true });
  assert.deepEqual(REPLY_TEXT_OPTIONS.copilot, { includeThinking: false });
  assert.equal(assistantReplyText(""), "");
});

test("matchPhases: interleaved prompt/answer/result ordering", () => {
  const r = {
    argv: ["tools/call", "collect"],
    exit: 0,
    events: [
      { t: 1, stream: "stdout", data: "Enter your na" },
      { t: 2, stream: "stdout", data: "me: " }, // pattern spans chunks
      { t: 3, stream: "stdin", data: "Ada\n" },
      { t: 4, stream: "stdout", data: '{"ok":true}\n' },
    ],
  };
  assert.equal(
    matchPhases(
      [
        { stream: "stdout", match: "Enter your name" },
        { stream: "stdin", match: "Ada" },
        { stream: "stdout", match: '"ok"' },
      ],
      r,
    ),
    null,
  );
  // The answer cannot come before the prompt.
  assert.match(
    matchPhases(
      [
        { stream: "stdin", match: "Ada" },
        { stream: "stdout", match: "Enter your name" },
      ],
      r,
    ),
    /matched stdout only BEFORE/,
  );
  assert.match(
    matchPhases([{ stream: "stderr", match: "x" }], r),
    /no stderr data recorded/,
  );
  assert.match(
    matchPhases([{ stream: "stdout", match: "missing" }], r),
    /not found on stdout/,
  );
});

test("matchCall: phases participate in a full matcher", () => {
  const r = record(["connect", "test-stdio"], {
    stdout: "Visit https://idp.example/auth to continue\nConnection ready\n",
  });
  assert.equal(
    matchCall(
      {
        cmd: "connect",
        phases: [
          { stream: "stdout", match: "https://idp\\.example/auth" },
          { stream: "stdout", match: "Connection ready" },
        ],
      },
      r,
    ),
    null,
  );
});

test("validateBehaviorCase: phases schema", () => {
  const errs = validateBehaviorCase(
    {
      prompt: "p",
      expectCalls: [
        {
          cmd: "connect",
          phases: [
            { stream: "socket", match: "x" },
            { stream: "stdout", match: "(", extra: 1 },
            "nope",
          ],
        },
        { cmd: "ok", phases: [] },
      ],
    },
    0,
  );
  assert.ok(errs.some((e) => /phases\[0\]\.stream must be one of/.test(e)));
  assert.ok(
    errs.some((e) => /phases\[1\]\.match is not a valid regex/.test(e)),
  );
  assert.ok(errs.some((e) => /phases\[1\] unknown key `extra`/.test(e)));
  assert.ok(errs.some((e) => /phases\[2\] must be an object/.test(e)));
  assert.ok(errs.some((e) => /`phases` must be a non-empty array/.test(e)));
});

test("validateServerSpec: url form, composed form, and rejects", () => {
  assert.deepEqual(validateServerSpec(undefined, 0), []);
  assert.deepEqual(
    validateServerSpec({ url: "http://127.0.0.1:3999/mcp" }, 0),
    [],
  );
  assert.deepEqual(
    validateServerSpec(
      {
        serverInfo: { name: "composed", version: "1.0.0" },
        tools: [{ preset: "add" }],
      },
      0,
    ),
    [],
  );
  assert.ok(
    validateServerSpec({ url: "ftp://x" }, 0).some((e) =>
      /http\(s\) URL/.test(e),
    ),
  );
  assert.ok(
    validateServerSpec({ url: "http://x", tools: [{ preset: "add" }] }, 0).some(
      (e) => /no other keys/.test(e),
    ),
  );
  assert.ok(
    validateServerSpec({ tools: [{ preset: "add" }] }, 0).some((e) =>
      /needs `serverInfo`/.test(e),
    ),
  );
  assert.deepEqual(
    validateServerSpec(
      {
        serverInfo: { name: "protected-api", version: "1.0.0" },
        transport: { type: "streamable-http" },
        oauth: { enabled: true, mode: "combined" },
      },
      0,
    ),
    [],
    "http composed form (incl. oauth) is valid",
  );
  assert.ok(
    validateServerSpec(
      {
        serverInfo: { name: "c", version: "1" },
        transport: { type: "sse" },
      },
      0,
    ).some((e) => /sse fixtures are not supported/.test(e)),
  );
  assert.ok(validateServerSpec([], 0).some((e) => /must be an object/.test(e)));
});

test("validateCaseServers: map form, exclusivity, and per-entry labels", () => {
  const spec = { serverInfo: { name: "s", version: "1" } };
  assert.deepEqual(
    validateCaseServers(
      { servers: { calendar: spec, "weather-api": { url: "http://x/mcp" } } },
      0,
    ),
    [],
  );
  assert.ok(
    validateCaseServers({ server: spec, servers: { a: spec } }, 0).some((e) =>
      /mutually exclusive/.test(e),
    ),
  );
  assert.ok(
    validateCaseServers({ servers: {} }, 0).some((e) =>
      /must not be empty/.test(e),
    ),
  );
  assert.ok(
    validateCaseServers({ servers: ["x"] }, 0).some((e) =>
      /name→spec object/.test(e),
    ),
  );
  assert.ok(
    validateCaseServers({ servers: { "bad name!": spec } }, 0).some((e) =>
      /not a valid catalog entry name/.test(e),
    ),
  );
  assert.ok(
    validateCaseServers({ servers: { a: undefined } }, 0).some((e) =>
      /must not be undefined/.test(e),
    ),
  );
  // Nested spec errors carry the entry name.
  assert.ok(
    validateCaseServers({ servers: { alpha: { url: "ftp://x" } } }, 3).some(
      (e) => /behavior case 3 `servers`\.alpha/.test(e),
    ),
  );
});

test("validateBehaviorCase: server field is validated through the case", () => {
  const errs = validateBehaviorCase(
    { prompt: "p", expectCalls: [{ cmd: "connect" }], server: { url: "nope" } },
    2,
  );
  assert.ok(errs.some((e) => /behavior case 2 `server`/.test(e)));
});

test("validateBehaviorCase: empty expectCalls is an error", () => {
  const errs = validateBehaviorCase({ prompt: "p", expectCalls: [] }, 0);
  assert.ok(errs.some((e) => /non-empty array/.test(e)));
});
