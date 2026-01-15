import { spawn } from "child_process";
import { resolve } from "path";
import { fileURLToPath } from "url";
import { dirname } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI_PATH = resolve(__dirname, "../../build/cli.js");

export interface CliResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  output: string; // Combined stdout + stderr
}

export interface CliOptions {
  timeout?: number;
  cwd?: string;
  env?: Record<string, string>;
  signal?: AbortSignal;
}

/**
 * Run the CLI with given arguments and capture output
 */
export async function runCli(
  args: string[],
  options: CliOptions = {},
): Promise<CliResult> {
  return new Promise((resolve, reject) => {
    const child = spawn("node", [CLI_PATH, ...args], {
      stdio: ["pipe", "pipe", "pipe"],
      cwd: options.cwd,
      env: { ...process.env, ...options.env },
      signal: options.signal,
      // Kill child process tree on exit
      detached: false,
    });

    let stdout = "";
    let stderr = "";
    let resolved = false;

    // Default timeout of 10 seconds (less than vitest's 15s)
    const timeoutMs = options.timeout ?? 10000;
    const timeout = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        // Kill the process and all its children
        try {
          if (process.platform === "win32") {
            child.kill("SIGTERM");
          } else {
            // On Unix, kill the process group
            process.kill(-child.pid!, "SIGTERM");
          }
        } catch (e) {
          // Process might already be dead, try direct kill
          try {
            child.kill("SIGKILL");
          } catch (e2) {
            // Process is definitely dead
          }
        }
        reject(new Error(`CLI command timed out after ${timeoutMs}ms`));
      }
    }, timeoutMs);

    child.stdout.on("data", (data) => {
      stdout += data.toString();
    });

    child.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    child.on("close", (code) => {
      if (!resolved) {
        resolved = true;
        clearTimeout(timeout);
        resolve({
          exitCode: code,
          stdout,
          stderr,
          output: stdout + stderr,
        });
      }
    });

    child.on("error", (error) => {
      if (!resolved) {
        resolved = true;
        clearTimeout(timeout);
        reject(error);
      }
    });
  });
}
