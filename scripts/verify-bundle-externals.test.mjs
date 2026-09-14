/**
 * Table-driven tests for the pure parsers of `verify-bundle-externals.mjs`.
 *
 * One case per rule the guard encodes. The guard itself reads real build output,
 * which no unit test can produce cheaply — so what is pinned here is the
 * *decision* logic: which entries count as externals, and which emitted shapes
 * count as "inlined anyway".
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

import {
  BUNDLED_CLIENTS,
  evaluateClient,
  parseExternals,
  findInlinedExternals,
} from "./verify-bundle-externals.mjs";

describe("parseExternals", () => {
  test("collects bare string entries", () => {
    assert.deepEqual(
      parseExternals(`export default { external: ["undici", "pino"] }`),
      ["undici", "pino"],
    );
  });

  test("ignores package names that appear only inside comments", () => {
    // The real configs document each entry at length, and #2067's entry names
    // `undici` in its own prose — a comment-blind scan would double-count it and,
    // worse, invent entries for packages merely discussed.
    const src = `export default { external: [
      // "ghost" is explained here but is NOT an entry.
      /* neither is "phantom" */
      "undici",
    ] }`;
    assert.deepEqual(parseExternals(src), ["undici"]);
  });

  test("handles single quotes and nested arrays", () => {
    assert.deepEqual(
      parseExternals(
        `export default { external: ['a', 'b'], noExternal: ["c"] }`,
      ),
      ["a", "b"],
    );
  });

  test("returns an empty list when there is no external array", () => {
    assert.deepEqual(parseExternals(`export default { entry: ["x.ts"] }`), []);
  });
});

describe("findInlinedExternals", () => {
  const banner = (p) => `// ${p}\nvar x = 1;\n`;

  test("flags a package inlined as its own chunk", () => {
    // The exact shape #2067 shipped: a dynamically import()ed CommonJS package
    // emitted as `undici-HXPKCIY3.js` beside index.js.
    const { violations } = findInlinedExternals({
      externals: ["undici"],
      files: [
        {
          name: "index.js",
          source: banner("../../core/mcp/node/transport.ts"),
        },
        {
          name: "undici-HXPKCIY3.js",
          source: banner("../../node_modules/undici/lib/core/symbols.js"),
        },
      ],
    });
    assert.equal(violations.length, 1);
    assert.equal(violations[0].pkg, "undici");
    assert.match(violations[0].reason, /undici-HXPKCIY3\.js/);
  });

  test("flags a package inlined straight into the entry, with no chunk", () => {
    // A *statically* imported package is folded into index.js and emits no
    // chunk at all, so a chunk-name check would miss it entirely. The banner is
    // what gives it away.
    const { violations } = findInlinedExternals({
      externals: ["pino"],
      files: [
        {
          name: "index.js",
          source:
            banner("../../core/mcp/index.ts") +
            banner("../../node_modules/pino/pino.js"),
        },
      ],
    });
    assert.equal(violations.length, 1);
    assert.equal(violations[0].pkg, "pino");
    assert.match(violations[0].reason, /index\.js/);
  });

  test("passes a genuinely external package", () => {
    const { noBanners, violations } = findInlinedExternals({
      externals: ["undici", "pino"],
      files: [
        {
          name: "index.js",
          source:
            banner("../../core/mcp/node/proxyFetch.ts") +
            'await import("undici");\nimport "pino";\n',
        },
      ],
    });
    assert.equal(noBanners, false);
    assert.deepEqual(violations, []);
  });

  test("does not mistake a same-prefix package for the external", () => {
    // `undici-types` is a @types transitive and is legitimately inlined; the
    // trailing slash in the needle is what keeps it from reading as `undici`.
    const { violations } = findInlinedExternals({
      externals: ["undici"],
      files: [
        {
          name: "index.js",
          source: banner("../../node_modules/undici-types/index.js"),
        },
      ],
    });
    assert.deepEqual(violations, []);
  });

  test("matches a scoped package on its full name", () => {
    const { violations } = findInlinedExternals({
      externals: ["@napi-rs/keyring"],
      files: [
        {
          name: "index.js",
          source: banner("../../node_modules/@napi-rs/keyring/index.js"),
        },
      ],
    });
    assert.equal(violations.length, 1);
    assert.equal(violations[0].pkg, "@napi-rs/keyring");
  });

  test("reports noBanners rather than a clean pass when banners are absent", () => {
    // The guard reads esbuild's `// <path>` module banners, so minified output
    // would make every bundle look clean. That must fail loudly instead —
    // otherwise enabling `minify` silently retires the check.
    const { noBanners, violations } = findInlinedExternals({
      externals: ["undici"],
      files: [{ name: "index.js", source: "var a=1;var b=2;" }],
    });
    assert.equal(noBanners, true);
    assert.deepEqual(violations, []);
  });
});

