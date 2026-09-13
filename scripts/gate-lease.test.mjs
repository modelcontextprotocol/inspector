// Tests for the local:gate lease (#2339). The pure helpers are table-driven;
// the lease itself is exercised against a REAL `proper-lockfile` lock, a real
// child process and — for the signal path — a real signal to a real wrapper
// process, each against a throwaway lease directory so no test can queue
// behind (or block) a developer's actual gate. Run via `npm run test:scripts`
// (node:test; the root has no vitest harness).

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

import {
  DIR_ENV,
  SKIP_ENV,
  STALE_MS,
  describeHolder,
  exitCodeFor,
  formatDuration,
  isSkipped,
  leaseDir,
  leaseTarget,
  lockPathOf,
  main,
  readHolder,
  runUnderLease,
  spawnSpec,
} from "./gate-lease.mjs";

const SCRIPT = fileURLToPath(new URL("./gate-lease.mjs", import.meta.url));

/** A fresh lease directory per test, so tests never contend with each other. */
function freshDir() {
  return mkdtempSync(join(tmpdir(), "gate-lease-test-"));
}

function collectLog() {
  const lines = [];
  return { lines, log: (line) => lines.push(line) };
}

/** Run `node -e <source>` under the lease with quiet stdio and fast knobs. */
function runNode(source, opts = {}) {
  return runUnderLease({
    command: process.execPath,
    args: ["-e", source],
    stdio: "ignore",
    pollMs: 25,
    progressMs: 60_000,
    ...opts,
  });
}

/** Poll until `predicate()` holds or `timeoutMs` passes. */
async function waitFor(predicate, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    assert.ok(Date.now() < deadline, "condition not met in time");
    await delay(25);
  }
}

function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

test("leaseDir: explicit override, then XDG_RUNTIME_DIR, then tmpdir", () => {
  assert.equal(leaseDir({ [DIR_ENV]: "/x/y" }), "/x/y");
  assert.equal(
    leaseDir({ XDG_RUNTIME_DIR: "/run/user/1" }),
    join("/run/user/1", "mcp-inspector-gate-lease"),
  );
  assert.equal(leaseDir({}), join(tmpdir(), "mcp-inspector-gate-lease"));
  // The lock is a sibling of the target, never inside it — a file inside the
  // lock directory would make its removal (and so stale takeover) fail.
  assert.equal(lockPathOf("/d"), `${leaseTarget("/d")}.lock`);
});

test("isSkipped: unset, empty and `0` mean the lease is on", () => {
  for (const [env, expected] of [
    [{}, false],
    [{ [SKIP_ENV]: "" }, false],
    [{ [SKIP_ENV]: "0" }, false],
    [{ [SKIP_ENV]: "1" }, true],
    [{ [SKIP_ENV]: "true" }, true],
  ]) {
    assert.equal(isSkipped(env), expected, JSON.stringify(env));
  }
});

test("formatDuration: seconds under a minute, m/ss above", () => {
  for (const [ms, expected] of [
    [0, "0s"],
    [-500, "0s"],
    [4_400, "4s"],
    [59_499, "59s"],
    [60_000, "1m00s"],
    [95_000, "1m35s"],
    [3_605_000, "60m05s"],
  ]) {
    assert.equal(formatDuration(ms), expected, String(ms));
  }
});

test("exitCodeFor: the child's code, else 128 + signal", () => {
  assert.equal(exitCodeFor({ code: 0, signal: null }), 0);
  assert.equal(exitCodeFor({ code: 7, signal: null }), 7);
  assert.equal(exitCodeFor({ code: null, signal: "SIGTERM" }), 143);
  assert.equal(exitCodeFor({ code: null, signal: "SIGINT" }), 130);
  assert.equal(exitCodeFor({ code: null, signal: "SIGNOPE" }), 128);
});

test("spawnSpec: shell-free and grouped on POSIX; cmd.exe-quoted on Windows", () => {
  // `npm` is `npm.cmd` on Windows and cannot be started without a shell, and
  // a shell re-parses any argument holding a space — the same pair of rules
  // `scripts/install-clients.mjs` and `scripts/lib/win-shell-args.mjs` encode.
  const args = ["run", "local:gate:stages", "a b"];
  assert.deepEqual(spawnSpec("npm", args, "darwin"), {
    command: "npm",
    args,
    shell: false,
    detached: true,
  });
  assert.deepEqual(spawnSpec("npm", args, "linux").detached, true);
  const win = spawnSpec("npm", args, "win32");
  assert.equal(win.shell, true);
  assert.equal(win.detached, false);
  assert.deepEqual(win.args, ["run", "local:gate:stages", '"a b"']);
});

