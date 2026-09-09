// Table-driven tests for the pure helpers of the dep-lockstep guard (#1896).
// One case per rule the guard encodes — the comment names the rule, so a future
// change that relaxes one is visible as a deleted assertion rather than a quiet
// behavior shift. Run via `npm run test:scripts` (node:test; the root has no
// vitest harness).
//
// The candidate derivation itself lives in `lib/tsc-program.mjs` (shared with
// `verify:typecheck-coverage` since #1965) and is covered by
// `lib/tsc-program.test.mjs`; what stays here is the lockfile comparison and the
// client-enrollment rule this guard owns.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  clientProjects,
  countDeclaredHeld,
  declaredPackages,
  findDeclaredSkew,
  findSkew,
  hasReadableLockShape,
  lockVersionsByPath,
  majorOf,
  partitionDeclaredSkew,
  partitionSkew,
  toleratesSkew,
  topLevelVersions,
} from "./verify-dep-lockstep.mjs";

test("clientProjects: a `typecheck` script's projects win over references", () => {
  // Both enrollment paths exist (cli/tui/launcher declare `typecheck`,
  // `clients/web` is a `tsc -b` solution) and this guard must measure the same
  // programs as `verify:typecheck-coverage`, which prefers the script.
  assert.deepEqual(
    clientProjects(
      {
        typecheck: "tsc --noEmit -p tsconfig.json && tsc -p tsconfig.test.json",
      },
      ["./ignored.json"],
    ),
    ["tsconfig.json", "tsconfig.test.json"],
  );
});

test("clientProjects: a reference client is measured through its references", () => {
  assert.deepEqual(
    clientProjects({ build: "tsc -b && vite build" }, ["./a.json"]),
    ["./a.json"],
  );
  // Neither path available — the caller reports it rather than measuring nothing.
  assert.deepEqual(clientProjects({ build: "vite build" }, []), []);
});

test("clientProjects: a NEUTERED project still contributes its program (#1965)", () => {
  // `--noCheck` stops that pass type-checking, which is the sibling guard's
  // complaint; the program still resolves its imports, and dropping it here
  // would shrink what THIS guard measures on the strength of that other defect.
  assert.deepEqual(
    clientProjects(
      {
        typecheck:
          "tsc -p tsconfig.json --noCheck && tsc -p tsconfig.test.json",
      },
      [],
    ).sort(),
    ["tsconfig.json", "tsconfig.test.json"],
  );
});

test("lockVersionsByPath: keyed by install path, nested entries included (Copilot, #1965 r1)", () => {
  // Keyed by PATH, not by package name: a nested copy that entered a program has
  // to be priced from its own entry. Reading only `node_modules/<pkg>` would
  // compare it against the install's top-level copy — a different version, or
  // none — and a real pair could pass.
  const lock = {
    packages: {
      "": { name: "root" },
      "node_modules/zod": { version: "4.4.3" },
      "node_modules/yaml": { version: "2.9.0" },
      "node_modules/cosmiconfig/node_modules/yaml": { version: "1.10.3" },
      "node_modules/@modelcontextprotocol/client": { version: "2.0.0-beta.5" },
      "node_modules/no-version": { resolved: "https://example.test/x.tgz" },
    },
  };
  assert.deepEqual([...lockVersionsByPath(lock)].sort(), [
    ["node_modules/@modelcontextprotocol/client", "2.0.0-beta.5"],
    ["node_modules/cosmiconfig/node_modules/yaml", "1.10.3"],
    ["node_modules/yaml", "2.9.0"],
    ["node_modules/zod", "4.4.3"],
  ]);
});

test("lockVersionsByPath: a malformed or empty lockfile yields nothing", () => {
  // Safe as a pure helper *because* `hasReadableLockShape` rejects these before
  // any comparison — an empty map reaching `findSkew` is the fail-open path.
  for (const lock of [undefined, null, {}, { packages: {} }])
    assert.equal(lockVersionsByPath(lock).size, 0);
});

/** `crossInstallPackages`-shaped input: name → program → install → entry paths. */
const occurrence = (name, program, byRoot) =>
  new Map([
    [
      name,
      new Map([
        [
          program,
          new Map(
            Object.entries(byRoot).map(([dir, paths]) => [dir, new Set(paths)]),
          ),
        ],
      ]),
    ],
  ]);

