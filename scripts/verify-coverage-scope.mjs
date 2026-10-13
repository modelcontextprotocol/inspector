/**
 * Guards the file set each client's coverage run measures (#2709).
 *
 * The per-file ≥90 gate only judges the files that reach
 * `coverage/coverage-summary.json`. Nothing checked that the report holds the
 * files it should, so when a client's coverage `include` globs stop matching,
 * the gate shrinks silently and stays green. That happened during the #2557
 * dependency refresh: under vitest 5, whose fix for "coverage include/exclude
 * globs too eager" changed how `clients/web`'s mixed relative/absolute
 * patterns resolve, web's report fell from 418 files to 11 — every remaining
 * file cleared 90, every test passed, and only a by-hand comparison of the
 * summary file counts caught it. It is #1301's class (core/ files silently
 * leaving the gate), reached through a tooling upgrade instead of a path move.
 *
 * **The check compares the report against an independent expansion of the
 * client's own declaration.** For each client, Vitest resolves the config —
 * so the patterns read here are the ones the run actually used, hard-coded
 * default exclusions included — but the patterns are then expanded against
 * the file system with Node's own `fs.globSync` / `path.matchesGlob`, never
 * with Vitest's matcher. Asking the tool under test which files it meant would
 * agree with it by construction, which is exactly the blind spot this closes.
 * There is no file count to maintain: a new file under an included directory
 * is expected the moment it exists.
 *
 * **How a declared pattern is read** — the declaration, not any one Vitest
 * version's matcher, is the reference:
 *
 *   • an absolute pattern means itself;
 *   • a relative pattern resolves against the client directory, unless it
 *     starts with the client's own repo-relative path (`clients/web/server/**`
 *     in web's list), which can only mean a repo-root-relative path;
 *   • an exclude pattern removes a file when it matches the file's absolute,
 *     client-relative or repo-relative path. That is deliberately lenient: an
 *     over-broad exclude can only make the guard expect fewer files, never
 *     report a file as missing that the run was right to drop.
 *
 * Every client gated by `npm run coverage` is checked, and a client with a
 * `test:coverage` script that this guard does not list fails loudly rather
 * than going unchecked — the same deny-by-default as `verify:test-timeouts`.
 *
 * It reads coverage output, so it runs at the end of the root `coverage`
 * script (and with it in `local:gate` and the CI `coverage` job), not in
 * `validate`.
 *
 * ⚠️ Observed to FAIL before it was trusted: with web's summary reduced to
 * the `clients/web/server/**` rows a vitest 5 run produced, it names every
 * web component, hook, lib, util and core/ file that dropped out.
 */

import {
  existsSync,
  globSync,
  readFileSync,
  readdirSync,
  statSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const scriptsDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptsDir, "..");

/**
 * Every client whose coverage run `npm run coverage` gates, and the config
 * file that declares its coverage scope.
 */
export const CLIENTS = [
  { name: "web", config: "vite.config.ts" },
  { name: "cli", config: "vitest.config.ts" },
  { name: "mcpdo", config: "vitest.config.ts" },
  { name: "tui", config: "vitest.config.ts" },
  { name: "launcher", config: "vitest.config.ts" },
];

/**
 * Files a client's declaration matches that its coverage run legitimately
 * omits, keyed by client, as repo-relative paths. Each entry must say why.
 * Empty today: on `v2/main` every client's report holds exactly what its
 * declaration expands to.
 *
 * @type {Record<string, Record<string, string>>}
 */
export const KNOWN_OMISSIONS = {};

/** @param {string} p */
const slash = (p) => p.split(path.sep).join("/");

/**
 * Expand one client's coverage `include`/`exclude` against the file system.
 *
 * @param {{
 *   include: readonly string[],
 *   exclude: readonly string[],
 *   clientDir: string,
 *   repoRoot: string,
 * }} scope absolute `clientDir` and `repoRoot`
 * @returns {string[]} sorted absolute, forward-slashed file paths
 */
