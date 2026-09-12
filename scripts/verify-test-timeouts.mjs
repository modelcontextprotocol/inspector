/**
 * Guards the wall-clock budgets every Vitest project in this repo runs under
 * (#2323), and the two decisions that came with them.
 *
 * The class it encodes against: a budget nobody chose. Three of the six
 * projects ran on Vitest's own `testTimeout: 5000` and five on its
 * `hookTimeout` / `teardownTimeout: 10000` — values sized for an idle machine,
 * not for the one this team works on (three or four concurrent agent sessions
 * in separate worktrees, each free to run the full `npm run local:gate`, on
 * eight logical cores). A correct, deterministic test cut off mid-flight by
 * such a budget fails a gate its diff did not break, which trains people to
 * re-run rather than read — the same argument AGENTS.md's "Lint has no warning
 * tier" makes from the other direction. #2292, #1942 and #1742 were each that
 * class — a budget or poll ceiling nobody chose — found and fixed one site at a
 * time. ⚠️ Not every timing failure in this repo's history belongs here: #2278
 * was a missing condition wait around a geometry read and #2250 a genuine race
 * in a test's own timing, both fixed by making the test wait for the right
 * thing. Citing those as evidence for a larger ceiling would argue against
 * #1596, which this guard is meant to uphold rather than erode (Copilot).
 *
 * Three properties, which is what makes this worth a guard rather than a
 * comment:
 *
 * 1. **Resolved, not declared.** It asks Vitest to resolve each project and
 *    reads the number a test actually gets. Asserting that a key is absent from
 *    some config block would pass just as happily on a config that had stopped
 *    being loaded at all.
 * 2. **Unknown projects fail loudly.** A seventh project added without a row
 *    here is exactly the drift this exists to prevent, so it is an error rather
 *    than something the table silently skips.
 * 3. **`retry` must stay unset.** A retry converts a load-induced red into a
 *    silent green on the only pre-push gate this repo has, and would re-open
 *    #1596 by hiding a real race behind a second attempt. That was a deliberate
 *    "do not raise" decision, so it is enforced rather than remembered — and
 *    enforced in all three places Vitest accepts one, since the decision is
 *    about the behavior rather than about a config key: the resolved project,
 *    an individual `it`/`describe` options object, and a `--retry` flag in an
 *    npm script (Copilot). What stays outside its reach is a human typing
 *    `--retry` into their own shell, which no committed check can see.
 *
 * It also asserts the Testing Library half, which no Vitest config can see:
 * `asyncUtilTimeout` governs every `waitFor` / `findBy*` in the web projects
 * and is the binding constraint on an async assertion, since it is tighter than
 * any per-test budget here. What is enforced is that each web project *states*
 * it — raising it was measured and rejected, for the reason recorded in
 * `clients/web/src/test/setup.ts`.
 *
 * ⚠️ Observed to FAIL against the unfixed config before it was trusted: on
 * `origin/v2/main` it reports `unit`, `tui` and `launcher` at
 * `testTimeout: 5000`, five of the six projects at `hookTimeout: 10000`, and
 * both `asyncUtilTimeout` assertions unmet.
 */

import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * The budgets, restated here rather than imported from `vitest.shared.mts`.
 *
 * That duplication is the point: importing the same object the configs spread
 * in would make this guard agree with any value at all, including a default
 * someone reinstated by deleting the spread. A guard has to state the
 * expectation independently or it is only asserting that a file parses.
 */
export const EXPECTED_TIMEOUTS = Object.freeze({
  testTimeout: 15_000,
  hookTimeout: 30_000,
  teardownTimeout: 30_000,
});

/** Web's `integration` project pays for real servers, sockets and OAuth flows. */
export const EXPECTED_INTEGRATION_TIMEOUTS = Object.freeze({
  ...EXPECTED_TIMEOUTS,
  testTimeout: 30_000,
});

/**
 * Every Vitest project in the repo, keyed by the resolved project name. Vitest
 * appends the browser instance to a browser project's name, so `storybook`
 * resolves as `storybook (chromium)`; match on the leading segment.
 */
