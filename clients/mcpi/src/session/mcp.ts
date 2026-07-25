import { Command, type Command as CommandType } from "commander";
import type { JsonValue } from "@inspector/core/mcp/index.js";
import {
  loadServerEntries,
  parseHeaderPair,
  parseKeyValuePair as parseEnvPair,
  selectServerEntry,
} from "@inspector/core/mcp/node/index.js";
import { type LoggingLevel } from "@modelcontextprotocol/client";
import { LoggingLevelSchema } from "@modelcontextprotocol/core";
import { CliExitCodeError, EXIT_CODES } from "../error-handler.js";
import { callDaemon, ensureDaemon } from "../daemon/index.js";
import type { SessionInfo } from "../daemon/protocol.js";
import {
  annotateServerEntriesWithSessions,
  listServerEntries,
  showServerEntry,
  summarizeServerConfig,
} from "../handlers/servers-list.js";
import { type OutputFormat } from "../handlers/format-output.js";
import {
  DEFAULT_CONNECT_TIMEOUT_MS,
  withConnectTimeout,
} from "../handlers/connect-timeout.js";
import type { MethodArgs } from "../handlers/method-types.js";
import { SESSION_RPC_METHODS } from "../handlers/method-types.js";
import { authorizeInFrontend } from "./authorize.js";
import { resolveToolCallArgs } from "./parse-tool-args.js";
import {
  dispatchSessionRpc,
  hoistAtSession,
  requireExplicitSession,
  stripAt,
} from "./dispatch.js";
import { writeSessionOutput } from "./format-session.js";
import {
  createPrivateBinding,
  formatPrivateEnvExports,
} from "./private-env.js";
import {
  clearAllStoredAuth,
  clearStoredAuth,
  clearStoredAuthForRelogin,
  listStoredAuth,
} from "./stored-auth.js";
import { styleFromOpts } from "./style.js";
import { awaitableLog } from "../utils/awaitable-log.js";
import { createInterface } from "node:readline/promises";

function isDaemonUnreachable(error: unknown): boolean {
  return (
    error instanceof CliExitCodeError &&
    error.envelope?.code === "daemon_unreachable"
  );
}

/** Commander help/version exits — text already written; not real failures. */
function isCommanderDisplayOnly(error: unknown): boolean {
  if (error == null || typeof error !== "object") return false;
  const code = (error as { code?: unknown }).code;
  return (
    code === "commander.help" ||
    code === "commander.helpDisplayed" ||
    code === "commander.version"
  );
}

type GlobalOpts = {
  format?: OutputFormat;
  plain?: boolean;
  session?: string;
  catalog?: string;
  config?: string;
  storedAuthOnly?: boolean;
};

function outOpts(opts: GlobalOpts) {
  return {
    format: opts.format,
    style: styleFromOpts({ plain: opts.plain === true, format: opts.format }),
  };
}

const validLogLevels: LoggingLevel[] = Object.values(LoggingLevelSchema.enum);

/**
 * Session-first CLI entry (`mcpi`). Talks to the implicit session daemon over
 * IPC for connect/disconnect/sessions and MCP RPCs; `servers/list` and
 * `servers/show` are local (no daemon).
 */
