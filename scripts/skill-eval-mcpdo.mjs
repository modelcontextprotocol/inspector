#!/usr/bin/env node
// Trigger eval for the PRODUCT skill `skills/mcpdo` (the mcpdo connection CLI).
//
// `skills:eval` measures the dev-workflow skills in `.claude/skills`. The
// mcpdo skill is a different animal: it SHIPS in the npm package and is
// installed into a *user's* skills directory, so measuring it inside this
// repo's checkout would measure the wrong environment twice over —
//
//   - agents discover project skills from `<cwd>/.claude/skills`, so a run
//     with `cwd` at the repo root cannot see `skills/mcpdo` at all, and
//   - the repo checkout loads AGENTS.md and ten dev skills, none of which a
//     user of mcpdo has in context.
//
// So each sample runs in a SANDBOX project: a fresh directory outside the
// repo containing only `.claude/skills/mcpdo` (a copy of the shipped skill,
// evals excluded). That is the closest headless approximation of "a user with
// the mcpdo skill installed asks their agent something".
//
// The sandbox lives under `~/.cache`, not `os.tmpdir()`, for two reasons that
// are both about flags `runPrompt` already passes: the Copilot run carries
// `--disallow-temp-dir`, and a sandbox *inside* the repo would be walked up
// past — the agent would resolve the repo as the project root and load the
// dev skills instead of the sandbox's.
//
// What a trigger case proves — and does not. A hit means only "the agent
// loaded the mcpdo skill for this prompt". The case set therefore skews
// toward UNPROMPTED-RECOGNITION prompts (no mention of mcpdo: "what MCP
// servers am I connected to?") where the decision to reach for the skill is
// the entire measurement, plus negatives that guard against a description
// broadened into firing on every prompt containing "server" or "tools". A
// task-framed "use mcpdo to ..." prompt is near-guaranteed to fire and earns
// one smoke case, no more. Whether the agent then runs the RIGHT mcpdo
// commands is a separate (behavior) measurement this script does not make.
//
// Like `skills:eval`, this is NOT part of `validate`, `local:gate`, or CI:
// it spends metered model calls and the measurement is a hit rate over
// samples. Run it before and after editing `skills/mcpdo/SKILL.md`, and
// compare the same cases.
//
// BEHAVIOR cases (`"kind": "behavior"` in evals.json) go one layer deeper
// than trigger cases: did the agent run the RIGHT mcpdo commands? Each
// sample gets a hermetic environment — a private daemon binding, a throwaway
// storage dir, and a catalog holding exactly one entry (`test-stdio`, this
// repo's stdio test server) — and a recording `mcpdo` shim first on PATH
// that tees stdio through the real build while appending a transcript per
// invocation (lib/mcpdo-eval-shim.mjs). Scoring matches the transcript
// against the case's `expectCalls` (lib/mcpdo-eval-matchers.mjs): an ordered
// subsequence of structured matchers over parsed argv, exit codes, and
// captured output — never over shell strings from the agent's event stream.
// The shell containment is command-scoped approval, probed live on both
// CLIs: Claude `--allowedTools "Bash(mcpdo *)"`, Copilot `--allow-tool
// 'shell(mcpdo:*)'`; anything else effectful is auto-denied fast in headless
// mode and the run continues. (Copilot's `--available-tools` is deliberately
// NOT used here: its availability names differ from its pattern names, and
// filtering the shell tool out entirely makes the model fabricate command
// output — measured, not hypothesized.) Behavior cases are POSIX-only: the
// shim is installed as a `#!/bin/sh` wrapper.
//
// Usage:
//   npm run skills:eval:mcpdo
//   RUNS=5 THRESHOLD=0.8 npm run skills:eval:mcpdo
//   AGENT=copilot npm run skills:eval:mcpdo
//   BEHAVIOR_RUNS=4 BEHAVIOR_THRESHOLD=0.75 npm run skills:eval:mcpdo