export const EXPECTED_PROJECTS = Object.freeze({
  unit: EXPECTED_TIMEOUTS,
  integration: EXPECTED_INTEGRATION_TIMEOUTS,
  storybook: EXPECTED_TIMEOUTS,
  cli: EXPECTED_TIMEOUTS,
  tui: EXPECTED_TIMEOUTS,
  launcher: EXPECTED_TIMEOUTS,
});

/**
 * The four Vitest configs to resolve, and the project names each must yield.
 *
 * The node clients name no project, so their single project resolves with an
 * empty name — `projects` supplies the name this guard checks it under. Web's
 * three name themselves, so its entry lists them and the resolver matches by
 * name instead of by position.
 */
export const CONFIG_ROOTS = Object.freeze([
  { root: "clients/web", projects: ["unit", "integration", "storybook"] },
  { root: "clients/cli", projects: ["cli"] },
  { root: "clients/tui", projects: ["tui"] },
  { root: "clients/launcher", projects: ["launcher"] },
]);

/**
 * Files that must configure Testing Library's `asyncUtilTimeout`, with the
 * import each has to configure it through. Storybook instruments its own copy
 * of Testing Library so its interactions panel can trace each step, so
 * configuring `@testing-library/*` there would configure a copy no play
 * function calls.
 */
export const ASYNC_UTIL_SITES = Object.freeze([
  {
    file: "clients/web/src/test/setup.ts",
    from: "@testing-library/react",
    project: "unit",
  },
  {
    file: "clients/web/src/test/storybookSetup.ts",
    from: "storybook/test",
    project: "storybook",
  },
]);

/**
 * The value those sites must configure — stated here for the same reason the
 * Vitest budgets are: a guard that accepts any number at all would pass on
 * `asyncUtilTimeout: 1` (Copilot).
 *
 * It is Testing Library's own default, and deliberately so: what this guard
 * enforces is that the value is *stated*, not that it is large. Raising it was
 * measured and rejected — see the long comment in
 * `clients/web/src/test/setup.ts`.
 */
export const EXPECTED_ASYNC_UTIL_TIMEOUT = 1_000;

/**
 * Directory every Vitest config in this repo lives one level under. Discovery
 * (below) walks it rather than trusting a hand-written list.
 */
export const CLIENTS_DIR = "clients";

/**
 * Every filename Vitest will load a config from, most specific first.
 *
 * The full set, not the two spellings this repo happens to use: discovery is
 * only deny-by-default if it sees every config Vitest would (Copilot). A
 * `clients/foo/vitest.config.mts` that this list did not name would be
 * invisible, and an invisible config yields no project to reject — the same
 * hole as a hand-written `CONFIG_ROOTS`, one level down. Order matters at
 * resolution time, where the first match wins, and mirrors Vitest's own
 * preference for a `vitest.config.*` over a `vite.config.*`.
 */
export const VITEST_CONFIG_FILENAMES = Object.freeze([
  ...["ts", "mts", "cts", "js", "mjs", "cjs"].map((e) => `vitest.config.${e}`),
  ...["ts", "mts", "cts", "js", "mjs", "cjs"].map((e) => `vite.config.${e}`),
]);

/**
 * Compare one resolved project against its row.
 *
 * @param {string} name project name as this guard knows it
 * @param {{testTimeout?: unknown, hookTimeout?: unknown, teardownTimeout?: unknown, retry?: unknown}} config
 * @param {Record<string, Readonly<Record<string, number>>>} [expected]
 * @returns {string[]} one message per violation; empty when the project is fine
 */
