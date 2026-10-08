// Tests for `npx-default-bin.mjs` (#2651): npm's default-bin rule, and the
// assertion that the root manifest — the one that publishes — resolves
// `npx @modelcontextprotocol/inspector` to the launcher.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { npxDefaultBin } from "./npx-default-bin.mjs";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);
const LAUNCHER = "./clients/launcher/build/index.js";

test("the root manifest's npx default bin is the launcher", () => {
  const manifest = JSON.parse(
    readFileSync(path.join(repoRoot, "package.json"), "utf8"),
  );
  const bin = npxDefaultBin(manifest);
  assert.notEqual(
    bin,
    null,
    "npx @modelcontextprotocol/inspector would fail: no single bin and none named after the package",
  );
  assert.equal(manifest.bin[bin], LAUNCHER);
});

test("a sole bin is run whatever its name", () => {
  assert.equal(
    npxDefaultBin({ name: "@s/pkg", bin: { "mcp-inspector": LAUNCHER } }),
    "mcp-inspector",
  );
});

test("aliases of one file count as a sole bin", () => {
  assert.equal(
    npxDefaultBin({ name: "@s/pkg", bin: { a: LAUNCHER, b: LAUNCHER } }),
    "a",
  );
});

test("several distinct bins resolve to the one named after the unscoped package", () => {
  assert.equal(
    npxDefaultBin({
      name: "@s/inspector",
      bin: { inspector: LAUNCHER, mcpdo: "./mcpdo.js" },
    }),
    "inspector",
  );
});

test("several distinct bins with none named after the package fail (the 2.10.0 shape)", () => {
  assert.equal(
    npxDefaultBin({
      name: "@modelcontextprotocol/inspector",
      bin: { "mcp-inspector": LAUNCHER, mcpdo: "./mcpdo.js" },
    }),
    null,
  );
});

test("a string bin is named after the unscoped package", () => {
  assert.equal(npxDefaultBin({ name: "@s/pkg", bin: LAUNCHER }), "pkg");
});

test("no bin at all fails", () => {
  assert.equal(npxDefaultBin({ name: "pkg" }), null);
});