test("readHolder/describeHolder: a missing or malformed record is not an error", () => {
  const dir = freshDir();
  assert.equal(readHolder(dir), null);
  assert.equal(describeHolder(null), "another local:gate");
  writeFileSync(leaseTarget(dir), "not json");
  assert.equal(readHolder(dir), null);
  writeFileSync(leaseTarget(dir), JSON.stringify({ pid: "12", cwd: "/w" }));
  assert.equal(readHolder(dir), null);
  const record = { pid: 12, cwd: "/w", startedAt: 1_000 };
  writeFileSync(leaseTarget(dir), JSON.stringify(record));
  assert.deepEqual(readHolder(dir), record);
  assert.equal(
    describeHolder(record, 96_000),
    "pid 12 in /w, running for 1m35s",
  );
});

test("two concurrent runs serialize: the second starts after the first ends", async () => {
  const dir = freshDir();
  const marks = join(dir, "marks.log");
  const { lines, log } = collectLog();
  const body = (label) =>
    `const fs=require("fs");const f=${JSON.stringify(marks)};` +
    `fs.appendFileSync(f,"${label} start "+Date.now()+"\\n");` +
    `setTimeout(()=>fs.appendFileSync(f,"${label} end "+Date.now()+"\\n"),300)`;
  const first = runNode(body("a"), { dir, log });
  // Give the first run the lock — and its holder record, which is written
  // just after — before the second asks, so which one waits, and what it is
  // told, are not themselves races the assertions have to allow for.
  await waitFor(() => existsSync(leaseTarget(dir)));
  const second = runNode(body("b"), { dir, log });
  assert.deepEqual(await Promise.all([first, second]), [0, 0]);

  const marksByLabel = Object.fromEntries(
    readFileSync(marks, "utf8")
      .trim()
      .split("\n")
      .map((line) => line.split(" "))
      .map(([label, phase, at]) => [`${label} ${phase}`, Number(at)]),
  );
  assert.ok(
    marksByLabel["b start"] >= marksByLabel["a end"],
    `b started (${marksByLabel["b start"]}) before a ended (${marksByLabel["a end"]})`,
  );
  // The waiter said who it was waiting on, named the bypass, and reported the
  // wait when it finally acquired; the uncontended run said nothing on entry.
  assert.equal(
    lines.filter((l) => l.includes("holds the gate lease")).length,
    1,
  );
  assert.match(
    lines.find((l) => l.includes("holds the gate lease")),
    /pid \d+ in .+, running for/,
  );
  assert.match(
    lines.find((l) => l.includes("holds the gate lease")),
    new RegExp(`${SKIP_ENV}=1`),
  );
  assert.equal(
    lines.filter((l) => l.startsWith("gate-lease: acquired after")).length,
    1,
  );
  assert.equal(
    lines.filter((l) => l.startsWith("gate-lease: released after")).length,
    2,
  );
  assert.ok(!existsSync(lockPathOf(dir)), "the lock is released at the end");
  assert.ok(!existsSync(leaseTarget(dir)), "the holder record goes with it");
});

test("the child's exit code is the run's exit code", async () => {
  const dir = freshDir();
  assert.equal(await runNode("process.exit(7)", { dir, log: () => {} }), 7);
});

test("a stale lock (its holder died) is taken over, not waited on", async () => {
  const dir = freshDir();
  mkdirSync(lockPathOf(dir), { recursive: true });
  const dead = new Date(Date.now() - STALE_MS - 1_000);
  utimesSync(lockPathOf(dir), dead, dead);
  const { lines, log } = collectLog();
  assert.equal(await runNode("", { dir, log }), 0);
  assert.equal(
    lines.filter((l) => l.includes("holds the gate lease")).length,
    0,
  );
  assert.ok(!existsSync(lockPathOf(dir)));
});

