#!/usr/bin/env node
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Command } from "commander";
import { parseLauncherArgv } from "./parse-launcher-argv.js";
const launcherDir = dirname(fileURLToPath(import.meta.url));
function clientEntry(client) {
    return pathToFileURL(join(launcherDir, "..", "..", client, "build", "index.js")).href;
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
}
catch (err) {
    const message = err instanceof Error ? err.message : "Invalid launcher arguments.";
    console.error(`Error: ${message}`);
    process.exit(1);
}
const { mode, forwardedArgv, hasPrefixModeFlag } = parsedArgv;
const helpOnly = process.argv.includes("-h") || process.argv.includes("--help");
if (helpOnly && !hasPrefixModeFlag) {
    program.outputHelp();
    console.log("\nMode flags (--web, --cli, --tui) must appear before app options. All following arguments are forwarded unchanged.");
    process.exit(0);
}
async function run() {
    if (mode === "web") {
        const { runWeb } = await import(clientEntry("web"));
        await runWeb(forwardedArgv);
    }
    else if (mode === "cli") {
        const { runCli } = await import(clientEntry("cli"));
        await runCli(forwardedArgv);
    }
    else {
        const { runTui } = await import(clientEntry("tui"));
        await runTui(forwardedArgv);
    }
}
run().catch((err) => {
    console.error("Error running MCP Inspector:", err);
    process.exit(1);
});
