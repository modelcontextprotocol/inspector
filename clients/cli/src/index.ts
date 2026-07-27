#!/usr/bin/env node

import { resolve } from "path";
import { fileURLToPath } from "url";
import { runCli, validLogLevels } from "./cli.js";
import { handleError } from "./error-handler.js";

// `handleError` is exported so the launcher (which imports `runCli` as a module
// and owns the rejection) can route a `mcp-inspector --cli` failure through the
// CLI's own sink — preserving the EXIT_CODES map and the JSON `{"error":…}`
// envelope that this bin's own `.catch` provides only when run directly.
export { runCli, validLogLevels, handleError };

const __filename = fileURLToPath(import.meta.url);
const isMain =
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === resolve(__filename);

if (isMain) {
  runCli(process.argv)
    .then(() => process.exit(0))
    .catch(handleError);
}
