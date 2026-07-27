#!/usr/bin/env node

import { resolve } from "path";
import { fileURLToPath } from "url";
import { runTui } from "./tui.js";

export { runTui };

const __filename = fileURLToPath(import.meta.url);
const isMain =
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === resolve(__filename);

if (isMain) {
  runTui(process.argv).catch((err: unknown) => {
    // Print the message, not the stack — a startup config error (e.g. the
    // OAuth callback loopback guard) should read as an actionable message, not
    // an internal fault. Matches run-web.ts's house pattern. The stack is still
    // available under DEBUG / MCP_DEBUG for a real fault.
    console.error("Error:", err instanceof Error ? err.message : err);
    if ((process.env.DEBUG || process.env.MCP_DEBUG) && err instanceof Error) {
      console.error(err.stack);
    }
    process.exit(1);
  });
}