import { spawnSync } from "node:child_process";
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { AGENTS, formatReport, runPrompt } from "./skill-eval.mjs";
import { parseSkill, validateEvalCases } from "./lib/skill-manifest.mjs";
import {
  evalExpectCalls,
  validateBehaviorCase,
} from "./lib/mcpdo-eval-matchers.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SKILL_DIR = path.join(ROOT, "skills", "mcpdo");
// The cases live OUTSIDE the skill directory, deliberately: `skills/mcpdo` is
// a published artifact (npm `files`, installed into user skill dirs), and the
// skill IS the directory — eval data inside it would ship to every user and
// pollute what an agent may read. Dev-only measurement data belongs with the
// package that owns the skill, not in its payload. (The dev-workflow skills
// under `.claude/skills` keep evals inline because those directories never
// leave the repo.)
const EVALS_FILE = path.join(
  ROOT,
  "clients",
  "daemon-cli",
  "evals",
  "evals.json",
);
const SKILL_NAME = "mcpdo";

// Behavior-eval fixtures: the real CLI build the shim wraps, the shim
// itself, and the stdio test server the private catalog points at. Builds,
// not sources — the eval measures what a user would run.
const REAL_BIN = path.join(
  ROOT,
  "clients",
  "daemon-cli",
  "build",
  "mcp-bin.js",
);
const SHIM_SRC = path.join(ROOT, "scripts", "lib", "mcpdo-eval-shim.mjs");
const TEST_SERVER_BIN = path.join(
  ROOT,
  "test-servers",
  "build",
  "test-server-stdio.js",
);
const SERVER_LAUNCHER = path.join(
  ROOT,
  "scripts",
  "lib",
  "mcpdo-eval-server-launcher.mjs",
);

const THRESHOLD = Number(process.env.THRESHOLD ?? 0.8);
const RUNS = Number(process.env.RUNS ?? 3);
const CONCURRENCY = Number(process.env.CONCURRENCY ?? 4);
const AGENT = process.env.AGENT ?? "claude";
// Behavior knobs are separate from the trigger ones: a multi-turn agentic
// run costs an order of magnitude more than a one-turn trigger sample, and
// its hit rate is honestly lower — 0.5 strict to start, tightened as the
// skill improves rather than loosened to pass.
const BEHAVIOR_RUNS = Number(process.env.BEHAVIOR_RUNS ?? RUNS);
const BEHAVIOR_THRESHOLD = Number(process.env.BEHAVIOR_THRESHOLD ?? 0.5);
const BEHAVIOR_TURNS = Number(process.env.BEHAVIOR_TURNS ?? 14);

/**
 * Build the sandbox project one sample set runs in.
 *
 * The skill is COPIED rather than symlinked: a symlink would resolve back
 * inside the repo, and whether an agent's project-root detection follows it
 * is exactly the kind of version-dependent behavior a measurement should not
 * sit on.
 *
 * @returns {string} The sandbox directory.
 */
export function makeSandbox() {
  const dir = path.join(
    os.homedir(),
    ".cache",
    "mcpdo-skill-eval",
    `${process.pid}-${randomBytes(4).toString("hex")}`,
  );
  const dest = path.join(dir, ".claude", "skills", SKILL_NAME);
  mkdirSync(dest, { recursive: true });
  cpSync(SKILL_DIR, dest, { recursive: true });
  // A README so a human finding a leaked sandbox knows what it was.
  writeFileSync(
    path.join(dir, "README.md"),
    "Scratch project for `npm run skills:eval:mcpdo`; safe to delete.\n",
  );
  return dir;
}

/**
 * Load and validate the committed cases, partitioned by kind.
 *
 * Trigger cases go through the shared `validateEvalCases` schema; behavior
 * cases through this harness's own `validateBehaviorCase` — `expectCalls` is
 * a private contract of this runner, and the shared schema should not grow
 * fields only one skill's eval understands.
 *
 * @returns {{ trigger: object[], behavior: object[] }}
 */