const lockPaths = (byDir) =>
  new Map(
    Object.entries(byDir).map(([dir, entries]) => [
      dir,
      new Map(Object.entries(entries)),
    ]),
  );

test("findSkew: reports the copies one program loaded, with their paths", () => {
  const { skewed, unresolved } = findSkew(
    occurrence("zod", "clients/web/tsconfig.test.json", {
      ".": ["node_modules/zod"],
      "clients/web": ["node_modules/zod"],
    }),
    lockPaths({
      ".": { "node_modules/zod": "4.3.6" },
      "clients/web": { "node_modules/zod": "4.4.3" },
    }),
  );
  assert.deepEqual(unresolved, []);
  assert.deepEqual(skewed, [
    {
      name: "zod",
      occurrences: [
        {
          program: "clients/web/tsconfig.test.json",
          holders: [
            { dir: ".", entryPath: "node_modules/zod", version: "4.3.6" },
            {
              dir: "clients/web",
              entryPath: "node_modules/zod",
              version: "4.4.3",
            },
          ],
        },
      ],
    },
  ]);
});

test("findSkew: only the installs that MET in a program are compared (Copilot, #1965 r1)", () => {
  // `clients/cli` holds a different zod, but no program loads it beside another
  // copy — nothing has to relate the two, so it is not a finding, and naming cli
  // in a diagnostic about web's program would be wrong as well as noisy.
  const { skewed } = findSkew(
    occurrence("zod", "clients/web/tsconfig.test.json", {
      ".": ["node_modules/zod"],
      "clients/web": ["node_modules/zod"],
    }),
    lockPaths({
      ".": { "node_modules/zod": "4.4.3" },
      "clients/web": { "node_modules/zod": "4.4.3" },
      "clients/cli": { "node_modules/zod": "4.3.6" },
    }),
  );
  assert.deepEqual(skewed, []);
});

test("findSkew: a nested copy is priced from its own entry (Copilot, #1965 r1)", () => {
  // The root loaded zod through `a`'s nested copy. Pricing it from the root's
  // TOP-LEVEL entry (4.4.3, aligned with web) would report the pair as agreeing.
  const { skewed } = findSkew(
    occurrence("zod", "clients/web/tsconfig.test.json", {
      ".": ["node_modules/a/node_modules/zod"],
      "clients/web": ["node_modules/zod"],
    }),
    lockPaths({
      ".": {
        "node_modules/zod": "4.4.3",
        "node_modules/a/node_modules/zod": "3.1.0",
      },
      "clients/web": { "node_modules/zod": "4.4.3" },
    }),
  );
  assert.deepEqual(
    skewed[0].occurrences[0].holders.map((h) => `${h.dir}:${h.version}`),
    [".:3.1.0", "clients/web:4.4.3"],
  );
});

test("findSkew: agreement is not skew", () => {
  const { skewed, unresolved } = findSkew(
    occurrence("zod", "p", {
      ".": ["node_modules/zod"],
      "clients/web": ["node_modules/zod"],
    }),
    lockPaths({
      ".": { "node_modules/zod": "4.4.3" },
      "clients/web": { "node_modules/zod": "4.4.3" },
    }),
  );
  assert.deepEqual(skewed, []);
  assert.deepEqual(unresolved, []);
});

test("findSkew: a copy with no lockfile entry is reported, not skipped", () => {
  // Skipping it would drop a holder from the comparison and could report a real
  // skew as agreement — the gate failing open.
  const { skewed, unresolved } = findSkew(
    occurrence("zod", "p", {
      ".": ["node_modules/zod"],
      "clients/web": ["node_modules/zod"],
    }),
    lockPaths({ ".": { "node_modules/zod": "4.4.3" }, "clients/web": {} }),
  );
  assert.deepEqual(unresolved, [
    { name: "zod", dir: "clients/web", entryPath: "node_modules/zod" },
  ]);
  assert.deepEqual(skewed, []);
});

