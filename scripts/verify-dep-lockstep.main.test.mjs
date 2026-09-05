// End-to-end tests for the dep-lockstep guard's executable path (Copilot,
// #1962). The sibling tests cover the pure helpers; nothing exercised `main()`,
// so a regression in candidate derivation, install discovery, lockfile loading,
// the sibling-guard vouch, or the nonzero exit on real skew would have left the
// whole suite green.
//
// Each case builds a throwaway repo — the guard derives its root from its own
// file location, so the script is copied into the fixture rather than pointed
// at one — `git add`s it (install discovery is by manifest, but the sibling
// `verify:format-coverage` vouch and git-based tooling expect a repo), and runs
// the guard as a subprocess to assert the exit status and message.
//
// Since #1965 the fixture must contain a REAL tsc program: the candidate set is
// derived from what `tsc --listFilesOnly` resolves, so each fixture ships two
// installs holding the same tiny stub packages, one client tsconfig whose
// program spans both (its own `src` resolves from the client install, the shared
// `core/` it includes resolves from the root — the actual v2 shape), and a
// symlinked real `typescript` to run it. Run via `npm run test:scripts`.

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptsDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(scriptsDir, "..");

/** The real typescript install, symlinked into each fixture so `npx tsc` runs. */
const typescriptDir = path.dirname(
  createRequire(path.join(repoRoot, "clients", "web", "package.json")).resolve(
    "typescript/package.json",
  ),
);

/**
 * A lockfileVersion 3 lockfile, including the `""` root entry npm always writes.
 * A key already containing `node_modules/` is used verbatim, so a nested install
 * path (`node_modules/outer/node_modules/inner`) can be expressed.
 */
const lock = (deps) => ({
  lockfileVersion: 3,
  packages: {
    "": { name: "fixture" },
    ...Object.fromEntries(
      Object.entries(deps).map(([name, version]) => [
        name.includes("node_modules/") ? name : `node_modules/${name}`,
        { version },
      ]),
    ),
  },
});

/**
 * Build a fixture repo whose one client program spans two installs.
 *
 * `outer` is named by first-party code in both trees; `inner` is named ONLY by
 * `outer`'s own `.d.ts`, so it reaches the program transitively — the
 * `@modelcontextprotocol/sdk` shape #1965 is about. Both stubs are installed
 * under the root AND under `clients/web`, so each program holds two copies of
 * each and both are candidates. `solo` is installed at the root only and
 * imported only by the shared tree, so it can never be a candidate however its
 * lockfile entries read.
 */
