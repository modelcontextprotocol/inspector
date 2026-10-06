import { callDaemon, ensureDaemon, streamDaemon } from "../daemon/index.js";
import type { RpcParams, RpcResult } from "../daemon/protocol.js";
import type {
  CliAppInfo,
  MethodArgs,
} from "@inspector/cli/handlers/method-types.js";
import type { OutputFormat } from "@inspector/cli/handlers/format-output.js";
import { writeConnectionOutput } from "./format-connection.js";
import { styleFromOpts, type Style } from "@inspector/cli/style.js";
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
    // `format` stays frontend-only: forwarding it would make the daemon's
    // runMethod treat `format: "json"` tool calls as app-info requests and
    // issue a hidden extra resources/read whose result we discard. The
    // daemon also strips it defensively (see stripConnectionFields).
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
        // Core enforces the configured MCP request timeout daemon-side; a
        // fixed local deadline would falsely fail stream setups (e.g. a
        // subscribe against a slow server) that are still valid.
        timeoutMs: 0,
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
  // Interactive callers get inline prompts; everyone else — `--format json`
  // (single machine-readable payload) or no TTY at all (an agent's stdin is
  // not wired to the human, so a prompt would hang until auto-cancel) — has
  // the daemon park the elicitation and answers via `elicitation/respond`.
  const interactive =
    format === "text" &&
    (process.stdin.isTTY === true || process.stderr.isTTY === true);
  params.interactive = interactive;
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
          // channel; parked (non-interactive) callers never receive frames,
          // so this only ever runs interactively.
          interactive,
        }),
    });
  } finally {
    process.off("SIGINT", onSignal);
    process.off("SIGTERM", onSignal);
  }
  await writeRpcOutcome(
    { format, style },
    method,
    methodArgs.toolName,
    outcome,
  );
}

/**
 * Render one rpc outcome — final result, NDJSON report, or a parked
 * elicitation round. Shared by the originating call above and by
 * `elicitation/respond`, whose result is the same shape (the resumed call's
 * outcome or the next round).
 */
export async function writeRpcOutcome(
  out: { format?: OutputFormat; style: Style },
  method: string,
  toolName: string | undefined,
  outcome: RpcResult,
): Promise<void> {
  const { format, style } = out;
  if (outcome.kind === "elicitation-pending") {
    await writeConnectionOutput(
      { format, style },
      { kind: "elicitation-pending", elicitation: outcome.elicitation },
    );
    return;
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
      toolName,
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
 * Global options that take a value, as registered on the program in `runMcp`
 * (after `expandConnAlias` has rewritten `--conn` to `--connection`). The
 * hoist below needs this to know that the token after `--format` is its value
 * rather than the subcommand.
 */
const VALUE_TAKING_GLOBALS = new Set([
  "--format",
  "--connection",
  "--catalog",
  "--config",
]);

const AT_CONNECTION_RE = /^@[A-Za-z0-9_.-]+$/;

/**
 * Hoist an `@name` connection token from argv so `mcpdo @alpha tools/list`
 * works. The token is recognised anywhere before the subcommand — the README
 * documents global options as going before the subcommand, so
 * `mcpdo --format json @alpha tools/list` must work too, not only a leading
 * `@alpha`. Scanning stops at the subcommand (the first token that is neither
 * an option, an option's value, nor the `@name` itself) and at `--`, so a
 * positional argument that happens to start with `@` is never claimed.
 */
export function hoistAtConnection(argv: string[]): {
  argv: string[];
  connectionFromAt?: string;
} {
  const start = 2;
  for (let i = start; i < argv.length; i++) {
    const token = argv[i]!;
    if (token === "--") break;
    if (AT_CONNECTION_RE.test(token)) {
      return {
        argv: [...argv.slice(0, i), ...argv.slice(i + 1)],
        connectionFromAt: token.slice(1),
      };
    }
    if (token.startsWith("-")) {
      // `--opt=value` carries its value inline; a value-taking global
      // consumes the next token. Any other option (boolean globals, -h) is a
      // single token. An option this table doesn't know is treated as
      // boolean, which at worst stops the scan early at its value — never
      // claims one as a connection.
      if (!token.includes("=") && VALUE_TAKING_GLOBALS.has(token)) i++;
      continue;
    }
    // First non-option token is the subcommand: @name past this point is a
    // positional argument, not a connection selector.
    break;
  }
  return { argv };
}
