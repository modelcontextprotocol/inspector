/**
 * Which bare specifiers a built bundle imports, and whether each one resolves
 * from a given directory under **ESM** rules (#2650).
 *
 * `pack:verify` uses this to prove that every package the installed `mcpdo`
 * bundle reaches for is actually resolvable from the consumer install — the
 * failure a missing root `dependencies` entry or a dropped `external` produces,
 * and one that only shows at the moment the import runs. Driving a couple of
 * commands cannot see a lazy `import()` on a path those commands never take.
 *
 * Resolution is ESM on purpose. `@modelcontextprotocol/ext-tasks` exports only
 * an `import` condition, so a CommonJS `require.resolve` reports it missing even
 * though the bundle — which is ESM — loads it fine. The 2.10.0 hand check hit
 * exactly that false failure. So the probe runs `import.meta.resolve` in a
 * module placed **inside** the directory being checked, which is the resolver
 * and the starting point the bundle itself gets.
 *
 * Extraction is a statement-anchored scan rather than a parser: esbuild emits
 * every static import at column 0, so anchoring at the line start keeps prose
 * in the bundle's comments (`… apart from "a digest was wrong" …`) from reading
 * as a `from "<specifier>"` clause.
 */

import { spawnSync } from "node:child_process";
import { rmSync, writeFileSync } from "node:fs";
import { isBuiltin } from "node:module";
import { join, resolve } from "node:path";

const STATIC_FROM = /^(?:import|export)\b[^;]*?\bfrom\s*["']([^"']+)["']/gm;
const SIDE_EFFECT = /^import\s*["']([^"']+)["']/gm;
const DYNAMIC = /\bimport\(\s*["']([^"']+)["']\s*\)/g;

/** True for a specifier npm has to supply: not relative, absolute or a builtin. */
export function isBareSpecifier(specifier) {
  return (
    !specifier.startsWith(".") &&
    !specifier.startsWith("/") &&
    !specifier.includes(":") &&
    !isBuiltin(specifier)
  );
}

/**
 * @param {string} source one bundle file's text
 * @returns {string[]} the bare specifiers it imports, sorted and de-duplicated
 */
export function collectBareImports(source) {
  const found = new Set();
  for (const pattern of [STATIC_FROM, SIDE_EFFECT, DYNAMIC]) {
    for (const match of source.matchAll(pattern)) {
      if (isBareSpecifier(match[1])) found.add(match[1]);
    }
  }
  return [...found].sort();
}

const PROBE_NAME = "__pack_verify_resolve_probe.mjs";
const PROBE = `const failed = [];
for (const s of JSON.parse(process.argv[2])) {
  try { import.meta.resolve(s); } catch (e) { failed.push({ specifier: s, error: e.message }); }
}
process.stdout.write(JSON.stringify(failed));
`;

/**
 * ESM-resolve each specifier from inside `dir`. The probe module is written
 * into `dir` and removed again, so it resolves exactly as a module there does.
 *
 * @param {{ dir: string, specifiers: string[] }} options
 * @returns {{ specifier: string, error: string }[]} the ones that did not resolve
 */
export function unresolvedFrom({ dir, specifiers }) {
  const probe = resolve(dir, PROBE_NAME);
  writeFileSync(probe, PROBE);
  try {
    const r = spawnSync(process.execPath, [probe, JSON.stringify(specifiers)], {
      cwd: dir,
      encoding: "utf8",
    });
    if (r.status !== 0) {
      throw new Error(`resolve probe exited ${r.status}: ${r.stderr}`);
    }
    return JSON.parse(r.stdout);
  } finally {
    rmSync(probe, { force: true });
  }
}
