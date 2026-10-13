// Tests for the install-script review guard. The policy matching and the
// lockfile scan are exercised in memory; `main` against a throwaway tree on
// disk, so install discovery, the per-install policy and the exit status are
// covered too. Run via `npm run test:scripts`.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  isReviewed,
  main,
  packageNameOf,
  unreviewedScripts,
} from "./verify-install-scripts.mjs";

const lockOf = (packages) => ({
  lockfileVersion: 3,
  packages: { "": { name: "x", hasInstallScript: true }, ...packages },
});

test("packageNameOf takes the innermost package, scoped names included", () => {
  assert.equal(packageNameOf("node_modules/esbuild"), "esbuild");
  assert.equal(
    packageNameOf("node_modules/vite/node_modules/fsevents"),
    "fsevents",
  );
  assert.equal(packageNameOf("node_modules/a/node_modules/@s/b"), "@s/b");
});

test("a bare name reviews every version, allow or deny", () => {
  assert.equal(isReviewed({ fsevents: false }, "fsevents", "2.3.2"), true);
  assert.equal(isReviewed({ fsevents: true }, "fsevents", "9.0.0"), true);
});

test("a versioned key reviews only the versions its range satisfies", () => {
  const policy = { "esbuild@0.28.2": true, "fsevents@^2.3.0": false };
  assert.equal(isReviewed(policy, "esbuild", "0.28.2"), true);
  assert.equal(isReviewed(policy, "esbuild", "0.28.3"), false);
  assert.equal(isReviewed(policy, "fsevents", "2.3.3"), true);
  assert.equal(isReviewed(policy, "fsevents", "3.0.0"), false);
});

test("a non-boolean value, an invalid range or another package is no review", () => {
  assert.equal(isReviewed({ esbuild: "maybe" }, "esbuild", "1.0.0"), false);
  assert.equal(
    isReviewed({ "esbuild@not a range": true }, "esbuild", "1.0.0"),
    false,
  );
  assert.equal(
    isReviewed({ "esbuild-wasm": false }, "esbuild", "1.0.0"),
    false,
  );
  assert.equal(isReviewed(undefined, "esbuild", "1.0.0"), false);
});

test("unreviewedScripts reports only scripted, undecided dependencies", () => {
  const lock = lockOf({
    "node_modules/esbuild": { version: "0.28.2", hasInstallScript: true },
    "node_modules/fsevents": { version: "2.3.3", hasInstallScript: true },
    "node_modules/vite/node_modules/fsevents": {
      version: "2.3.2",
      hasInstallScript: true,
    },
    "node_modules/plain": { version: "1.0.0" },
  });
  // The `""` project entry carries the root postinstall and is never reported.
  assert.deepEqual(unreviewedScripts(lock, { fsevents: false }), [
    { entryPath: "node_modules/esbuild", name: "esbuild", version: "0.28.2" },
  ]);
  assert.deepEqual(
    unreviewedScripts(lock, { esbuild: false, fsevents: false }),
    [],
  );
});

function tree(installs) {
  const root = mkdtempSync(path.join(tmpdir(), "install-scripts-"));
  for (const [rel, { manifest, lock }] of Object.entries(installs)) {
    const dir = path.join(root, rel);
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, "package.json"), JSON.stringify(manifest));
    if (lock)
      writeFileSync(path.join(dir, "package-lock.json"), JSON.stringify(lock));
  }
  return root;
}

const silenced = (fn) => {
  const { log, error } = console;
  console.log = () => {};
  console.error = () => {};
  try {
    return fn();
  } finally {
    Object.assign(console, { log, error });
  }
};

const scripted = lockOf({
  "node_modules/esbuild": { version: "0.28.2", hasInstallScript: true },
});

test("main passes when every install decides its own scripts", () => {
  const root = tree({
    ".": { manifest: { allowScripts: { esbuild: false } }, lock: scripted },
    "clients/a": {
      manifest: { allowScripts: { esbuild: false } },
      lock: scripted,
    },
    // No lockfile: dep-lockstep's finding, skipped here.
    "clients/b": { manifest: {} },
  });
  try {
    assert.equal(
      silenced(() => main(root)),
      0,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("main fails when a client relies on another install's policy", () => {
  const root = tree({
    ".": { manifest: { allowScripts: { esbuild: false } }, lock: scripted },
    "clients/a": { manifest: {}, lock: scripted },
  });
  const errors = [];
  const { error } = console;
  console.error = (msg) => errors.push(msg);
  try {
    assert.equal(main(root), 1);
    assert.match(errors.join("\n"), /clients\/a: esbuild@0\.28\.2/);
    assert.doesNotMatch(errors.join("\n"), /^ {2}\.: /m);
  } finally {
    console.error = error;
    rmSync(root, { recursive: true, force: true });
  }
});