test("a stale lock that cannot be removed is waited on, not bypassed", async () => {
  const dir = freshDir();
  // Stale by mtime, but with a file inside — the library's takeover `rmdir`
  // fails ENOTEMPTY, which is not ELOCKED. Something still holds the path,
  // so degrading to an unleased run here would be the overlap this prevents.
  mkdirSync(lockPathOf(dir), { recursive: true });
  writeFileSync(join(lockPathOf(dir), "stray"), "");
  const dead = new Date(Date.now() - STALE_MS - 1_000);
  utimesSync(lockPathOf(dir), dead, dead);
  const { lines, log } = collectLog();
  await assert.rejects(runNode("", { dir, log, maxWaitMs: 0 }), /gave up/);
  assert.equal(
    lines.filter((l) => l.includes("running without")).length,
    0,
    lines.join("\n"),
  );
  assert.ok(existsSync(lockPathOf(dir)));
});

test("a command that cannot be spawned still releases the lease", async () => {
  const dir = freshDir();
  const { log } = collectLog();
  await assert.rejects(
    runUnderLease({
      command: join(dir, "no-such-binary"),
      args: [],
      dir,
      log,
      stdio: "ignore",
      pollMs: 25,
    }),
    { code: "ENOENT" },
  );
  assert.ok(
    !existsSync(lockPathOf(dir)),
    "the lease must not outlive the failed spawn",
  );
  assert.ok(!existsSync(leaseTarget(dir)));
});

test("a command that fails synchronously before it starts still releases the lease", async () => {
  const dir = freshDir();
  const { log } = collectLog();
  // `spawn` validates its arguments synchronously: a non-array `args` throws
  // before any child exists, the same class as `winShellArgs` refusing a `%`
  // on Windows. That throw must not strand the lock until stale takeover.
  await assert.rejects(
    runUnderLease({
      command: process.execPath,
      args: "-e",
      dir,
      log,
      stdio: "ignore",
      pollMs: 25,
    }),
    { code: "ERR_INVALID_ARG_TYPE" },
  );
  assert.ok(!existsSync(lockPathOf(dir)));
  assert.ok(!existsSync(leaseTarget(dir)));
});

test("a lock replaced mid-run (stale takeover) is the winner's, and is left alone", async () => {
  const dir = freshDir();
  const { lines, log } = collectLog();
  const run = runNode("setTimeout(() => {}, 400)", { dir, log });
  await waitFor(() => existsSync(leaseTarget(dir)));
  // What a waiter does after our refresh timer was starved past STALE_MS:
  // remove our directory and create its own. A new inode, so the guard can
  // tell it is not ours — and must not `rmdir` it on our way out, or a third
  // gate would run beside the winner.
  rmSync(lockPathOf(dir), { recursive: true });
  mkdirSync(lockPathOf(dir));
  writeFileSync(
    leaseTarget(dir),
    JSON.stringify({ pid: 1, cwd: "/winner", startedAt: Date.now() }),
  );
  assert.equal(await run, 0);
  assert.ok(
    existsSync(lockPathOf(dir)),
    "the winner's lock survived our release",
  );
  assert.equal(readHolder(dir)?.cwd, "/winner", "and so did its record");
  assert.ok(
    lines.some((l) => l.includes("taken over by another gate")),
    lines.join("\n"),
  );
});

test("a live lock that never releases fails the wait loudly, naming the holder", async () => {
  const dir = freshDir();
  // A fresh lock directory nobody refreshes is indistinguishable from a live
  // holder for STALE_MS, which is longer than this test is prepared to wait.
  mkdirSync(lockPathOf(dir), { recursive: true });
  writeFileSync(
    leaseTarget(dir),
    JSON.stringify({
      pid: 424242,
      cwd: "/some/worktree",
      startedAt: Date.now(),
    }),
  );
  const { lines, log } = collectLog();
  await assert.rejects(runNode("", { dir, log, maxWaitMs: 0 }), (err) => {
    assert.match(err.message, /gave up after/);
    assert.match(err.message, /pid 424242 in \/some\/worktree/);
    assert.match(err.message, new RegExp(`${SKIP_ENV}=1`));
    return true;
  });
  assert.equal(
    lines.filter((l) => l.includes("holds the gate lease")).length,
    1,
  );
  // The lock was somebody else's; giving up must not remove it.
  assert.ok(existsSync(lockPathOf(dir)));
});

