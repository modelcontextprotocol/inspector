// Structured matchers for mcpdo behavior evals (`skills:eval:mcpdo`).
//
// A behavior case asserts WHAT an agent did with mcpdo, from the transcript
// records the eval shim (`mcpdo-eval-shim.mjs`) writes: one JSON line per
// invocation, `{ argv, exit, start, end, events }`. Everything here works on
// parsed argv ARRAYS and captured output — never on re-parsed shell strings,
// which would re-implement the shell's quoting rules badly and drift from
// what actually ran.
//
// Matcher semantics are deliberately loose where the CLI is generous. mcpdo
// accepts the same tool call as `tools/call get_sum a:=2 b:=3`,
// `tools/call --tool-name get_sum --tool-arg a=2 b=3`, or
// `tools/call get_sum '{"a":2,"b":3}'`, with the connection as `@name`, as
// `--connection name`, or implicit via MRU. A case should pass for every
// correct spelling and fail for a wrong tool, wrong argument, or wrong
// server — so parsing normalizes all spellings into one shape before
// matching, and values compare canonically (`"2"` matches `2`).

/**
 * Global and per-command flags that consume exactly one following token.
 *
 * Deliberately a fixed list rather than a "flags eat the next token"
 * heuristic: boolean flags like `--task` would otherwise swallow the tool
 * name. An unknown value-flag degrades softly — its value shows up as a
 * stray positional, which no matcher field reads.
 */
const VALUE_FLAGS = new Set([
  "--format",
  "--connection",
  "--conn",
  "--catalog",
  "--config",
  "--tool-name",
  "--tool-args-json",
  "--uri",
  "--transport",
  "--cwd",
  "--connect-timeout",
  "--era",
  "--elicit",
  "-e",
]);

/**
 * Variadic flags (`<pairs...>`): consume following `key=value` tokens until
 * one stops looking like a pair.
 */
const VARIADIC_FLAGS = new Set(["--metadata", "--tool-arg", "--tool-metadata"]);

/** JSON.parse when the text parses, the raw string otherwise. */
function looseParse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/**
 * Parse one mcpdo invocation's argv (everything after `mcpdo`) into the
 * fields matchers assert on.
 *
 * @param {string[]} argv
 * @returns {{ cmd: string | null, connection: string | null, tool: string |
 *   null, args: Record<string, unknown>, positionals: string[] }}
 */
export function parseMcpdoArgv(argv) {
  let connection = null;
  let toolNameFlag = null;
  const args = {};
  const positionals = [];

  for (let i = 0; i < argv.length; i++) {
    let token = argv[i];
    // `--flag=value` form: split so the flag matches the sets below the same
    // as the space-separated form; otherwise `--connection=x` would parse as
    // an unknown boolean flag and silently drop the value.
    let inline = null;
    if (token.startsWith("--")) {
      const eq = token.indexOf("=");
      if (eq !== -1) {
        inline = token.slice(eq + 1);
        token = token.slice(0, eq);
      }
    }
    if (VARIADIC_FLAGS.has(token)) {
      const pairs = inline !== null ? [inline] : [];
      while (
        i + 1 < argv.length &&
        !argv[i + 1].startsWith("-") &&
        argv[i + 1].includes("=")
      ) {
        pairs.push(argv[++i]);
      }
      if (token === "--tool-arg") {
        for (const pair of pairs) {
          const eq = pair.indexOf("=");
          args[pair.slice(0, eq)] = looseParse(pair.slice(eq + 1));
        }
      }
      continue;
    }
    if (VALUE_FLAGS.has(token)) {
      const value = inline ?? argv[++i];
      if (token === "--connection" || token === "--conn") connection = value;
      if (token === "--tool-name") toolNameFlag = value;
      if (token === "--tool-args-json") {
        const parsed = looseParse(value);
        if (parsed !== null && typeof parsed === "object") {
          Object.assign(args, parsed);
        }
      }
      continue;
    }
    if (token.startsWith("--")) continue; // boolean flag
    if (token.startsWith("@") && token.length > 1) {
      // Positional `@name` selects the connection wherever it appears.
      if (connection === null) connection = token.slice(1);
      continue;
    }
    positionals.push(token);
  }

  let cmd = positionals[0] ?? null;
  let rest = positionals.slice(1);
  if (cmd === "daemon" && rest.length > 0) {
    // `daemon stop` etc. — the subcommand is part of what a case asserts.
    cmd = `daemon ${rest[0]}`;
    rest = rest.slice(1);
  }

  let tool = toolNameFlag;
  for (const token of rest) {
    if (token.includes(":=")) {
      const sep = token.indexOf(":=");
      args[token.slice(0, sep)] = looseParse(token.slice(sep + 2));
      continue;
    }
    if (token.startsWith("{")) {
      const parsed = looseParse(token);
      if (parsed !== null && typeof parsed === "object") {
        Object.assign(args, parsed);
      }
      continue;
    }
    // First bare positional after the command: the tool (or prompt, or
    // task id — the field is generic on purpose; `tool` is just its most
    // common reading).
    if (tool === null) tool = token;
  }

  return { cmd, connection, tool, args, positionals };
}

