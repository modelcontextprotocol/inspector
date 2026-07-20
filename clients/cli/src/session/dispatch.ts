import { callDaemon, ensureDaemon, streamDaemon } from "../daemon/index.js";
import type { RpcParams, RpcResult } from "../daemon/protocol.js";
import type { CliAppInfo, MethodArgs } from "../handlers/method-types.js";
import type { OutputFormat } from "../handlers/format-output.js";
import { writeSessionOutput } from "./format-session.js";
import { styleFromOpts } from "./style.js";

const STREAM_METHODS = new Set(["logging/tail", "resources/subscribe"]);

export type SessionDispatchOpts = {
  format?: OutputFormat;
  plain?: boolean;
  session?: string;
  requireExplicit: boolean;
};

/**
 * Run one session MCP method via daemon `rpc` or `stream`.
 */
export async function dispatchSessionRpc(
  method: string,
  methodArgs: MethodArgs,
  opts: SessionDispatchOpts,
): Promise<void> {
  const format: OutputFormat = opts.format ?? "text";
  const style = styleFromOpts({ plain: opts.plain, format });
  const params: RpcParams = {
    ...methodArgs,
    format,
    method,
    name: stripAt(opts.session),
    requireExplicit: opts.requireExplicit,
  };

  const { socketPath } = await ensureDaemon();

  if (STREAM_METHODS.has(method)) {
    const ac = new AbortController();
    const onSignal = () => ac.abort();
    process.on("SIGINT", onSignal);
    process.on("SIGTERM", onSignal);
    try {
      await streamDaemon(params, {
        socketPath,
        signal: ac.signal,
        onData: (data) => {
          void writeSessionOutput(
            { format, style },
            {
              kind: "stream-event",
              data,
            },
          );
        },
      });
    } finally {
      process.off("SIGINT", onSignal);
      process.off("SIGTERM", onSignal);
    }
    return;
  }

  const outcome = await callDaemon<RpcResult>("rpc", params, { socketPath });
  if (outcome.kind === "ndjson") {
    await writeSessionOutput(
      { format, style },
      {
        kind: "ndjson",
        lines: outcome.lines,
      },
    );
    return;
  }
  await writeSessionOutput(
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

/** Non-TTY (CI/pipelines) must pass an explicit session for MRU-targeting ops. */
export function requireExplicitSession(): boolean {
  if (process.env.MCP_ALLOW_DEFAULT_SESSION === "1") return false;
  return !process.stdout.isTTY;
}

/**
 * Hoist a leading `@name` from argv so `mcp @alpha tools/list` works.
 */
export function hoistAtSession(argv: string[]): {
  argv: string[];
  sessionFromAt?: string;
} {
  const start = 2;
  const user = argv.slice(start);
  const token = user[0];
  if (token && /^@[A-Za-z0-9_.-]+$/.test(token)) {
    return {
      argv: [...argv.slice(0, start), ...user.slice(1)],
      sessionFromAt: token.slice(1),
    };
  }
  return { argv };
}