export function loadCases() {
  const skill = parseSkill(
    SKILL_NAME,
    readFileSync(path.join(SKILL_DIR, "SKILL.md"), "utf8"),
  );
  if (skill.errors.length > 0) {
    throw new Error(`skills/mcpdo/SKILL.md does not parse: ${skill.errors[0]}`);
  }
  if (!skill.modelInvoked) {
    throw new Error(
      "skills/mcpdo is not model-invoked; a trigger eval of it measures nothing",
    );
  }
  const all = JSON.parse(readFileSync(EVALS_FILE, "utf8"));
  if (!Array.isArray(all)) {
    throw new Error("clients/daemon-cli/evals/evals.json must be an array");
  }
  // `kind` is an explicit discriminator, required on every case: a defaulted
  // kind would let a typo ("behaviour") silently demote a behavior case to a
  // trigger case and fail with an unrelated schema error.
  const KINDS = new Set(["trigger", "behavior"]);
  const kindErrors = all.flatMap((c, i) =>
    KINDS.has(c?.kind)
      ? []
      : [
          `case ${i}: \`kind\` must be one of ${[...KINDS].join(", ")} (got ${JSON.stringify(c?.kind)})`,
        ],
  );
  if (kindErrors.length > 0) {
    throw new Error(
      `clients/daemon-cli/evals/evals.json: ${kindErrors.join("; ")}`,
    );
  }
  const trigger = all.filter((c) => c.kind === "trigger");
  const behavior = all.filter((c) => c.kind === "behavior");
  const errors = [
    ...validateEvalCases(SKILL_NAME, trigger, new Set([SKILL_NAME])),
    ...behavior.flatMap((c, i) => validateBehaviorCase(c, i)),
  ];
  if (errors.length > 0) {
    throw new Error(
      `clients/daemon-cli/evals/evals.json: ${errors.join("; ")}`,
    );
  }
  return { trigger, behavior };
}

/**
 * Agent arguments for a BEHAVIOR run: the trigger policy plus shell, scoped
 * to mcpdo by command-level approval. Both syntaxes were probed live (see
 * the header): unapproved effectful commands fail fast and the run
 * continues, so containment costs turns, not hangs.
 *
 * Passed to `runPrompt` as `agentArgsFn` — a replacement, because the
 * trigger policy's `--deny-tool shell` / `--disallowedTools Bash` cannot be
 * retracted by appending.
 *
 * @param {string} agent
 * @param {number} maxTurns
 * @returns {string[]}
 */
export function behaviorAgentArgs(agent, maxTurns) {
  if (agent === "copilot") {
    return [
      "--output-format",
      "json",
      // No `--available-tools`: its availability names differ from the
      // approval-pattern names (the shell tool is `bash` in events but
      // `shell(...)` in patterns), and naming it wrong silently removes the
      // tool — after which the model FABRICATES command output. Approval
      // scoping alone contains the run: everything unapproved is auto-denied
      // in headless mode.
      "--allow-tool",
      "view,glob,grep,skill",
      "--allow-tool",
      "shell(mcpdo:*)",
      "--deny-tool",
      "write",
      "--deny-tool",
      "url",
      "--disable-builtin-mcps",
      "--disallow-temp-dir",
      "--no-ask-user",
      "--no-auto-update",
    ];
  }
  if (agent !== "claude") throw new Error(`unknown agent \`${agent}\``);
  return [
    "-p",
    "--output-format",
    "stream-json",
    "--verbose",
    "--max-turns",
    String(maxTurns),
    "--tools",
    "Read,Glob,Grep,Skill,Bash",
    "--allowedTools",
    "Read,Glob,Grep,Skill,Bash(mcpdo *)",
    "--disallowedTools",
    "Write,Edit,NotebookEdit,Task,Agent,SlashCommand,WebFetch,WebSearch,KillShell",
    "--strict-mcp-config",
  ];
}

/**
 * Build one behavior sample's hermetic mcpdo world, next to (not inside) its
 * sandbox so the agent's cwd stays clean.
 *
 * Private daemon binding (own dir + minted token — the same isolation
 * `mcpdo private` gives a shell), throwaway storage, a catalog holding
 * exactly `test-stdio`, and a bin dir whose `mcpdo` is the recording shim.
 * One entry on purpose: with a single catalog entry, an implicit-MRU call
 * can only mean the right server, which is what lets the `connection`
 * matcher accept the flag's absence.
 *
 * No `MCP_ALLOW_DEFAULT_CONNECTION`: agents run non-TTY, and the explicit
 * connect-or-name path is the realistic one being measured.
 *
 * The default entry is the stdio test server in its DEFAULT composition. A
 * case's `server` spec swaps in a composed one instead: the `url` form
 * points the entry at an already-running HTTP fixture; the config form is
 * written to disk and served through the eval's stdio launcher — the
 * composable framework's own path, not an extension of the default server's
 * entrypoint.
 *
 * @param {string} sandbox The sample's sandbox dir (from `makeSandbox`).
 * @param {object} [server] Optional per-case server spec (see
 *   `validateServerSpec`).
 * @returns {{ env: Record<string, string>, logPath: string, teardown: () =>
 *   void }}
 */
