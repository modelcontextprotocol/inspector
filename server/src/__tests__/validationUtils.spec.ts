import { describe, it, expect } from "@jest/globals";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { validateWorkingDirectoryAbsolute } from "../validationUtils.js";

describe("validateWorkingDirectoryAbsolute", () => {
  it("returns error for missing path", async () => {
    const res = await validateWorkingDirectoryAbsolute("");
    expect(res.valid).toBe(false);
    expect(res.error).toBe("Missing path");
  });

  it("returns error for non-absolute path", async () => {
    const res = await validateWorkingDirectoryAbsolute("./rel");
    expect(res.valid).toBe(false);
    expect(res.error).toBe("Path must be absolute");
  });

  it("returns valid for existing readable directory", async () => {
    const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "mcpv-"));
    try {
      const res = await validateWorkingDirectoryAbsolute(dir);
      expect(res.valid).toBe(true);
      expect(res.error).toBeUndefined();
    } finally {
      await fs.promises.rm(dir, { recursive: true, force: true });
    }
  });

  it("returns error when path does not exist", async () => {
    const nonExistent = path.join(os.tmpdir(), `nope-${Date.now()}`);
    const res = await validateWorkingDirectoryAbsolute(nonExistent);
    expect(res.valid).toBe(false);
    expect(res.error).toContain("Directory does not exist");
  });

  it("returns error when path is a file", async () => {
    const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "mcpf-"));
    const file = path.join(dir, "f.txt");
    await fs.promises.writeFile(file, "x");
    try {
      const res = await validateWorkingDirectoryAbsolute(file);
      expect(res.valid).toBe(false);
      expect(res.error).toBe("Not a directory");
    } finally {
      await fs.promises.rm(dir, { recursive: true, force: true });
    }
  });
});