export async function runMcp(argv?: string[]): Promise<void> {
  const raw = argv ?? process.argv;
  const { argv: rewritten, sessionFromAt } = hoistAtSession(raw);

  const program = new Command();
  program.exitOverride((err) => {
    // Help/version already printed. Always throw so Commander does not
    // process.exit (which would tear down in-process tests); runMcp treats
    // these as success. Bare `mcpi` uses code `commander.help` with exitCode 1
    // — must not reach handleError as an ErrorEnvelope.
    if (isCommanderDisplayOnly(err)) throw err;
    if (err.exitCode !== 0) throw err;
  });

  program
    .name("mcpi")
    .description(
      "MCP Inspector session CLI — connect once, run many commands against a named session.",
    )
    .helpOption("-h, --help", "Display help for command")
    .helpCommand("help [command]", "Display help for command")
    .option(
      "--format <format>",
      "Output format: text (default; human-readable) or json (pretty-printed)",
      (v: string): OutputFormat => {
        if (v !== "text" && v !== "json") {
          throw new Error(`--format must be 'text' or 'json'.`);
        }
        return v;
      },
    )
    .option(
      "--plain",
      "Disable ANSI styling (color, bold/dim, hyperlinks) in human text output",
    )
    .option(
      "--session <name>",
      "Session name (without required @). Overrides MRU / positional @name.",
    )
    .option(
      "--catalog <path>",
      "Writable catalog file (default: ~/.mcp-inspector/mcp.json or MCP_CATALOG_PATH)",
    )
    .option(
      "--config <path>",
      "Read-only session config file (never written or seeded)",
    )
    .option(
      "--stored-auth-only",
      "Never start interactive OAuth; use the shared store if present, otherwise fail.",
    );

  if (sessionFromAt) {
    program.setOptionValue("session", sessionFromAt);
  }

  program
    .command("servers/list")
    .description(
      "List catalog/config server entries (marks live sessions when the daemon is running; no MCP connection)",
    )
    .action(async () => {
      const opts = program.opts<GlobalOpts>();
      const envCatalog = process.env.MCP_CATALOG_PATH;
      const entries = await listServerEntries({
        catalogPath: opts.catalog?.trim() || envCatalog,
        configPath: opts.config?.trim() || undefined,
      });
      let sessions: SessionInfo[] = [];
      try {
        const result = await callDaemon<{ sessions: SessionInfo[] }>(
          "sessions/list",
          {},
        );
        sessions = result.sessions;
      } catch (error) {
        if (!isDaemonUnreachable(error)) throw error;
      }
      await writeSessionOutput(outOpts(opts), {
        kind: "servers/list",
        servers: annotateServerEntriesWithSessions(entries, sessions),
      });
    });

  program
    .command("servers/show")
    .description(
      "Show one catalog/config entry in detail (no MCP connection; secrets redacted)",
    )
    .argument("<name>", "Catalog entry name")
    .action(async (name: string) => {
      const opts = program.opts<GlobalOpts>();
      const envCatalog = process.env.MCP_CATALOG_PATH;
      const entry = await showServerEntry(name, {
        catalogPath: opts.catalog?.trim() || envCatalog,
        configPath: opts.config?.trim() || undefined,
      });
      await writeSessionOutput(outOpts(opts), {
        kind: "servers/show",
        server: entry,
      });
    });

  registerConnect(program);
  registerSessionAdmin(program);
  registerAuthCommands(program);
  registerRpcCommands(program);
  // Keep infra commands last in --help (just before Commander's built-in help).
  registerDaemonCommands(program);
  registerPrivateCommand(program);

  try {
    await program.parseAsync(rewritten);
  } catch (error) {
    if (isCommanderDisplayOnly(error)) return;
    throw error;
  }
}

