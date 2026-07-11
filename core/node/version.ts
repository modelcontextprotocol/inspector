/**
 * Single source of truth for the Inspector's version, read from the **root**
 * `package.json` of the published `@modelcontextprotocol/inspector` package.
 *
 * The Inspector ships as one package with one version number; the per-client
 * `package.json`s deliberately carry no `version` field, so every Node client
 * (CLI, TUI, and the web backend) resolves the version here instead of reading
 * its own manifest.
 *
 * **Node-only** — this uses `node:fs`; never import it from browser code. The
 * web *browser* cannot read the filesystem and gets its version from the
 * backend via `GET /api/config` instead.
 */

import { readFileSync } from "node:fs";
import { dirname, join, parse } from "node:path";
import { fileURLToPath } from "node:url";

/** The published root package's name — how we recognize the root manifest. */
export const ROOT_PACKAGE_NAME = "@modelcontextprotocol/inspector";

interface RootManifest {
  name?: string;
  version?: string;
}

/**
 * Resolve the Inspector version by walking up from the calling module to the
 * root `package.json` (the one named {@link ROOT_PACKAGE_NAME}, which alone
 * carries a `version`). Pass the caller's `import.meta.url`.
 *
 * This works identically in the dev tree and the published tarball: in both,
 * a client entry (`clients/<name>/{src,build}/…`) sits below the root manifest,
 * and npm always ships the root `package.json`. Client `package.json`s are
 * skipped because they have no matching `name`/`version`, so a stray manifest
 * on the way up never shadows the real root.
 *
 * @param callerUrl the calling module's `import.meta.url`
 * @returns the version string from the root `package.json`
 * @throws if no root manifest is found above the caller
 */
export function readInspectorVersion(callerUrl: string): string {
  const startDir = dirname(fileURLToPath(callerUrl));
  const { root } = parse(startDir);

  let dir = startDir;
  for (;;) {
    let manifest: RootManifest | undefined;
    try {
      manifest = JSON.parse(
        readFileSync(join(dir, "package.json"), "utf-8"),
      ) as RootManifest;
    } catch {
      // No (readable) package.json at this level — keep walking up.
    }
    if (manifest?.name === ROOT_PACKAGE_NAME && manifest.version) {
      return manifest.version;
    }
    if (dir === root) break;
    dir = dirname(dir);
  }

  throw new Error(
    `Could not locate the ${ROOT_PACKAGE_NAME} root package.json above ${startDir}`,
  );
}
