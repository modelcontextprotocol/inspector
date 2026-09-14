/**
 * Guards the mirror of the "must be bundled" rule: a dependency a client
 * declares **external** must still be external in the built bundle.
 *
 * AGENTS.md has a rule for dependencies that MUST be inlined — the
 * React-rendering ones (#1952) — and nothing at all for the opposite direction,
 * which is how #2067 shipped. `undici` was declared only in the root and
 * `clients/cli` manifests, and tsup auto-externalizes just what the *nearest*
 * manifest declares, so esbuild inlined 1.05 MB of it into the web and TUI
 * bundles. Inlining a CommonJS package into an ESM bundle is not merely wasteful:
 * esbuild rewrites `import("undici")` to a relative chunk whose `require("assert")`
 * hits its `__require` shim and throws `Dynamic require of "assert" is not
 * supported`. Because the specifier was rewritten at build time, no user-side
 * install can ever satisfy it — the package is unloadable by construction, and
 * every proxied connection failed with a message telling users to install a
 * package that was already there.
 *
 * The check is deliberately on the **built output**, not the config: the config
 * is what a reviewer reads, but the emitted chunk is what ships, and the two
 * disagreed for four releases. It is also derived from each client's own
 * `external` list rather than a list maintained here, so a newly externalized
 * package is covered without editing this file.
 *
 * Nothing else catches this class. The unit and integration tests run against
 * source with a real `undici` on the resolution path; the smokes run the built
 * tree but never set a proxy env var, so the lazy `import()` never executes.
 */