/** Recursively: parse JSON-looking strings, sort object keys. */
function normalize(value) {
  const v = typeof value === "string" ? looseParse(value) : value;
  if (v !== null && typeof v === "object") {
    if (Array.isArray(v)) return v.map(normalize);
    return Object.fromEntries(
      Object.keys(v)
        .sort()
        .map((k) => [k, normalize(v[k])]),
    );
  }
  return v;
}

/** Stable stringify: objects with sorted keys, so shape compares by value. */
function canonical(value) {
  return JSON.stringify(normalize(value));
}

/**
 * Loose value equality: `2`, `"2"`, and a JSON string `"2"` all match, and
 * objects compare deeply with key order ignored. Argument values arrive as
 * strings from `--tool-arg a=2` and as numbers from `a:=2`; a case should
 * not care which spelling the agent picked.
 */
export function valuesMatch(expected, actual) {
  return canonical(expected) === canonical(actual);
}

/** Concatenated output for one stream of a transcript record. */
export function streamText(record, stream) {
  return (record.events ?? [])
    .filter((e) => e.stream === stream)
    .map((e) => e.data)
    .join("");
}

/** Read `a.b.c` out of a parsed JSON value. */
function readPath(value, dotted) {
  let cur = value;
  for (const key of dotted.split(".")) {
    if (cur === null || typeof cur !== "object") return undefined;
    cur = cur[key];
  }
  return cur;
}

/**
 * Per-stream views of a transcript with a mapping back to GLOBAL event
 * order.
 *
 * Two problems solved at once. A pipe does not preserve write boundaries, so
 * a phase's pattern may span two recorded chunks — matching must run over
 * each stream's concatenated text, not per event. But interactive ordering
 * ("the stdin answer came after the stdout prompt") is BETWEEN streams, so
 * every character also needs a position on the one shared timeline; segments
 * carry that mapping.
 *
 * @param {object} record One shim transcript record.
 * @returns {Map<string, { text: string, segments: { streamStart: number,
 *   globalStart: number, len: number }[] }>}
 */
export function buildTimeline(record) {
  const streams = new Map();
  let global = 0;
  for (const event of record.events ?? []) {
    const data = String(event.data ?? "");
    let entry = streams.get(event.stream);
    if (!entry) {
      entry = { text: "", segments: [] };
      streams.set(event.stream, entry);
    }
    entry.segments.push({
      streamStart: entry.text.length,
      globalStart: global,
      len: data.length,
    });
    entry.text += data;
    global += data.length;
  }
  return streams;
}

/** Global timeline position of a stream-local offset. */
function globalPos(entry, streamOffset) {
  for (const seg of entry.segments) {
    if (streamOffset < seg.streamStart + seg.len) {
      return seg.globalStart + (streamOffset - seg.streamStart);
    }
  }
  return Number.MAX_SAFE_INTEGER;
}

/**
 * Match ordered phases against one invocation's interleaved transcript.
 *
 * Each phase is `{ stream, match }`: a regex that must appear on that stream
 * strictly AFTER (on the global timeline) where the previous phase matched.
 * This is what turns the shim's event capture into assertions like "stdout
 * showed the auth URL before exit" or "stdin answered only after the prompt
 * appeared".
 *
 * @param {{ stream: string, match: string }[]} phases
 * @param {object} record One shim transcript record.
 * @returns {string | null} `null` on match, else the first failure reason.
 */
