import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createTestServerHttp,
  createTestServerInfo,
} from "@modelcontextprotocol/inspector-test-server";
import { EXIT_CODES } from "@inspector/core/cli/error-handler.js";
import { REPEAT_GRACE_MS } from "../src/handlers/load-interrupt.js";

const here = dirname(fileURLToPath(import.meta.url));
const BIN = resolve(here, "../build/index.js");

/**
 * Ctrl+C / SIGTERM delivered as a REAL signal to the BUILT CLI (#2834).
 *
 * The in-process suite (`load-summary.test.ts`) calls the CLI's own listener
 * directly, which is exactly what let the first fix ship broken: `when-exit`
 * (via `atomically`) also listens, and re-raises the signal with
 * `process.kill(process.pid, …)` after its cleanups. That copy only exists
 * when the kernel delivers a signal to a real process carrying the real
 * dependency graph, so only a spawned binary can see it.
 *
 * Budgets: the child is killed after `CHILD_TIMEOUT_MS`, inside the test's own
 * `E2E_SPAWN_MS`, so a hang names the CLI rather than timing out the test
 * generically (the same arrangement as `e2e.test.ts`, #2323).
 */
const CHILD_TIMEOUT_MS = 15_000;
const E2E_SPAWN_MS = 25_000;

type Run = {
  child: ChildProcess;
  done: Promise<{ code: number | null; stdout: string; stderr: string }>;
  stderr: () => string;
};

function spawnLoad(url: string, tool: string): Run {
  const child = spawn(
    "node",
    [
      BIN,
      url,
      "--transport",
      "http",
      "--method",
      "tools/call",
      "--tool-name",
      tool,
      "--load",
      "--load-duration",
      "60",
      "--load-concurrency",
      "2",
      "--format",
      "json",
    ],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
  let stdout = "";
  let stderr = "";
  child.stdout!.on("data", (d) => (stdout += d.toString()));
  child.stderr!.on("data", (d) => (stderr += d.toString()));
  const done = new Promise<{
    code: number | null;
    stdout: string;
    stderr: string;
  }>((resolveDone, reject) => {
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`built CLI did not exit within ${CHILD_TIMEOUT_MS}ms`));
    }, CHILD_TIMEOUT_MS);
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolveDone({ code, stdout, stderr });
    });
  });
  return { child, done, stderr: () => stderr };
}

/** Resolve once `check` holds, polling every 50ms. */
async function until(check: () => boolean): Promise<void> {
  while (!check()) await new Promise((r) => setTimeout(r, 50));
}

describe("--load under a real signal (built CLI)", () => {
  let calls = 0;
  let release: (() => void)[] = [];
  const makeServer = () =>
    createTestServerHttp({
      serverInfo: createTestServerInfo("load-signal", "1.0.0"),
      tools: [
        {
          name: "slow",
          description: "Answers after 50ms",
          inputSchema: {},
          handler: async () => {
            calls++;
            await new Promise((r) => setTimeout(r, 50));
            return { content: [{ type: "text", text: "ok" }] };
          },
        },
        {
          name: "hang",
          description: "Answers only when the test lets it",
          inputSchema: {},
          handler: async () => {
            calls++;
            await new Promise<void>((r) => release.push(r));
            return { content: [{ type: "text", text: "late" }] };
          },
        },
      ],
    });

  let server: ReturnType<typeof makeServer>;

  beforeEach(async () => {
    calls = 0;
    release = [];
    server = makeServer();
    await server.start();
  });

  afterEach(async () => {
    for (const r of release) r();
    await server.stop();
  });

  it.each(["SIGINT", "SIGTERM"] as const)(
    "prints the partial summary and exits 130 on one %s",
    async (signal) => {
      const run = spawnLoad(server.url, "slow");
      await until(() => calls >= 10);
      run.child.kill(signal);
      const { code, stdout, stderr } = await run.done;
      expect(code).toBe(EXIT_CODES.INTERRUPTED);
      const { result } = JSON.parse(stdout.trim().split("\n")[0]!);
      expect(result.stoppedEarly).toEqual({
        reason: "interrupted",
        detail: `received ${signal}`,
      });
      expect(result.ok).toBeGreaterThan(0);
      expect(stderr).toContain(`Interrupted (${signal})`);
      expect(JSON.parse(stderr.trim().split("\n").pop()!).error.code).toBe(
        "interrupted",
      );
    },
    E2E_SPAWN_MS,
  );

  it(
    "exits 130 at once on a second Ctrl+C while calls will not settle",
    async () => {
      const run = spawnLoad(server.url, "hang");
      await until(() => calls >= 2);
      run.child.kill("SIGINT");
      await until(() => run.stderr().includes("Interrupted (SIGINT)"));
      // A person's second press, past the window that absorbs a re-raise.
      await new Promise((r) => setTimeout(r, REPEAT_GRACE_MS + 200));
      run.child.kill("SIGINT");
      const { code, stdout } = await run.done;
      expect(code).toBe(EXIT_CODES.INTERRUPTED);
      // The in-flight calls never settled, so there was no summary to print.
      expect(stdout).toBe("");
    },
    E2E_SPAWN_MS,
  );
});
