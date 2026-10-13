// Tests for the install-script review guard. The policy matching and the
// lockfile scan are exercised in memory, and `main` is exercised against a
// throwaway tree on disk, so install discovery, the per-install policy and the exit status are
// covered too. Run via `npm run test:scripts`.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  isReviewed,
  keyMatches,
  main,
  packageNameOf,
  registryIdentity,
  unreviewedScripts,
} from "./verify-install-scripts.mjs";

const REGISTRY = "https://registry.npmjs.org";
const tgz = (name, version) =>
  `${REGISTRY}/${name}/-/${name.split("/").pop()}-${version}.tgz`;
const dep = (name, version, extra = {}) => ({
  version,
  resolved: tgz(name, version),
  hasInstallScript: true,
  ...extra,
});

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

test("registryIdentity reads name and version off the tarball URL", () => {
  assert.deepEqual(registryIdentity(tgz("esbuild", "0.28.2")), {
    name: "esbuild",
    version: "0.28.2",
  });
  assert.deepEqual(registryIdentity(`${REGISTRY}/@s/b/-/b-1.0.0.tgz`), {
    name: "@s/b",
    version: "1.0.0",
  });
  assert.deepEqual(
    registryIdentity("https://host/mount/@s%2fb/-/b-1.0.0-rc.1.tgz"),
    { name: "@s/b", version: "1.0.0-rc.1" },
  );
});

test("registryIdentity proves nothing for a non-registry source", () => {
  assert.equal(registryIdentity(undefined), null);
  assert.equal(registryIdentity("git+ssh://git@github.com/a/b.git#abc"), null);
  assert.equal(registryIdentity("file:../pkg"), null);
  assert.equal(registryIdentity("https://host/pkg.tgz"), null);
  assert.equal(registryIdentity(`${REGISTRY}/a/-/b-1.0.0.tgz`), null);
  assert.equal(registryIdentity(`${REGISTRY}/a/-/a-latest.tgz`), null);
  assert.equal(registryIdentity(`${REGISTRY}/a/-/a-1.0.0.zip`), null);
});

test("a bare name or name@* reviews every version, allow or deny", () => {
  const id = { name: "fsevents", version: "2.3.2" };
  assert.equal(keyMatches("fsevents", id), true);
  assert.equal(keyMatches("fsevents@*", id), true);
  assert.equal(keyMatches("@s/b", { name: "@s/b", version: "1.0.0" }), true);
  assert.equal(isReviewed({ fsevents: true }, dep("fsevents", "9.0.0")), true);
});

test("only exact versions joined by || review a version, as npm reads them", () => {
  const id = { name: "esbuild", version: "0.28.2" };
  assert.equal(keyMatches("esbuild@0.28.2", id), true);
  assert.equal(keyMatches("esbuild@0.28.1 || 0.28.2", id), true);
  assert.equal(keyMatches("esbuild@0.28.3", id), false);
  // npm rejects comparator ranges as policy keys, so they review nothing.
  assert.equal(keyMatches("esbuild@^0.28.0", id), false);
  assert.equal(keyMatches("esbuild@>=0.1.0", id), false);
  assert.equal(keyMatches("esbuild@0.28.2 ||", id), false);
  assert.equal(
    keyMatches("@s/b@1.0.0", { name: "@s/b", version: "1.0.0" }),
    true,
  );
});

test("a non-boolean value or another package is no review", () => {
  const entry = dep("esbuild", "1.0.0");
  assert.equal(isReviewed({ esbuild: "maybe" }, entry), false);
  assert.equal(isReviewed({ "esbuild-wasm": false }, entry), false);
  assert.equal(isReviewed(undefined, entry), false);
});

test("an alias is matched by the package it resolves to, not its folder", () => {
  // `"esbuild": "npm:naughty@1.0.0"` installs naughty under node_modules/esbuild.
  const aliased = dep("naughty", "1.0.0");
  assert.equal(isReviewed({ esbuild: false }, aliased), false);
  assert.equal(isReviewed({ naughty: false }, aliased), true);
});

test("a non-registry entry is reviewed only by its exact resolved spec", () => {
  const git = {
    version: "1.0.0",
    resolved: "git+ssh://git@github.com/a/b.git#abc",
    hasInstallScript: true,
  };
  assert.equal(isReviewed({ b: false }, git), false);
  assert.equal(isReviewed({ [git.resolved]: false }, git), true);
});

test("unreviewedScripts reports only scripted, undecided dependencies", () => {
  const lock = lockOf({
    "node_modules/esbuild": dep("esbuild", "0.28.2"),
    "node_modules/fsevents": dep("fsevents", "2.3.3"),
    "node_modules/vite/node_modules/fsevents": dep("fsevents", "2.3.2"),
    "node_modules/aliased": dep("naughty", "1.0.0"),
    "node_modules/plain": { version: "1.0.0", resolved: tgz("plain", "1.0.0") },
  });
  // The `""` project entry carries the root postinstall and is never reported.
  assert.deepEqual(
    unreviewedScripts(lock, { fsevents: false, aliased: false }),
    [
      {
        entryPath: "node_modules/esbuild",
        name: "esbuild",
        version: "0.28.2",
        bundled: false,
      },
      {
        entryPath: "node_modules/aliased",
        name: "naughty",
        version: "1.0.0",
        bundled: false,
      },
    ],
  );
  assert.deepEqual(
    unreviewedScripts(lock, {
      esbuild: false,
      fsevents: false,
      naughty: false,
    }),
    [],
  );
  const file = lockOf({
    "node_modules/b": {
      version: "1.0.0",
      resolved: "file:../b",
      hasInstallScript: true,
    },
  });
  assert.deepEqual(unreviewedScripts(file, {}), [
    {
      entryPath: "node_modules/b",
      name: "b",
      version: "1.0.0",
      bundled: false,
    },
  ]);
});

test("a non-registry entry needs a decision even without the flag (prepare)", () => {
  const git = "git+ssh://git@github.com/a/b.git#abc";
  const lock = lockOf({
    "node_modules/b": { version: "1.0.0", resolved: git },
    "node_modules/linked": { resolved: "../linked", link: true },
    // Scriptless and source-less: neither bundled nor registry-unresolved
    // entries can run `prepare`, so neither needs a decision.
    "node_modules/b/node_modules/bundled": { version: "1.0.0", inBundle: true },
    "node_modules/unresolved": { version: "1.0.0" },
  });
  assert.deepEqual(unreviewedScripts(lock, {}), [
    {
      entryPath: "node_modules/b",
      name: "b",
      version: "1.0.0",
      bundled: false,
    },
  ]);
  assert.deepEqual(unreviewedScripts(lock, { [git]: false }), []);
});

test("a bundled script is always reported: no policy key can decide it", () => {
  const lock = lockOf({
    "node_modules/a/node_modules/bundled": dep("bundled", "1.0.0", {
      inBundle: true,
    }),
  });
  assert.deepEqual(unreviewedScripts(lock, { bundled: false }), [
    {
      entryPath: "node_modules/a/node_modules/bundled",
      name: "bundled",
      version: "1.0.0",
      bundled: true,
    },
  ]);
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

const scripted = lockOf({ "node_modules/esbuild": dep("esbuild", "0.28.2") });

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
