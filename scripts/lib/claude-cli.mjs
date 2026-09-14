// Spawning the `claude` CLI from the root scripts (#2163, Copilot).
//
// On Windows an npm-installed `claude` is a `.cmd` shim, and Node has refused
// shell-free `.cmd`/`.bat` spawns since the CVE-2024-27980 hardening — so a
// plain `spawnSync("claude", …)` reports ENOENT there even though the CLI is
// installed. Every consumer of that would then be wrong in a *quiet* way:
// `verify:skills` would skip its authoritative hand-off, `verify:skills:cli`
// would download the pinned package it already has (and fail offline), and
// `skills:eval` would report "not on PATH".
//
// The shell that fixes it introduces the #1939 problem — `cmd.exe` re-parses a
// space-joined string, so any argument holding a metacharacter becomes syntax —
// so arguments go through the same `winShellArgs` quoting the npm/npx call
// sites use. This is deliberately the ONLY place that decides either question.

import { spawnSync } from "node:child_process";
import { winShellArgs } from "./win-shell-args.mjs";

/**
 * `spawnSync` arguments for a `claude` invocation, correct on every platform.
 *
 * @param {string[]} args
 * @param {object} [options] Passed through to `spawnSync`.
 * @param {string} [platform] Defaults to the current platform; injectable for tests.
 * @returns {{ command: string, args: string[], options: object }}
 */
export function claudeSpawnArgs(
  args,
  options = {},
  platform = process.platform,
) {
  return {
    command: "claude",
    args: winShellArgs(args, platform),
    options: { ...options, shell: platform === "win32" },
  };
}

/**
 * Read the installed CLI's version, or null when there is no usable one.
 *
 * "Usable" deliberately includes parsing the output: a `claude` that answers
 * `--version` with something unrecognizable cannot be trusted to be the pinned
 * one either, and the callers all treat null as "use the pinned package".
 *
 * Generic in the parser's result: this helper only distinguishes "parsed" from
 * "did not", so the shape is whatever the caller's parser returns — today
 * `{ parts, prerelease }` from `parseClaudeVersion`. Hard-coding `number[]`
 * here made valid callers look type-invalid (Copilot).
 *
 * @template T
 * @param {(text: string) => T | null} parseVersion
 * @param {{ spawn?: typeof spawnSync, platform?: string }} [io]
 * @returns {T | null}
 */
export function probeClaudeVersion(
  parseVersion,
  { spawn = spawnSync, platform } = {},
) {
  const { command, args, options } = claudeSpawnArgs(
    ["--version"],
    { encoding: "utf8" },
    platform,
  );
  const res = spawn(command, args, options);
  if (res.error || res.status !== 0) return null;
  return parseVersion(res.stdout ?? "");
}
