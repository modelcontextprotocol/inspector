#!/usr/bin/env node

import { runTui } from "./tui.js";

runTui(process.argv).catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
