// Tests for `bundle-bare-imports.mjs` (#2650): the bare-specifier scan over a
// bundle, and ESM resolution from inside a directory — including the
// import-only `exports` shape a CommonJS `require.resolve` misreports.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  collectBareImports,
  isBareSpecifier,
  unresolvedFrom,
} from "./bundle-bare-imports.mjs";

test("isBareSpecifier excludes relative, absolute, URL and builtin specifiers", () => {
  assert.equal(isBareSpecifier("zod"), true);
  assert.equal(isBareSpecifier("@modelcontextprotocol/client/stdio"), true);
  for (const s of [
    "./chunk.js",
    "../x.js",
    "/abs.js",
    "node:fs",
    "fs",
    "fs/promises",
    "readline/promises",
  ]) {
    assert.equal(isBareSpecifier(s), false, s);
  }
});

test("collectBareImports finds static, multi-line, re-export, side-effect and dynamic imports", () => {
  const source = [
    'import { a } from "zod";',
    "import {",
    "  b,",
    "  c",
    '} from "@modelcontextprotocol/client/stdio";',
    'export * from "yaml";',
    'import "side-effect-pkg";',
    'import { readFileSync } from "fs";',
    'import { x } from "./chunk-ABC.js";',
    'const m = await import("undici");',
    'const n = await import("@napi-rs/keyring");',
  ].join("\n");
  assert.deepEqual(collectBareImports(source), [
    "@modelcontextprotocol/client/stdio",
    "@napi-rs/keyring",
    "side-effect-pkg",
    "undici",
    "yaml",
    "zod",
  ]);
});

test('collectBareImports ignores `from "..."` prose inside a comment', () => {
  const source = [
    "/**",
    ' * digests to check" apart from "a digest was wrong" and "the walk',
    ' * event since I last looked" from "something has", without',
    " */",
    'import { z } from "zod";',
  ].join("\n");
  assert.deepEqual(collectBareImports(source), ["zod"]);
});

test("unresolvedFrom ESM-resolves an import-only package and reports a missing one", () => {
  const root = mkdtempSync(join(tmpdir(), "bare-imports-"));
  try {
    const pkg = join(root, "node_modules", "import-only");
    mkdirSync(pkg, { recursive: true });
    writeFileSync(
      join(pkg, "package.json"),
      JSON.stringify({
        name: "import-only",
        type: "module",
        exports: { "./sub": { import: "./sub.js" } },
      }),
    );
    writeFileSync(join(pkg, "sub.js"), "export {};\n");
    const dir = join(root, "consumer");
    mkdirSync(dir);

    const failed = unresolvedFrom({
      dir,
      specifiers: ["import-only/sub", "not-installed"],
    });
    assert.deepEqual(
      failed.map((f) => f.specifier),
      ["not-installed"],
    );
    // The probe leaves nothing behind in the checked directory.
    assert.deepEqual(readdirSync(dir), []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