export function matchPhases(phases, record) {
  const streams = buildTimeline(record);
  let cursor = -1;
  for (const [i, phase] of phases.entries()) {
    const entry = streams.get(phase.stream);
    if (!entry) {
      return `phase ${i} /${phase.match}/: no ${phase.stream} data recorded`;
    }
    const re = new RegExp(phase.match, "g");
    let found = -1;
    for (const m of entry.text.matchAll(re)) {
      const end = globalPos(entry, m.index + Math.max(m[0].length, 1) - 1);
      if (end > cursor) {
        found = end;
        break;
      }
    }
    if (found === -1) {
      const anywhere = new RegExp(phase.match).test(entry.text);
      return anywhere
        ? `phase ${i} /${phase.match}/ matched ${phase.stream} only BEFORE phase ${i - 1}`
        : `phase ${i} /${phase.match}/ not found on ${phase.stream}`;
    }
    cursor = found;
  }
  return null;
}

/**
 * Match one transcript record against one matcher.
 *
 * @param {object} matcher See `validateBehaviorCase` for the shape.
 * @param {object} record One shim transcript record.
 * @returns {string | null} `null` on match, else the first mismatch reason.
 */
export function matchCall(matcher, record) {
  const parsed = parseMcpdoArgv(record.argv ?? []);
  if (parsed.cmd !== matcher.cmd) {
    return `cmd is \`${parsed.cmd}\`, expected \`${matcher.cmd}\``;
  }
  if (matcher.connection !== undefined) {
    // `connect` names its connection positionally (`connect test-stdio`),
    // which the generic parse files under `tool` — for this command the
    // target IS the connection being established, so match either spelling.
    const conn =
      parsed.connection ?? (matcher.cmd === "connect" ? parsed.tool : null);
    // An absent connection is accepted: the hermetic env holds exactly one
    // entry, so the implicit MRU can only be the right one. An EXPLICIT
    // wrong connection is the bug this field exists to catch.
    if (conn !== null && conn !== matcher.connection) {
      return `connection is \`${conn}\`, expected \`${matcher.connection}\``;
    }
  }
  if (matcher.tool !== undefined && parsed.tool !== matcher.tool) {
    return `tool is \`${parsed.tool}\`, expected \`${matcher.tool}\``;
  }
  for (const [key, expected] of Object.entries(matcher.args ?? {})) {
    if (!(key in parsed.args)) {
      return `arg \`${key}\` missing (args: ${JSON.stringify(parsed.args)})`;
    }
    if (!valuesMatch(expected, parsed.args[key])) {
      return `arg \`${key}\` is ${JSON.stringify(parsed.args[key])}, expected ${JSON.stringify(expected)}`;
    }
  }
  // A failing invocation must not satisfy a matcher unless the case says so:
  // `connect` that exited 1 did not connect.
  const wantExit = matcher.exit ?? 0;
  if (record.exit !== wantExit) {
    return `exit is ${record.exit}, expected ${wantExit}`;
  }
  const stdout = streamText(record, "stdout");
  if (matcher.result !== undefined) {
    let parsedOut;
    try {
      parsedOut = JSON.parse(stdout);
    } catch {
      // Distinct diagnostic on purpose: the call may have been right while
      // the case asserted JSON against human text output.
      return `\`result\` asserted but stdout is not JSON (use stdoutMatch for text output)`;
    }
    for (const [path, expected] of Object.entries(matcher.result)) {
      const actual = readPath(parsedOut, path);
      if (!valuesMatch(expected, actual)) {
        return `result path \`${path}\` is ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`;
      }
    }
  }
  if (matcher.stdoutMatch !== undefined) {
    if (!new RegExp(matcher.stdoutMatch).test(stdout)) {
      return `stdout does not match /${matcher.stdoutMatch}/`;
    }
  }
  if (matcher.phases !== undefined) {
    const reason = matchPhases(matcher.phases, record);
    if (reason !== null) return reason;
  }
  return null;
}

/**
 * Check the transcript contains the expected calls as an ordered
 * subsequence — other calls in between are fine (exploring with
 * `tools/list` first is correct behavior, not noise).
 *
 * @param {object[]} expectCalls
 * @param {object[]} records
 * @returns {{ ok: boolean, failures: string[] }}
 */
