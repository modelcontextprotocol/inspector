import { describe, it, expect } from "vitest";
import {
  mkdtempSync,
  mkdirSync,
  rmSync,
  writeFileSync,
  readFileSync,
} from "fs";
import { tmpdir } from "os";
import { join, dirname } from "path";
import { pathToFileURL, fileURLToPath } from "url";
import {
  readInspectorVersion,
  ROOT_PACKAGE_NAME,
} from "@inspector/core/node/version.js";

/** Absolute path to the repo root package.json (three levels above core/node). */
const rootPackageJsonPath = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
  "..",
  "..",
  "..",
  "package.json",
);

function readRootVersion(): string {
  return (
    JSON.parse(readFileSync(rootPackageJsonPath, "utf-8")) as {
      version: string;
    }
  ).version;
}

describe("readInspectorVersion", () => {
  it("resolves the version from the root package.json for a caller inside the repo", () => {
    // This test file lives below the root manifest; walking up from it passes
    // clients/web/package.json (wrong name → skipped) and several levels with no
    // package.json (the catch branch) before reaching the root.
    expect(readInspectorVersion(import.meta.url)).toBe(readRootVersion());
    // Sanity: the root manifest really is the one we match on.
    expect(ROOT_PACKAGE_NAME).toBe("@modelcontextprotocol/inspector");
  });

  it("skips a matching-name manifest that has no version, then throws when no versioned root exists above the caller", () => {
    // A fake root manifest with the right name but NO version must not satisfy
    // the search — the walk keeps going up. Rooted in the OS temp dir (outside
    // the repo), so the walk reaches the filesystem root without finding a
    // versioned inspector manifest and throws.
    const work = mkdtempSync(join(tmpdir(), "version-test-"));
    try {
      writeFileSync(
        join(work, "package.json"),
        JSON.stringify({ name: ROOT_PACKAGE_NAME }),
      );
      const sub = join(work, "sub");
      mkdirSync(sub);
      const callerUrl = pathToFileURL(join(sub, "caller.js")).href;

      expect(() => readInspectorVersion(callerUrl)).toThrow(
        /Could not locate the @modelcontextprotocol\/inspector root package\.json/,
      );
    } finally {
      rmSync(work, { recursive: true, force: true });
    }
  });
});
