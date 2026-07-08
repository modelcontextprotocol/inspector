import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

/**
 * Regression guard for the browser bundle. The browser's `RemoteOAuthStorage`
 * (App.tsx -> lib/remoteOAuthStorage.ts -> remote/storage-remote.ts) chains
 * through a handful of `core/auth` + `core/storage` modules, so ALL of them
 * must stay Node-free. `oauth-persist.ts` previously value-imported
 * `store-io.js`, which pulls `node:fs` + `atomically` (-> `stubborn-fs` ->
 * `node:process.getuid`) into the browser bundle and blanked the app at
 * runtime. The Node-only file backend now lives in
 * `core/auth/node/oauth-persist-file.ts`.
 *
 * This guard is transitive: it scans every module reachable from
 * `storage-remote.ts` (short of the `node/` boundary), so a forbidden import
 * added one hop away — e.g. through `store-serialize.ts` or `store.ts` — is
 * caught too, not just a direct import in `oauth-persist.ts`.
 */

const here = dirname(fileURLToPath(import.meta.url));
const coreDir = resolve(here, "../../../../../../core");

// Browser-reachable modules (value-import graph from storage-remote.ts,
// excluding the intentional `node/` backend which is never bundled).
const BROWSER_REACHABLE = [
  "auth/remote/storage-remote.ts",
  "auth/oauth-storage.ts",
  "auth/store.ts",
  "auth/oauth-persist.ts",
  "storage/store-serialize.ts",
];

const FORBIDDEN = [/(^|\/)store-io(\.js)?$/, /^node:/, /^atomically$/];

function importSpecifiers(source: string): string[] {
  const specs: string[] = [];
  const re = /(?:import|export)[^;]*?from\s*["']([^"']+)["']/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source)) !== null) {
    specs.push(m[1]);
  }
  return specs;
}

describe("browser-reachable OAuth storage modules stay Node-free", () => {
  it.each(BROWSER_REACHABLE)(
    "%s imports no Node built-ins, atomically, or store-io",
    (relPath) => {
      const source = readFileSync(resolve(coreDir, relPath), "utf-8");
      const offenders = importSpecifiers(source).filter((spec) =>
        FORBIDDEN.some((re) => re.test(spec)),
      );
      expect(offenders).toEqual([]);
    },
  );

  it("oauth-persist.ts sources its (de)serializers from store-serialize", () => {
    const source = readFileSync(
      resolve(coreDir, "auth/oauth-persist.ts"),
      "utf-8",
    );
    expect(importSpecifiers(source)).toContain("../storage/store-serialize.js");
  });
});