export function evalExpectCalls(expectCalls, records) {
  const failures = [];
  let cursor = 0;
  for (const [i, matcher] of expectCalls.entries()) {
    let matched = -1;
    const nearMisses = [];
    for (let j = cursor; j < records.length; j++) {
      const reason = matchCall(matcher, records[j]);
      if (reason === null) {
        matched = j;
        break;
      }
      // Same command, wrong details: that is the interesting diagnostic.
      if (parseMcpdoArgv(records[j].argv ?? []).cmd === matcher.cmd) {
        nearMisses.push(reason);
      }
    }
    if (matched === -1) {
      const detail =
        nearMisses.length > 0
          ? ` (near miss: ${nearMisses[0]})`
          : records.length === 0
            ? " (no mcpdo invocations recorded)"
            : "";
      failures.push(
        `expectCalls[${i}] \`${matcher.cmd}\` not satisfied${detail}`,
      );
    } else {
      cursor = matched + 1;
    }
  }
  return { ok: failures.length === 0, failures };
}

const MATCHER_KEYS = new Set([
  "cmd",
  "connection",
  "tool",
  "args",
  "exit",
  "result",
  "stdoutMatch",
  "phases",
]);

const PHASE_STREAMS = new Set(["stdin", "stdout", "stderr"]);

/**
 * Validate one behavior case. Local to the mcpdo eval on purpose — the
 * shared `skill-manifest.mjs` schema describes trigger cases for every
 * skill, while `expectCalls` is this harness's private contract.
 *
 * Unknown matcher keys are errors, not ignored: a typoed `tooll` would
 * otherwise silently assert nothing and report a hit.
 *
 * @param {object} c
 * @param {number} i Case index, for error messages.
 * @returns {string[]} Errors; empty when valid.
 */
