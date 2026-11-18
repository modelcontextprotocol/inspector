/**
 * Bundling invariant for the TUI's React-rendering dependencies (#1952).
 *
 * The published TUI is a single ESM bundle whose bare `import "react"` resolves
 * from `clients/tui/build/`. Any package left *external* resolves its own
 * `react` from wherever npm placed **it** instead — and npm places a package
 * next to a version satisfying its declared peer range. `ink-form` and
 * `ink-scroll-view` accept `react: ">=18"`, so a consumer project holding React
 * 18 satisfies them, they hoist to that project's root, and the Inspector's
 * React 19 nests beneath it. Two React copies later, the first hook either of
 * them calls reads a null dispatcher and the TUI dies with
 * "Cannot read properties of null (reading 'useState')" — the moment a tool
 * test form or a scroll view mounts.
 *
 * Inlining them removes npm from the decision entirely: their `import "react"`
 * is emitted into the bundle, so it resolves exactly where the bundle's does.
 *
 * This test is the durable guard, because the failure is invisible in the repo
 * (a dev install has one React) and in every smoke (same) — it only appears
 * once the package is installed *under* another project that renders React.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { DepsConfig, UserConfig, UserConfigExport } from "tsdown";
import tsdownConfig from "../tsdown.config.js";

const clientDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

/**
 * tsdown's config export is a union — a single options object, an array of
 * them, a function returning either, or a promise of any of those. The TUI
 * config is the first form, so narrow to it at runtime rather than assuming: a
 * future config that grows a second build should fail loudly here instead of
 * silently checking nothing.
 */
function singleConfig(config: UserConfigExport): UserConfig {
  if (
    typeof config !== "object" ||
    Array.isArray(config) ||
    config instanceof Promise
  ) {
    throw new Error(
      "clients/tui/tsdown.config.ts is expected to export one options object",
    );
  }
  return config;
}

/**
 * The string entries of a `deps.alwaysBundle` / `deps.neverBundle` option.
 * Both also accept a lone entry, and `neverBundle` a function or `true`; a
 * function or `true` has no names to read, so it fails loudly rather than
 * letting every assertion below pass against an empty list.
 */
function stringEntries(
  list: DepsConfig["alwaysBundle"] | DepsConfig["neverBundle"],
): string[] {
  if (typeof list === "function" || typeof list === "boolean") {
    throw new Error(
      "clients/tui/tsdown.config.ts deps lists are expected to be literal arrays",
    );
  }
  const entries = list === undefined ? [] : Array.isArray(list) ? list : [list];
  return entries.filter((entry) => typeof entry === "string");
}

/**
 * React-rendering dependencies left external by an explicit trade-off.
 *
 * `ink` is here for its **cost**, not because its peer range makes it safe.
 * Bundling it works (verified against both consumer repros) but adds ~1.4MB —
 * react-reconciler and yoga-layout come with it — plus a `createRequire` banner
 * for the inlined CJS. The smaller tarball won.
 *
 * The exemption is only tolerable because the root manifest's `react` range
 * starts at the floor of `ink`'s own peer range and stays open to the rest of
 * the major (`^19.3.0` against Ink 8's `>=19.3.0`), so any React 19 that npm
 * may place `ink` beside is one our range admits too — an external `ink`
 * resolves the same copy the bundle does. The test below pins that
 * relationship: a root range that starts anywhere else silently reopens #1952
 * for the renderer itself.
 */
const EXTERNAL_BY_DESIGN = new Set(["ink"]);

function readPackageJson(name: string): {
  peerDependencies?: Record<string, string>;
} {
  // Resolve through the client's own node_modules rather than `require.resolve`
  // on the package name: several of these packages export only their entry
  // point, so `<name>/package.json` is not a resolvable subpath.
  const manifest = path.join(clientDir, "node_modules", name, "package.json");
  return JSON.parse(readFileSync(manifest, "utf8"));
}

