#!/usr/bin/env node

import { realpathSync } from "fs";
import { resolve } from "path";
import { fileURLToPath } from "url";
import { handleError } from "@inspector/cli/error-handler.js";
import { runMcp } from "./session/mcp.js";

export { runMcp };

const __filename = fileURLToPath(import.meta.url);

/** True when this file is the process entry (works through npm-link symlinks). */
function isMainModule(): boolean {
  const entry = process.argv[1];
  if (entry === undefined) return false;
  try {
    return realpathSync(resolve(entry)) === realpathSync(resolve(__filename));
  } catch {
    return resolve(entry) === resolve(__filename);
  }
}

if (isMainModule()) {
  runMcp(process.argv)
    .then(() => process.exit(0))
    .catch(handleError);
}
