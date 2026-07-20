import { runMcp as invokeMcp } from "../../src/session/mcp.js";
import { formatErrorOutput } from "../../src/error-handler.js";

export interface McpResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  output: string;
}

export interface McpOptions {
  timeout?: number;
  env?: Record<string, string>;
}

type WriteArgs = [
  chunk: unknown,
  encoding?: unknown,
  callback?: (() => void) | undefined,
];

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
 * In-process runner for `runMcp` (session CLI), mirroring {@link runCli}.
 */
export async function runMcp(
  args: string[],
  options: McpOptions = {},
): Promise<McpResult> {
  let stdout = "";
  let stderr = "";

  const originalStdoutWrite = process.stdout.write;
  const originalStderrWrite = process.stderr.write;

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

  const argv = ["node", "mcpi", ...args];
  const timeoutMs = options.timeout ?? 15000;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`mcpi command timed out after ${timeoutMs}ms`)),
      timeoutMs,
    );
  });

  let exitCode = 0;
  try {
    await Promise.race([invokeMcp(argv), timeout]);
  } catch (error) {
    const out = formatErrorOutput(error);
    exitCode = out.exitCode;
    stderr += out.stderr;
  } finally {
    if (timer) clearTimeout(timer);
    process.stdout.write = originalStdoutWrite;
    process.stderr.write = originalStderrWrite;
    for (const [key, value] of Object.entries(envBackup)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }

  return { exitCode, stdout, stderr, output: stdout + stderr };
}
