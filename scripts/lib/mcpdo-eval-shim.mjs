#!/usr/bin/env node
// Transparent recording wrapper around the real mcpdo, for behavior evals.
//
// The behavior eval (`skills:eval:mcpdo`) needs to know what an agent's
// shell actually asked mcpdo to do and what mcpdo answered — WITHOUT parsing
// shell strings out of the agent's event stream (quoting rules, chained
// commands and subshells make that a reimplementation of `sh`). So the
// harness puts a `mcpdo` shim first on PATH; the shim execs this file, which
// spawns the REAL CLI and tees all three stdio streams through untouched
// while recording a timestamped transcript.
//
// One JSON line per invocation, appended to `$MCPDO_EVAL_LOG`:
//
//   { argv, exit, start, end, events: [{ t, stream, data }] }
//
// `events` interleaves stdin/stdout/stderr in arrival order, so an
// interactive invocation (elicitation prompts answered over stdin, two-phase
// OAuth output on one blocked pipe) is captured as faithfully as an atomic
// one — for the simple case the transcript degenerates to a single stdout
// event. Output is recorded VERBATIM: the shim never injects `--format json`
// or any other flag, because which format the agent asked for is part of
// what is being measured.
//
// The record is written on child exit with a single appendFileSync — an
// O_APPEND write of one line, atomic enough for concurrent invocations
// within a sample (POSIX; the eval is POSIX-only, stated where it runs).

import { spawn } from "node:child_process";
import { appendFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Run the real CLI, teeing stdio and recording the transcript.
 *
 * Injectable so tests can drive it with a fixture child and in-memory
 * streams; the module main wires the real process.
 *
 * @param {object} opts
 * @param {string} opts.realBin Path to the real mcp-bin.js.
 * @param {string[]} opts.argv What the agent passed after `mcpdo`.
 * @param {string} opts.logPath Transcript destination (NDJSON, appended).
 * @param {NodeJS.ReadableStream} opts.stdin
 * @param {NodeJS.WritableStream} opts.stdout
 * @param {NodeJS.WritableStream} opts.stderr
 * @param {typeof spawn} [opts.spawnFn]
 * @param {typeof appendFileSync} [opts.appendFn]
 * @returns {Promise<number>} The child's exit code.
 */
export function runShim({
  realBin,
  argv,
  logPath,
  stdin,
  stdout,
  stderr,
  spawnFn = spawn,
  appendFn = appendFileSync,
}) {
  return new Promise((resolve, reject) => {
    const record = {
      argv,
      exit: null,
      start: Date.now(),
      end: null,
      events: [],
    };
    const child = spawnFn(process.execPath, [realBin, ...argv], {
      stdio: ["pipe", "pipe", "pipe"],
    });
    const tap = (stream) => (chunk) => {
      record.events.push({
        t: Date.now(),
        stream,
        data: chunk.toString("utf8"),
      });
    };
    stdin.on("data", (chunk) => {
      tap("stdin")(chunk);
      child.stdin.write(chunk);
    });
    stdin.on("end", () => child.stdin.end());
    // The child may exit without reading piped stdin; that EPIPE is its
    // business, not a shim failure.
    child.stdin.on("error", () => {});
    child.stdout.on("data", (chunk) => {
      tap("stdout")(chunk);
      stdout.write(chunk);
    });
    child.stderr.on("data", (chunk) => {
      tap("stderr")(chunk);
      stderr.write(chunk);
    });
    child.on("error", reject);
    child.on("close", (code) => {
      record.exit = code ?? 1;
      record.end = Date.now();
      appendFn(logPath, JSON.stringify(record) + "\n");
      resolve(record.exit);
    });
  });
}

const isMain =
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  const realBin = process.env.MCPDO_EVAL_REAL;
  const logPath = process.env.MCPDO_EVAL_LOG;
  if (!realBin || !logPath) {
    process.stderr.write(
      "mcpdo-eval-shim: MCPDO_EVAL_REAL and MCPDO_EVAL_LOG must be set\n",
    );
    process.exit(2);
  }
  runShim({
    realBin,
    argv: process.argv.slice(2),
    logPath,
    stdin: process.stdin,
    stdout: process.stdout,
    stderr: process.stderr,
  }).then(
    (code) => process.exit(code),
    (err) => {
      process.stderr.write(`mcpdo-eval-shim: ${err?.message ?? err}\n`);
      process.exit(2);
    },
  );
}