export function checkProject(name, config, expected = EXPECTED_PROJECTS) {
  const row = expected[name];
  if (!row) {
    return [
      `project "${name}" has no row in EXPECTED_PROJECTS — a project whose budgets ` +
        `nobody stated is exactly the drift this guard exists to prevent. Add it.`,
    ];
  }
  const failures = [];
  for (const [key, want] of Object.entries(row)) {
    const got = config[key];
    if (got !== want) {
      failures.push(
        `project "${name}" resolves ${key} to ${String(got)}, expected ${want}`,
      );
    }
  }
  // Vitest leaves `retry` undefined when nothing sets it; 0 is the same
  // decision written out.
  const retry = config.retry;
  if (retry !== undefined && retry !== 0) {
    failures.push(
      `project "${name}" sets retry to ${String(retry)} — a retry turns a ` +
        `load-induced red into a silent green on the only pre-push gate here (#1596)`,
    );
  }
  return failures;
}

/**
 * Strip comments so a disabled call cannot satisfy a check.
 *
 * Comment-aware rather than exact, deliberately: a naive scan of the raw source
 * would accept a `// configure({ asyncUtilTimeout: 1000 })` left behind by
 * someone disabling it, which is the most likely way this stops being
 * configured (Copilot).
 *
 * A scanner rather than a regex, for two reasons that a regex gets wrong in
 * opposite directions. It must strip a comment that **follows code** on a line
 * — `const disabled = true; // configure({ … })` — which an anchored
 * line-comment pattern misses entirely (Copilot); and it must NOT treat the
 * `//` inside a string literal as the start of one, which an unanchored pattern
 * would, silently truncating any line holding a URL. Tracking quotes is the
 * only way to have both.
 *
 * @param {string} source
 * @returns {string}
 */
export function stripComments(source) {
  let out = "";
  let quote = null;
  for (let i = 0; i < source.length; i += 1) {
    const c = source[i];
    const next = source[i + 1];
    if (quote) {
      // A backslash escapes the next character, so a `\"` cannot close a `"`.
      if (c === "\\") {
        out += c + (next ?? "");
        i += 1;
        continue;
      }
      if (c === quote) quote = null;
      out += c;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      quote = c;
      out += c;
      continue;
    }
    if (c === "/" && next === "/") {
      while (i < source.length && source[i] !== "\n") i += 1;
      // Keep the newline, so line structure (and any anchored match a caller
      // makes) survives the strip.
      out += "\n";
      continue;
    }
    if (c === "/" && next === "*") {
      i += 2;
      while (
        i < source.length &&
        !(source[i] === "*" && source[i + 1] === "/")
      ) {
        i += 1;
      }
      i += 1;
      continue;
    }
    out += c;
  }
  return out;
}

/**
 * Does this source configure `asyncUtilTimeout` at the expected value, through
 * the right import?
 *
 * Deliberately a source check and not a runtime one: the value only exists
 * inside a running test environment, and a `configure` call reached by no
 * project would satisfy a runtime probe of this module just as well. What
 * closes that second gap is `checkSetupFilesWiring` below, which asks the
 * resolved project whether it actually loads the file.
 *
 * @param {string} source
 * @param {string} from module the `configure` must come from
 * @param {number} [expected] the value it must configure
 * @returns {string[]}
 */