function registerConnect(program: CommandType): void {
  program
    .command("connect")
    .description("Connect a catalog entry or ad-hoc target as a named session")
    .argument(
      "[target...]",
      "Catalog entry name, or command/URL (use -- for command args)",
    )
    .option("--server <name>", "Server name from catalog/config")
    .option(
      "-e <env>",
      "Environment variables for the server (KEY=VALUE)",
      parseEnvPair,
      {},
    )
    .option("--cwd <path>", "Working directory for stdio server process")
    .option(
      "--transport <type>",
      "Transport type (sse, http, or stdio)",
      (value: string) => {
        const valid = ["sse", "http", "stdio"];
        if (!valid.includes(value)) {
          throw new Error(`Invalid transport type: ${value}`);
        }
        return value as "sse" | "http" | "stdio";
      },
    )
    .option("--server-url <url>", "Server URL for SSE/HTTP transport")
    .option(
      "--header <headers...>",
      'HTTP headers as "HeaderName: Value" pairs',
      parseHeaderPair,
      {},
    )
    .option(
      "--connect-timeout <ms>",
      `Connection timeout in ms (default ${DEFAULT_CONNECT_TIMEOUT_MS} for ad-hoc)`,
      (v: string) => {
        const n = Number(v);
        if (!Number.isFinite(n) || n < 0) {
          throw new Error(`--connect-timeout must be a non-negative number.`);
        }
        return n;
      },
    )
    .option(
      "--relogin",
      "Ignore stored OAuth for this connect (HTTP/SSE URL keys only); interactive login runs only if the server requires auth. No-op for stdio / servers with no stored entry",
    )
    .action(async (target: string[], cmdOpts) => {
      const opts = program.opts<GlobalOpts>();
      const { name: positionalSession, rest } = splitSessionTarget(target);
      const sessionName =
        stripAt(opts.session) ??
        positionalSession ??
        cmdOpts.server?.trim() ??
        rest[0];

      if (!sessionName) {
        throw new CliExitCodeError(
          EXIT_CODES.USAGE,
          "connect requires a catalog entry name, --server <name>, or an ad-hoc target.",
          { code: "usage" },
        );
      }

      const relogin = cmdOpts.relogin === true;
      if (relogin && opts.storedAuthOnly) {
        throw new CliExitCodeError(
          EXIT_CODES.USAGE,
          "--relogin cannot be combined with --stored-auth-only",
          { code: "usage" },
        );
      }

      const adHoc =
        rest.length > 1 ||
        Boolean(cmdOpts.transport) ||
        Boolean(cmdOpts.serverUrl?.trim()) ||
        (rest.length === 1 && looksLikeUrl(rest[0]!));

      const envCatalog = adHoc ? undefined : process.env.MCP_CATALOG_PATH;
      const serverOptions = {
        catalogPath: opts.catalog?.trim() || envCatalog,
        configPath: opts.config?.trim() || undefined,
        target: adHoc ? (rest.length > 0 ? rest : undefined) : undefined,
        transport: cmdOpts.transport as "sse" | "http" | "stdio" | undefined,
        serverUrl: cmdOpts.serverUrl as string | undefined,
        cwd: cmdOpts.cwd as string | undefined,
        env: cmdOpts.e as Record<string, string> | undefined,
        headers: cmdOpts.header as Record<string, string> | undefined,
      };

      const selectName = adHoc
        ? undefined
        : ((cmdOpts.server as string | undefined)?.trim() ?? rest[0]);

      const entries = await loadServerEntries(serverOptions);
      const selected = selectServerEntry(entries, selectName);
      const serverConfig = selected.config;
      const serverSettings = withConnectTimeout(
        selected.settings,
        (cmdOpts.connectTimeout as number | undefined) ??
          (adHoc ? DEFAULT_CONNECT_TIMEOUT_MS : undefined),
      );
      const { detail } = summarizeServerConfig(serverConfig);
      const name = stripAt(sessionName)!;

      if (relogin && "url" in serverConfig && serverConfig.url) {
        await clearStoredAuthForRelogin(serverConfig.url);
      }

      const { socketPath } = await ensureDaemon();
      const connectParams = {
        name,
        serverConfig,
        serverSettings,
        serverIdentity: detail,
      };

      let result: SessionInfo;
      try {
        result = await callDaemon<SessionInfo>("connect", connectParams, {
          socketPath,
        });
      } catch (error) {
        if (
          !(error instanceof CliExitCodeError) ||
          error.envelope?.code !== "auth_required"
        ) {
          throw error;
        }
        if (opts.storedAuthOnly) {
          throw error;
        }
        await authorizeInFrontend(serverConfig, serverSettings, {
          storedAuthOnly: false,
        });
        result = await callDaemon<SessionInfo>("connect", connectParams, {
          socketPath,
        });
      }
      await writeSessionOutput(outOpts(opts), {
        kind: "session",
        session: result,
      });
    });
}

