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

import { spawn } from "node:child_process";
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomBytes, randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { AGENTS, formatReport, runPrompt } from "./skill-eval.mjs";
import { parseSkill, validateEvalCases } from "./lib/skill-manifest.mjs";
import {
  assistantReplyText,
  REPLY_TEXT_OPTIONS,
  evalExpectCalls,
  streamText,
  validateBehaviorCase,
  claudeSessionId,
  lastCommandBefore,
  succeededBefore,
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
const EVALS_FILE = path.join(ROOT, "clients", "mcpdo", "evals", "evals.json");
const SKILL_NAME = "mcpdo";

// Behavior-eval fixtures: the real CLI build the shim wraps, the shim
// itself, and the stdio test server the private catalog points at. Builds,
// not sources — the eval measures what a user would run.
const REAL_BIN = path.join(ROOT, "clients", "mcpdo", "build", "mcp-bin.js");
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
// `all` runs every known agent in sequence; a single agent name narrows the
// run (e.g. AGENT=claude for cheaper iteration).
const AGENT = process.env.AGENT ?? "all";
// Behavior knobs are separate from the trigger ones: a multi-turn agentic
// run costs an order of magnitude more than a one-turn trigger sample, and
// its hit rate is honestly lower — 0.5 strict to start, tightened as the
// skill improves rather than loosened to pass.
const BEHAVIOR_RUNS = Number(process.env.BEHAVIOR_RUNS ?? RUNS);
const BEHAVIOR_THRESHOLD = Number(process.env.BEHAVIOR_THRESHOLD ?? 0.5);
const BEHAVIOR_TURNS = Number(process.env.BEHAVIOR_TURNS ?? 14);
// Substring filter over case prompts (both sections) for cheap iteration on
// one case: `CASE_MATCH="add 2 and 3" npm run skills:eval:mcpdo`. A filtered
// run is a dev probe, not a measurement — the summary says so when active.
const CASE_MATCH = process.env.CASE_MATCH ?? "";

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
    throw new Error("clients/mcpdo/evals/evals.json must be an array");
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
    throw new Error(`clients/mcpdo/evals/evals.json: ${kindErrors.join("; ")}`);
  }
  const trigger = all.filter((c) => c.kind === "trigger");
  const behavior = all.filter((c) => c.kind === "behavior");
  const errors = [
    ...validateEvalCases(SKILL_NAME, trigger, new Set([SKILL_NAME])),
    ...behavior.flatMap((c, i) => validateBehaviorCase(c, i)),
  ];
  if (errors.length > 0) {
    throw new Error(`clients/mcpdo/evals/evals.json: ${errors.join("; ")}`);
  }
  return { trigger, behavior };
}

/**
 * Agent arguments for a BEHAVIOR run: the trigger policy plus shell, scoped
 * to mcpdo by command-level approval.
 *
 * SECURITY NOTE — this scoping is NOT a boundary. The approval patterns are
 * prefix matches (`mcpdo x && anything` passes), and `mcpdo connect` itself
 * launches arbitrary stdio commands by design. What the patterns do is keep a
 * COOPERATING model from drifting into unrelated shell work (probed live:
 * unapproved effectful commands fail fast and the run continues, so the
 * denials cost turns, not hangs). The agent's command environment is
 * minimized separately (see agentEnv in skill-eval.mjs); a runner who wants
 * hard isolation from a misbehaving model should run this suite inside an
 * OS-level sandbox of their choice (container, VM, dedicated user).
 *
 * Passed to `runPrompt` as `agentArgsFn` — a replacement, because the
 * trigger policy's `--deny-tool shell` / `--disallowedTools Bash` cannot be
 * retracted by appending.
 *
 * @param {string} agent
 * @param {number} maxTurns
 * @param {string | null} [resumeSessionId] The session id for a multi-turn
 *   OAuth behavior case. For claude it is the prior turn's captured id, added
 *   as `--resume` on the second turn only. For copilot it is an id the harness
 *   minted, added as `--session-id` on both turns (which that flag sets then
 *   resumes). Null for a single-turn case, where both agents start fresh.
 * @returns {string[]}
 */