export function expandCoverageScope({ include, exclude, clientDir, repoRoot }) {
  const clientPrefix = `${slash(path.relative(repoRoot, clientDir))}/`;
  const files = new Set();
  for (const raw of include) {
    const pattern = slash(raw);
    let matches;
    if (path.isAbsolute(raw)) {
      matches = globSync(pattern);
    } else {
      const base = pattern.startsWith(clientPrefix) ? repoRoot : clientDir;
      matches = globSync(pattern, { cwd: base }).map((f) =>
        path.resolve(base, f),
      );
    }
    for (const f of matches) files.add(slash(path.resolve(f)));
  }
  const excludes = exclude.map(slash);
  return (
    [...files]
      .filter((abs) => {
        const candidates = [
          abs,
          slash(path.relative(clientDir, abs)),
          slash(path.relative(repoRoot, abs)),
        ];
        return !excludes.some((p) =>
          candidates.some((c) => path.matchesGlob(c, p)),
        );
      })
      // `globSync` returns directories too; a coverage report holds files.
      .filter((abs) => statSync(abs).isFile())
      .sort()
  );
}

/**
 * Compare the expected file set with the files a coverage summary reports.
 *
 * @param {{
 *   client: string,
 *   expected: readonly string[],
 *   reported: readonly string[],
 *   omissions?: Record<string, string>,
 *   repoRoot: string,
 * }} input absolute, forward-slashed paths
 * @returns {string[]} failure messages; empty when the scope holds
 */
export function diffCoverageScope({
  client,
  expected,
  reported,
  omissions = {},
  repoRoot,
}) {
  const failures = [];
  if (expected.length === 0) {
    failures.push(
      `${client}: its coverage include expands to no files at all — the ` +
        `declaration no longer names anything on disk`,
    );
    return failures;
  }
  const have = new Set(reported.map(slash));
  const rel = (abs) => slash(path.relative(repoRoot, abs));
  // An omission is honored only with a stated reason; an entry without one
  // would weaken the gate as silently as the glob drift this guard exists for.
  const isJustified = (r) =>
    typeof omissions[r] === "string" && omissions[r].trim() !== "";
  const missing = expected.filter(
    (f) => !have.has(f) && !(rel(f) in omissions && isJustified(rel(f))),
  );
  if (missing.length > 0) {
    failures.push(
      `${client}: ${missing.length} of ${expected.length} file(s) its coverage ` +
        `include declares are missing from coverage-summary.json (the report ` +
        `holds ${have.size}) — the run measured a narrower scope than it ` +
        `declares, so those files are not under the per-file gate:\n` +
        missing.map((f) => `    ${rel(f)}`).join("\n"),
    );
  }
  const expectedRel = new Set(expected.map(rel));
  const reportedRel = new Set([...have].map(rel));
  for (const omitted of Object.keys(omissions)) {
    if (!isJustified(omitted)) {
      failures.push(
        `${client}: KNOWN_OMISSIONS names ${omitted} without a reason — ` +
          `state why the run may omit it, or remove the entry`,
      );
    } else if (!expectedRel.has(omitted)) {
      failures.push(
        `${client}: KNOWN_OMISSIONS names ${omitted}, which its declaration ` +
          `no longer matches — a stale entry hides nothing and should be removed`,
      );
    } else if (reportedRel.has(omitted)) {
      failures.push(
        `${client}: KNOWN_OMISSIONS names ${omitted}, which the report now ` +
          `measures — the exemption is stale and should be removed`,
      );
    }
  }
  return failures;
}

/**
 * Clients on disk with a `test:coverage` script that `CLIENTS` does not list,
 * and listed clients with no such script.
 *
 * @param {string[]} discovered client names with a `test:coverage` script
 * @param {readonly {name: string}[]} [configured]
 * @returns {string[]}
 */