export function makeBehaviorEnv(sandbox, server = undefined) {
  const envDir = `${sandbox}-env`;
  const daemonDir = path.join(envDir, "daemon");
  const storageDir = path.join(envDir, "storage");
  const binDir = path.join(envDir, "bin");
  const logPath = path.join(envDir, "mcpdo-transcript.ndjson");
  const catalogPath = path.join(envDir, "catalog.json");
  mkdirSync(daemonDir, { recursive: true, mode: 0o700 });
  mkdirSync(storageDir, { recursive: true });
  mkdirSync(binDir, { recursive: true });
  let entry;
  if (server === undefined) {
    entry = {
      type: "stdio",
      command: process.execPath,
      args: [TEST_SERVER_BIN],
    };
  } else if ("url" in server) {
    entry = { type: "streamable-http", url: server.url };
  } else {
    const serverConfigPath = path.join(envDir, "server-config.json");
    // The launcher is always a stdio child; the case spec needn't say so
    // (and validateServerSpec rejects a spec that says otherwise).
    writeFileSync(
      serverConfigPath,
      JSON.stringify({ transport: { type: "stdio" }, ...server }, null, 2),
    );
    entry = {
      type: "stdio",
      command: process.execPath,
      args: [SERVER_LAUNCHER, serverConfigPath],
    };
  }
  writeFileSync(
    catalogPath,
    JSON.stringify({ mcpServers: { "test-stdio": entry } }, null, 2),
  );
  const shimBin = path.join(binDir, "mcpdo");
  writeFileSync(
    shimBin,
    `#!/bin/sh\nexec ${JSON.stringify(process.execPath)} ${JSON.stringify(SHIM_SRC)} "$@"\n`,
  );
  chmodSync(shimBin, 0o755);
  const env = {
    PATH: `${binDir}${path.delimiter}${process.env.PATH ?? ""}`,
    MCP_INSPECTOR_DAEMON_DIR: daemonDir,
    MCP_INSPECTOR_DAEMON_TOKEN: randomBytes(32).toString("base64url"),
    MCP_STORAGE_DIR: storageDir,
    MCP_CATALOG_PATH: catalogPath,
    MCPDO_EVAL_REAL: REAL_BIN,
    MCPDO_EVAL_LOG: logPath,
  };
  const teardown = () => {
    // Direct spawn of the real build, not the shim: teardown must not
    // appear in the transcript, and must work even if the shim is broken.
    spawnSync(process.execPath, [REAL_BIN, "daemon", "stop"], {
      env: { ...process.env, ...env },
      timeout: 15000,
      stdio: "ignore",
    });
    rmSync(envDir, { recursive: true, force: true });
  };
  return { env, logPath, teardown };
}

/** Parse the shim transcript; tolerate a torn final line, never silent-drop. */
export function readTranscript(logPath) {
  if (!existsSync(logPath)) return [];
  return readFileSync(logPath, "utf8")
    .split("\n")
    .filter((l) => l.trim() !== "")
    .flatMap((l) => {
      try {
        return [JSON.parse(l)];
      } catch {
        return [];
      }
    });
}

/**
 * Run one behavior sample: fresh sandbox + hermetic env, one agent session,
 * transcript scored against the case's `expectCalls`.
 *
 * @param {object} c A behavior case.
 * @returns {Promise<{ hit: boolean, failures: string[], calls: number }>}
 */
async function runBehaviorSample(c) {
  const sandbox = makeSandbox();
  const { env, logPath, teardown } = makeBehaviorEnv(sandbox, c.server);
  try {
    await runPrompt(c.prompt, {
      cwd: sandbox,
      agent: AGENT,
      maxTurns: BEHAVIOR_TURNS,
      env,
      agentArgsFn: behaviorAgentArgs,
    });
    const records = readTranscript(logPath);
    const { ok, failures } = evalExpectCalls(c.expectCalls, records);
    return { hit: ok, failures, calls: records.length };
  } finally {
    teardown();
    rmSync(sandbox, { recursive: true, force: true });
  }
}

async function pool(items, n, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (i < items.length) {
        const idx = i++;
        out[idx] = await fn(items[idx]);
      }
    }),
  );
  return out;
}