test("findSkew: results are sorted by package name", () => {
  const found = new Map([
    ...occurrence("zod", "p", {
      ".": ["node_modules/zod"],
      "clients/web": ["node_modules/zod"],
    }),
    ...occurrence("hono", "p", {
      ".": ["node_modules/hono"],
      "clients/web": ["node_modules/hono"],
    }),
  ]);
  const { skewed } = findSkew(
    found,
    lockPaths({
      ".": { "node_modules/zod": "1.0.0", "node_modules/hono": "1.0.0" },
      "clients/web": {
        "node_modules/zod": "2.0.0",
        "node_modules/hono": "2.0.0",
      },
    }),
  );
  assert.deepEqual(
    skewed.map((s) => s.name),
    ["hono", "zod"],
  );
});

test("hasReadableLockShape: only a v2+ packages table with a root entry (Copilot, #1962)", () => {
  assert.equal(
    hasReadableLockShape({ lockfileVersion: 3, packages: { "": {} } }),
    true,
  );
  assert.equal(
    hasReadableLockShape({
      lockfileVersion: 2,
      packages: { "": {}, "node_modules/zod": { version: "4.4.3" } },
    }),
    true,
  );
  const rejected = [
    undefined,
    null,
    {},
    { lockfileVersion: 3, packages: null },
    { lockfileVersion: 3, packages: [] }, // an array has no `""` key
    { lockfileVersion: 3, packages: {} }, // no root entry
    {
      lockfileVersion: 3,
      packages: { "node_modules/zod": { version: "4.4.3" } },
    },
    { lockfileVersion: 1, dependencies: { zod: { version: "4.4.3" } } },
    // A declared v1 carrying a `packages` table: the version is checked, not
    // inferred from the key's presence, so this is rejected rather than
    // half-trusted into an empty (fail-open) version map.
    { lockfileVersion: 1, packages: { "": {} } },
    { packages: { "": {} } }, // no declared version at all
    { lockfileVersion: "3", packages: { "": {} } }, // not a number
  ];
  for (const lock of rejected)
    assert.equal(hasReadableLockShape(lock), false, JSON.stringify(lock));
});

test("partitionSkew: the allowlist is by name, not by version pair", () => {
  // So an ordinary patch float within a tolerated package does not churn the
  // allowlist, while any *unlisted* package that starts skewing still fails.
  const skewed = [
    {
      name: "react",
      occurrences: [
        {
          program: "p",
          holders: [
            { dir: ".", version: "19.2.7" },
            { dir: "clients/web", version: "19.2.8" },
          ],
        },
      ],
    },
    {
      name: "zod",
      occurrences: [
        {
          program: "p",
          holders: [
            { dir: ".", version: "4.3.6" },
            { dir: "clients/web", version: "4.4.3" },
          ],
        },
      ],
    },
  ];
  const tolerated = new Map([["react", "shallow interfaces"]]);
  const { failures, ignored } = partitionSkew(skewed, tolerated);
  assert.deepEqual(
    failures.map((s) => s.name),
    ["zod"],
  );
  assert.deepEqual(
    ignored.map((s) => s.name),
    ["react"],
  );
});

test("partitionSkew: deny by default — nothing tolerated fails everything", () => {
  const skewed = [
    {
      name: "zod",
      occurrences: [
        { program: "p", holders: [{ dir: ".", version: "1.0.0" }] },
      ],
    },
  ];
  assert.equal(partitionSkew(skewed, new Map()).failures.length, 1);
});

test("partitionSkew: the allowlist tolerates skew only within a major (Copilot, #1962)", () => {
  // Each rationale establishes that a patch/minor difference is benign; that is
  // not evidence a React 18-vs-19 split is, so a listed package still fails
  // across a major boundary.
  const tolerated = new Map([["react", "shallow interfaces"]]);
  const withinMajor = [
    {
      name: "react",
      occurrences: [
        {
          program: "p",
          holders: [
            { dir: ".", version: "19.2.7" },
            { dir: "clients/web", version: "19.2.8" },
          ],
        },
      ],
    },
  ];
  const acrossMajor = [
    {
      name: "react",
      occurrences: [
        {
          program: "p",
          holders: [
            { dir: ".", version: "18.3.1" },
            { dir: "clients/web", version: "19.2.8" },
          ],
        },
      ],
    },
  ];
  assert.equal(partitionSkew(withinMajor, tolerated).failures.length, 0);
  assert.equal(partitionSkew(withinMajor, tolerated).ignored.length, 1);
  assert.equal(partitionSkew(acrossMajor, tolerated).failures.length, 1);
  assert.equal(partitionSkew(acrossMajor, tolerated).ignored.length, 0);
});