function registerAuthCommands(program: CommandType): void {
  program
    .command("auth/list")
    .description(
      "List server URLs in the shared OAuth store (keys for auth/clear)",
    )
    .action(async () => {
      const opts = program.opts<GlobalOpts>();
      const list = await listStoredAuth();
      await writeSessionOutput(outOpts(opts), { kind: "auth/list", list });
    });

  program
    .command("auth/clear")
    .description(
      "Clear stored OAuth state for one server URL (from auth/list) or all entries",
    )
    .argument("[key]", "Server URL key from auth/list")
    .option("--all", "Clear every stored OAuth server entry")
    .option("--yes", "Skip confirmation when using --all")
    .action(async (key: string | undefined, cmdOpts) => {
      const opts = program.opts<GlobalOpts>();
      const all = cmdOpts.all === true;
      if (all && key?.trim()) {
        throw new CliExitCodeError(
          EXIT_CODES.USAGE,
          "auth/clear: pass a key or --all, not both",
          { code: "usage" },
        );
      }
      if (!all && !key?.trim()) {
        throw new CliExitCodeError(
          EXIT_CODES.USAGE,
          "auth/clear requires a server URL key (from auth/list) or --all",
          { code: "usage" },
        );
      }
      if (all) {
        if (!cmdOpts.yes) {
          if (!process.stdin.isTTY || !process.stdout.isTTY) {
            throw new CliExitCodeError(
              EXIT_CODES.USAGE,
              "auth/clear --all requires --yes in non-interactive mode",
              { code: "usage" },
            );
          }
          /* v8 ignore next 22 -- interactive y/N confirm needs a real TTY */
          const rl = createInterface({
            input: process.stdin,
            output: process.stderr,
          });
          try {
            const answer = await rl.question(
              "Clear ALL stored OAuth credentials? [y/N] ",
            );
            const ok =
              answer.trim().toLowerCase() === "y" ||
              answer.trim().toLowerCase() === "yes";
            if (!ok) {
              throw new CliExitCodeError(
                EXIT_CODES.USAGE,
                "auth/clear --all cancelled",
                { code: "usage" },
              );
            }
          } finally {
            rl.close();
          }
        }
        const result = await clearAllStoredAuth();
        await writeSessionOutput(outOpts(opts), {
          kind: "auth/clear",
          result: { all: true, cleared: result.cleared },
        });
        return;
      }
      const result = await clearStoredAuth(key!);
      await writeSessionOutput(outOpts(opts), {
        kind: "auth/clear",
        result: { url: result.url },
      });
    });
}

function registerSessionAdmin(program: CommandType): void {
  program
    .command("disconnect")
    .description("Disconnect a session (MRU when omitted on a TTY)")
    .argument("[session]", "Optional @name / name to disconnect")
    .action(async (sessionArg: string | undefined) => {
      const opts = program.opts<GlobalOpts>();
      const name = stripAt(opts.session) ?? stripAt(sessionArg);
      const { socketPath } = await ensureDaemon();
      const result = await callDaemon<{ name: string }>(
        "disconnect",
        {
          name,
          requireExplicit: requireExplicitSession(),
        },
        { socketPath },
      );
      await writeSessionOutput(outOpts(opts), {
        kind: "disconnect",
        name: result.name,
      });
    });

  program
    .command("sessions/list")
    .description("List open sessions (marks MRU); does not start the daemon")
    .action(async () => {
      const opts = program.opts<GlobalOpts>();
      try {
        const result = await callDaemon<{ sessions: SessionInfo[] }>(
          "sessions/list",
          {},
        );
        await writeSessionOutput(outOpts(opts), {
          kind: "sessions/list",
          sessions: result.sessions,
        });
      } catch (error) {
        if (isDaemonUnreachable(error)) {
          await writeSessionOutput(outOpts(opts), {
            kind: "sessions/list",
            sessions: [],
          });
          return;
        }
        throw error;
      }
    });

  program
    .command("sessions/use")
    .description("Set the MRU session without an MCP RPC")
    .argument("<session>", "Session @name / name")
    .action(async (sessionArg: string) => {
      const opts = program.opts<GlobalOpts>();
      const name = stripAt(opts.session) ?? stripAt(sessionArg);
      if (!name) {
        throw new CliExitCodeError(
          EXIT_CODES.USAGE,
          "sessions/use requires a session name",
          { code: "usage" },
        );
      }
      const { socketPath } = await ensureDaemon();
      const result = await callDaemon<SessionInfo>(
        "sessions/use",
        { name },
        { socketPath },
      );
      await writeSessionOutput(outOpts(opts), {
        kind: "session",
        session: result,
      });
    });
}

function registerDaemonCommands(program: CommandType): void {
  const daemon = program.command("daemon").description("Daemon control");

  daemon
    .command("status")
    .description("Show daemon pid, socket, and sessions (does not start it)")
    .action(async () => {
      const opts = program.opts<GlobalOpts>();
      try {
        const result = await callDaemon("daemon/status", {});
        await writeSessionOutput(outOpts(opts), {
          kind: "daemon/status",
          status: result as Record<string, unknown>,
        });
      } catch (error) {
        if (isDaemonUnreachable(error)) {
          await writeSessionOutput(outOpts(opts), {
            kind: "daemon/status",
            status: {
              running: false,
              message: "Daemon is not running.",
            },
          });
          return;
        }
        throw error;
      }
    });

  daemon
    .command("stop")
    .description("Stop the daemon and disconnect all sessions")
    .action(async () => {
      const opts = program.opts<GlobalOpts>();
      try {
        const result = await callDaemon("daemon/stop", {});
        await writeSessionOutput(outOpts(opts), {
          kind: "daemon/stop",
          result: result as Record<string, unknown>,
        });
      } catch (error) {
        if (isDaemonUnreachable(error)) {
          await writeSessionOutput(outOpts(opts), {
            kind: "daemon/stop",
            result: {
              stopping: false,
              message: "Daemon was not running.",
            },
          });
          return;
        }
        throw error;
      }
    });
}