/** Dependencies that declare a `react` peer — i.e. that render React themselves. */
function reactRenderingDependencies(): string[] {
  const { dependencies } = JSON.parse(
    readFileSync(path.join(clientDir, "package.json"), "utf8"),
  ) as { dependencies: Record<string, string> };

  return Object.keys(dependencies).filter(
    (name) => readPackageJson(name).peerDependencies?.react !== undefined,
  );
}

const config = singleConfig(tsdownConfig);
const noExternal = stringEntries(config.deps?.alwaysBundle);
const external = stringEntries(config.deps?.neverBundle);

describe("tui tsdown config", () => {
  it("finds the React-rendering dependencies to check", () => {
    // A guard on the guard: if this resolves to nothing (a rename, a moved
    // node_modules), every assertion below would pass vacuously.
    expect(reactRenderingDependencies().length).toBeGreaterThan(0);
  });

  it("bundles every React-rendering dependency that is not exempt", () => {
    const shouldInline = reactRenderingDependencies().filter(
      (name) => !EXTERNAL_BY_DESIGN.has(name),
    );

    expect(shouldInline.length).toBeGreaterThan(0);
    for (const name of shouldInline) {
      expect(
        noExternal,
        `${name} renders React, so it must be bundled`,
      ).toContain(name);
      expect(external, `${name} must not be external`).not.toContain(name);
    }
  });

  it("starts the root react range at ink's peer floor, so npm can dedupe", () => {
    // This is what keeps the one exemption tolerable. `ink` is external, so it
    // resolves whatever React npm placed beside it — and npm can only place it
    // beside *ours* if our range admits every React `ink`'s peer does. A root
    // range starting ABOVE that floor means a consumer holding a React in the
    // gap gets a second copy: `ink` renders through theirs, the bundle through
    // ours, and the TUI dies at startup on a null dispatcher. One starting
    // BELOW it lets our React dedupe to a consumer's older copy that `ink`
    // cannot use, so `ink` is the one that nests — the same split, mirrored.
    //
    // So the root range must start at the same floor `ink`'s own peer does.
    // Ink 6 declared `>=19.0.0`; Ink 8 declares `>=19.3.0` (#2984).
    const rootReact = (
      JSON.parse(
        readFileSync(path.join(clientDir, "..", "..", "package.json"), "utf8"),
      ) as { dependencies: Record<string, string> }
    ).dependencies.react;
    const inkPeerReact = readPackageJson("ink").peerDependencies?.react ?? "";

    const floor = /^>=(\d+\.\d+\.\d+)$/.exec(inkPeerReact)?.[1];
    expect(floor, `unexpected ink peer range: ${inkPeerReact}`).toBeDefined();
    expect(
      rootReact,
      `root react must be ^${floor} so npm can dedupe with any React a consumer pins that ink accepts`,
    ).toBe(`^${floor}`);
  });

  it("keeps each exempt package external, and declared for consumers", () => {
    // An external package is not shipped in the bundle, so the root manifest
    // has to install it — the mirror image of the inlined ones, which must NOT
    // be root dependencies. Getting this backwards breaks the published TUI at
    // startup with an unresolved import.
    const rootDependencies = JSON.parse(
      readFileSync(path.join(clientDir, "..", "..", "package.json"), "utf8"),
    ) as { dependencies: Record<string, string> };

    for (const name of EXTERNAL_BY_DESIGN) {
      expect(external, `${name} is external by design`).toContain(name);
      expect(
        Object.keys(rootDependencies.dependencies),
        `${name} is external, so consumers must install it`,
      ).toContain(name);
    }
  });

  it("keeps react itself external, as the single shared instance", () => {
    expect(external).toContain("react");
    expect(noExternal).not.toContain("react");
  });

  it("verifies the deps it exempts are still declared", () => {
    // If `ink` ever leaves the dependency list, the exemption above is stale
    // and would silently excuse a future package that took its name.
    for (const name of EXTERNAL_BY_DESIGN) {
      expect(reactRenderingDependencies()).toContain(name);
    }
  });
});
