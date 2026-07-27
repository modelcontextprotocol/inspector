// Shared npm-script reachability helpers used by both coverage guards
// (`verify-format-coverage.mjs`, `verify-typecheck-coverage.mjs`). Extracted so
// the wiring logic both depend on — "is this gate actually run?" — can't drift
// between them (the same rationale `scripts/lib/prod-web-server.mjs` was
// extracted under).

/**
 * Split a shell-ish command string into args, honoring single and double quotes
 * (a quoted arg becomes one token with the quotes stripped). Used by both
 * coverage guards so they parse a script's args — quoting is the house style
 * here (a quoted prettier glob, `tsc -p "tsconfig.json"`) — the same way.
 */
export function tokenize(command) {
  const tokens = [];
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let m;
  while ((m = re.exec(command)) !== null) {
    tokens.push(m[1] ?? m[2] ?? m[3]);
  }
  return tokens;
}

/**
 * Names of scripts transitively reachable from `entry` by following `npm run
 * <name>` references within a single manifest's `scripts`, plus npm's implicit
 * `pre<name>`/`post<name>` lifecycle hooks (npm runs those around `<name>`
 * without an explicit `npm run`, so a gate moved into e.g. `prevalidate` is
 * still reached). A gate harvested from a script that nothing reachable from
 * `entry` invokes gates nothing, so callers restrict to this set to assert "CI
 * actually runs this", not merely "the script exists".
 */
export function reachableScripts(scripts, entry = "validate") {
  const reached = new Set();
  const queue = [entry];
  const runRef = /npm run ([\w:-]+)/g;
  while (queue.length > 0) {
    const name = queue.shift();
    if (reached.has(name)) continue;
    reached.add(name);
    // npm runs pre<name>/post<name> implicitly around <name>.
    for (const hook of [`pre${name}`, `post${name}`])
      if (typeof scripts?.[hook] === "string") queue.push(hook);
    const cmd = scripts?.[name];
    if (typeof cmd !== "string") continue;
    for (const m of cmd.matchAll(runRef)) queue.push(m[1]);
  }
  return reached;
}

/** The command strings of every script reachable from the root `validate`. */
function rootReachedCommands(rootScripts) {
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
  // Anchored match: an optional leading `./` (`cd ./clients/x` genuinely runs
  // the client) and a boundary after the dir, so a prefix-sibling (`clients/x`
  // vs `clients/x-next`) can't satisfy the check for the shorter name — a bare
  // substring `includes` would let a sibling silently vouch for a dropped client.
  // Quotes are stripped first so `cd "clients/x"` (a valid form) still matches.
  const escaped = clientDir.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`cd \\.?/?${escaped}(?=$|[\\s&;])`);
  return rootReachedCommands(rootScripts).some(
    (c) => re.test(c.replace(/["']/g, "")) && /npm run validate/.test(c),
  );
}

/**
 * Whether `scriptName` is reachable from the root `validate`. A guard can't
 * assert it is *itself* run (an unrun guard runs no check), but the two coverage
 * guards can each assert the *other* is still wired — so dropping either from
 * `validate` is caught by its sibling. Only deleting both slips through.
 */
export function rootReachesScript(rootScripts, scriptName) {
  return reachableScripts(rootScripts, "validate").has(scriptName);
}