function makeFixture({
  rootDeps,
  webDeps,
  scripts,
  webScripts,
  rawWebLock,
  webTsconfig,
  rootNestedInner,
  cliDeps,
  rootManifestDeps,
  webManifestDeps,
  webSolo,
} = {}) {
  // realpath matters: on macOS `tmpdir()` is `/var/...`, a symlink to
  // `/private/var/...`. The guard only runs `main()` when `import.meta.url`
  // (always the resolved path) matches `process.argv[1]`, so launching it via
  // the unresolved path would load the module and silently do nothing —
  // exiting 0 with no output, which every assertion here would misread.
  const dir = realpathSync(mkdtempSync(path.join(tmpdir(), "dep-lockstep-")));
  const write = (rel, contents) => {
    mkdirSync(path.join(dir, path.dirname(rel)), { recursive: true });
    writeFileSync(
      path.join(dir, rel),
      typeof contents === "string"
        ? contents
        : JSON.stringify(contents, null, 2),
    );
  };

  write("package.json", {
    name: "fixture",
    ...(rootManifestDeps ? { dependencies: rootManifestDeps } : {}),
    scripts: scripts ?? {
      validate: "npm run verify:format-coverage && npm run verify:dep-lockstep",
      "verify:format-coverage": "node scripts/verify-format-coverage.mjs",
      "verify:dep-lockstep": "node scripts/verify-dep-lockstep.mjs",
    },
  });

  // The shared tree, compiled into the client's program but resolving its own
  // imports from the ROOT install — the reason a package can appear twice.
  write(
    "core/client.ts",
    'import type { Outer } from "outer";\nimport type { Solo } from "solo";\nexport type FromCore = Outer | Solo;\n',
  );
  // The client's own source, resolving from the CLIENT install.
  write(
    "clients/web/src/main.ts",
    'import type { Outer } from "outer";\nexport type FromWeb = Outer;\n',
  );
  write("clients/web/package.json", {
    name: "web",
    ...(webManifestDeps ? { devDependencies: webManifestDeps } : {}),
    scripts: webScripts ?? { typecheck: "tsc --noEmit -p tsconfig.json" },
  });
  write(
    "clients/web/tsconfig.json",
    webTsconfig ?? {
      compilerOptions: {
        noEmit: true,
        module: "esnext",
        target: "esnext",
        moduleResolution: "bundler",
        types: [],
      },
      include: ["src/**/*.ts", "../../core/**/*.ts"],
    },
  );

  // Stub installs. `outer` pulls `inner` in through its own declarations. The
  // installed version must match the lockfile's: TypeScript keys its
  // package-identity dedup on name@version, so a stub that lied about its
  // version would make the program under test differ from the one the lockfile
  // describes.
  const root = rootDeps ?? ALIGNED;
  const web = webDeps ?? ALIGNED;
  const stub = (installRoot, versions, name, body) => {
    if (!versions[name]) return;
    write(`${installRoot}node_modules/${name}/package.json`, {
      name,
      version: versions[name],
      types: "index.d.ts",
    });
    write(`${installRoot}node_modules/${name}/index.d.ts`, body);
  };
  for (const [installRoot, versions] of [
    ["", root],
    ["clients/web/", web],
  ]) {
    stub(
      installRoot,
      versions,
      "outer",
      'import type { Inner } from "inner";\nexport type Outer = Inner;\n',
    );
    stub(installRoot, versions, "inner", "export type Inner = number;\n");
  }
  stub("", root, "solo", "export type Solo = string;\n");
  // `solo` under the CLIENT install as well. Nothing in `clients/web/src`
  // imports it, so the program still resolves exactly one copy (the root's, via
  // the shared `core/`) — the declared tier's whole point is that it sees this
  // second copy anyway (#2226).
  const webLockDeps = { ...web };
  if (webSolo) {
    stub(
      "clients/web/",
      { solo: webSolo },
      "solo",
      "export type Solo = string;\n",
    );
    webLockDeps.solo = webSolo;
  }

  // The root reaches `inner` only through a copy NESTED under `outer`, at a
  // version its top-level entry does not carry. npm's own conflict resolution,
  // and the case that must still be priced from the entry the program resolved.
  const rootLockDeps = { ...root };
  if (rootNestedInner) {
    stub(
      "node_modules/outer/",
      { inner: rootNestedInner },
      "inner",
      "export type Inner = number;\n",
    );
    rootLockDeps["node_modules/outer/node_modules/inner"] = rootNestedInner;
  }

  write("package-lock.json", lock(rootLockDeps));
  write("clients/web/package-lock.json", rawWebLock ?? lock(webLockDeps));

  // A second client, to prove a third install's copy is not dragged into a
  // comparison it never took part in. Its program spans only its own install.
  if (cliDeps) {
    write("clients/cli/package.json", {
      name: "cli",
      scripts: { typecheck: "tsc --noEmit -p tsconfig.json" },
    });
    write("clients/cli/tsconfig.json", {
      compilerOptions: {
        noEmit: true,
        module: "esnext",
        target: "esnext",
        moduleResolution: "bundler",
        types: [],
      },
      include: ["src/**/*.ts"],
    });
    write(
      "clients/cli/src/main.ts",
      'import type { Outer } from "outer";\nexport type FromCli = Outer;\n',
    );
    stub(
      "clients/cli/",
      cliDeps,
      "outer",
      'import type { Inner } from "inner";\nexport type Outer = Inner;\n',
    );
    stub("clients/cli/", cliDeps, "inner", "export type Inner = number;\n");
    write("clients/cli/package-lock.json", lock(cliDeps));
  }

  // The guard resolves its repo root from its own location, so it has to live
  // inside the fixture; its `lib/` imports come along.
  mkdirSync(path.join(dir, "scripts", "lib"), { recursive: true });
  for (const rel of [
    "verify-dep-lockstep.mjs",
    path.join("lib", "npm-scripts.mjs"),
    path.join("lib", "resolve-node-bin.mjs"),
    path.join("lib", "tsc-program.mjs"),
  ])
    cpSync(path.join(scriptsDir, rel), path.join(dir, "scripts", rel));

  // A real typescript, plus the `.bin` entry `npx --no-install tsc` resolves by
  // walking up from the client dir.
  mkdirSync(path.join(dir, "node_modules", ".bin"), { recursive: true });
  symlinkSync(
    typescriptDir,
    path.join(dir, "node_modules", "typescript"),
    "dir",
  );
  symlinkSync(
    path.join(typescriptDir, "bin", "tsc"),
    path.join(dir, "node_modules", ".bin", "tsc"),
  );

  execFileSync("git", ["init", "-q"], { cwd: dir });
  execFileSync("git", ["add", "-A"], { cwd: dir });
  return dir;
}