export function behaviorAgentArgs(agent, maxTurns, resumeSessionId = null) {
  if (agent === "copilot") {
    return [
      "--output-format",
      "json",
      // One flag both sets and resumes: on turn 1 it mints the session under
      // the id the harness chose, on turn 2 the same id continues it (verified
      // against the live CLI). Unlike claude there is nothing to parse out of
      // the stream — the harness owns the id — so it is passed on BOTH turns.
      ...(resumeSessionId ? ["--session-id", resumeSessionId] : []),
      // No `--available-tools`: its availability names differ from the
      // approval-pattern names (the shell tool is `bash` in events but
      // `shell(...)` in patterns), and naming it wrong silently removes the
      // tool — after which the model FABRICATES command output. Everything
      // unapproved is auto-denied in headless mode (drift reduction, not
      // containment — see the function doc).
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
    // Continue the prior turn's session when resuming; reads the new prompt
    // from stdin exactly as a fresh `-p` run does.
    ...(resumeSessionId ? ["--resume", resumeSessionId] : []),
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
 * Normalize a behavior case's server declaration to a name→spec map.
 * `servers` wins (validation forbids both); `server` is sugar for a single
 * entry under the default name; neither means the default composition.
 *
 * @param {object} c A behavior case.
 * @returns {Record<string, object | undefined>}
 */
export function caseServers(c) {
  if (c.servers !== undefined) return c.servers;
  return { "test-stdio": c.server };
}

/**
 * Build one behavior sample's hermetic mcpdo world, next to (not inside) its
 * sandbox so the agent's cwd stays clean.
 *
 * Private daemon binding (own dir + minted token — the same isolation
 * `mcpdo private` gives a shell), throwaway storage, a catalog holding
 * exactly the case's servers, and a bin dir whose `mcpdo` is the recording
 * shim.
 *
 * No `MCP_ALLOW_DEFAULT_CONNECTION`: agents run non-TTY, so the mcpdo
 * itself refuses implicit-MRU targeting (`requireExplicitConnection`) —
 * every successful targeting call in a transcript names its connection,
 * which is what keeps `connection` matchers decidable even with several
 * catalog entries.
 *
 * Per-entry spec forms (see `validateServerSpec`): undefined → the stdio
 * test server in its DEFAULT composition; `{url}` → an already-running HTTP
 * fixture; composed with stdio (or no) transport → config on disk, served
 * through the eval's stdio launcher; composed with streamable-http
 * transport → started IN-PROCESS (`TestServerHttp`) and the entry points at
 * its URL. In-process because nothing forces a process boundary for HTTP
 * (the daemon only spawns stdio commands), the fixture can't pollute the
 * transcript (the shim records only mcpdo invocations), and teardown is a
 * direct `stop()`. OAuth rides on the same instance (`oauth` in the spec).
 *
 * @param {string} sandbox The sample's sandbox dir (from `makeSandbox`).
 * @param {Record<string, object | undefined>} [servers] Name→spec map (from
 *   `caseServers`).
 * @returns {Promise<{ env: Record<string, string>, logPath: string,
 *   teardown: () => Promise<void> }>}
 */
export async function makeBehaviorEnv(
  sandbox,
  servers = { "test-stdio": undefined },
) {
  const envDir = `${sandbox}-env`;
  const daemonDir = path.join(envDir, "daemon");
  const storageDir = path.join(envDir, "storage");
  const binDir = path.join(envDir, "bin");
  const logPath = path.join(envDir, "mcpdo-transcript.ndjson");
  const catalogPath = path.join(envDir, "catalog.json");
  mkdirSync(daemonDir, { recursive: true, mode: 0o700 });
  mkdirSync(storageDir, { recursive: true });
  mkdirSync(binDir, { recursive: true });
  /** In-process HTTP fixtures to stop at teardown. */
  const httpServers = [];
  const entries = {};
  try {
    for (const [name, spec] of Object.entries(servers)) {
      if (spec === undefined) {
        entries[name] = {
          type: "stdio",
          command: process.execPath,
          args: [TEST_SERVER_BIN],
        };
      } else if ("url" in spec) {
        entries[name] = { type: "streamable-http", url: spec.url };
      } else if (spec.transport?.type === "streamable-http") {
        const serverConfigPath = path.join(
          envDir,
          `server-config-${name}.json`,
        );
        writeFileSync(serverConfigPath, JSON.stringify(spec, null, 2));
        const { loadConfig, resolveConfig, TestServerHttp } = await import(
          path.join(ROOT, "test-servers", "build", "index.js")
        );
        const server = new TestServerHttp(
          resolveConfig(loadConfig(serverConfigPath)),
        );
        await server.start();
        httpServers.push(server);
        entries[name] = { type: "streamable-http", url: server.url };
      } else {
        const serverConfigPath = path.join(
          envDir,
          `server-config-${name}.json`,
        );
        // The launcher is always a stdio child; the case spec needn't say so
        // (and validateServerSpec rejects a spec that says otherwise).
        writeFileSync(
          serverConfigPath,
          JSON.stringify({ transport: { type: "stdio" }, ...spec }, null, 2),
        );
        entries[name] = {
          type: "stdio",
          command: process.execPath,
          args: [SERVER_LAUNCHER, serverConfigPath],
        };
      }
    }
  } catch (err) {
    for (const s of httpServers) await s.stop().catch(() => {});
    rmSync(envDir, { recursive: true, force: true });
    throw err;
  }
  writeFileSync(catalogPath, JSON.stringify({ mcpServers: entries }, null, 2));
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
    // Ephemeral OAuth callback port per sample: the default is a fixed port
    // (6276), which concurrent samples' detached auth helpers fight over —
    // the loser's consent redirect lands on the winner's helper and sign-in
    // silently never completes (measured: intermittent secure-add misses
    // with endless `authorized: false` polls).
    MCP_OAUTH_CALLBACK_URL: "http://127.0.0.1:0/oauth/callback",
    MCPDO_EVAL_REAL: REAL_BIN,
    MCPDO_EVAL_LOG: logPath,
  };
  const teardown = async ({ keepEnvDir = false } = {}) => {
    // Daemon first (it may hold connections into the HTTP fixtures), then
    // the fixtures. Direct spawn of the real build, not the shim: teardown
    // must not appear in the transcript, and must work even if the shim is
    // broken. Async spawn, NOT spawnSync — the in-process fixtures share
    // this event loop, and a synchronous wait would deadlock any daemon
    // shutdown that talks to them (measured: the sync variant stalled).
    await new Promise((resolve) => {
      const child = spawn(process.execPath, [REAL_BIN, "daemon", "stop"], {
        env: { ...process.env, ...env },
        stdio: "ignore",
      });
      const timer = setTimeout(() => child.kill("SIGKILL"), 15000);
      child.on("exit", () => {
        clearTimeout(timer);
        resolve();
      });
      child.on("error", () => {
        clearTimeout(timer);
        resolve();
      });
    });
    for (const s of httpServers) await s.stop().catch(() => {});
    if (!keepEnvDir) rmSync(envDir, { recursive: true, force: true });
  };
  return { env, logPath, envDir, teardown };
}

/** Parse the shim transcript; tolerate a torn final line, never silent-drop. */
export function readTranscript(logPath) {
  if (!existsSync(logPath)) return [];
  const lines = readFileSync(logPath, "utf8").split("\n");
  const lastNonEmpty = lines.findLastIndex((l) => l.trim() !== "");
  const records = [];
  for (let i = 0; i <= lastNonEmpty; i++) {
    if (lines[i].trim() === "") continue;
    try {
      records.push(JSON.parse(lines[i]));
    } catch {
      // Only the final record can legitimately be malformed (a write torn
      // by a kill); anything earlier is corruption the scorer must not
      // silently misread as agent behavior.
      if (i === lastNonEmpty) break;
      throw new Error(
        `${logPath}: malformed transcript record at line ${i + 1}`,
      );
    }
  }
  return records;
}

/**
 * Simulate the human side of a headless OAuth flow: visit the sign-in link
 * the agent was handed and approve the consent page.
 *
 * Non-TTY `connect` against an auth-requiring server exits 0 with the
 * authorize URL in its output while a detached helper holds the loopback
 * callback. In a real session the agent relays that URL and a human clicks
 * it; here the harness is the human. GET shows the composable AS's consent
 * page; POSTing the same params approves it; following the redirect delivers
 * code+state to the helper's loopback listener, which finishes the token
 * exchange — after which the agent's next call revives the connection.
 *
 * @param {string} authUrl The full /oauth/authorize URL from the transcript.
 */
export async function clickConsent(authUrl) {
  let res = await fetch(authUrl, { redirect: "manual" });
  if (res.status === 200) {
    const u = new URL(authUrl);
    res = await fetch(`${u.origin}${u.pathname}`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(u.searchParams),
      redirect: "manual",
    });
  }
  if (res.status !== 301 && res.status !== 302) {
    throw new Error(
      `consent POST: expected redirect, got ${res.status}: ${(await res.text()).slice(0, 200)}`,
    );
  }
  const location = res.headers.get("location");
  if (!location) throw new Error("consent redirect missing Location header");
  // The loopback callback owned by the detached auth helper.
  const cb = await fetch(new URL(location, authUrl));
  await cb.text().catch(() => {});
}

const AUTHORIZE_URL_RE =
  /https?:\/\/[^\s"'<>\\]+\/oauth\/authorize\?[^\s"'<>\\]*/g;

/**
 * Watch a behavior sample's transcript for authorize URLs and auto-approve
 * each one once (`autoConsent` cases). Polling the transcript, not the live
 * streams: the shim appends a record when an invocation exits, and non-TTY
 * connect exits as soon as it prints the URL, so the link shows up while
 * the agent is still mid-session. Click failures are logged, not thrown —
 * the case then fails on its own matchers, with this as the diagnostic.
 *
 * @param {string} logPath The sample's transcript path.
 * @param {object} [opts]
 * @param {number} [opts.delayMs] How long a discovered URL sits unclicked. The
 *   simulated human signing in instantly would let the agent skip the relay
 *   entirely (its first poll already shows the connection up), so an
 *   `expectReply` case holds the click back long enough that the agent has
 *   to tell the user about the link, exactly as in a real session.
 * @param {(() => string) | null} [opts.replyText] When set, a URL is clicked
 *   only once it appears verbatim in the text this getter returns — the
 *   agent's own user-facing replies. This makes consent *causal* on the
 *   relay: the simulated human can only open a link the agent actually
 *   showed them, so a session where the agent hoards the URL never
 *   authenticates and fails on `expectCalls` too, exactly as a real user is
 *   stranded.
 * @returns {{ stop: () => void, clickedCount: () => number }}
 */
export function startConsentClicker(logPath, opts = {}) {
  const { delayMs = 0, replyText = null } = opts;
  const clicked = new Set();
  const firstSeen = new Map();
  let inFlight = false;
  let succeeded = 0;
  const timer = setInterval(() => {
    if (inFlight) return;
    const now = Date.now();
    const relayed = replyText === null ? null : replyText();
    const urls = new Set();
    for (const record of readTranscript(logPath)) {
      // Scan joined per-stream text, not individual chunks: a long authorize
      // URL (e.g. inside pretty-printed `--format json` output) can be split
      // across stream chunks, and a per-chunk scan then sees only fragments
      // (measured: copilot misses where sign-in silently never happened).
      for (const stream of ["stdout", "stderr"]) {
        for (const url of streamText(record, stream).match(AUTHORIZE_URL_RE) ??
          []) {
          if (clicked.has(url)) continue;
          if (relayed !== null && !relayed.includes(url)) continue;
          if (!firstSeen.has(url)) firstSeen.set(url, now);
          if (now - firstSeen.get(url) >= delayMs) urls.add(url);
        }
      }
    }
    if (urls.size === 0) return;
    for (const url of urls) clicked.add(url);
    inFlight = true;
    (async () => {
      for (const url of urls) {
        try {
          await clickConsent(url);
          succeeded++;
          console.error(`  autoConsent: clicked ${new URL(url).pathname}`);
        } catch (err) {
          console.error(`  autoConsent: click failed — ${err.message}`);
        }
      }
    })().finally(() => {
      inFlight = false;
    });
  }, 250);
  return {
    stop: () => clearInterval(timer),
    // How many consent clicks have COMPLETED (not merely been scheduled) — the
    // multi-turn flow waits on this to know the simulated sign-in happened
    // before it resumes the session.
    clickedCount: () => succeeded,
  };
}

/**
 * One out-of-band `connections/show @name --format json` against the sample's
 * daemon, read back as parsed JSON. Spawned as the REAL bin directly (not
 * through the PATH shim), so it never appears in the scored transcript —
 * `expectCalls` sees only what the AGENT ran.
 *
 * @param {NodeJS.ProcessEnv} env The sample's hermetic env (binds the daemon).
 * @param {string} name Connection/catalog name.
 * @returns {Promise<Record<string, unknown> | null>} Parsed result, or null
 *   on any failure (daemon down, unknown connection, unparseable output).
 */
function daemonShowJson(env, name) {
  return new Promise((resolve) => {
    const child = spawn(
      process.execPath,
      [REAL_BIN, "connections/show", `@${name}`, "--format", "json"],
      { env, stdio: ["ignore", "pipe", "ignore"] },
    );
    let out = "";
    child.stdout.on("data", (d) => {
      out += d;
    });
    child.on("error", () => resolve(null));
    child.on("close", () => {
      try {
        resolve(JSON.parse(out));
      } catch {
        resolve(null);
      }
    });
  });
}

/**
 * Wait for a pending OAuth connection to finish signing in, driving the
 * completion itself. `connections/show` revives a pending entry once tokens
 * are on disk (see the daemon's show handler), so polling it both WAITS for
 * the simulated human's consent click to land AND performs the revive the
 * agent's next op would — leaving the connection live for the resumed turn.
 * Ready ⇔ the result no longer carries `authUrl`/`pendingAuth`. Returns false
 * on timeout (the agent likely never relayed the URL, so nothing was clicked);
 * the case then fails on its own matchers, with the timeout as the signal.
 *
 * @param {NodeJS.ProcessEnv} env The sample's hermetic env.
 * @param {string} name Connection/catalog name.
 * @param {number} [timeoutMs]
 * @returns {Promise<boolean>}
 */
async function waitForConnectionReady(env, name, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const result = await daemonShowJson(env, name);
    if (result && !result.authUrl && result.pendingAuth !== true) return true;
    if (Date.now() >= deadline) return false;
    await new Promise((r) => setTimeout(r, 400));
  }
}

/**
 * Where a failed sample's artifacts are preserved for diagnosis: the shim
 * transcript, the raw agent stream, the composed catalog/server configs, and
 * the case itself. Never auto-cleaned — delete by hand when done.
 */
export const FAILURES_DIR = path.join(
  os.homedir(),
  ".cache",
  "mcpdo-skill-eval",
  "failures",
);

/**
 * Run one behavior sample: fresh sandbox + hermetic env, one agent session,
 * transcript scored against the case's `expectCalls`. On a miss the sample's
 * env dir (transcript, agent stream, configs, case) is preserved under
 * {@link FAILURES_DIR} and its path returned as `artifactsDir`.
 *
 * @param {object} c A behavior case.
 * @param {string} agent One of `AGENTS`.
 * @returns {Promise<{ hit: boolean, failures: string[], calls: number }>}
 */
async function runBehaviorSample(c, agent) {
  const sandbox = makeSandbox();
  let ready;
  try {
    ready = await makeBehaviorEnv(sandbox, caseServers(c));
  } catch (err) {
    // makeBehaviorEnv cleans up its own envDir on failure; the sandbox
    // predates it and is ours to reclaim.
    rmSync(sandbox, { recursive: true, force: true });
    throw err;
  }
  const { env, logPath, envDir, teardown } = ready;
  const rawLogPath = path.join(envDir, "agent-session.ndjson");
  // The reply gate reads the live raw agent stream, appended per chunk by
  // runPrompt — so mid-session the getter sees every reply sent so far.
  const replyText = () =>
    existsSync(rawLogPath)
      ? assistantReplyText(
          readFileSync(rawLogPath, "utf8"),
          REPLY_TEXT_OPTIONS[agent],
        )
      : "";
  const clicker =
    c.autoConsent === true
      ? startConsentClicker(logPath, {
          delayMs: c.consentDelayMs ?? 0,
          replyText: c.consentAfterReply === true ? replyText : null,
        })
      : null;
  let keepEnvDir = false;
  let artifactsDir = null;
  // A multi-turn case (`followUp`) runs the prompt, completes the simulated
  // sign-in out-of-band, then resumes the SAME claude session with the
  // follow-up text — modelling a real session where the agent relays the URL,
  // ends its turn, and continues once the user says they signed in. Turn 1's
  // user-facing reply and the follow-up's send time are captured so the
  // scorer can separate "shown the URL in turn 1" and "stopped after connect"
  // from the resumed turn's work.
  const isMultiTurn =
    typeof c.followUp === "string" && c.followUp.trim() !== "";
  const name = Object.keys(caseServers(c))[0];
  // Copilot's session id is the harness's to choose — minted up front and set
  // on turn 1 via `--session-id` so turn 2 can resume it. Claude instead
  // stamps its own id, which turn 1 emits and we read back below; so turn 1
  // passes no id for claude.
  const copilotSessionId =
    isMultiTurn && agent === "copilot" ? randomUUID() : null;
  let turn1Reply = "";
  let followUpAt = Number.POSITIVE_INFINITY;
  try {
    await runPrompt(c.prompt, {
      cwd: sandbox,
      agent,
      maxTurns: BEHAVIOR_TURNS,
      env,
      agentArgsFn: behaviorAgentArgs,
      rawLogPath,
      resumeSessionId: copilotSessionId,
    });
    if (isMultiTurn) {
      turn1Reply = replyText();
      // Drive + wait for the simulated sign-in the clicker performs, so the
      // resumed turn finds the connection live (as `connect` promised the
      // user it would "complete automatically").
      const ready = await waitForConnectionReady(env, name);
      if (!ready) {
        console.error(
          `  multi-turn: ${name} never finished signing in before the follow-up`,
        );
      }
      // Copilot uses the id we minted; claude's is read back from its stream.
      const sessionId =
        agent === "copilot"
          ? copilotSessionId
          : existsSync(rawLogPath)
            ? claudeSessionId(readFileSync(rawLogPath, "utf8"))
            : null;
      followUpAt = Date.now();
      if (sessionId) {
        await runPrompt(c.followUp, {
          cwd: sandbox,
          agent,
          maxTurns: BEHAVIOR_TURNS,
          env,
          agentArgsFn: behaviorAgentArgs,
          rawLogPath,
          resumeSessionId: sessionId,
        });
      } else {
        console.error(
          `  multi-turn: no ${agent} session id captured — cannot resume`,
        );
      }
    }
    const records = readTranscript(logPath);
    const { ok: callsOk, failures } = evalExpectCalls(c.expectCalls, records);
    let ok = callsOk;
    if (c.expectReply !== undefined) {
      // What the agent SAID, not what it ran: the raw agent stream is the
      // only record of the user-facing reply (see assistantReplyText). For a
      // multi-turn case this is the FIRST turn's reply — the URL must reach
      // the user before they sign in, not after.
      const reply = isMultiTurn ? turn1Reply : replyText();
      if (!new RegExp(c.expectReply).test(reply)) {
        ok = false;
        failures.push(
          `expectReply: no assistant text matched /${c.expectReply}/ ` +
            `(the agent never showed it to the user)`,
        );
      }
    }
    if (c.expectLastCallTurn1 !== undefined) {
      // Pure-connect cases (no task command to run): the agent's final
      // first-turn mcpdo command must be `connect` — it relayed the URL and
      // stopped, with nothing legitimate to chain after it.
      const last = lastCommandBefore(records, followUpAt);
      if (last !== c.expectLastCallTurn1) {
        ok = false;
        failures.push(
          `expectLastCallTurn1: turn 1's final mcpdo command was ` +
            `\`${last ?? "(none)"}\`, expected \`${c.expectLastCallTurn1}\` ` +
            `(did it poll/retry after showing the URL instead of ending the turn?)`,
        );
      }
    }
    if (c.rejectCompletedTurn1 !== undefined) {
      // Cases with a task command (e.g. `tools/list`): did the agent STOP to
      // let the user sign in, or barrel through? The signal is whether the
      // task command SUCCEEDED in turn 1 — a poll that ran until the
      // connection came up, or a genuine completion, exits 0; an optimistic
      // `connect && tools/list` chain exits non-zero (auth_required) and the
      // agent correctly waits. Last-command cannot tell those apart; this can.
      if (succeededBefore(records, followUpAt, c.rejectCompletedTurn1)) {
        ok = false;
        failures.push(
          `rejectCompletedTurn1: \`${c.rejectCompletedTurn1}\` succeeded ` +
            `(exit 0) in turn 1 — the agent completed the task instead of ` +
            `waiting for the user to sign in (polled/retried, or never stopped).`,
        );
      }
    }
    if (c.expectReplyFollowUp !== undefined) {
      // What the RESUMED turn told the user — turn-2 text only, found by
      // stripping the turn-1 prefix the full reply is built on.
      const full = replyText();
      const afterText = full.startsWith(turn1Reply)
        ? full.slice(turn1Reply.length)
        : full;
      if (!new RegExp(c.expectReplyFollowUp).test(afterText)) {
        ok = false;
        failures.push(
          `expectReplyFollowUp: no assistant text after the follow-up ` +
            `matched /${c.expectReplyFollowUp}/ ` +
            `(it never reported the result once access was granted)`,
        );
      }
    }
    // Compact transcript for miss diagnostics: what the agent actually ran
    // and what it got back — the eval's equivalent of a stack trace.
    const transcript = ok
      ? []
      : records.map((r) => ({
          argv: r.argv,
          exit: r.exit,
          start: r.start,
          end: r.end,
          out: streamText(r, "stdout").slice(0, 300),
          err: streamText(r, "stderr").slice(0, 300),
        }));
    if (!ok || process.env.MCPDO_EVAL_KEEP === "1") {
      keepEnvDir = true;
      writeFileSync(
        path.join(envDir, "case.json"),
        JSON.stringify({ agent, case: c, failures }, null, 2),
      );
      artifactsDir = path.join(
        FAILURES_DIR,
        `${new Date().toISOString().replace(/[:.]/g, "-")}-${agent}-${path.basename(envDir)}`,
      );
    }
    return {
      hit: ok,
      failures,
      calls: records.length,
      transcript,
      artifactsDir,
    };
  } finally {
    clicker?.stop();
    await teardown({ keepEnvDir });
    if (keepEnvDir && artifactsDir !== null) {
      mkdirSync(FAILURES_DIR, { recursive: true });
      renameSync(envDir, artifactsDir);
    }
    rmSync(sandbox, { recursive: true, force: true });
  }
}

/**
 * Run `fn` over `items` with at most `n` in flight.
 *
 * A rejecting item must not blow up the pool mid-run: sibling samples own
 * live resources (spawned daemons, sandbox dirs) that only their own
 * try/finally reclaims, so an immediate `Promise.all` rejection would exit
 * the process before that cleanup runs. With `onError`, a rejection is
 * mapped to a result and the run continues. Without it, the pool stops
 * taking new items, lets in-flight siblings finish (and clean up), then
 * rethrows the first error. Exported for tests.
 *
 * @param {Array<T>} items
 * @param {number} n Max concurrency.
 * @param {(item: T) => Promise<R>} fn
 * @param {(item: T, err: unknown) => R} [onError]
 * @returns {Promise<R[]>}
 * @template T, R
 */
export async function pool(items, n, fn, onError) {
  const out = new Array(items.length);
  let firstError = null;
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (firstError === null && i < items.length) {
        const idx = i++;
        try {
          out[idx] = await fn(items[idx]);
        } catch (err) {
          if (onError) {
            out[idx] = onError(items[idx], err);
          } else {
            firstError ??= err;
          }
        }
      }
    }),
  );
  if (firstError !== null) throw firstError;
  return out;
}