test("partitionSkew: an unparseable version can't be proven same-major, so it fails", () => {
  const tolerated = new Map([["react", "shallow interfaces"]]);
  const skewed = [
    {
      name: "react",
      occurrences: [
        {
          program: "p",
          holders: [
            { dir: ".", version: "19.2.7" },
            { dir: "clients/web", version: "next" },
          ],
        },
      ],
    },
  ];
  assert.equal(partitionSkew(skewed, tolerated).failures.length, 1);
});

test("majorOf: prerelease and build metadata are irrelevant", () => {
  const cases = [
    ["4.4.3", "4"],
    ["2.0.0-beta.5", "2"],
    ["19.2.8", "19"],
    ["1.10.3+build.7", "1"],
  ];
  for (const [input, expected] of cases)
    assert.equal(majorOf(input), expected, input);
  for (const bad of ["next", "", undefined, null, "v4.4.3"])
    assert.equal(majorOf(bad), null, JSON.stringify(bad));
});

// ---------------------------------------------------------------------------
// The declared tier (#2226). One case per rule, same convention as above.
// ---------------------------------------------------------------------------

test("declaredPackages: dependencies, devDependencies and optionalDependencies from every install", () => {
  // devDependencies count because the boundary is "does the repo name a package
  // npm installs for us", not "does it ship" — `@types/node` and the toolchain
  // are exactly the case #2226 is about, and all of them are devDependencies.
  // optionalDependencies count for the same reason: npm attempts to install one
  // like any other direct declaration (Copilot, #2226).
  assert.deepEqual(
    [
      ...declaredPackages([
        { dir: ".", manifest: { dependencies: { react: "^19.0.0" } } },
        {
          dir: "clients/web",
          manifest: {
            dependencies: { "react-dom": "^19.2.4" },
            devDependencies: { "@types/react": "^19.2.14" },
            optionalDependencies: { fsevents: "^2.3.3" },
          },
        },
      ]),
    ].sort(),
    ["@types/react", "fsevents", "react", "react-dom"],
  );
});

test("declaredPackages: a peer range is not a declaration", () => {
  // A peer range constrains the consumer's HOST rather than naming what this
  // repo installs; the copy npm auto-installs to satisfy an unmet one is still
  // caught whenever some manifest declares that name, which is the
  // eslint/typescript/vitest shadow case (all three are root devDependencies).
  assert.deepEqual(
    [
      ...declaredPackages([
        { dir: ".", manifest: { peerDependencies: { react: "^19.0.0" } } },
      ]),
    ],
    [],
  );
});

test("declaredPackages: a manifest with no dependency fields contributes nothing", () => {
  assert.equal(
    declaredPackages([{ dir: "clients/launcher", manifest: { name: "l" } }])
      .size,
    0,
  );
});

test("topLevelVersions: nested copies are excluded", () => {
  // Top-level is what the install's own code resolves and what a range in that
  // manifest governs. A nested copy exists because some dependency asked for a
  // different version, so it is constrained by that dependency, not by us.
  const versions = topLevelVersions({
    lockfileVersion: 3,
    packages: {
      "": { name: "fixture" },
      "node_modules/zod": { version: "4.4.3" },
      "node_modules/outer/node_modules/zod": { version: "3.0.0" },
      "clients/web/node_modules/zod": { version: "9.9.9" },
    },
  });
  assert.deepEqual([...versions], [["zod", "4.4.3"]]);
});

test("findDeclaredSkew: two installs disagreeing is skew, and every holder is named", () => {
  const skewed = findDeclaredSkew(
    new Set(["@types/node"]),
    new Map([
      [".", new Map([["@types/node", "24.13.3"]])],
      ["clients/cli", new Map([["@types/node", "24.13.1"]])],
      ["clients/web", new Map([["@types/node", "24.13.3"]])],
    ]),
  );
  assert.deepEqual(skewed, [
    {
      name: "@types/node",
      holders: [
        { dir: ".", version: "24.13.3" },
        { dir: "clients/cli", version: "24.13.1" },
        { dir: "clients/web", version: "24.13.3" },
      ],
    },
  ]);
});

