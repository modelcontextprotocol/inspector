import { describe, it, expect } from "vitest";
import {
  isBenignWarning,
  BENIGN_PAIRS,
} from "../../../server/quiet-config-warnings.mjs";

// A representative Rolldown config-load warning block (header + code frame), as
// captured from `vite dev` startup.
function warning(dep: string, file: string): string {
  return (
    `${file} (8:36) [UNRESOLVED_IMPORT] Warning: Could not resolve ${dep} in ${file}\n` +
    `   ╭─[ ${file}:8:37 ]\n` +
    ` 8 │ import { readFile } from ${dep};\n` +
    `   ╰─ Module not found, treating it as an external dependency\n`
  );
}

describe("quiet-config-warnings / isBenignWarning", () => {
  it("matches each benign node-only dep warning", () => {
    for (const [dep, file] of BENIGN_PAIRS) {
      expect(isBenignWarning(warning(dep, file))).toBe(true);
    }
  });

  it("ignores non-UNRESOLVED output", () => {
    expect(isBenignWarning("VITE v8.0.0  ready in 603 ms")).toBe(false);
    expect(
      isBenignWarning("Sandbox (MCP Apps): http://localhost:61146/sandbox"),
    ).toBe(false);
  });

  it("does not drop an UNRESOLVED_IMPORT for a different (real) dependency", () => {
    expect(
      isBenignWarning(
        "src/App.tsx (1:0) [UNRESOLVED_IMPORT] Warning: Could not resolve 'some-real-pkg' in src/App.tsx",
      ),
    ).toBe(false);
  });

  it("requires the matching source path, not just the package name", () => {
    // Same dep, but in an unrelated file → not silenced (guards over-matching).
    expect(
      isBenignWarning(
        "src/elsewhere.ts (1:0) [UNRESOLVED_IMPORT] Warning: Could not resolve 'chokidar' in src/elsewhere.ts",
      ),
    ).toBe(false);
  });

  it("uses repo-relative path fragments (not bare basenames)", () => {
    for (const [, file] of BENIGN_PAIRS) {
      expect(file).toContain("/");
    }
  });
});