export function checkClientRoster(discovered, configured = CLIENTS) {
  const known = new Set(configured.map((c) => c.name));
  const failures = [];
  for (const name of discovered) {
    if (!known.has(name)) {
      failures.push(
        `clients/${name} has a test:coverage script this guard does not ` +
          `check — add it to CLIENTS rather than leaving its scope unguarded`,
      );
    }
  }
  for (const name of known) {
    if (!discovered.includes(name)) {
      failures.push(
        `CLIENTS names ${name}, which has no test:coverage script — a stale ` +
          `row silently stops checking anything`,
      );
    }
  }
  return failures;
}

/**
 * @param {string} root
 * @returns {string[]}
 */
function discoverCoverageClients(root) {
  const clientsDir = path.join(root, "clients");
  return readdirSync(clientsDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .filter((name) => {
      const manifest = path.join(clientsDir, name, "package.json");
      if (!existsSync(manifest)) return false;
      const scripts = JSON.parse(readFileSync(manifest, "utf8")).scripts ?? {};
      return typeof scripts["test:coverage"] === "string";
    })
    .sort();
}

/**
 * Resolve a client's coverage options through Vitest's own config resolver,
 * so the patterns checked are the ones the run used.
 *
 * @param {string} clientDir
 * @param {string} configFile
 * @returns {Promise<{include: string[], exclude: string[]}>}
 */
async function resolveCoverageOptions(clientDir, configFile) {
  const { createVitest } = await import("vitest/node");
  const vitest = await createVitest("test", {
    watch: false,
    run: true,
    root: clientDir,
    config: path.join(clientDir, configFile),
  });
  try {
    const { include, exclude } = vitest.config.coverage;
    return { include: include ?? [], exclude: exclude ?? [] };
  } finally {
    await vitest.close();
  }
}

/**
 * @param {string} summaryPath
 * @returns {string[] | null} reported absolute paths, or null when absent
 */
function readReportedFiles(summaryPath) {
  if (!existsSync(summaryPath)) return null;
  const summary = JSON.parse(readFileSync(summaryPath, "utf8"));
  return Object.keys(summary).filter((k) => k !== "total");
}

/**
 * @param {{
 *   root?: string,
 *   clients?: readonly {name: string, config: string}[],
 *   omissions?: Record<string, Record<string, string>>,
 *   resolveOptions?: typeof resolveCoverageOptions,
 *   log?: (line: string) => void,
 * }} [deps]
 * @returns {Promise<string[]>} failures
 */
export async function run({
  root = repoRoot,
  clients = CLIENTS,
  omissions = KNOWN_OMISSIONS,
  resolveOptions = resolveCoverageOptions,
  log = (line) => console.log(line),
} = {}) {
  const failures = checkClientRoster(discoverCoverageClients(root), clients);
  for (const { name, config } of clients) {
    const clientDir = path.join(root, "clients", name);
    const summaryPath = path.join(
      clientDir,
      "coverage",
      "coverage-summary.json",
    );
    const reported = readReportedFiles(summaryPath);
    if (reported === null) {
      failures.push(
        `${name}: no ${slash(path.relative(root, summaryPath))} — run its ` +
          `coverage first (\`npm run coverage\`); this guard reads its output`,
      );
      continue;
    }
    const { include, exclude } = await resolveOptions(clientDir, config);
    const expected = expandCoverageScope({
      include,
      exclude,
      clientDir,
      repoRoot: root,
    });
    const clientFailures = diffCoverageScope({
      client: name,
      expected,
      reported,
      omissions: omissions[name],
      repoRoot: root,
    });
    failures.push(...clientFailures);
    if (clientFailures.length === 0) {
      log(`  ${name}: ${expected.length} declared file(s), all measured`);
    }
  }
  return failures;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  console.log(
    "verify:coverage-scope — coverage reports hold their declared scope",
  );
  const failures = await run();
  if (failures.length > 0) {
    console.error(`\n✗ ${failures.length} coverage-scope failure(s):\n`);
    for (const f of failures) console.error(`  - ${f}\n`);
    process.exit(1);
  }
  console.log("✓ every client's coverage report holds its declared file set");
}