function registerPrivateCommand(program: CommandType): void {
  program
    .command("private")
    .description(
      'Print shell exports for a private daemon (eval "$(mcpi private)"). ' +
        "Later mcpi commands in that shell use an isolated, token-gated daemon.",
    )
    .action(async () => {
      const binding = createPrivateBinding();
      await awaitableLog(formatPrivateEnvExports(binding));
    });
}

function registerRpcCommands(program: CommandType): void {
  for (const method of SESSION_RPC_METHODS) {
    const cmd = program
      .command(method)
      .description(`MCP ${method} against the current session`);

    cmd.option(
      "--metadata <pairs...>",
      "General metadata as key=value pairs",
      parseKeyValue,
      {},
    );

    switch (method) {
      case "tools/list":
        cmd.option("--app-info", "Emit one NDJSON app-info line per tool");
        cmd.action(async (o) => {
          await runRpc(program, method, {
            appInfo: o.appInfo === true,
            metadata: stringifyMeta(o.metadata),
          });
        });
        break;
      case "tools/call":
        cmd
          .argument("[toolName]", "Tool name")
          .argument(
            "[toolArgs...]",
            "Arguments as key:=value pairs or a JSON object",
          )
          .option("--tool-name <name>", "Tool name")
          .option(
            "--tool-arg <pairs...>",
            "Tool argument as key=value pair (alternative to key:=value positionals)",
            parseKeyValue,
            {},
          )
          .option(
            "--tool-args-json <json>",
            "Tool arguments as a JSON object (alternative to inline JSON positional)",
          )
          .option(
            "--tool-metadata <pairs...>",
            "Tool-specific metadata",
            parseKeyValue,
            {},
          )
          .option("--task", "Task-augmented tool call (callToolStream)")
          .option("--app-info", "Probe MCP App metadata only");
        cmd.action(
          async (
            toolNamePos: string | undefined,
            toolArgsPos: string[] | undefined,
            o,
          ) => {
            const { toolName, toolArg } = resolveToolCallArgs({
              toolNameFlag: o.toolName as string | undefined,
              toolNamePos,
              toolArgsPos,
              toolArgFlag: (o.toolArg ?? {}) as Record<string, JsonValue>,
              toolArgsJson: o.toolArgsJson as string | undefined,
            });
            await runRpc(program, method, {
              toolName,
              toolArg,
              toolMeta: stringifyMeta(o.toolMetadata),
              metadata: stringifyMeta(o.metadata),
              task: o.task === true,
              appInfo: o.appInfo === true,
            });
          },
        );
        break;
      case "resources/read":
      case "resources/subscribe":
      case "resources/unsubscribe":
        cmd
          .argument("[uri]", "Resource URI")
          .option("--uri <uri>", "Resource URI");
        cmd.action(async (uriPos: string | undefined, o) => {
          await runRpc(program, method, {
            uri: (o.uri as string | undefined) ?? uriPos,
            metadata: stringifyMeta(o.metadata),
          });
        });
        break;
      case "prompts/get":
        cmd
          .argument("[promptName]", "Prompt name")
          .option("--prompt-name <name>", "Prompt name")
          .option(
            "--prompt-args <pairs...>",
            "Prompt arguments",
            parseKeyValue,
            {},
          );
        cmd.action(async (promptPos: string | undefined, o) => {
          await runRpc(program, method, {
            promptName: (o.promptName as string | undefined) ?? promptPos,
            promptArgs: (o.promptArgs ?? {}) as Record<string, JsonValue>,
            metadata: stringifyMeta(o.metadata),
          });
        });
        break;
      case "prompts/complete":
        cmd
          .option("--complete-ref-type <type>", "ref/prompt or ref/resource")
          .option("--complete-ref <ref>", "Prompt name or resource URI")
          .option("--complete-arg-name <name>", "Argument name")
          .option("--complete-arg-value <value>", "Partial value", "");
        cmd.action(async (o) => {
          const refType = o.completeRefType as string | undefined;
          if (refType !== "ref/prompt" && refType !== "ref/resource") {
            throw new CliExitCodeError(
              EXIT_CODES.USAGE,
              "prompts/complete requires --complete-ref-type ref/prompt|ref/resource",
              { code: "usage" },
            );
          }
          await runRpc(program, method, {
            completeRefType: refType,
            completeRef: o.completeRef as string | undefined,
            completeArgName: o.completeArgName as string | undefined,
            completeArgValue: (o.completeArgValue as string | undefined) ?? "",
            metadata: stringifyMeta(o.metadata),
          });
        });
        break;
      case "logging/setLevel":
        cmd
          .argument("[level]", "Logging level")
          .option("--log-level <level>", "Logging level");
        cmd.action(async (levelPos: string | undefined, o) => {
          const level = (o.logLevel as string | undefined) ?? levelPos;
          if (level && !validLogLevels.includes(level as LoggingLevel)) {
            throw new Error(
              `Invalid log level: ${level}. Valid: ${validLogLevels.join(", ")}`,
            );
          }
          await runRpc(program, method, {
            logLevel: level as LoggingLevel | undefined,
            metadata: stringifyMeta(o.metadata),
          });
        });
        break;
      case "tasks/get":
      case "tasks/cancel":
      case "tasks/result":
        cmd.argument("[taskId]", "Task id").option("--task-id <id>", "Task id");
        cmd.action(async (taskPos: string | undefined, o) => {
          await runRpc(program, method, {
            taskId: (o.taskId as string | undefined) ?? taskPos,
            metadata: stringifyMeta(o.metadata),
          });
        });
        break;
      case "roots/set":
        cmd.option("--roots-json <json>", "JSON array of {uri, name?}");
        cmd.action(async (o) => {
          await runRpc(program, method, {
            rootsJson: o.rootsJson as string | undefined,
            metadata: stringifyMeta(o.metadata),
          });
        });
        break;
      default:
        cmd.action(async (o) => {
          await runRpc(program, method, {
            metadata: stringifyMeta(o.metadata),
          });
        });
        break;
    }
  }
}