export function validateBehaviorCase(c, i) {
  const errors = [];
  if (typeof c.prompt !== "string" || c.prompt.trim() === "") {
    errors.push(`behavior case ${i}: \`prompt\` must be a non-empty string`);
  }
  if (!Array.isArray(c.expectCalls) || c.expectCalls.length === 0) {
    errors.push(
      `behavior case ${i}: \`expectCalls\` must be a non-empty array`,
    );
    return errors;
  }
  c.expectCalls.forEach((m, j) => {
    const at = `behavior case ${i} expectCalls[${j}]`;
    if (m === null || typeof m !== "object" || Array.isArray(m)) {
      errors.push(`${at}: must be an object`);
      return;
    }
    if (typeof m.cmd !== "string" || m.cmd.trim() === "") {
      errors.push(`${at}: \`cmd\` is required`);
    }
    for (const key of Object.keys(m)) {
      if (!MATCHER_KEYS.has(key)) {
        errors.push(`${at}: unknown key \`${key}\``);
      }
    }
    for (const key of ["connection", "tool", "stdoutMatch"]) {
      if (m[key] !== undefined && typeof m[key] !== "string") {
        errors.push(`${at}: \`${key}\` must be a string`);
      }
    }
    for (const key of ["args", "result"]) {
      if (
        m[key] !== undefined &&
        (m[key] === null || typeof m[key] !== "object" || Array.isArray(m[key]))
      ) {
        errors.push(`${at}: \`${key}\` must be an object`);
      }
    }
    if (m.exit !== undefined && !Number.isInteger(m.exit)) {
      errors.push(`${at}: \`exit\` must be an integer`);
    }
    if (m.stdoutMatch !== undefined && typeof m.stdoutMatch === "string") {
      try {
        new RegExp(m.stdoutMatch);
      } catch {
        errors.push(`${at}: \`stdoutMatch\` is not a valid regex`);
      }
    }
    if (m.phases !== undefined) {
      if (!Array.isArray(m.phases) || m.phases.length === 0) {
        errors.push(`${at}: \`phases\` must be a non-empty array`);
      } else {
        m.phases.forEach((p, k) => {
          if (p === null || typeof p !== "object" || Array.isArray(p)) {
            errors.push(`${at}: phases[${k}] must be an object`);
            return;
          }
          for (const key of Object.keys(p)) {
            if (key !== "stream" && key !== "match") {
              errors.push(`${at}: phases[${k}] unknown key \`${key}\``);
            }
          }
          if (!PHASE_STREAMS.has(p.stream)) {
            errors.push(
              `${at}: phases[${k}].stream must be one of ${[...PHASE_STREAMS].join(", ")}`,
            );
          }
          if (typeof p.match !== "string") {
            errors.push(`${at}: phases[${k}].match must be a string`);
          } else {
            try {
              new RegExp(p.match);
            } catch {
              errors.push(`${at}: phases[${k}].match is not a valid regex`);
            }
          }
        });
      }
    }
  });
  if (c.autoConsent !== undefined && typeof c.autoConsent !== "boolean") {
    errors.push(`behavior case ${i}: \`autoConsent\` must be a boolean`);
  }
  if (
    c.consentAfterReply !== undefined &&
    typeof c.consentAfterReply !== "boolean"
  ) {
    errors.push(`behavior case ${i}: \`consentAfterReply\` must be a boolean`);
  }
  if (
    c.consentDelayMs !== undefined &&
    (!Number.isInteger(c.consentDelayMs) || c.consentDelayMs < 0)
  ) {
    errors.push(
      `behavior case ${i}: \`consentDelayMs\` must be a non-negative integer`,
    );
  }
  for (const key of ["expectReply", "expectReplyFollowUp"]) {
    if (c[key] === undefined) continue;
    if (typeof c[key] !== "string" || c[key].trim() === "") {
      errors.push(`behavior case ${i}: \`${key}\` must be a non-empty string`);
    } else {
      try {
        new RegExp(c[key]);
      } catch {
        errors.push(`behavior case ${i}: \`${key}\` is not a valid regex`);
      }
    }
  }
  // `followUp` makes a case MULTI-TURN: turn 1 runs the prompt, the harness
  // completes the simulated sign-in, then turn 2 resumes the same agent
  // session with this text. Only meaningful alongside `autoConsent` (nothing
  // completes the sign-in otherwise) and currently claude-only (session
  // resume), but neither is enforced here — the harness skips a multi-turn
  // case for a non-claude agent, and a missing clicker just fails the case.
  if (c.followUp !== undefined) {
    if (typeof c.followUp !== "string" || c.followUp.trim() === "") {
      errors.push(
        `behavior case ${i}: \`followUp\` must be a non-empty string`,
      );
    }
    if (c.expectReplyFollowUp === undefined) {
      errors.push(
        `behavior case ${i}: \`followUp\` requires \`expectReplyFollowUp\` ` +
          `(a multi-turn case must assert what the resumed turn told the user)`,
      );
    }
  } else if (c.expectReplyFollowUp !== undefined) {
    errors.push(
      `behavior case ${i}: \`expectReplyFollowUp\` requires \`followUp\``,
    );
  }
  // `expectLastCallTurn1` asserts the agent's LAST mcpdo command before the
  // follow-up turn (all of a single-turn case) was this one — the gate that
  // proves a pure-connect case STOPPED after relaying the sign-in URL instead
  // of polling. For a case with a task command to run, use
  // `rejectCompletedTurn1` instead (last-command is brittle under chaining).
  if (c.expectLastCallTurn1 !== undefined) {
    if (
      typeof c.expectLastCallTurn1 !== "string" ||
      c.expectLastCallTurn1.trim() === ""
    ) {
      errors.push(
        `behavior case ${i}: \`expectLastCallTurn1\` must be a non-empty string`,
      );
    }
  }
  // `rejectCompletedTurn1` names the task command (e.g. `tools/list`) whose
  // SUCCESS (exit 0) before the follow-up means the agent completed the task
  // in turn 1 instead of stopping to let the user sign in — a poll or a
  // genuine completion. See `succeededBefore` for why this replaced the
  // brittle "last command was connect" check for the list-tools case.
  if (c.rejectCompletedTurn1 !== undefined) {
    if (
      typeof c.rejectCompletedTurn1 !== "string" ||
      c.rejectCompletedTurn1.trim() === ""
    ) {
      errors.push(
        `behavior case ${i}: \`rejectCompletedTurn1\` must be a non-empty string`,
      );
    }
  }
  errors.push(...validateCaseServers(c, i));
  return errors;
}

/**
 * Claude's session id, read from its `-p --output-format stream-json` NDJSON
 * (`rawLogPath`). Claude stamps the same `session_id` on its init system
 * event and its final result event; `--resume <id>` continues that session,
 * which is what makes the OAuth behavior cases multi-turn. Returns the last
 * one seen (robust to a torn final line), or null when absent — a non-claude
 * stream, or one never captured.
 *
 * @param {string} raw NDJSON text as captured via `rawLogPath`.
 * @returns {string | null}
 */
export function claudeSessionId(raw) {
  let id = null;
  for (const line of raw.split("\n")) {
    if (!line.includes("session_id")) continue;
    let evt;
    try {
      evt = JSON.parse(line);
    } catch {
      continue;
    }
    if (typeof evt?.session_id === "string" && evt.session_id !== "") {
      id = evt.session_id;
    }
  }
  return id;
}

