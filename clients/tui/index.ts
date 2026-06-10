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
    console.error(err);
    process.exit(1);
  });
}
