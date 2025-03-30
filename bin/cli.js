#!/usr/bin/env node
import { Command } from "commander";
import fs from "node:fs";
import path from "node:path";
import { dirname, resolve } from "path";
import { spawnPromise } from "spawn-rx";
import { fileURLToPath } from "url";
const __dirname = dirname(fileURLToPath(import.meta.url));
function handleError(error) {
    let message;
    if (error instanceof Error) {
        message = error.message;
    }
    else if (typeof error === "string") {
        message = error;
    }
    else {
        message = "Unknown error";
    }
    console.error(message);
    process.exit(1);
}
function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
async function runWebClient(args) {
    const inspectorServerPath = resolve(__dirname, "..", "server", "build", "index.js");
    // Path to the client entry point
    const inspectorClientPath = resolve(__dirname, "..", "client", "bin", "cli.js");
    const CLIENT_PORT = process.env.CLIENT_PORT ?? "5173";
    const SERVER_PORT = process.env.SERVER_PORT ?? "3000";
    console.log("Starting MCP inspector...");
    const abort = new AbortController();
    let cancelled = false;
    process.on("SIGINT", () => {
        cancelled = true;
        abort.abort();
    });
    const server = spawnPromise("node", [
        inspectorServerPath,
        ...(args.command ? [`--env`, args.command] : []),
        ...(args.args ? [`--args=${args.args.join(" ")}`] : []),
    ], {
        env: {
            ...process.env,
            PORT: SERVER_PORT,
            MCP_ENV_VARS: JSON.stringify(args.envArgs),
        },
        signal: abort.signal,
        echoOutput: true,
    });
    const client = spawnPromise("node", [inspectorClientPath], {
        env: { ...process.env, PORT: CLIENT_PORT },
        signal: abort.signal,
        echoOutput: true,
    });
    // Make sure our server/client didn't immediately fail
    await Promise.any([server, client, delay(2 * 1000)]);
    const portParam = SERVER_PORT === "3000" ? "" : `?proxyPort=${SERVER_PORT}`;
    console.log(`\n🔍 MCP Inspector is up and running at http://127.0.0.1:${CLIENT_PORT}${portParam} 🚀`);
    try {
        await Promise.any([server, client]);
    }
    catch (e) {
        if (!cancelled || process.env.DEBUG) {
            throw e;
        }
    }
}
async function runCli(args) {
    const projectRoot = resolve(__dirname, "..");
    const cliPath = resolve(projectRoot, "cli", "build", "index.js");
    const abort = new AbortController();
    let cancelled = false;
    process.on("SIGINT", () => {
        cancelled = true;
        abort.abort();
    });
    try {
        await spawnPromise("node", [cliPath, args.command, ...args.args], {
            env: { ...process.env, ...args.envArgs },
            signal: abort.signal,
            echoOutput: true,
        });
    }
    catch (e) {
        if (!cancelled || process.env.DEBUG) {
            throw e;
        }
    }
}
function loadConfigFile(configPath, serverName) {
    try {
        const resolvedConfigPath = path.isAbsolute(configPath)
            ? configPath
            : path.resolve(process.cwd(), configPath);
        if (!fs.existsSync(resolvedConfigPath)) {
            throw new Error(`Config file not found: ${resolvedConfigPath}`);
        }
        const configContent = fs.readFileSync(resolvedConfigPath, "utf8");
        const parsedConfig = JSON.parse(configContent);
        if (!parsedConfig.mcpServers || !parsedConfig.mcpServers[serverName]) {
            const availableServers = Object.keys(parsedConfig.mcpServers || {}).join(", ");
            throw new Error(`Server '${serverName}' not found in config file. Available servers: ${availableServers}`);
        }
        const serverConfig = parsedConfig.mcpServers[serverName];
        return serverConfig;
    }
    catch (err) {
        if (err instanceof SyntaxError) {
            throw new Error(`Invalid JSON in config file: ${err.message}`);
        }
        throw err;
    }
}
function parseKeyValuePair(value, previous = {}) {
    const parts = value.split("=");
    const key = parts[0];
    const val = parts.slice(1).join("=");
    if (val === undefined || val === "") {
        throw new Error(`Invalid parameter format: ${value}. Use key=value format.`);
    }
    return { ...previous, [key]: val };
}
function parseArgs() {
    const program = new Command();
    const argSeparatorIndex = process.argv.indexOf("--");
    let preArgs = process.argv;
    let postArgs = [];
    if (argSeparatorIndex !== -1) {
        preArgs = process.argv.slice(0, argSeparatorIndex);
        postArgs = process.argv.slice(argSeparatorIndex + 1);
    }
    program
        .name("inspector-bin")
        .allowExcessArguments()
        .allowUnknownOption()
        .option("-e <env>", "environment variables in KEY=VALUE format", parseKeyValuePair, {})
        .option("--config <path>", "config file path")
        .option("--server <n>", "server name from config file")
        .option("--cli", "enable CLI mode");
    // Parse only the arguments before --
    program.parse(preArgs);
    const options = program.opts();
    const remainingArgs = program.args;
    // Add back any arguments that came after --
    const finalArgs = [...remainingArgs, ...postArgs];
    // Validate that config and server are provided together
    if ((options.config && !options.server) ||
        (!options.config && options.server)) {
        throw new Error("Both --config and --server must be provided together. If you specify one, you must specify the other.");
    }
    // If config file is specified, load and use the options from the file. We must merge the args
    // from the command line and the file together, or we will miss the method options (--method,
    // etc.)
    if (options.config && options.server) {
        const config = loadConfigFile(options.config, options.server);
        return {
            command: config.command,
            args: [...(config.args || []), ...finalArgs],
            envArgs: { ...(config.env || {}), ...(options.e || {}) },
            cli: options.cli || false,
        };
    }
    // Otherwise use command line arguments
    const command = finalArgs[0] || "";
    const args = finalArgs.slice(1);
    return {
        command,
        args,
        envArgs: options.e || {},
        cli: options.cli || false,
    };
}
async function main() {
    process.on("uncaughtException", (error) => {
        handleError(error);
    });
    try {
        const args = parseArgs();
        if (args.cli) {
            runCli(args);
        }
        else {
            await runWebClient(args);
        }
    }
    catch (error) {
        handleError(error);
    }
}
main();
