import { runCli as invokeCli } from "../../src/cli.js";

export interface CliResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  output: string; // Combined stdout + stderr
}

export interface CliOptions {
  timeout?: number;
  /**
   * Accepted for source-compatibility with the previous out-of-process runner.
   * The in-process runner shares the test worker's working directory, so it is
   * ignored — no current test sets it. The out-of-process E2E layer
   * (`e2e.test.ts`) still honors a real cwd.
   */
  cwd?: string;
  env?: Record<string, string>;
  signal?: AbortSignal;
}

type WriteArgs = [
  chunk: unknown,
  encoding?: unknown,
  callback?: (() => void) | undefined,
];

/**
 * Build a `process.std{out,err}.write` replacement that appends every chunk to
 * a buffer and still honors the optional write callback. `awaitableLog` (the
 * CLI's stdout writer) passes its resolve handler as that callback, so it MUST
 * be invoked or `runCli` would hang forever waiting for the flush.
 */
function captureWrite(append: (text: string) => void) {
  return (...args: WriteArgs): boolean => {
    const [chunk, encoding, callback] = args;
    append(typeof chunk === "string" ? chunk : String(chunk));
    const cb = typeof encoding === "function" ? encoding : callback;
    if (typeof cb === "function") cb();
    return true;
  };
}

/**
 * Run the CLI **in-process** by importing and invoking `runCli` directly, so
 * its source (`clients/cli/src/**`) is measured under vitest's coverage
 * instrumentation. The previous implementation spawned `build/index.js` as a
 * subprocess, which left CLI source invisible to coverage (#1484).
 *
 * The returned shape matches the old out-of-process runner exactly
 * (`exitCode` / `stdout` / `stderr` / `output`) so every existing test and the
 * shared assertion helpers keep working unchanged:
 * - stdout/stderr are captured by temporarily patching `process.std*.write`
 *   (and `console.error`/`console.warn`, which commander and error paths use).
 * - A thrown error (bad args, failed connect, unsupported method) maps to
 *   `exitCode: 1` with the message appended to stderr — mirroring how the real
 *   binary's `main()` routes errors through `handleError` → `process.exit(1)`.
 * - `options.env` is applied to `process.env` for the duration of the call and
 *   fully restored afterward.
 *
 * The real binary, its shebang, and actual `process.exit` codes are covered by
 * the thin out-of-process layer in `e2e.test.ts` and `scripts/smoke-cli.mjs`.
 */
export async function runCli(
  args: string[],
  options: CliOptions = {},
): Promise<CliResult> {
  let stdout = "";
  let stderr = "";

  const originalStdoutWrite = process.stdout.write;
  const originalStderrWrite = process.stderr.write;
  const originalConsoleError = console.error;
  const originalConsoleWarn = console.warn;

  // Snapshot and apply env overrides; `undefined` records keys that did not
  // exist so they can be deleted (not set to the string "undefined") on restore.
  const envBackup: Record<string, string | undefined> = {};
  if (options.env) {
    for (const [key, value] of Object.entries(options.env)) {
      envBackup[key] = process.env[key];
      process.env[key] = value;
    }
  }

  process.stdout.write = captureWrite((text) => {
    stdout += text;
  }) as typeof process.stdout.write;
  process.stderr.write = captureWrite((text) => {
    stderr += text;
  }) as typeof process.stderr.write;
  console.error = (...parts: unknown[]) => {
    stderr += parts.map(String).join(" ") + "\n";
  };
  console.warn = (...parts: unknown[]) => {
    stderr += parts.map(String).join(" ") + "\n";
  };

  // `runCli` reads `process.argv.slice(2)`, so prepend two placeholder entries
  // ([node, script]) to mirror how the binary is launched.
  const argv = ["node", "inspector-cli", ...args];

  const timeoutMs = options.timeout ?? 10000;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`CLI command timed out after ${timeoutMs}ms`)),
      timeoutMs,
    );
  });

  let exitCode = 0;
  try {
    await Promise.race([invokeCli(argv), timeout]);
  } catch (error) {
    exitCode = 1;
    stderr += (error instanceof Error ? error.message : String(error)) + "\n";
  } finally {
    if (timer) clearTimeout(timer);
    process.stdout.write = originalStdoutWrite;
    process.stderr.write = originalStderrWrite;
    console.error = originalConsoleError;
    console.warn = originalConsoleWarn;
    for (const [key, value] of Object.entries(envBackup)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }

  return {
    exitCode,
    stdout,
    stderr,
    output: stdout + stderr,
  };
}