describe("evaluateClient", () => {
  const banner = (p) => `// ${p}\nvar x = 1;\n`;
  const clean = [
    { name: "index.js", source: banner("../../core/mcp/index.ts") },
  ];

  test("fails closed when no externals could be parsed", () => {
    // A tsup refactor — `external: EXTERNALS`, or a line break after the colon —
    // makes parseExternals return nothing. Checking zero packages and reporting
    // success would silently disable the guard on a change that looks harmless.
    const failures = evaluateClient({
      name: "web",
      build: "clients/web/build",
      externals: [],
      files: clean,
    });
    assert.equal(failures.length, 1);
    assert.match(failures[0], /no `external` entries could be parsed/);
  });

  test("fails when the bundle carries no module banners", () => {
    const failures = evaluateClient({
      name: "cli",
      build: "clients/cli/build",
      externals: ["undici"],
      files: [{ name: "index.js", source: "var a=1;" }],
    });
    assert.equal(failures.length, 1);
    assert.match(failures[0], /no esbuild module banners/);
  });

  test("reports one failure per inlined package", () => {
    const failures = evaluateClient({
      name: "tui",
      build: "clients/tui/build",
      externals: ["undici", "pino"],
      files: [
        {
          name: "index.js",
          source:
            banner("../../node_modules/undici/index.js") +
            banner("../../node_modules/pino/pino.js"),
        },
      ],
    });
    assert.equal(failures.length, 2);
    assert.match(
      failures[0],
      /tui: "undici" is declared external but was inlined/,
    );
  });

  test("flags a root dependency even when the external list omits it", () => {
    // THE #2067 SHAPE, and the reason the candidate set is not just `externals`.
    // `undici` was missing from the web and TUI external lists — that omission
    // WAS the bug — so a guard driven only by those lists would have inspected
    // the inlined 1.05MB bundle and reported success. Removing a package from an
    // `external` list must not remove it from scrutiny.
    const failures = evaluateClient({
      name: "web",
      build: "clients/web/build",
      externals: ["pino"],
      rootDependencies: ["undici", "pino"],
      files: [
        {
          name: "undici-HXPKCIY3.js",
          source: banner("../../node_modules/undici/lib/core/symbols.js"),
        },
      ],
    });
    assert.equal(failures.length, 1);
    // Worded for where the candidate came from: `undici` is NOT in this
    // client's `external` list here — that absence IS the bug — so a message
    // saying it "is declared external" would send the reader looking for a
    // declaration that is precisely what is missing.
    assert.match(
      failures[0],
      /"undici" is a root runtime dependency, so it must stay external, but it was inlined/,
    );
    assert.doesNotMatch(failures[0], /is declared external but was inlined/);
  });

  test("uses the declared-external wording when the package IS in the list", () => {
    const failures = evaluateClient({
      name: "web",
      build: "clients/web/build",
      externals: ["undici"],
      rootDependencies: ["undici"],
      files: [
        {
          name: "index.js",
          source: banner("../../node_modules/undici/index.js"),
        },
      ],
    });
    assert.equal(failures.length, 1);
    assert.match(failures[0], /"undici" is declared external but was inlined/);
  });

  test("does not flag a deliberately inlined package that is not a root dependency", () => {
    // The TUI inlines `ink-form` / `ink-scroll-view` on purpose (#1952). They are
    // declared in the TUI's own manifest, never at the root, which is exactly
    // what keeps them out of the candidate set.
    assert.deepEqual(
      evaluateClient({
        name: "tui",
        build: "clients/tui/build",
        externals: ["react", "ink"],
        rootDependencies: ["react"],
        files: [
          {
            name: "index.js",
            source: banner("../../node_modules/ink-form/lib/Form.js"),
          },
        ],
      }),
      [],
    );
  });

  test("passes a clean bundle", () => {
    assert.deepEqual(
      evaluateClient({
        name: "web",
        build: "clients/web/build",
        externals: ["undici"],
        rootDependencies: ["undici"],
        files: clean,
      }),
      [],
    );
  });
});

describe("BUNDLED_CLIENTS", () => {
  test("is enrolled from what is actually on disk, not from itself", () => {
    // Asserting the hard-coded list equals a hard-coded copy of itself proves
    // nothing — adding `clients/foo` with a tsup build would leave it green
    // while the new bundle went unchecked. So the expected set is DISCOVERED:
    // a client is tsup-bundled iff it ships a tsup config. `clients/launcher`
    // is plain tsc, emits no bundle, and is correctly absent.
    const clientsDir = path.join(repoRoot, "clients");
    const discovered = readdirSync(clientsDir)
      .filter((name) =>
        readdirSync(path.join(clientsDir, name)).some((f) =>
          /^tsup(\..+)?\.config\.ts$/.test(f),
        ),
      )
      .sort();

    assert.ok(discovered.length > 0, "no tsup-bundled clients discovered");
    assert.deepEqual(
      BUNDLED_CLIENTS.map((c) => c.name).sort(),
      discovered,
      "BUNDLED_CLIENTS is out of sync with the clients that ship a tsup config",
    );
  });

  test("points each client at a config and build dir that exist", () => {
    for (const client of BUNDLED_CLIENTS) {
      assert.ok(
        existsSync(path.join(repoRoot, client.config)),
        `${client.name}: missing ${client.config}`,
      );
      // The build dir is produced by `npm run build`; only assert the path is
      // under the client, since the guard itself reports a missing build.
      assert.match(client.build, new RegExp(`^clients/${client.name}/`));
    }
  });
});
