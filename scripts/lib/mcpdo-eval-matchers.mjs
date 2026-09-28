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
    const token = argv[i];
    if (VARIADIC_FLAGS.has(token)) {
      const pairs = [];
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
      const value = argv[++i];
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
]);

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
  });
  return errors;
}
