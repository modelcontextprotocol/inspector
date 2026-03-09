#!/usr/bin/env node

import { Command } from "commander";

const program = new Command();

program
  .name("mcp-inspector")
  .description("MCP Inspector – run web UI, CLI, or TUI")
  .option("--web", "Run web UI (default)")
  .option("--cli", "Run CLI")
  .option("--tui", "Run TUI")
  .allowUnknownOption();

program.parseOptions(process.argv);
const opts = program.opts() as { web?: boolean; cli?: boolean; tui?: boolean };

const helpOnly = process.argv.includes("-h") || process.argv.includes("--help");
const modeFlagSet = opts.web || opts.cli || opts.tui;

if (helpOnly && !modeFlagSet) {
  program.outputHelp();
  console.log(
    "\nAll other arguments are forwarded to the selected app. Use --web, --cli, or --tui then pass app-specific options.",
  );
  process.exit(0);
}

const mode = opts.tui ? "tui" : opts.cli ? "cli" : "web";
const modeFlag = opts.tui ? "--tui" : opts.cli ? "--cli" : "--web";
// Forward argv without the launcher's mode flag so the app's Commander doesn't see unknown option
const forwardedArgv = process.argv.filter((arg) => arg !== modeFlag);

async function run(): Promise<void> {
  if (mode === "web") {
    const { runWeb } = await import("@modelcontextprotocol/inspector-web");
    await runWeb(forwardedArgv);
  } else if (mode === "cli") {
    const { runCli } = await import("@modelcontextprotocol/inspector-cli");
    await runCli(forwardedArgv);
  } else {
    const { runTui } = await import("@modelcontextprotocol/inspector-tui");
    await runTui(forwardedArgv);
  }
}

run().catch((err: unknown) => {
  console.error("Error running MCP Inspector:", err);
  process.exit(1);
});
