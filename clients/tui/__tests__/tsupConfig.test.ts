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
import type { Options } from "tsup";
import tsupConfig, {
  INK_FORM_INCOMPLETE_HINT,
  INK_FORM_SUBMIT_BUTTON,
  fixInkFormIncompleteHint,
  inkFormLabelPatch,
} from "../tsup.config.js";

const clientDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

/**
 * `defineConfig()` is typed as a union — a single options object, an array of
 * them, or a function returning either. The TUI config is the first form, so
 * narrow to it at runtime rather than assuming: a future config that grows a
 * second build should fail loudly here instead of silently checking nothing.
 */
function singleConfig(config: typeof tsupConfig): Options {
  if (typeof config !== "object" || Array.isArray(config)) {
    throw new Error(
      "clients/tui/tsup.config.ts is expected to export one options object",
    );
  }
  return config;
}

/** The string entries of an `external` / `noExternal` list (ours are all strings but the type allows RegExp). */
function stringEntries(list: (string | RegExp)[] | undefined): string[] {
  return (list ?? []).filter((entry) => typeof entry === "string");
}

/**
 * React-rendering dependencies left external by an explicit trade-off.
 *
 * `ink` is here for its **cost**, not because its peer range makes it safe.
 * Bundling it works (verified against both consumer repros) but adds ~1.4MB —
 * react-reconciler and yoga-layout come with it — plus a `createRequire` banner
 * for the inlined CJS. The smaller tarball won.
 *
 * The exemption is only tolerable because the root manifest keeps `react` open
 * to the whole major (`^19.0.0`), which lets npm dedupe our React with whatever
 * React 19 a consumer pins — so an external `ink` resolves the same copy the
 * bundle does. The test below pins that relationship: narrowing the root range
 * silently reopens #1952 for the renderer itself.
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

/** The real `ink-form` module the label patch targets. */
const submitButtonPath = path.join(
  clientDir,
  "node_modules",
  "ink-form",
  "lib",
  "SubmitButton.js",
);

const config = singleConfig(tsupConfig);
const noExternal = stringEntries(config.noExternal);
const external = stringEntries(config.external);

describe("tui tsup config", () => {
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

  it("keeps the root react range open to the whole major, so npm can dedupe", () => {
    // This is what keeps the one exemption tolerable. `ink` is external, so it
    // resolves whatever React npm placed beside it — and npm can only place it
    // beside *ours* if our range admits the consumer's React too. Pinning the
    // root range above the major floor (say `^19.2.4`) means a consumer holding
    // React 19.0 gets a second copy: `ink` renders through theirs, the bundle
    // through ours, and the TUI dies at startup on a null dispatcher.
    //
    // So the root range must start at the same floor `ink`'s own peer does.
    const rootReact = (
      JSON.parse(
        readFileSync(path.join(clientDir, "..", "..", "package.json"), "utf8"),
      ) as { dependencies: Record<string, string> }
    ).dependencies.react;
    const inkPeerReact = readPackageJson("ink").peerDependencies?.react ?? "";

    const floor = /^>=(\d+)\.0\.0$/.exec(inkPeerReact)?.[1];
    expect(floor, `unexpected ink peer range: ${inkPeerReact}`).toBeDefined();
    expect(
      rootReact,
      `root react must be ^${floor}.0.0 so npm can dedupe with any React ${floor} a consumer pins`,
    ).toBe(`^${floor}.0.0`);
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

  it("corrects ink-form's misspelled incomplete-form hint", () => {
    // Read the real dependency, so an `ink-form` upgrade that fixes or rewords
    // the label fails here — the patch must then be removed, not left silently
    // matching nothing.
    const patched = fixInkFormIncompleteHint(
      readFileSync(submitButtonPath, "utf8"),
      submitButtonPath,
    );
    expect(patched).toContain(INK_FORM_INCOMPLETE_HINT.fixed);
    expect(patched).not.toContain(INK_FORM_INCOMPLETE_HINT.typo);
  });

  it("routes the real module through the plugin, not just the helper", async () => {
    // The helper is only reached if the plugin's onLoad filter matches. Drive
    // the plugin as esbuild would — register, then invoke — so a filter that
    // stops matching the real module's path fails here instead of no-opping
    // through a green build (the exact silence this patch exists to prevent).
    type OnLoadCallback = (args: {
      path: string;
    }) => Promise<{ contents: string }>;
    const registered: { filter: RegExp; callback: OnLoadCallback }[] = [];

    const build = {
      onLoad: (options: { filter: RegExp }, callback: OnLoadCallback) =>
        registered.push({ filter: options.filter, callback }),
    };
    // esbuild's `PluginBuild` carries far more than this patch touches, and the
    // stub above deliberately implements only the one hook it registers — so
    // the double cast is bridging a real structural gap, not hiding a mismatch.
    // A hook the patch called but the stub lacks fails as undefined here rather
    // than passing silently.
    // esbuild types `setup` as `void | Promise<void>`; await it so the
    // assertions below can't run before an async setup has registered.
    await inkFormLabelPatch.setup(
      build as unknown as Parameters<typeof inkFormLabelPatch.setup>[0],
    );

    expect(registered).toHaveLength(1);
    const [{ filter, callback }] = registered;
    expect(filter.test(submitButtonPath)).toBe(true);

    const { contents } = await callback({ path: submitButtonPath });
    expect(contents).toContain(INK_FORM_INCOMPLETE_HINT.fixed);
    expect(contents).not.toContain(INK_FORM_INCOMPLETE_HINT.typo);
  });

  it("scopes the patch to ink-form's SubmitButton and nothing else", () => {
    expect(INK_FORM_SUBMIT_BUTTON.test(submitButtonPath)).toBe(true);
    // A Windows-style path must match too — the filter runs against whatever
    // esbuild resolved, and its separator is the platform's.
    expect(
      INK_FORM_SUBMIT_BUTTON.test(
        "C:\\repo\\node_modules\\ink-form\\lib\\SubmitButton.js",
      ),
    ).toBe(true);
    for (const other of [
      "/repo/node_modules/ink-form/lib/Form.js",
      "/repo/node_modules/ink-select-input/build/SubmitButton.js",
      "/repo/src/SubmitButton.jsx",
    ]) {
      expect(INK_FORM_SUBMIT_BUTTON.test(other), other).toBe(false);
    }
  });

  it("fails loudly rather than silently skipping a label it cannot find", () => {
    expect(() =>
      fixInkFormIncompleteHint("no such label here", "SubmitButton.js"),
    ).toThrow(/no longer contains the ink-form label/);
  });

  it("only rewrites the misspelling", () => {
    // The two strings must differ by exactly the fix, or the patch is silently
    // changing copy nobody reviewed.
    expect(INK_FORM_INCOMPLETE_HINT.fixed).toBe(
      INK_FORM_INCOMPLETE_HINT.typo.replace("competed", "completed"),
    );
  });

  it("verifies the deps it exempts are still declared", () => {
    // If `ink` ever leaves the dependency list, the exemption above is stale
    // and would silently excuse a future package that took its name.
    for (const name of EXTERNAL_BY_DESIGN) {
      expect(reactRenderingDependencies()).toContain(name);
    }
  });
});