test("findDeclaredSkew: two CLIENTS disagreeing is skew, with no root copy involved", () => {
  // No single `tsc` program can see this pair, which is why the program tier
  // structurally cannot report it (`@types/react`, web against tui).
  assert.deepEqual(
    findDeclaredSkew(
      new Set(["@types/react"]),
      new Map([
        [".", new Map()],
        ["clients/web", new Map([["@types/react", "19.2.18"]])],
        ["clients/tui", new Map([["@types/react", "19.2.17"]])],
      ]),
    ).map((s) => s.name),
    ["@types/react"],
  );
});

test("findDeclaredSkew: one holder cannot skew, and agreement is not skew", () => {
  assert.deepEqual(
    findDeclaredSkew(
      new Set(["only-root", "agreed"]),
      new Map([
        [
          ".",
          new Map([
            ["only-root", "1.0.0"],
            ["agreed", "2.0.0"],
          ]),
        ],
        ["clients/web", new Map([["agreed", "2.0.0"]])],
      ]),
    ),
    [],
  );
});

test("findDeclaredSkew: an installed package no manifest declares is not a candidate", () => {
  assert.deepEqual(
    findDeclaredSkew(
      new Set(),
      new Map([
        [".", new Map([["undeclared", "1.0.0"]])],
        ["clients/web", new Map([["undeclared", "2.0.0"]])],
      ]),
    ),
    [],
  );
});

test("findDeclaredSkew: results are sorted by package name", () => {
  const two = new Map([
    [
      ".",
      new Map([
        ["zod", "1.0.0"],
        ["ajv", "1.0.0"],
      ]),
    ],
    [
      "clients/web",
      new Map([
        ["zod", "2.0.0"],
        ["ajv", "2.0.0"],
      ]),
    ],
  ]);
  assert.deepEqual(
    findDeclaredSkew(new Set(["zod", "ajv"]), two).map((s) => s.name),
    ["ajv", "zod"],
  );
});

test("partitionDeclaredSkew: deny by default", () => {
  const skewed = [
    {
      name: "zod",
      holders: [
        { dir: ".", version: "4.4.3" },
        { dir: "w", version: "4.3.6" },
      ],
    },
  ];
  const { failures, ignored } = partitionDeclaredSkew(skewed, new Map());
  assert.deepEqual(
    failures.map((f) => f.name),
    ["zod"],
  );
  assert.deepEqual(ignored, []);
});

test("partitionDeclaredSkew: an allowlisted package tolerates only a within-major skew", () => {
  const within = {
    name: "hono",
    holders: [
      { dir: ".", version: "4.1.0" },
      { dir: "w", version: "4.2.0" },
    ],
  };
  const across = {
    name: "hono",
    holders: [
      { dir: ".", version: "4.1.0" },
      { dir: "w", version: "5.0.0" },
    ],
  };
  const allow = new Map([["hono", "reason"]]);
  assert.deepEqual(partitionDeclaredSkew([within], allow).ignored.length, 1);
  assert.deepEqual(partitionDeclaredSkew([across], allow).failures.length, 1);
});

test("toleratesSkew: the within-a-major rule is stated once for both tiers", () => {
  const allow = new Map([["p", "reason"]]);
  assert.equal(
    toleratesSkew("p", [{ version: "1.1.0" }, { version: "1.2.0" }], allow),
    true,
  );
  assert.equal(
    toleratesSkew("p", [{ version: "1.1.0" }, { version: "2.0.0" }], allow),
    false,
  );
  // Unparseable can't be proven same-major, so it fails rather than passes.
  assert.equal(
    toleratesSkew("p", [{ version: "1.1.0" }, { version: "next" }], allow),
    false,
  );
  assert.equal(
    toleratesSkew("other", [{ version: "1.1.0" }, { version: "1.2.0" }], allow),
    false,
  );
});

test("countDeclaredHeld: counts declared names more than one install holds", () => {
  const versions = new Map([
    [
      ".",
      new Map([
        ["shared", "1.0.0"],
        ["root-only", "1.0.0"],
      ]),
    ],
    [
      "clients/web",
      new Map([
        ["shared", "1.0.0"],
        ["undeclared", "1.0.0"],
      ]),
    ],
  ]);
  assert.equal(
    countDeclaredHeld(new Set(["shared", "root-only", "undeclared"]), versions),
    // `shared` alone: the other two are held by one install each.
    1,
  );
});