export function checkAsyncUtilSource(
  source,
  from,
  expected = EXPECTED_ASYNC_UTIL_TIMEOUT,
) {
  const code = stripComments(source);
  const failures = [];

  // Bind-then-check, not two independent regexes. Checking "imports from X" and
  // "calls configure()" separately passes on a split import — `cleanup` from
  // `@testing-library/react` and `configure` from `@testing-library/dom` — which
  // is a configuration applied to a copy no test calls, and green by inspection
  // (Copilot). So find the name `configure` is bound to *in the import from the
  // required module*, and require the call to use that name.
  const importRe = new RegExp(
    `import\\s*\\{([^}]*)\\}\\s*from\\s*["']${from.replace(/[.*+?^$()|[\]\\]/g, "\\$&").replace(/\//g, "\\/")}["']`,
  );
  const imported = importRe.exec(code);
  if (!imported) {
    failures.push(`does not import from "${from}"`);
    return failures;
  }

  // `configure`, or `configure as somethingElse`.
  const binding = imported[1]
    .split(",")
    .map((spec) => spec.trim())
    .map((spec) => /^configure(?:\s+as\s+([A-Za-z_$][\w$]*))?$/.exec(spec))
    .find(Boolean);
  if (!binding) {
    failures.push(`does not import configure from "${from}"`);
    return failures;
  }
  const name = binding[1] ?? "configure";

  // EVERY call, not the first. A setup file holding the expected call followed
  // by a second one is the shape that matters: the later call wins at runtime,
  // so inspecting only the first would approve a file whose effective timeout
  // is something else entirely (Copilot). Requiring all of them to agree is
  // stricter than checking the last and gives a clearer message than "the
  // effective value is X" would.
  // ⚠️ `(?<![.\\w$])` and not `\\b`: a word boundary succeeds straight after a
  // dot, so `other.configure({ … })` matched the imported name and satisfied the
  // check while the imported binding was never called at all (Copilot). Excluded
  // are a member access and any identifier this name is merely the tail of.
  const calls = [];
  const nameRe = new RegExp(`(?<![.\\w$])${name}\\s*\\(`, "g");
  let m;
  while ((m = nameRe.exec(code)) !== null) {
    const open = m.index + m[0].length - 1;
    const close = matchBracket(code, open);
    if (close === -1) break;
    calls.push(code.slice(open + 1, close));
    nameRe.lastIndex = close;
  }
  if (calls.length === 0) {
    failures.push(`does not call ${name}()`);
    return failures;
  }

  const configured = calls
    .map((args) => /asyncUtilTimeout\s*:\s*(\d[\d_]*)/.exec(args))
    .filter(Boolean)
    .map((match) => match[1]);
  if (configured.length === 0) {
    failures.push(`calls ${name}() without an asyncUtilTimeout`);
    return failures;
  }
  for (const value of configured) {
    if (Number(value.replace(/_/g, "")) !== expected) {
      failures.push(
        `configures asyncUtilTimeout as ${value}, expected ${expected}`,
      );
    }
  }
  return failures;
}

/**
 * Is each declared site actually loaded by the project it claims to configure?
 *
 * Without this the guard reads two files and reports both projects configured
 * while `setupFiles` had been deleted from `vite.config.ts` and Testing Library
 * had silently gone back to its 1000ms default (Copilot). Vitest resolves
 * `setupFiles` to absolute paths, so compare by suffix against the declared
 * repo-relative path.
 *
 * @param {string} name project name as this guard knows it
 * @param {unknown} setupFiles the project's resolved `setupFiles`
 * @param {readonly {file: string, project: string}[]} [sites]
 * @returns {string[]}
 */
export function checkSetupFilesWiring(
  name,
  setupFiles,
  sites = ASYNC_UTIL_SITES,
) {
  const site = sites.find((s) => s.project === name);
  if (!site) return [];
  const loaded = Array.isArray(setupFiles) ? setupFiles : [];
  const wanted = site.file.split("/").join("/");
  const found = loaded.some(
    (f) => typeof f === "string" && f.split("\\").join("/").endsWith(wanted),
  );
  return found
    ? []
    : [
        `project "${name}" does not load ${site.file} as a setupFile, so its ` +
          `asyncUtilTimeout never takes effect`,
      ];
}

/**
 * Skip whitespace from `i`.
 *
 * @param {string} code
 * @param {number} i
 * @returns {number}
 */
function skipWs(code, i) {
  while (i < code.length && /\s/.test(code[i])) i += 1;
  return i;
}

/**
 * Index just past the string or template literal starting at `i`.
 *
 * @param {string} code
 * @param {number} i index of the opening quote
 * @returns {number} index after the closing quote, or `code.length` if unclosed
 */
function skipString(code, i) {
  const quote = code[i];
  let j = i + 1;
  while (j < code.length) {
    if (code[j] === "\\") {
      j += 2;
      continue;
    }
    if (code[j] === quote) return j + 1;
    j += 1;
  }
  return code.length;
}

/**
 * Index of the bracket closing the one at `i`, honoring nesting and skipping
 * string literals so a bracket inside a string cannot unbalance the count.
 *
 * This is what a regex cannot do, and the reason this scan is structural: a
 * character class like `[^()]*` cannot consume `it.each([makeCase()])` or
 * `it.skipIf(() => isWindows())`, so every such suite was a blind spot
 * (Copilot).
 *
 * @param {string} code
 * @param {number} i index of the opening bracket
 * @returns {number} index of the matching close, or -1
 */
