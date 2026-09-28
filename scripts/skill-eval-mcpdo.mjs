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
// Usage:
//   npm run skills:eval:mcpdo
//   RUNS=5 THRESHOLD=0.8 npm run skills:eval:mcpdo
//   AGENT=copilot npm run skills:eval:mcpdo

import {
  cpSync,
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

const THRESHOLD = Number(process.env.THRESHOLD ?? 0.8);
const RUNS = Number(process.env.RUNS ?? 3);
const CONCURRENCY = Number(process.env.CONCURRENCY ?? 4);
const AGENT = process.env.AGENT ?? "claude";

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

/** Load and validate the committed cases. */
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
  const evalsFile = EVALS_FILE;
  const cases = JSON.parse(readFileSync(evalsFile, "utf8"));
  const invalid = validateEvalCases(SKILL_NAME, cases, new Set([SKILL_NAME]));
  if (invalid.length > 0) {
    throw new Error(`skills/mcpdo/evals/evals.json: ${invalid.join("; ")}`);
  }
  return cases;
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
  if (!Number.isFinite(THRESHOLD) || THRESHOLD < 0 || THRESHOLD > 1) {
    console.error(
      `skills:eval:mcpdo — THRESHOLD must be a number in [0, 1] (got ${process.env.THRESHOLD}).`,
    );
    process.exit(1);
  }
  const cases = loadCases().map((c) => ({ ...c, from: SKILL_NAME }));
  const sandbox = makeSandbox();
  console.log(
    `skills:eval:mcpdo — ${cases.length} cases x ${RUNS} runs, agent ${AGENT}, sandbox ${sandbox}`,
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
    process.exit(failed > 0 ? 1 : 0);
  } finally {
    rmSync(sandbox, { recursive: true, force: true });
  }
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
