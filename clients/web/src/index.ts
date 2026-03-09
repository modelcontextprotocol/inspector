#!/usr/bin/env node

import { resolve } from "path";
import { fileURLToPath } from "url";
import { runWeb } from "./web.js";

export { runWeb };

const __filename = fileURLToPath(import.meta.url);
const isMain =
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === resolve(__filename);

if (isMain) {
  runWeb(process.argv)
    .then((code) => process.exit(code ?? 0))
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}
