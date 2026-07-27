#!/usr/bin/env node

import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Command } from "commander";
import { parseLauncherArgv } from "./parse-launcher-argv.js";

const launcherDir = dirname(fileURLToPath(import.meta.url));

function clientEntry(client: "web" | "cli" | "tui"): string {
  return pathToFileURL(
    join(launcherDir, "..", "..", client, "build", "index.js"),
  ).href;
}

/**
 * Whether to append the error stack on a top-level failure. Gated on `MCP_DEBUG`
 * or `DEBUG` being *meaningfully* set — `"0"` / `"false"` / empty read as off, so
 * a stray `DEBUG=0` doesn't turn stacks on (and `DEBUG` stays useful for the
 * `debug` package's namespace filter, which is any non-empty value).
 */
function wantsDebugStack(): boolean {
  const on = (v: string | undefined): boolean => {
    const s = v?.trim().toLowerCase();
    return !!s && s !== "0" && s !== "false";
  };
  return on(process.env.MCP_DEBUG) || on(process.env.DEBUG);
}

const program = new Command();

program
  .name("mcp-inspector")
  .description("MCP Inspector – run web UI, CLI, or TUI")
  .option("--web", "Run web UI (default)")
  .option("--cli", "Run CLI")
  .option("--tui", "Run TUI");

let parsedArgv;
try {
  parsedArgv = parseLauncherArgv(process.argv);
} catch (err) {
  const message =
    err instanceof Error ? err.message : "Invalid launcher arguments.";
  console.error(`Error: ${message}`);
  process.exit(1);
}

const { mode, forwardedArgv, hasPrefixModeFlag } = parsedArgv;

const helpOnly = process.argv.includes("-h") || process.argv.includes("--help");

if (helpOnly && !hasPrefixModeFlag) {
  program.outputHelp();
  console.log(
    "\nMode flags (--web, --cli, --tui) must appear before app options. All following arguments are forwarded unchanged.",
  );
  process.exit(0);
}

async function run(): Promise<void> {
  if (mode === "web") {
    const { runWeb } = await import(clientEntry("web"));
    await runWeb(forwardedArgv);
  } else if (mode === "cli") {
    // Route a CLI failure through the CLI's own error sink so `mcp-inspector
    // --cli` (a module import here, so the CLI bin's own `.catch(handleError)`
    // never fires) still honors the EXIT_CODES map and emits the JSON
    // `{"error":…}` envelope its README documents — instead of the generic
    // exit-1 catch-all below.
    const { runCli, handleError } = await import(clientEntry("cli"));
    try {
      // On success, let `run()` resolve and the event loop drain (rather than a
      // `process.exit(0)`) — the CLI closes its own transports, and an eager exit
      // risks truncating a large stdout payload on a pipe (async on macOS).
      await runCli(forwardedArgv);
    } catch (err) {
      // A stale `cli/build` (built before handleError was exported) would make
      // this `undefined`; fall through to the generic sink with the real message
      // rather than throwing "handleError is not a function" over it.
      if (typeof handleError !== "function") throw err;
      handleError(err); // writes the envelope + process.exit(code); never returns
    }
  } else {
    const { runTui } = await import(clientEntry("tui"));
    await runTui(forwardedArgv);
  }
}

run().catch((err: unknown) => {
  // Print the message, not the Error stack — a startup config error (a bad flag,
  // the OAuth callback loopback guard) should read as actionable, not internal.
  // The stack is still available under DEBUG / MCP_DEBUG for real faults.
  console.error(
    "Error running MCP Inspector:",
    err instanceof Error ? err.message : err,
  );
  if (wantsDebugStack() && err instanceof Error) {
    console.error(err.stack);
  }
  process.exit(1);
});
