import { describe, it, expect } from "vitest";
import { spawn } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { getTestMcpServerCommand } from "@modelcontextprotocol/inspector-test-server";

const here = dirname(fileURLToPath(import.meta.url));
const BIN = resolve(here, "../build/index.js");

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
    }, 15000);
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

  it("exits 0 and prints tools JSON on a successful run", async () => {
    const result = await spawnCli([command, ...args, "--method", "tools/list"]);

    expect(result.exitCode).toBe(0);
    const json = JSON.parse(result.stdout);
    expect(Array.isArray(json.tools)).toBe(true);
  });

  it("exits non-zero when required --method is missing", async () => {
    const result = await spawnCli([command, ...args]);

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("Method is required");
  });
});