test("a waiter reports progress while it waits", async () => {
  const dir = freshDir();
  mkdirSync(lockPathOf(dir), { recursive: true });
  const { lines, log } = collectLog();
  await assert.rejects(
    runNode("", { dir, log, maxWaitMs: 120, pollMs: 30, progressMs: 0 }),
    /gave up/,
  );
  assert.ok(
    lines.some((l) => l.startsWith("gate-lease: still waiting")),
    lines.join("\n"),
  );
});

test(`${SKIP_ENV}=1 runs without touching the lease`, async () => {
  const dir = freshDir();
  const { lines, log } = collectLog();
  const env = { ...process.env, [SKIP_ENV]: "1" };
  assert.equal(await runNode("", { dir, log, env }), 0);
  assert.match(lines.join("\n"), new RegExp(`${SKIP_ENV} is set`));
  assert.ok(!existsSync(lockPathOf(dir)));
});

test("a lease directory that cannot exist degrades to an unleased run", async () => {
  const parent = freshDir();
  const file = join(parent, "a-file");
  writeFileSync(file, "");
  const { lines, log } = collectLog();
  assert.equal(await runNode("", { dir: join(file, "nested"), log }), 0);
  assert.match(
    lines.join("\n"),
    /could not create .*; running without the lease/,
  );
});

test("main: no command is a usage error", async () => {
  const { error } = console;
  const lines = [];
  console.error = (line) => lines.push(line);
  try {
    assert.equal(await main([]), 2);
  } finally {
    console.error = error;
  }
  assert.match(lines.join("\n"), /usage:/);
});

// Ctrl-C and a plain kill are the obvious ones; Ctrl-\ (SIGQUIT) is the one
// that was missed (Copilot), and it matters for the same reason: the child
// is in its own process group, so a signal the wrapper does not handle ends
// the wrapper alone and orphans the gate.
for (const [signal, code] of [
  ["SIGTERM", 143],
  ["SIGQUIT", 131],
]) {
  test(`${signal} to the wrapper stops the whole tree, releases the lease and exits ${code}`, async () => {
    const dir = freshDir();
    const pidFile = join(dir, "grandchild.pid");
    // The gate stand-in: starts a descendant of its own (as `npm run` does,
    // four levels deep), records both pids, then idles forever unless
    // signalled. The descendant is what proves the whole *tree* is stopped —
    // a regression to `child.kill()` or a non-detached spawn would leave it
    // running and fail below.
    const idle =
      `const d = require("child_process").spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });` +
      `require("fs").writeFileSync(${JSON.stringify(pidFile)}, process.pid + " " + d.pid);` +
      `setInterval(() => {}, 1000)`;
    const wrapper = spawn(
      process.execPath,
      [SCRIPT, process.execPath, "-e", idle],
      {
        env: { ...process.env, [DIR_ENV]: dir },
        stdio: ["ignore", "ignore", "pipe"],
      },
    );
    let stderr = "";
    wrapper.stderr.on("data", (chunk) => (stderr += chunk));
    const exited = new Promise((resolve) =>
      wrapper.once("exit", (code, signal) => resolve({ code, signal })),
    );

    let tree = [];
    try {
      await waitFor(() => existsSync(pidFile));
      tree = readFileSync(pidFile, "utf8").split(" ").map(Number);
      assert.equal(tree.length, 2);
      for (const pid of tree) assert.ok(isAlive(pid), `pid ${pid} started`);
      assert.ok(existsSync(lockPathOf(dir)), "the wrapper held the lease");
    } finally {
      // On every path — a failed setup assertion included — the wrapper is
      // told to stop, so an idle grandchild can never outlive the suite.
      wrapper.kill(signal);
    }
    const outcome = await exited;
    assert.deepEqual(outcome, { code, signal: null }, stderr);
    for (const pid of tree)
      await waitFor(() => !isAlive(pid)).catch(() => {
        process.kill(pid, "SIGKILL");
        assert.fail(
          `pid ${pid} outlived the wrapper — the tree was not stopped`,
        );
      });
    assert.ok(
      !existsSync(lockPathOf(dir)),
      "the lease was released on the way out",
    );
    assert.match(stderr, new RegExp(`received ${signal}; stopping the gate`));
  });
}