function matchBracket(code, i) {
  const open = code[i];
  const close = open === "(" ? ")" : "}";
  let depth = 0;
  let j = i;
  while (j < code.length) {
    const c = code[j];
    if (c === '"' || c === "'" || c === "`") {
      j = skipString(code, j);
      continue;
    }
    if (c === open) depth += 1;
    else if (c === close) {
      depth -= 1;
      if (depth === 0) return j;
    }
    j += 1;
  }
  return -1;
}

/** Test-definition heads a `retry` option can be attached to. */
const TEST_HEAD = /\b(?:it|test|describe|suite|bench)(?:\.\w+)*/g;

/**
 * A `retry` declared on an individual test or suite, or passed on a command
 * line — the two places a project-level check cannot see.
 *
 * The "no retry" decision is about the behavior, not about one config key, so a
 * guard that only reads `project.config.retry` leaves `it("…", { retry: 2 })`
 * and `--retry=2` in an npm script wide open (Copilot). Both are scanned here.
 *
 * Structural rather than a single regex, for two reasons learned one round
 * apart. The `retry` must sit in an **options object that follows the test
 * name**, which is the only position Vitest reads it from — that is what keeps
 * a `retry` field in fixture data, a variable named `retry`, or a mocked API's
 * option out of it, and this repo has several. And the chain may carry an
 * argument of its own — `it.each([makeCase()])`, `it.skipIf(() => isWin())`,
 * `it.each\`table\`` — which a character-class regex cannot step over once it
 * contains nested parentheses, silently skipping every such suite.
 *
 * @param {string} source
 * @returns {string[]} the matched declarations, empty when there are none
 */
export function findTestLevelRetries(source) {
  const code = stripComments(source);
  const found = [];
  TEST_HEAD.lastIndex = 0;
  let head;
  while ((head = TEST_HEAD.exec(code)) !== null) {
    const decl = readRetryOption(code, head.index + head[0].length);
    if (decl) found.push(decl);
  }
  return found;
}

/**
 * Read a `retry` out of the options object of the test call starting at `i`.
 *
 * @param {string} code comment-stripped source
 * @param {number} i index just past the `it`/`describe`/… chain
 * @returns {string | null}
 */