function runGuard(dir) {
  const r = spawnSync(
    process.execPath,
    [path.join(dir, "scripts", "verify-dep-lockstep.mjs")],
    { cwd: dir, encoding: "utf8" },
  );
  return { status: r.status, out: `${r.stdout}${r.stderr}` };
}

/** Run `fn` against a fresh fixture, always cleaning the temp dir up. */
function withFixture(options, fn) {
  const dir = makeFixture(options);
  try {
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const ALIGNED = { outer: "1.2.3", inner: "4.5.6", solo: "7.8.9" };

test("main: exits 0 when every install agrees", () => {
  withFixture({}, (dir) => {
    const { status, out } = runGuard(dir);
    assert.equal(status, 0, out);
    assert.match(out, /verify:dep-lockstep — OK/);
    // `outer` alone: both installs hold it and both files land in the program.
    // `solo` is installed at the root only, so it is not install-crossing — and
    // `inner`, at the same version in both installs, is collapsed by
    // TypeScript's package-identity redirect (see the note on `crossInstallPackages`
    // in lib/tsc-program.mjs): only one copy is ever loaded, so there is nothing
    // for the checker to relate. The next test is the version that matters.
    assert.match(out, /1 install-crossing dependencies/);
    assert.match(out, /1 tsc programs/);
  });
});

test("main: exits 1 and names the skewed package and every holder", () => {
  withFixture(
    { rootDeps: { ...ALIGNED, outer: "1.0.0" }, webDeps: ALIGNED },
    (dir) => {
      const { status, out } = runGuard(dir);
      assert.equal(status, 1, out);
      assert.match(out, /\bouter\b/);
      assert.match(out, /1\.0\.0\s+\(\.\/node_modules\/outer\)/);
      assert.match(out, /1\.2\.3\s+\(clients\/web\/node_modules\/outer\)/);
      // The program that saw both copies is named, so the claim is checkable.
      assert.match(out, /in clients\/web\/tsconfig\.json/);
      // `inner` agrees, so it must not be reported.
      assert.doesNotMatch(out, /^\s+inner$/m);
    },
  );
});

test("main: a package reached only through another package's .d.ts is caught (#1965)", () => {
  // `inner` is never written in first-party code — it enters the program solely
  // through `outer`'s declarations. The derivation this replaced read the
  // shared sources' own imports and could not see it, which is how
  // `@modelcontextprotocol/sdk` sat skewed across two installs while the guard
  // stayed green. Its parent skews too, which is what puts both copies of the
  // parent in the program to resolve from — the real #1965 shape, where
  // `ext-apps` was split 1.7.4/1.7.5 alongside the SDK.
  withFixture(
    {
      rootDeps: { ...ALIGNED, outer: "1.0.0", inner: "4.0.0" },
      webDeps: ALIGNED,
    },
    (dir) => {
      const { status, out } = runGuard(dir);
      assert.equal(status, 1, out);
      assert.match(out, /^\s+inner$/m);
      assert.match(out, /4\.0\.0\s+\(\.\/node_modules\/inner\)/);
      assert.match(out, /4\.5\.6\s+\(clients\/web\/node_modules\/inner\)/);
    },
  );
});

test("main: a package that reaches the program from ONE install is not a candidate", () => {
  // `solo` is installed at the root only, so no program ever holds two copies of
  // it — its lockfile entries can disagree without TypeScript ever relating two
  // declarations. Failing here would be the old derivation's false positive
  // (which is what made an allowlist of inert names necessary).
  withFixture(
    { rootDeps: { ...ALIGNED, solo: "7.0.0" }, webDeps: ALIGNED },
    (dir) => {
      const { status, out } = runGuard(dir);
      assert.equal(status, 0, out);
      assert.doesNotMatch(out, /\bsolo\b/);
    },
  );
});

test("main: a third install's copy is not dragged into a comparison it never joined (Copilot, #1965 r1)", () => {
  // `clients/cli` holds `outer` at a different version, but its own program is
  // the only one that loads that copy and no second install meets it there.
  // Flattening the candidates to names would compare cli against web's aligned
  // pair and fail — naming an install that never took part.
  withFixture(
    { cliDeps: { ...ALIGNED, outer: "9.9.9", inner: "9.9.9" } },
    (dir) => {
      const { status, out } = runGuard(dir);
      assert.equal(status, 0, out);
      assert.doesNotMatch(out, /clients\/cli/);
    },
  );
});

test("main: a nested copy is priced from its own lockfile entry (Copilot, #1965 r1)", () => {
  // The root reaches `inner` only through `node_modules/outer/node_modules/inner`
  // at 9.9.9, while its top-level entry still reads 4.5.6 — the version web
  // holds. Pricing the copy from the top-level entry would report the pair as
  // agreeing and let a real 9.9.9-vs-4.5.6 program through.
  withFixture(
    {
      rootDeps: { ...ALIGNED, outer: "1.0.0" },
      webDeps: ALIGNED,
      rootNestedInner: "9.9.9",
    },
    (dir) => {
      const { status, out } = runGuard(dir);
      assert.equal(status, 1, out);
      assert.match(out, /^\s+inner$/m);
      assert.match(
        out,
        /9\.9\.9\s+\(\.\/node_modules\/outer\/node_modules\/inner\)/,
      );
      assert.match(out, /4\.5\.6\s+\(clients\/web\/node_modules\/inner\)/);
    },
  );
});

test("main: exits 1 when a client names no tsconfig project", () => {
  // No `typecheck` script and no `tsconfig.json` references: none of that
  // client's programs is measured, so a skew reaching only them would pass.
  withFixture({ webScripts: { build: "vite build" } }, (dir) => {
    rmSync(path.join(dir, "clients", "web", "tsconfig.json"));
    const { status, out } = runGuard(dir);
    assert.equal(status, 1, out);
    assert.match(out, /names no tsconfig project/);
  });
});

test("main: exits 1 when a program cannot be listed, rather than measuring nothing", () => {
  // A broken tsconfig makes `tsc --listFilesOnly` resolve nothing. Reading that
  // as "no candidates here" is the gate failing open.
  withFixture({ webTsconfig: "{ this is not json" }, (dir) => {
    const { status, out } = runGuard(dir);
    assert.equal(status, 1, out);
    assert.match(out, /exited non-zero/);
  });
});

test("main: exits 1 on a lockfile it cannot read, rather than failing open (Copilot, #1962)", () => {
  // A v1 lockfile has `dependencies` and no `packages` table. Treating it as an
  // install that simply holds nothing would leave the *root's* copy unopposed
  // and the skew below reported as aligned — the gate failing open.
  withFixture(
    {
      rootDeps: { ...ALIGNED, outer: "1.0.0" },
      rawWebLock: {
        lockfileVersion: 1,
        dependencies: { outer: { version: "1.2.3" } },
      },
    },
    (dir) => {
      const { status, out } = runGuard(dir);
      assert.equal(status, 1, out);
      assert.match(out, /not in a readable format/);
      assert.match(out, /clients\/web\/package-lock\.json/);
    },
  );
});

test("main: exits 1 on a lockfile with a `packages` table but no root entry", () => {
  // The shape check is not just "has a packages key" — a table without the
  // `""` root npm always writes is not a lockfile this guard can trust.
  withFixture(
    {
      rawWebLock: {
        lockfileVersion: 3,
        packages: { "node_modules/outer": { version: "1.2.3" } },
      },
    },
    (dir) => {
      const { status, out } = runGuard(dir);
      assert.equal(status, 1, out);
      assert.match(out, /not in a readable format/);
    },
  );
});

test("main: exits 1 on an install whose lockfile is missing (Copilot, #1962)", () => {
  // Enrolment is by `package.json`, so a missing lockfile is loud rather than a
  // silently absent row. The fixture IS skewed, so dropping the install instead
  // would leave the remaining holder unopposed and report aligned.
  withFixture({ rootDeps: { ...ALIGNED, outer: "1.0.0" } }, (dir) => {
    rmSync(path.join(dir, "clients", "web", "package-lock.json"));
    const { status, out } = runGuard(dir);
    assert.equal(status, 1, out);
    assert.match(out, /no lockfile/);
    assert.match(out, /clients\/web\/package-lock\.json/);
  });
});

test("main: exits 1 when the ROOT lockfile is missing", () => {
  // The worst variant: the root is the install every shared source resolves
  // from, so omitting it could let the guard pass on client locks alone.
  withFixture({}, (dir) => {
    rmSync(path.join(dir, "package-lock.json"));
    const { status, out } = runGuard(dir);
    assert.equal(status, 1, out);
    assert.match(out, /no lockfile/);
    assert.match(out, /^\s+\.\/package-lock\.json$/m);
  });
});

test("main: a clients/ dir with no package.json is not an install", () => {
  // Enrolling a stray directory would demand a lockfile it should never have,
  // and a tsconfig project it has no way to name.
  withFixture({}, (dir) => {
    mkdirSync(path.join(dir, "clients", "scratch"), { recursive: true });
    writeFileSync(
      path.join(dir, "clients", "scratch", "notes.md"),
      "scratch\n",
    );
    const { status, out } = runGuard(dir);
    assert.equal(status, 0, out);
  });
});

test("main: exits 1 when there is no client program to measure at all", () => {
  // A moved `clients/` dir leaves the derivation with nothing to look at, and an
  // empty candidate set from a broken enumeration reads exactly like a clean
  // bill of health.
  withFixture({}, (dir) => {
    rmSync(path.join(dir, "clients"), { recursive: true, force: true });
    const { status, out } = runGuard(dir);
    assert.equal(status, 1, out);
    assert.match(out, /found no client program to measure/);
  });
});

test("main: exits 1 when the root validate no longer runs the sibling guard", () => {
  withFixture(
    {
      // `verify:format-coverage` dropped from the chain: the vouch must fail
      // even though the dependency versions themselves are fine.
      scripts: {
        validate: "npm run verify:dep-lockstep",
        "verify:dep-lockstep": "node scripts/verify-dep-lockstep.mjs",
      },
    },
    (dir) => {
      const { status, out } = runGuard(dir);
      assert.equal(status, 1, out);
      assert.match(out, /no longer runs `verify:format-coverage`/);
    },
  );
});

// ---------------------------------------------------------------------------
// The declared tier (#2226) — skew across installs that no ONE program sees.
// ---------------------------------------------------------------------------

test("main: a DECLARED package skewed across installs fails even when no program holds both copies (#2226)", () => {
  // The exact shape the issue reported, and the client copy is deliberately
  // UNDECLARED (Copilot): only the ROOT manifest names `solo`, while
  // `clients/web` merely holds a top-level copy — the way cli's `@types/node`
  // arrives, hoisted via `@types/express` with no range of ours governing it.
  // That is what makes the candidate set a UNION across installs rather than a
  // per-install intersection, and declaring it in both manifests would let a
  // per-install implementation pass this test.
  //
  // Only the shared `core/` imports `solo`, so the client's program resolves the
  // root's copy alone and the program tier is silent — correctly. The declared
  // tier is the one that sees it, which is the whole reason it exists.
  withFixture(
    {
      rootManifestDeps: { solo: "^7.0.0" },
      webSolo: "7.0.0",
    },
    (dir) => {
      const { status, out } = runGuard(dir);
      assert.equal(status, 1, out);
      assert.match(out, /1 declared dependency resolves/);
      assert.match(out, /7\.8\.9\s+\(\.\/node_modules\/solo\)/);
      assert.match(out, /7\.0\.0\s+\(clients\/web\/node_modules\/solo\)/);
      // The program tier must NOT have claimed it — its message names a program.
      assert.doesNotMatch(out, /in clients\/web\/tsconfig\.json/);
    },
  );
});

test("main: a declared package held at the same version in both installs passes and is counted", () => {
  // Same union shape as above — root-declared, client copy undeclared — so the
  // pass and the fail differ only in the version, not in how the name is found.
  withFixture(
    {
      rootManifestDeps: { solo: "^7.0.0" },
      webSolo: "7.8.9",
    },
    (dir) => {
      const { status, out } = runGuard(dir);
      assert.equal(status, 0, out);
      assert.match(out, /1 declared dependencies agree/);
    },
  );
});

test("main: the union runs the other way too — declared only by a CLIENT, held by the root", () => {
  // The mirror of the case above, and the reason `declaredPackages` unions every
  // install's manifest rather than reading the root's. `@types/react` is the
  // live shape: web and tui declare it, the root does not, and the two clients
  // disagreed. A root-manifest-only candidate set would report success here.
  withFixture(
    {
      webManifestDeps: { solo: "^7.0.0" },
      webSolo: "7.0.0",
    },
    (dir) => {
      const { status, out } = runGuard(dir);
      assert.equal(status, 1, out);
      assert.match(out, /1 declared dependency resolves/);
      assert.match(out, /7\.8\.9\s+\(\.\/node_modules\/solo\)/);
      assert.match(out, /7\.0\.0\s+\(clients\/web\/node_modules\/solo\)/);
    },
  );
});

test("main: an installed package NO manifest declares is not a declared-tier candidate", () => {
  // `outer` and `inner` sit in both installs in every fixture, but no manifest
  // names them. The declared tier's boundary is what the repo declares, so its
  // candidate count is zero here — the program tier is what covers those.
  withFixture({}, (dir) => {
    const { status, out } = runGuard(dir);
    assert.equal(status, 0, out);
    assert.match(out, /0 declared dependencies agree/);
  });
});

test("main: a declared package only ONE install holds cannot skew", () => {
  // `solo` is declared at the root and listed in the root lockfile only. One
  // holder is not an install-crossing dependency, so its version is nobody
  // else's business.
  withFixture(
    {
      rootManifestDeps: { solo: "^7.0.0" },
      webDeps: { outer: "1.2.3", inner: "4.5.6" },
    },
    (dir) => {
      const { status, out } = runGuard(dir);
      assert.equal(status, 0, out);
      assert.match(out, /0 declared dependencies agree/);
    },
  );
});
