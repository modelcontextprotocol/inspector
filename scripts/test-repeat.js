#!/usr/bin/env node

import { execSync } from "child_process";

/**
 * Equivalent to npm run test (prettier-check once, then vitest run), but runs
 * vitest run in a loop up to N times, stopping on first failure.
 *
 * Usage: node scripts/test-repeat.js [N]
 *   N = iteration count (default 5). Example: npm run test:repeat -- 10
 */

const args = process.argv.slice(2);
let maxIterations = 5;
if (args.length > 0) {
  const n = parseInt(args[0], 10);
  if (Number.isNaN(n) || n < 1) {
    console.error("Invalid count: expected positive integer");
    process.exit(1);
  }
  maxIterations = n;
}

console.log(`Prettier check (once)...`);
execSync("npm run prettier-check", { stdio: "inherit" });

console.log(
  `\nVitest run: up to ${maxIterations} iteration(s), stopping on first failure.\n`,
);
for (let i = 1; i <= maxIterations; i++) {
  console.log(`--- Iteration ${i}/${maxIterations} ---`);
  try {
    execSync("vitest run", { stdio: "inherit" });
  } catch (err) {
    process.exit(err.status ?? 1);
  }
}
console.log(`\nAll ${maxIterations} iteration(s) passed.`);
