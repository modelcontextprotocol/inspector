// Shared npm-script reachability helpers used by both coverage guards
// (`verify-format-coverage.mjs`, `verify-typecheck-coverage.mjs`). Extracted so
// the wiring logic both depend on — "is this gate actually run?" — can't drift
// between them (the same rationale `scripts/lib/prod-web-server.mjs` was
// extracted under).

/**
 * Names of scripts transitively reachable from `entry` by following `npm run
 * <name>` references within a single manifest's `scripts`. A gate harvested from
 * a script that nothing reachable from `entry` invokes gates nothing, so callers
 * restrict to this set to assert "CI actually runs this", not merely "the script
 * exists".
 */
export function reachableScripts(scripts, entry = "validate") {
  const reached = new Set();
  const queue = [entry];
  const runRef = /npm run ([\w:-]+)/g;
  while (queue.length > 0) {
    const name = queue.shift();
    if (reached.has(name)) continue;
    reached.add(name);
    const cmd = scripts?.[name];
    if (typeof cmd !== "string") continue;
    for (const m of cmd.matchAll(runRef)) queue.push(m[1]);
  }
  return reached;
}

/** The command strings of every script reachable from the root `validate`. */
export function rootReachedCommands(rootScripts) {
  return [...reachableScripts(rootScripts)]
    .map((n) => rootScripts?.[n])
    .filter((c) => typeof c === "string");
}

/**
 * Whether the root `validate` chain invokes `cd <clientDir> && npm run validate`.
 * Without this a per-client gate would still be harvested from that client's own
 * `validate` and count as coverage even after the root chain stopped running it
 * — the "gate silently stops gating" failure, one level up.
 */
export function rootRunsClientValidate(rootScripts, clientDir) {
  return rootReachedCommands(rootScripts).some(
    (c) => c.includes(`cd ${clientDir}`) && /npm run validate/.test(c),
  );
}