async function main() {
  if (AGENT !== "all" && !AGENTS.includes(AGENT)) {
    console.error(
      `skills:eval:mcpdo — unknown AGENT \`${AGENT}\`; known: all, ${AGENTS.join(", ")}`,
    );
    process.exit(1);
  }
  const agents = AGENT === "all" ? [...AGENTS] : [AGENT];
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
  const byMatch = (c) => c.prompt.includes(CASE_MATCH);
  if (CASE_MATCH !== "") {
    console.log(
      `skills:eval:mcpdo — CASE_MATCH filter active (${JSON.stringify(CASE_MATCH)}); this is a dev probe, not a measurement`,
    );
  }
  let failed = 0;
  for (const agent of agents) {
    failed += await runTriggerSection(
      trigger.filter(byMatch).map((c) => ({ ...c, from: SKILL_NAME })),
      agent,
    );
    failed += await runBehaviorSection(behavior.filter(byMatch), agent);
  }
  process.exit(failed > 0 ? 1 : 0);
}

/**
 * Trigger section: did the skill fire? One shared read-only sandbox.
 *
 * @returns {Promise<number>} Failed case count.
 */
async function runTriggerSection(cases, agent) {
  if (cases.length === 0) return 0;
  const sandbox = makeSandbox();
  console.log(
    `skills:eval:mcpdo trigger — ${cases.length} cases x ${RUNS} runs, agent ${agent}, sandbox ${sandbox}`,
  );
  const samples = cases.flatMap((c) => Array.from({ length: RUNS }, () => c));
  try {
    const results = await pool(samples, CONCURRENCY, async (c) => {
      const invoked = await runPrompt(c.prompt, {
        cwd: sandbox,
        agent,
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
        agent,
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
async function runBehaviorSection(cases, agent) {
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
  // Both agents can resume a prior session, so multi-turn cases run on all of
  // them (claude via `--resume`, copilot via a minted `--session-id`).
  console.log(
    `skills:eval:mcpdo behavior — ${cases.length} cases x ${BEHAVIOR_RUNS} runs, agent ${agent}, budget ${BEHAVIOR_TURNS} turns`,
  );
  const samples = cases.flatMap((c) =>
    Array.from({ length: BEHAVIOR_RUNS }, () => c),
  );
  const results = await pool(
    samples,
    CONCURRENCY,
    async (c) => ({
      c,
      ...(await runBehaviorSample(c, agent)),
    }),
    // Infrastructure failure (spawn error, fixture died), not a model miss —
    // scored as a miss with an explicit reason so the section finishes and
    // sibling samples' daemons/sandboxes still get their teardown.
    (c, err) => ({
      c,
      hit: false,
      calls: 0,
      failures: [`sample error: ${err?.message ?? String(err)}`],
      transcript: [],
      artifactsDir: null,
    }),
  );
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
        if (r.artifactsDir) console.log(`    artifacts: ${r.artifactsDir}`);
        const t0 = r.transcript?.[0]?.start;
        for (const t of r.transcript ?? []) {
          const at =
            typeof t.start === "number" && typeof t0 === "number"
              ? ` @${((t.start - t0) / 1000).toFixed(1)}s+${((t.end - t.start) / 1000).toFixed(1)}s`
              : "";
          console.log(
            `    $ mcpdo ${t.argv.join(" ")} -> ${t.exit}${at}` +
              (t.out ? `\n      out: ${t.out.replace(/\n/g, "\\n")}` : "") +
              (t.err ? `\n      err: ${t.err.replace(/\n/g, "\\n")}` : ""),
          );
        }
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
