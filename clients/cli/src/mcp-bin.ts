#!/usr/bin/env node

import { resolve } from "path";
import { fileURLToPath } from "url";
import { handleError } from "./error-handler.js";
import { runMcp } from "./session/mcp.js";

export { runMcp };

const __filename = fileURLToPath(import.meta.url);
const isMain =
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === resolve(__filename);

if (isMain) {
  runMcp(process.argv)
    .then(() => process.exit(0))
    .catch(handleError);
}