function readRetryOption(code, i) {
  let j = skipWs(code, i);

  // `it.each\`table\`` puts a tagged template between the chain and the call.
  if (code[j] === "`") j = skipWs(code, skipString(code, j));
  if (code[j] !== "(") return null;

  // The first `(` is either the call itself or the chain's own argument
  // (`it.each([...])`, `it.skipIf(…)`). It is the call when a string literal —
  // the test name — comes first; otherwise step over it, balanced, and the real
  // call is the next `(`.
  let open = j;
  let name = skipWs(code, open + 1);
  if (!/["'`]/.test(code[name] ?? "")) {
    const close = matchBracket(code, open);
    if (close === -1) return null;
    open = skipWs(code, close + 1);
    if (code[open] !== "(") return null;
    name = skipWs(code, open + 1);
    if (!/["'`]/.test(code[name] ?? "")) return null;
  }

  let k = skipWs(code, skipString(code, name));
  if (code[k] !== ",") return null;
  k = skipWs(code, k + 1);
  if (code[k] !== "{") return null;

  const end = matchBracket(code, k);
  if (end === -1) return null;
  const options = code.slice(k + 1, end);
  // Two forms, because JavaScript has two. `retry: 2` and the shorthand
  // `{ retry }`, which is the same declaration with the value bound above and
  // which a colon-requiring pattern misses entirely (Copilot).
  const explicit = /(?:^|[\s,{])retry\s*:\s*([^,}\s]+)/.exec(options);
  if (explicit) return `retry: ${explicit[1]}`;
  const shorthand = /(?:^|[\s,{])retry\s*(?:,|$)/.test(options);
  return shorthand ? "retry (shorthand)" : null;
}

/**
 * A `retry` flag passed to vitest from an npm script.
 *
 * @param {Record<string, unknown>} scripts
 * @returns {string[]} `"<name>: <script>"` for each offender
 */
export function findScriptRetries(scripts) {
  return Object.entries(scripts ?? {})
    .filter(
      ([, cmd]) => typeof cmd === "string" && /(^|\s)--retry(=|\s|$)/.test(cmd),
    )
    .map(([name, cmd]) => `${name}: ${String(cmd)}`);
}

/**
 * Every Vitest config under `clients/`, as repo-relative directories.
 *
 * Discovery rather than the hand-written `CONFIG_ROOTS` list, so that a new
 * client with its own config cannot go unwatched — which would have made the
 * "a project with no row is an error" promise vacuous, since an undiscovered
 * config yields no project to reject (Copilot). `CONFIG_ROOTS` still exists to
 * say which project names each config must produce; this is what proves the
 * list is complete.
 *
 * @param {string} [root] absolute repo root
 * @returns {string[]}
 */
export function discoverConfigRoots(root = repoRoot) {
  const clients = resolve(root, CLIENTS_DIR);
  if (!existsSync(clients)) return [];
  return readdirSync(clients, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => join(clients, e.name))
    .filter((dir) =>
      VITEST_CONFIG_FILENAMES.some((f) => existsSync(join(dir, f))),
    )
    .map((dir) => relative(root, dir).split("\\").join("/"))
    .sort();
}

/**
 * Compare what is on disk against what this guard is configured to check.
 *
 * @param {string[]} discovered
 * @param {readonly {root: string}[]} [configured]
 * @returns {string[]}
 */
export function checkConfigRootCoverage(discovered, configured = CONFIG_ROOTS) {
  const known = new Set(configured.map((c) => c.root));
  const failures = [];
  for (const root of discovered) {
    if (!known.has(root)) {
      failures.push(
        `${root} has a Vitest config that this guard does not check — add it to ` +
          `CONFIG_ROOTS and EXPECTED_PROJECTS rather than leaving its budgets unstated`,
      );
    }
  }
  for (const root of known) {
    if (!discovered.includes(root)) {
      failures.push(
        `CONFIG_ROOTS names ${root}, which has no Vitest config on disk — a stale ` +
          `row silently stops checking anything`,
      );
    }
  }
  return failures;
}

/**
 * Resolve every project of one config, via Vitest's own resolver.
 *
 * @param {string} root absolute directory holding one of `VITEST_CONFIG_FILENAMES`
 * @returns {Promise<{name: string, config: Record<string, unknown>}[]>}
 */
async function resolveProjects(root) {
  const { createVitest } = await import("vitest/node");
  const config = VITEST_CONFIG_FILENAMES.map((f) => join(root, f)).find((f) =>
    existsSync(f),
  );
  if (!config) {
    throw new Error(`no vitest/vite config under ${root}`);
  }
  const vitest = await createVitest("test", {
    watch: false,
    run: true,
    root,
    config,
  });
  try {
    return vitest.projects.map((p) => ({
      name: p.name,
      config: /** @type {Record<string, unknown>} */ (p.config),
    }));
  } finally {
    await vitest.close();
  }
}

/**
 * Match a resolved project to the name this guard knows it by.
 *
 * A node client's single project resolves nameless, so its config entry
 * supplies the name. Web's three name themselves, but a browser project's name
 * carries its instance (`storybook (chromium)`), so compare the leading
 * segment rather than the whole string.
 *
 * @param {{name: string}} project
 * @param {string[]} expectedNames
 * @returns {string | undefined}
 */
export function identifyProject(project, expectedNames) {
  if (expectedNames.length === 1 && !project.name) return expectedNames[0];
  const base = project.name.replace(/\s*\(.*\)$/, "");
  return expectedNames.find((n) => n === base);
}

async function main() {
  // Seeded from discovery, not empty: the unknown-project check below can only
  // reject a project this guard actually resolves, so a config it never opens
  // is invisible to it. Without this line the deny-by-default claim rested on
  // `test:scripts` happening to run the same comparison — a different command,
  // which a standalone `npm run verify:test-timeouts` does not invoke (Copilot).
  const failures = checkConfigRootCoverage(discoverConfigRoots());
  let checked = 0;

  for (const { root, projects: expectedNames } of CONFIG_ROOTS) {
    const resolved = await resolveProjects(resolve(repoRoot, root));
    const seen = new Set();
    for (const project of resolved) {
      const name = identifyProject(project, expectedNames);
      if (!name) {
        failures.push(
          `${root}: resolved an unexpected project "${project.name}" — add it to ` +
            `CONFIG_ROOTS and EXPECTED_PROJECTS rather than leaving its budgets unstated`,
        );
        continue;
      }
      seen.add(name);
      checked += 1;
      failures.push(
        ...checkProject(name, project.config).map((f) => `${root}: ${f}`),
        ...checkSetupFilesWiring(name, project.config.setupFiles).map(
          (f) => `${root}: ${f}`,
        ),
      );
    }
    for (const name of expectedNames) {
      if (!seen.has(name)) {
        failures.push(`${root}: project "${name}" did not resolve at all`);
      }
    }
  }

  // `retry`, in the two places a resolved project cannot show it. Tracked files
  // only — an untracked scratch test is not something this repo ships.
  const testFiles = execFileSync(
    "git",
    ["ls-files", "*.test.ts", "*.test.tsx", "*.test.mts", "*.stories.tsx"],
    { cwd: repoRoot, encoding: "utf-8" },
  )
    .split("\n")
    .filter(Boolean);
  for (const file of testFiles) {
    const found = findTestLevelRetries(
      readFileSync(resolve(repoRoot, file), "utf-8"),
    );
    for (const decl of found) {
      failures.push(
        `${file} declares \`${decl}\` on a test or suite — a retry turns a ` +
          `load-induced red into a silent green on the only pre-push gate here (#1596)`,
      );
    }
  }

  const manifests = execFileSync(
    "git",
    ["ls-files", "package.json", "*/package.json", "*/*/package.json"],
    { cwd: repoRoot, encoding: "utf-8" },
  )
    .split("\n")
    .filter(Boolean);
  for (const file of manifests) {
    const { scripts } = JSON.parse(
      readFileSync(resolve(repoRoot, file), "utf-8"),
    );
    for (const offender of findScriptRetries(scripts)) {
      failures.push(`${file} passes --retry from a script — ${offender}`);
    }
  }

  for (const { file, from, project } of ASYNC_UTIL_SITES) {
    const abs = resolve(repoRoot, file);
    if (!existsSync(abs)) {
      failures.push(
        `${file} is missing — the "${project}" project has no asyncUtilTimeout`,
      );
      continue;
    }
    failures.push(
      ...checkAsyncUtilSource(readFileSync(abs, "utf-8"), from).map(
        (f) => `${file} (${project} project) ${f}`,
      ),
    );
  }

  if (failures.length > 0) {
    console.error("verify:test-timeouts FAILED\n");
    for (const f of failures) console.error(`  - ${f}`);
    console.error(
      "\nEvery test-gate budget must be a value someone chose, sized for a machine\n" +
        "running three or four concurrent worktree gates (#2323). The shared values live\n" +
        "in `vitest.shared.mts` (TIMEOUTS / INTEGRATION_TIMEOUTS) and every project\n" +
        "spreads one of them; Testing Library's own asyncUtilTimeout is configured in\n" +
        "each web project's setup file. Raising a budget is a decision to state there,\n" +
        "not a per-suite argument to add — and `retry` stays unset.",
    );
    process.exit(1);
  }

  console.log(
    `verify:test-timeouts OK — ${checked} Vitest projects on stated budgets, ` +
      `no retry in any project, test or script (${testFiles.length} test files, ` +
      `${manifests.length} manifests), ` +
      `${ASYNC_UTIL_SITES.length} asyncUtilTimeout sites configured.`,
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