/**
 * The `cmd` of the last mcpdo invocation that STARTED before `boundaryTs`
 * (epoch-ms), by start time — not array position, because a `connect` that
 * relays a URL exits fast while an earlier failed `tools/list` may still be
 * recorded around it. The multi-turn OAuth cases use this with the
 * follow-up's send time as the boundary to assert the agent's final first-turn
 * move was `connect` (it stopped to relay the URL) rather than a poll/retry.
 * A single-turn case passes `Infinity` to cover every record. Returns null
 * when nothing qualifies.
 *
 * @param {Array<{argv?: string[], start?: number}>} records
 * @param {number} boundaryTs
 * @returns {string | null}
 */
export function lastCommandBefore(records, boundaryTs) {
  let last = null;
  let lastStart = -Infinity;
  for (const r of records) {
    if (typeof r.start !== "number" || r.start >= boundaryTs) continue;
    if (r.start >= lastStart) {
      lastStart = r.start;
      last = parseMcpdoArgv(r.argv ?? []).cmd;
    }
  }
  return last;
}

/**
 * Did any mcpdo invocation of `cmd` SUCCEED (exit 0) before `boundaryTs`?
 *
 * This is the behavioral completion signal the multi-turn OAuth cases gate on,
 * and it is deliberately NOT `lastCommandBefore`. An agent that relays the
 * sign-in URL and then waits still frequently runs the task command
 * optimistically in the same turn — e.g. `connect && tools/list`, chained in a
 * single shell line — because `connect` exits 0 even when sign-in is pending.
 * That chained `tools/list` runs against a not-yet-connected server, exits
 * NON-zero (`auth_required`), and the agent ignores it and waits: correct
 * behavior, but `lastCommandBefore` reads the trailing `tools/list` and wrongly
 * flags it. What actually distinguishes "waited" from "barged through" is
 * whether the task command SUCCEEDED in turn 1 — a poll-until-connected or a
 * genuine completion exits 0; an optimistic chained attempt does not.
 *
 * @param {Array<{argv?: string[], start?: number, exit?: number}>} records
 * @param {number} boundaryTs
 * @param {string} cmd
 * @returns {boolean}
 */
export function succeededBefore(records, boundaryTs, cmd) {
  for (const r of records) {
    if (typeof r.start !== "number" || r.start >= boundaryTs) continue;
    if (r.exit !== 0) continue;
    if (parseMcpdoArgv(r.argv ?? []).cmd === cmd) return true;
  }
  return false;
}

/**
 * The text an agent actually showed its user, from the raw agent-session
 * NDJSON stream (`agent-session.ndjson`).
 *
 * This is deliberately a different surface from the shim transcript: a case's
 * `expectCalls` assert what the agent RAN, while `expectReply` asserts what it
 * SAID — the two can diverge exactly when the agent reads something in a
 * command's output (a sign-in URL) and fails to relay it to the user, which
 * no transcript matcher can see.
 *
 * Handles both agents' event shapes: Claude's `-p --output-format stream-json`
 * (`{type:"assistant", message:{content:[{type:"text", text}]}}`) and the
 * Copilot CLI's `--output-format json` (`{type:"assistant.message",
 * data:{content: "<text>"}}`). Malformed lines are CLI noise, not
 * observations, same as the collectors in skill-eval.mjs.
 *
 * What counts as "shown to the user" is host-specific, so it is a parameter
 * rather than a rule: Claude Code renders `thinking` blocks whose signature
 * is narration as ordinary foreground text — a sign-in URL relayed there
 * reached the user (observed live) — while the Copilot CLI shows its
 * reasoning in a dimmed font users routinely skip. The per-agent defaults
 * live in {@link REPLY_TEXT_OPTIONS}; pass `options` to override in a test
 * or when tuning what a given host actually surfaces.
 *
 * @param {string} raw NDJSON text as captured via `rawLogPath`.
 * @param {object} [options]
 * @param {boolean} [options.includeThinking] Also count Claude `thinking`
 *   blocks as user-visible text.
 * @returns {string} Every user-visible assistant text block, joined with
 *   newlines.
 */
