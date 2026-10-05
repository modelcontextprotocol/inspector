import { describe, it, expect } from "vitest";
import { spawn } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { getTestMcpServerCommand } from "@modelcontextprotocol/inspector-test-server";

const here = dirname(fileURLToPath(import.meta.url));
const BIN = resolve(here, "../build/index.js");

/**
 * The two bounds on a spawned child, which used to be the identical 15000 —
 * so which one fired was arbitrary, and they do different things (#2323).
 *
 * `CHILD_TIMEOUT_MS` kills the child's process group and rejects with a message
 * naming the CLI. The enclosing per-test budget just fails the test generically
 * and leaves a detached `node` behind. The useful diagnostic is the child
 * timer's, so it has to be the bound that wins — and the way to arrange that is
 * to raise the test's budget above it, not to shrink the child's. Shrinking it
 * would take load tolerance away from the one suite here that spawns a real
 * process, which is the opposite of this change's purpose (Copilot).
 *
 * `E2E_SPAWN_MS` is therefore an exception to the cli project's shared 15000,
 * and one of the few sites that should be: booting the built binary in a fresh
 * `node` and waiting for it to speak to an MCP server is elapsed work, not
 * slack. It is the child's own budget plus room for the spawn and the reject to
 * be observed.
 */
const CHILD_TIMEOUT_MS = 15_000;
const E2E_SPAWN_MS = 25_000;

interface SpawnResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
}

/**
 * Spawn the **built** CLI binary as a real subprocess. This is the deliberately
 * thin out-of-process layer that the in-process suite (cli-runner.ts) cannot
 * reach: the shebang, `index.ts`'s `isMain` bootstrap, and the actual
 * `process.exit` codes. Functional behavior is covered in-process under the
 * coverage gate; this only asserts the binary boots and exits correctly. The
 * binary is built by the `pretest` / `test:coverage` scripts before tests run.
 */
function spawnCli(args: string[]): Promise<SpawnResult> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn("node", [BIN, ...args], {
      stdio: ["pipe", "pipe", "pipe"],
      detached: process.platform !== "win32",
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      if (process.platform !== "win32" && child.pid != null) {
        process.kill(-child.pid, "SIGTERM");
      } else {
        child.kill("SIGTERM");
      }
      reject(new Error("E2E CLI timed out"));
    }, CHILD_TIMEOUT_MS);
    child.stdout.on("data", (d) => (stdout += d.toString()));
    child.stderr.on("data", (d) => (stderr += d.toString()));
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on("close", (exitCode) => {
      clearTimeout(timer);
      resolvePromise({ exitCode, stdout, stderr });
    });
  });
}

describe("CLI binary (out-of-process E2E)", () => {
  const { command, args } = getTestMcpServerCommand();

  it(
    "exits 0 and prints tools JSON on a successful run",
    async () => {
      const result = await spawnCli([
        command,
        ...args,
        "--method",
        "tools/list",
      ]);

      expect(result.exitCode).toBe(0);
      const json = JSON.parse(result.stdout);
      expect(Array.isArray(json.tools)).toBe(true);
    },
    E2E_SPAWN_MS,
  );

  // #2435: a stdio server's stderr is inherited by default, so its banners and
  // logs land in the CLI's stderr. A `--import` preload makes the real test
  // server write one such line before it starts; `--` ends the target, since
  // the preload flag would otherwise end it early.
  describe("--quiet and a stdio server's own stderr", () => {
    const NOISE = "SERVER_STDERR_NOISE_2435";
    const noisyTarget = [
      command,
      "--import",
      `data:text/javascript,${encodeURIComponent(
        `process.stderr.write(${JSON.stringify(NOISE + "\n")});`,
      )}`,
      ...args,
      "--",
    ];

    it(
      "passes it through without --quiet",
      async () => {
        const result = await spawnCli([
          ...noisyTarget,
          "--method",
          "tools/list",
        ]);

        expect(result.exitCode).toBe(0);
        expect(result.stderr).toContain(NOISE);
      },
      E2E_SPAWN_MS,
    );

    it(
      "suppresses it under -q, leaving only the result on stdout",
      async () => {
        const result = await spawnCli([
          ...noisyTarget,
          "-q",
          "--method",
          "tools/list",
        ]);

        expect(result.exitCode).toBe(0);
        expect(result.stderr).toBe("");
        expect(Array.isArray(JSON.parse(result.stdout).tools)).toBe(true);
      },
      E2E_SPAWN_MS,
    );
  });

  it(
    "exits non-zero when required --method is missing",
    async () => {
      const result = await spawnCli([command, ...args]);

      expect(result.exitCode).not.toBe(0);
      expect(result.stderr).toContain("Method is required");
    },
    E2E_SPAWN_MS,
  );
});
