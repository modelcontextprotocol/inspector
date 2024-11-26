#!/usr/bin/env node

import { join, dirname } from "path";
import { fileURLToPath } from "url";
import concurrently from "concurrently";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Get command line arguments
const [, , command, ...mcpServerArgs] = process.argv;

const inspectorServerPath = join(__dirname, "../server/build/index.js");

// Path to the client entry point
const inspectorClientPath = join(__dirname, "../client/bin/cli.js");

console.log("Starting MCP inspector...");

function escapeArg(arg) {
  if (arg.includes(" ") || arg.includes("'") || arg.includes('"')) {
    return `\\"${arg.replace(/"/g, '\\\\\\"')}\\"`;
  }
  return arg;
}

function buildCommandWithPort(command, port) {
  if (!port) return command;
  
  if (process.platform === 'win32') {
    return `set PORT=${port}&& ${command}`;
  }
  return `PORT=${port} ${command}`;
}

const serverCommand = [
  `node`,
  inspectorServerPath,
  command ? `--env ${escapeArg(command)}` : "",
  mcpServerArgs.length
    ? `--args="${mcpServerArgs.map(escapeArg).join(" ")}"`
    : "",
]
  .filter(Boolean)
  .join(" ");

const clientCommand = `node ${inspectorClientPath}`;
const CLIENT_PORT = process.env.CLIENT_PORT ?? "";
const SERVER_PORT = process.env.SERVER_PORT ?? "";

const { result } = concurrently(
  [
    {
      command: buildCommandWithPort(serverCommand, SERVER_PORT),
      name: "server",
    },
    {
      command: buildCommandWithPort(clientCommand, CLIENT_PORT),
      name: "client",
    },
  ],
  {
    prefix: "name",
    killOthers: ["failure", "success"],
    restartTries: 3,
  },
);

console.log(
  `\n🔍 MCP Inspector is up and running at http://localhost:${CLIENT_PORT || 5173} 🚀`,
);

result.catch((err) => {
  console.error("An error occurred:", err);
  process.exit(1);
});