async function main() {
  if (!AGENTS.includes(AGENT)) {
    console.error(
      `skills:eval:mcpdo — unknown AGENT \`${AGENT}\`; known: ${AGENTS.join(", ")}`,
    );
    process.exit(1);
  }
  for (const [name, value] of [
    ["THRESHOLD", THRESHOLD],
    ["BEHAVIOR_THRESHOLD", BEHAVIOR_THRESHOLD],
  ]) {
    if (!Number.isFinite(value) || value < 0 || value > 1) {
      console.error(
        `skills:eval:mcpdo — ${name} must be a number in [0, 1] (got ${process.env[name]}).`,
      );
      process.exit(1);
    }
  }
  const { trigger, behavior } = loadCases();
  let failed = 0;
  failed += await runTriggerSection(
    trigger.map((c) => ({ ...c, from: SKILL_NAME })),
  );
  failed += await runBehaviorSection(behavior);
  process.exit(failed > 0 ? 1 : 0);
}

/**
 * Trigger section: did the skill fire? One shared read-only sandbox.
 *
 * @returns {Promise<number>} Failed case count.
 */
async function runTriggerSection(cases) {
  if (cases.length === 0) return 0;
  const sandbox = makeSandbox();
  console.log(
    `skills:eval:mcpdo trigger — ${cases.length} cases x ${RUNS} runs, agent ${AGENT}, sandbox ${sandbox}`,
  );
  const samples = cases.flatMap((c) => Array.from({ length: RUNS }, () => c));
  try {
    const results = await pool(samples, CONCURRENCY, async (c) => {
      const invoked = await runPrompt(c.prompt, {
        cwd: sandbox,
        agent: AGENT,
        maxTurns: 1,
      });
      return { c, invoked };
    });
    // `ours` is just {mcpdo}: a negative case asserts THIS skill stayed
    // quiet. The sandbox has no other project skill, but the contributor's
    // ~/.claude skills are still visible to the run and are not ours to
    // assert about.
    const { lines, failed } = formatReport(
      cases,
      results,
      new Set([SKILL_NAME]),
      {
        threshold: THRESHOLD,
        chainThreshold: 0.5,
        chainMaxTurns: 1,
        agent: AGENT,
      },
    );
    for (const line of lines) console.log(line);
    return failed;
  } finally {
    rmSync(sandbox, { recursive: true, force: true });
  }
}

/**
 * Behavior section: did the agent run the right mcpdo commands? One hermetic
 * world per SAMPLE — samples must not share MRU or connection state.
 *
 * @returns {Promise<number>} Failed case count.
 */
async function runBehaviorSection(cases) {
  if (cases.length === 0) return 0;
  if (process.platform === "win32") {
    console.log(
      "skills:eval:mcpdo behavior — skipped: the recording shim is POSIX-only",
    );
    return 0;
  }
  if (!existsSync(REAL_BIN) || !existsSync(TEST_SERVER_BIN)) {
    console.error(
      "skills:eval:mcpdo behavior — missing builds; run `npm run build` first" +
        ` (need ${path.relative(ROOT, REAL_BIN)} and ${path.relative(ROOT, TEST_SERVER_BIN)})`,
    );
    return 1;
  }
  console.log(
    `skills:eval:mcpdo behavior — ${cases.length} cases x ${BEHAVIOR_RUNS} runs, agent ${AGENT}, budget ${BEHAVIOR_TURNS} turns`,
  );
  const samples = cases.flatMap((c) =>
    Array.from({ length: BEHAVIOR_RUNS }, () => c),
  );
  const results = await pool(samples, CONCURRENCY, async (c) => ({
    c,
    ...(await runBehaviorSample(c)),
  }));
  let failed = 0;
  for (const c of cases) {
    const mine = results.filter((r) => r.c === c);
    const hits = mine.filter((r) => r.hit).length;
    const rate = hits / mine.length;
    const pass = rate >= BEHAVIOR_THRESHOLD;
    if (!pass) failed++;
    console.log(
      `${pass ? "PASS" : "FAIL"} behavior ${hits}/${mine.length} (need ${BEHAVIOR_THRESHOLD}) — ${c.prompt}`,
    );
    for (const r of mine) {
      if (!r.hit) {
        console.log(
          `  miss (${r.calls} mcpdo calls): ${r.failures.join("; ")}`,
        );
      }
    }
  }
  return failed;
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main().catch((e) => {
    console.error(e.message ?? e);
    process.exit(1);
  });
}