export function assistantReplyText(raw, options = {}) {
  const { includeThinking = false } = options;
  const texts = [];
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    let evt;
    try {
      evt = JSON.parse(line);
    } catch {
      continue;
    }
    if (evt?.type === "assistant") {
      for (const block of evt.message?.content ?? []) {
        if (block?.type === "text" && typeof block.text === "string") {
          texts.push(block.text);
        } else if (
          includeThinking &&
          block?.type === "thinking" &&
          typeof block.thinking === "string"
        ) {
          texts.push(block.thinking);
        }
      }
    } else if (
      evt?.type === "assistant.message" &&
      typeof evt.data?.content === "string"
    ) {
      texts.push(evt.data.content);
    }
  }
  return texts.join("\n");
}

/**
 * Per-agent defaults for {@link assistantReplyText}: what each host's UI
 * actually puts in front of the user. Claude Code displays narration-style
 * thinking as foreground text; the Copilot CLI dims its reasoning, so only
 * proper assistant messages count there.
 */
export const REPLY_TEXT_OPTIONS = {
  claude: { includeThinking: true },
  copilot: { includeThinking: false },
};

/**
 * Validate a behavior case's server declaration: optional `server` (single
 * spec under the default catalog name) or `servers` (name→spec map), never
 * both. Names become catalog entry names — the agent sees them via
 * `servers/list`, so they are scenario content.
 *
 * @param {object} c A behavior case.
 * @param {number} i Case index, for error messages.
 * @returns {string[]}
 */
export function validateCaseServers(c, i) {
  if (c.server !== undefined && c.servers !== undefined) {
    return [
      `behavior case ${i}: \`server\` and \`servers\` are mutually exclusive`,
    ];
  }
  if (c.servers !== undefined) {
    const at = `behavior case ${i} \`servers\``;
    if (
      c.servers === null ||
      typeof c.servers !== "object" ||
      Array.isArray(c.servers)
    ) {
      return [`${at}: must be a name→spec object`];
    }
    const names = Object.keys(c.servers);
    if (names.length === 0) return [`${at}: must not be empty`];
    const errors = [];
    for (const name of names) {
      if (!/^[A-Za-z0-9_.-]+$/.test(name)) {
        errors.push(`${at}: \`${name}\` is not a valid catalog entry name`);
        continue;
      }
      if (c.servers[name] === undefined) {
        errors.push(
          `${at}.${name}: spec must not be undefined (omit \`servers\` for the default server)`,
        );
        continue;
      }
      errors.push(
        ...validateServerSpec(c.servers[name], i, `\`servers\`.${name}`),
      );
    }
    return errors;
  }
  return validateServerSpec(c.server, i);
}

/**
 * Validate one server spec: either `{ "url": "<http(s) endpoint>" }` for a
 * server the harness does not manage, or the test-servers declarative
 * config-file shape (serverInfo + preset refs). A composed spec with no
 * transport (or stdio) is served through the eval's stdio launcher; with
 * `transport.type: "streamable-http"` it is started in-process
 * (`TestServerHttp`) and the catalog entry points at its URL — OAuth via the
 * spec's `oauth` block rides on the same instance. Only the discriminating
 * structure is checked here — preset names and capability switches are the
 * framework's contract, validated by `resolveConfig` when the server starts.
 *
 * @param {object | undefined} server
 * @param {number} i Case index, for error messages.
 * @param {string} [label] Field label for error messages.
 * @returns {string[]}
 */
export function validateServerSpec(server, i, label = "`server`") {
  if (server === undefined) return [];
  const at = `behavior case ${i} ${label}`;
  if (server === null || typeof server !== "object" || Array.isArray(server)) {
    return [`${at}: must be an object`];
  }
  if ("url" in server) {
    const errors = [];
    if (typeof server.url !== "string" || !/^https?:\/\//.test(server.url)) {
      errors.push(`${at}: \`url\` must be an http(s) URL`);
    }
    for (const key of Object.keys(server)) {
      if (key !== "url") {
        errors.push(`${at}: \`url\` form takes no other keys (got \`${key}\`)`);
      }
    }
    return errors;
  }
  if (
    typeof server.serverInfo?.name !== "string" ||
    typeof server.serverInfo?.version !== "string"
  ) {
    return [
      `${at}: composed form needs \`serverInfo\` with \`name\` and \`version\` (or use the \`url\` form)`,
    ];
  }
  if (
    server.transport !== undefined &&
    server.transport?.type !== "stdio" &&
    server.transport?.type !== "streamable-http"
  ) {
    return [
      `${at}: composed transport must be "stdio" (default) or "streamable-http" — sse fixtures are not supported by the harness`,
    ];
  }
  return [];
}
