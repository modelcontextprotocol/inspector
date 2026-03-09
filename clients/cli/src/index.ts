#!/usr/bin/env node

import { resolve } from "path";
import { fileURLToPath } from "url";
import { runCli, validLogLevels } from "./cli.js";
import { handleError } from "./error-handler.js";

export { runCli, validLogLevels };

const __filename = fileURLToPath(import.meta.url);
const isMain =
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === resolve(__filename);

if (isMain) {
  runCli(process.argv)
    .then(() => process.exit(0))
    .catch(handleError);
}