async function runRpc(
  program: CommandType,
  method: string,
  methodArgs: MethodArgs,
): Promise<void> {
  const opts = program.opts<GlobalOpts>();
  await dispatchSessionRpc(method, methodArgs, {
    format: opts.format,
    plain: opts.plain === true,
    session: opts.session,
    requireExplicit: requireExplicitSession(),
  });
}

function parseKeyValue(
  value: string,
  previous: Record<string, JsonValue> = {},
): Record<string, JsonValue> {
  const parts = value.split("=");
  const key = parts[0];
  const val = parts.slice(1).join("=");
  if (!key || val === undefined || val === "") {
    throw new Error(
      `Invalid parameter format: ${value}. Use key=value format.`,
    );
  }
  let parsedValue: JsonValue;
  try {
    parsedValue = JSON.parse(val) as JsonValue;
  } catch {
    parsedValue = val;
  }
  return { ...previous, [key]: parsedValue };
}

function stringifyMeta(
  meta: Record<string, JsonValue> | undefined,
): Record<string, string> | undefined {
  if (!meta || Object.keys(meta).length === 0) return undefined;
  return Object.fromEntries(
    Object.entries(meta).map(([k, v]) => [k, metaValueToString(v)]),
  );
}

/** Preserve structured metadata (objects/arrays) instead of String → "[object Object]". */
function metaValueToString(value: JsonValue): string {
  if (typeof value === "string") return value;
  return JSON.stringify(value);
}

function looksLikeUrl(value: string): boolean {
  return /^https?:\/\//i.test(value);
}

function splitSessionTarget(target: string[]): {
  name: string | undefined;
  rest: string[];
} {
  if (target.length > 0 && target[0]!.startsWith("@")) {
    return { name: stripAt(target[0]), rest: target.slice(1) };
  }
  return { name: undefined, rest: target };
}

export { hoistAtSession } from "./dispatch.js";
