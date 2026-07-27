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
    // Append the stack only when DEBUG / MCP_DEBUG is *meaningfully* set — "0" /
    // "false" / empty read as off, so a stray DEBUG=0 doesn't force a stack.
    // (Duplicated from the launcher's `wantsDebugStack` — the two bins can't
    // import each other; keep them in sync if this logic changes.)
    const debugOn = (v: string | undefined): boolean => {
      const s = v?.trim().toLowerCase();
      return !!s && s !== "0" && s !== "false";
    };
    if (
      (debugOn(process.env.MCP_DEBUG) || debugOn(process.env.DEBUG)) &&
      err instanceof Error
    ) {
      console.error(err.stack);
    }
    process.exit(1);
  });
}
