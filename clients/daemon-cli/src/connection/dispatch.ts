import { callDaemon, ensureDaemon, streamDaemon } from "../daemon/index.js";
import type { RpcParams, RpcResult } from "../daemon/protocol.js";
import type {
  CliAppInfo,
  MethodArgs,
} from "@inspector/cli/handlers/method-types.js";
import type { OutputFormat } from "@inspector/cli/handlers/format-output.js";
import { writeConnectionOutput } from "./format-connection.js";
import { styleFromOpts } from "@inspector/cli/style.js";
import { promptElicitation } from "./elicitation-prompt.js";

const STREAM_METHODS = new Set(["logging/tail", "resources/subscribe"]);

/**
 * The only two methods whose NDJSON output is a `--verify` conformance report
 * rather than `tools/list --app-info` probe lines. Everything else that ever
 * returns `kind: "ndjson"` is the app-info shape, so this is a short
 * allow-list rather than the other way round.
 */
const NDJSON_VARIANTS = new Set(["skills/list", "skills/get"]);

export type ConnectionDispatchOpts = {
  format?: OutputFormat;
  plain?: boolean;
  connection?: string;
  requireExplicit: boolean;
};

/**
 * Run one connection MCP method via daemon `rpc` or `stream`.
 */
export async function dispatchConnectionRpc(
  method: string,
  methodArgs: MethodArgs,
  opts: ConnectionDispatchOpts,
): Promise<void> {
  const format: OutputFormat = opts.format ?? "text";
  const style = styleFromOpts({ plain: opts.plain, format });
  const params: RpcParams = {
    ...methodArgs,
    format,
    method,
    name: stripAt(opts.connection),
    requireExplicit: opts.requireExplicit,
  };

  const { socketPath } = await ensureDaemon();

  if (STREAM_METHODS.has(method)) {
    const ac = new AbortController();
    const onSignal = () => ac.abort();
    process.on("SIGINT", onSignal);
    process.on("SIGTERM", onSignal);
    // Stream writes are chained and awaited before returning: mcp-bin calls
    // process.exit() right after, which truncates a still-pending stdout
    // write when output is piped or backpressured.
    let writeChain: Promise<void> = Promise.resolve();
    try {
      await streamDaemon(params, {
        socketPath,
        signal: ac.signal,
        onData: (data) => {
          writeChain = writeChain
            .then(() =>
              writeConnectionOutput(
                { format, style },
                {
                  kind: "stream-event",
                  data,
                },
              ),
            )
            // Recover the chain itself, not just observe it: a rejected
            // chain would skip every later `.then`, silently dropping all
            // subsequent events after one failed write. Write errors stay
            // non-fatal, as they were when these writes were
            // fire-and-forget.
            .catch(() => {});
          // Returning the chain lets streamDaemon pause socket reads until
          // the write settles, bounding memory when stdout is slow.
          return writeChain;
        },
      });
    } finally {
      process.off("SIGINT", onSignal);
      process.off("SIGTERM", onSignal);
      await writeChain.catch(() => {});
    }
    return;
  }

  const ac = new AbortController();
  const onSignal = () => ac.abort();
  process.on("SIGINT", onSignal);
  process.on("SIGTERM", onSignal);
  let outcome: RpcResult;
  try {
    outcome = await callDaemon<RpcResult>("rpc", params, {
      socketPath,
      // Core enforces the configured MCP request timeout daemon-side; a
      // fixed local deadline would falsely fail long-running tool calls.
      timeoutMs: 0,
      signal: ac.signal,
      onElicitation: (frame) =>
        promptElicitation(frame, {
          style,
          // Prompting only needs a readable stdin and a text-based reply
          // channel, not an actual TTY — an agent relaying prompts to a human
          // (or answering directly) over a plain pipe works the same way a
          // human at a terminal does. `--format json` is still excluded since
          // stdout is a single machine-readable payload there, not a place to
          // interleave prompts. A stdin that's already closed (e.g. `</dev/null`)
          // is handled by declining/cancelling gracefully instead of hanging,
          // not by refusing to try.
          interactive: format === "text",
        }),
    });
  } finally {
    process.off("SIGINT", onSignal);
    process.off("SIGTERM", onSignal);
  }
  if (outcome.kind === "ndjson") {
    await writeConnectionOutput(
      { format, style },
      {
        kind: "ndjson",
        lines: outcome.lines,
        variant: NDJSON_VARIANTS.has(method) ? "skill-verify" : "app-info",
        summary: outcome.summary,
        exitCode: outcome.exitCode,
      },
    );
    return;
  }
  await writeConnectionOutput(
    { format, style },
    {
      kind: "rpc",
      method,
      result: outcome.result,
      appInfo: outcome.appInfo as CliAppInfo | undefined,
      toolName: methodArgs.toolName,
    },
  );
}

export function stripAt(name: string | undefined): string | undefined {
  if (!name) return undefined;
  return name.startsWith("@") ? name.slice(1) : name;
}

/**
 * Non-interactive runs must pass an explicit connection for MRU-targeting ops.
 * Key off stdin (not stdout) so piping output (`mcpdo tools/list | jq`) still
 * uses MRU when a human is at the keyboard.
 */
export function requireExplicitConnection(): boolean {
  if (process.env.MCP_ALLOW_DEFAULT_CONNECTION === "1") return false;
  return process.stdin.isTTY !== true;
}

/**
 * Hoist a leading `@name` from argv so `mcpdo @alpha tools/list` works.
 */
export function hoistAtConnection(argv: string[]): {
  argv: string[];
  connectionFromAt?: string;
} {
  const start = 2;
  const user = argv.slice(start);
  const token = user[0];
  if (token && /^@[A-Za-z0-9_.-]+$/.test(token)) {
    return {
      argv: [...argv.slice(0, start), ...user.slice(1)],
      connectionFromAt: token.slice(1),
    };
  }
  return { argv };
}
