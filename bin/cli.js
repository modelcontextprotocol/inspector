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

console.log(serverCommand);

const { result } = concurrently(
  [
    {
      command: serverCommand,
      name: "server",
    },
    {
      command: `node ${inspectorClientPath}`,
      name: "client",
    },
  ],
  {
    prefix: "name",
    killOthers: ["failure", "success"],
    restartTries: 3,
  },
);

result.catch((err) => {
  console.error("An error occurred:", err);
  process.exit(1);
});
