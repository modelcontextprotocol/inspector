import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

/**
 * Regression guard for the browser bundle. `core/auth/oauth-persist.ts` is
 * imported by browser code (App.tsx -> RemoteOAuthStorage -> oauth-persist),
 * so it must stay Node-free. It previously imported `store-io.js`, which pulls
 * `node:fs` + `atomically` (-> `stubborn-fs` -> `node:process.getuid`) into the
 * browser bundle and blanked the app at runtime. The Node-only file backend
 * now lives in `core/auth/node/oauth-persist-file.ts`; the isomorphic module
 * must only import the Node-free `store-serialize` helpers.
 */

const here = dirname(fileURLToPath(import.meta.url));
const coreAuth = resolve(here, "../../../../../../core/auth");

function importSpecifiers(source: string): string[] {
  const specs: string[] = [];
  const re = /(?:import|export)[^;]*?from\s*["']([^"']+)["']/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source)) !== null) {
    specs.push(m[1]);
  }
  return specs;
}

describe("oauth-persist.ts stays browser-safe", () => {
  const source = readFileSync(resolve(coreAuth, "oauth-persist.ts"), "utf-8");
  const specs = importSpecifiers(source);

  it("does not import the Node-only store-io module", () => {
    expect(specs).not.toContain("../storage/store-io.js");
  });

  it("does not import node: builtins or atomically", () => {
    const forbidden = specs.filter(
      (s) => s.startsWith("node:") || s === "atomically",
    );
    expect(forbidden).toEqual([]);
  });

  it("gets its (de)serializers from the Node-free store-serialize module", () => {
    expect(specs).toContain("../storage/store-serialize.js");
  });
});