import { readdirSync, readFileSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Clients that ship a tsup bundle, with the config to read `external` from and
 * the build directory to inspect. `clients/launcher` is plain `tsc` — it emits
 * no bundle and inlines nothing — so it has nothing to check.
 */
export const BUNDLED_CLIENTS = [
  {
    name: "web",
    config: "clients/web/tsup.runner.config.ts",
    build: "clients/web/build",
  },
  {
    name: "cli",
    config: "clients/cli/tsup.config.ts",
    build: "clients/cli/build",
  },
  {
    name: "tui",
    config: "clients/tui/tsup.config.ts",
    build: "clients/tui/build",
  },
];

/**
 * Extracts the string literals of a tsup config's `external: [...]` array.
 *
 * Reading the config as *text* rather than importing it keeps this guard free of
 * the client's own toolchain (tsup, esbuild, and — for the TUI — a plugin that
 * reads `ink-form` off disk at module load). Only bare string entries are
 * collected; a regex entry such as `/^@inspector\/core/` is a `noExternal`
 * pattern in practice and has no package name to look for.
 */
export function parseExternals(source) {
  const start = source.indexOf("external: [");
  if (start === -1) return [];
  let depth = 0;
  let end = -1;
  for (let i = source.indexOf("[", start); i < source.length; i++) {
    if (source[i] === "[") depth++;
    else if (source[i] === "]") {
      depth--;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }
  if (end === -1) return [];
  const body = source.slice(start, end);
  // Strip comments first: the entries are documented at length, and a package
  // name quoted inside prose would otherwise read as an entry.
  const withoutComments = body
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/[^\n]*/g, "");
  return [...withoutComments.matchAll(/"([^"]+)"|'([^']+)'/g)]
    .map((m) => m[1] ?? m[2])
    .filter((name) => name !== "external: [");
}

/**
 * Every module esbuild inlines is emitted under a `// <path>` banner naming its
 * source file, so a package that was bundled despite being declared external
 * leaves `// ../../node_modules/<pkg>/…` lines behind. Matching on those covers
 * **both** shapes this can take: a separate `<pkg>-HASH.js` chunk (what a
 * dynamically `import()`ed CommonJS package produces, which is what #2067 was)
 * and a statically-imported package folded straight into `index.js`, which
 * emits no chunk at all and would otherwise pass unnoticed.
 *
 * Reading banners means the guard depends on unminified output. That is true of
 * every client bundle today and is asserted rather than assumed: a build with no
 * banners at all fails as `noBanners` instead of silently reporting a clean
 * result, so turning on `minify` surfaces here rather than quietly retiring the
 * check.
 */
export function findInlinedExternals({ externals, files }) {
  const banners = files.flatMap((file) =>
    [...file.source.matchAll(/^\/\/ (\S+)$/gm)].map((m) => ({
      file: file.name,
      path: m[1],
    })),
  );
  if (banners.length === 0) {
    return { noBanners: true, violations: [] };
  }

  const violations = [];
  for (const pkg of externals) {
    // The trailing slash is load-bearing: without it `undici` matches
    // `undici-types`, a @types transitive that is legitimately present.
    const needle = `node_modules/${pkg}/`;
    const hit = banners.find((b) => b.path.includes(needle));
    if (hit) {
      violations.push({
        pkg,
        reason: `inlined into ${hit.file} (e.g. ${hit.path})`,
      });
    }
  }
  return { noBanners: false, violations };
}

/**
 * The per-client verdict, as pure data so every branch is unit-testable.
 *
 * The candidate set is the **union of two independently-derived lists**, and the
 * second is what makes this guard cover #2067 rather than merely its regression:
 *
 * - `externals` — what the client's tsup config declares. Catches a package that
 *   was meant to stay out and got pulled in anyway.
 * - `rootDependencies` — the root manifest's runtime dependencies. These are
 *   root-declared *by rule* (see AGENTS.md), reached through `core/`, and must be
 *   external in every client bundle. Deriving them independently is essential,
 *   because #2067 was a **missing** declaration: `undici` was absent from the web
 *   and TUI `external` lists, so a check driven only by those lists would have
 *   looked at the inlined 1.05MB bundle and reported success. Removing a package
 *   from an `external` list must not be able to remove it from scrutiny.
 *
 * It also **fails closed on an empty `external` list**. `parseExternals` keys off
 * the literal text `external: [`, so an ordinary tsup refactor — hoisting the
 * array to a constant, or a line break after the colon — would make it return
 * nothing. Every enrolled bundle has externals today, so "none parsed" means the
 * parser lost track of the config, not that the invariant holds.
 */
export function evaluateClient({
  name,
  build,
  externals,
  rootDependencies = [],
  files,
}) {
  if (externals.length === 0) {
    return [
      `${name}: no \`external\` entries could be parsed from its tsup config. ` +
        `Every bundled client has some, so this means the config no longer matches ` +
        `what parseExternals() reads (it keys off the literal text "external: ["). ` +
        `Update the parser rather than leaving the guard checking nothing.`,
    ];
  }

  const candidates = [...new Set([...externals, ...rootDependencies])];
  const { noBanners, violations } = findInlinedExternals({
    externals: candidates,
    files,
  });
  if (noBanners) {
    return [
      `${name}: ${build} has no esbuild module banners, so this guard cannot see ` +
        `what was inlined. Has minification been enabled for this bundle?`,
    ];
  }

  // Word the failure for where the candidate came from. A root dependency that
  // is missing from the `external` list — #2067's own shape — is not "declared
  // external", and saying so would send the reader looking for a declaration
  // that is precisely what is absent.
  const declared = new Set(externals);
  return violations.map((v) =>
    declared.has(v.pkg)
      ? `${name}: "${v.pkg}" is declared external but was inlined (${v.reason}).`
      : `${name}: "${v.pkg}" is a root runtime dependency, so it must stay ` +
        `external, but it was inlined (${v.reason}). Add it to this client's ` +
        `tsup \`external\` list.`,
  );
}

function main() {
  const failures = [];
  const rootDependencies = Object.keys(
    JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8"))
      .dependencies ?? {},
  );
  for (const client of BUNDLED_CLIENTS) {
    const buildDir = join(repoRoot, client.build);
    const entry = join(buildDir, "index.js");
    if (!existsSync(entry)) {
      failures.push(
        `${client.name}: ${client.build}/index.js is missing — run \`npm run build\` first.`,
      );
      continue;
    }
    const externals = parseExternals(
      readFileSync(join(repoRoot, client.config), "utf8"),
    );
    const files = readdirSync(buildDir)
      .filter((f) => f.endsWith(".js"))
      .map((name) => ({
        name,
        source: readFileSync(join(buildDir, name), "utf8"),
      }));
    failures.push(
      ...evaluateClient({
        name: client.name,
        build: client.build,
        externals,
        rootDependencies,
        files,
      }),
    );
  }

  if (failures.length > 0) {
    console.error("verify:bundle-externals FAILED\n");
    for (const f of failures) console.error(`  - ${f}`);
    // Only for a real inlining — the other two failure modes (nothing parsed,
    // no banners) are about the guard losing sight of the bundle, and "add the
    // package to `external`" would be the wrong instruction for either.
    if (failures.some((f) => f.includes("was inlined"))) {
      console.error(
        "\nAn externalized package must resolve from the consumer's install. If it was\n" +
          "inlined, esbuild rewrote its specifier to a relative chunk that no user-side\n" +
          "install can satisfy — and a CommonJS package inlined into an ESM bundle throws\n" +
          '`Dynamic require of "..." is not supported` on first use (#2067).\n' +
          "Add the package to that client's tsup `external` list.",
      );
    }
    process.exit(1);
  }

  console.log(
    `verify:bundle-externals OK — ${BUNDLED_CLIENTS.length} bundles, no externalized package inlined.`,
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
