// The shim's whole job is fidelity: same argv to the real binary, same bytes
// on the same streams, same exit code — with a transcript on the side. So
// the test drives it end-to-end against a fixture "real CLI" and asserts on
// all four at once. A unit test of the internals would pass while the tee
// dropped a stream (Copilot).

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SHIM = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "mcpdo-eval-shim.mjs",
);

// Echoes argv on stdout, a marker + upper-cased stdin on stderr, exits 3.
const FIXTURE = `
let input = "";
process.stdin.on("data", (c) => (input += c));
process.stdin.on("end", () => {
  process.stdout.write("argv:" + process.argv.slice(2).join(",") + "\\n");
  process.stderr.write("err:" + input.toUpperCase());
  process.exit(3);
});
`;

function runShimProcess(args, { stdinText = "", env = {} } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [SHIM, ...args], {
      env: { ...process.env, ...env },
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (c) => (stdout += c));
    child.stderr.on("data", (c) => (stderr += c));
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stdout, stderr }));
    child.stdin.end(stdinText);
  });
}

test("shim tees stdio verbatim, mirrors exit, and records the transcript", async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "mcpdo-shim-test-"));
  try {
    const realBin = path.join(dir, "fixture.mjs");
    const logPath = path.join(dir, "log.ndjson");
    writeFileSync(realBin, FIXTURE);

    const out = await runShimProcess(["tools/call", "get_sum", "a:=2"], {
      stdinText: "hi",
      env: { MCPDO_EVAL_REAL: realBin, MCPDO_EVAL_LOG: logPath },
    });
    assert.equal(out.code, 3);
    assert.equal(out.stdout, "argv:tools/call,get_sum,a:=2\n");
    assert.equal(out.stderr, "err:HI");

    const records = readFileSync(logPath, "utf8")
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l));
    assert.equal(records.length, 1);
    const r = records[0];
    assert.deepEqual(r.argv, ["tools/call", "get_sum", "a:=2"]);
    assert.equal(r.exit, 3);
    assert.ok(r.start <= r.end);
    const byStream = (s) =>
      r.events
        .filter((e) => e.stream === s)
        .map((e) => e.data)
        .join("");
    assert.equal(byStream("stdin"), "hi");
    assert.equal(byStream("stdout"), "argv:tools/call,get_sum,a:=2\n");
    assert.equal(byStream("stderr"), "err:HI");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("shim refuses to run without its env contract", async () => {
  const out = await runShimProcess(["anything"], {
    env: { MCPDO_EVAL_REAL: "", MCPDO_EVAL_LOG: "" },
  });
  assert.equal(out.code, 2);
  assert.match(out.stderr, /MCPDO_EVAL_REAL and MCPDO_EVAL_LOG/);
});
