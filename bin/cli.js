#!/usr/bin/env node

import { join, dirname } from "path";
import { fileURLToPath } from "url";
import concurrently from "concurrently";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Paths to the server and client entry points
const serverPath = join(__dirname, "../server/build/index.js");
const clientPath = join(__dirname, "../client/bin/cli.js");

console.log("Starting MCP inspector...");

const { result } = concurrently(
  [
    {
      command: `node ${serverPath}`,
      name: "server",
    },
    {
      command: `node ${clientPath}`,
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
