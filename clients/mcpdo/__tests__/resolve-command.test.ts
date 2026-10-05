import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { resolveCommandPath } from "../src/connection/resolve-command.js";

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-conn-resolve-"));

afterAll(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

function makeExecutable(dir: string, name: string): string {
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, name);
  fs.writeFileSync(file, "#!/bin/sh\n", { mode: 0o755 });
  return file;
}

describe("resolveCommandPath", () => {
  it("resolves a bare name to the first executable on PATH", () => {
    const first = path.join(tmpRoot, "first");
    const second = path.join(tmpRoot, "second");
    const expected = makeExecutable(first, "mytool");
    makeExecutable(second, "mytool");
    const env = { PATH: [first, second].join(path.delimiter) };
    expect(resolveCommandPath("mytool", env)).toBe(expected);
  });

  it("skips PATH entries where the name is missing or not a file", () => {
    const missing = path.join(tmpRoot, "missing");
    const hasDir = path.join(tmpRoot, "has-dir");
    fs.mkdirSync(path.join(hasDir, "mytool2"), { recursive: true });
    const real = path.join(tmpRoot, "real");
    const expected = makeExecutable(real, "mytool2");
    const env = { PATH: [missing, hasDir, "", real].join(path.delimiter) };
    expect(resolveCommandPath("mytool2", env)).toBe(expected);
  });

  it("skips non-executable files", () => {
    const dir = path.join(tmpRoot, "non-exec");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "mytool3"), "", { mode: 0o644 });
    const real = path.join(tmpRoot, "exec");
    const expected = makeExecutable(real, "mytool3");
    const env = { PATH: [dir, real].join(path.delimiter) };
    expect(resolveCommandPath("mytool3", env)).toBe(expected);
  });

  it("returns commands with a path separator unchanged", () => {
    expect(resolveCommandPath("./server.js", { PATH: tmpRoot })).toBe(
      "./server.js",
    );
    expect(resolveCommandPath("/usr/bin/env", { PATH: tmpRoot })).toBe(
      "/usr/bin/env",
    );
  });

  it("returns the name unchanged when not found on PATH", () => {
    const env = { PATH: path.join(tmpRoot, "empty-dir") };
    expect(resolveCommandPath("definitely-not-a-real-tool", env)).toBe(
      "definitely-not-a-real-tool",
    );
  });

  it("handles an empty command and an unset PATH", () => {
    expect(resolveCommandPath("", { PATH: tmpRoot })).toBe("");
    expect(resolveCommandPath("mytool", {})).toBe("mytool");
  });

  it("defaults to process.env", () => {
    // `sh` exists on every POSIX PATH; on Windows this still exercises the
    // default-env branch even if the lookup misses.
    const resolved = resolveCommandPath("sh");
    if (process.platform !== "win32") {
      expect(path.isAbsolute(resolved)).toBe(true);
    } else {
      expect(typeof resolved).toBe("string");
    }
  });
});
