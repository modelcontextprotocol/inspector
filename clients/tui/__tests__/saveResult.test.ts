import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  defaultResultFileName,
  saveResultToFile,
} from "../src/utils/saveResult.js";

const TEXT = { content: [{ type: "text", text: "hi" }] };
const IMAGE = {
  content: [{ type: "image", data: btoa("\x01\x02"), mimeType: "image/png" }],
};
const LINK_ONLY = { content: [{ type: "resource_link", uri: "x://a" }] };

describe("defaultResultFileName (#2571)", () => {
  it("is <tool>-result.json for json", () => {
    expect(defaultResultFileName("alpha", "json", TEXT)).toBe(
      "alpha-result.json",
    );
  });

  it("picks .txt or .bin for raw by what the result renders as", () => {
    expect(defaultResultFileName("alpha", "raw", TEXT)).toBe(
      "alpha-result.txt",
    );
    expect(defaultResultFileName("alpha", "raw", IMAGE)).toBe(
      "alpha-result.bin",
    );
    expect(defaultResultFileName("alpha", "raw", LINK_ONLY)).toBe(
      "alpha-result.txt",
    );
  });

  it("makes the tool name safe as a bare file name", () => {
    expect(defaultResultFileName("fs/read file", "json", TEXT)).toBe(
      "fs_read_file-result.json",
    );
    expect(defaultResultFileName("", "json", TEXT)).toBe("tool-result.json");
  });
});

describe("saveResultToFile (#2571)", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "tui-save-util-"));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("writes json relative to cwd and reports the absolute path and size", async () => {
    const saved = await saveResultToFile(TEXT, " out.json ", "json", dir);
    const expected = JSON.stringify(TEXT, null, 2) + "\n";
    expect(saved).toEqual({
      path: join(dir, "out.json"),
      format: "json",
      bytes: expected.length,
    });
    expect(readFileSync(join(dir, "out.json"), "utf8")).toBe(expected);
  });

  it("writes decoded bytes for a single binary block as raw", async () => {
    const saved = await saveResultToFile(IMAGE, "img.bin", "raw", dir);
    expect(saved.bytes).toBe(2);
    expect([...readFileSync(join(dir, "img.bin"))]).toEqual([1, 2]);
  });

  it("defaults cwd to the process working directory", async () => {
    const target = join(dir, "abs.json");
    const saved = await saveResultToFile(TEXT, target, "json");
    expect(saved.path).toBe(target);
  });

  it("refuses an empty path", async () => {
    await expect(saveResultToFile(TEXT, "  ", "json", dir)).rejects.toThrow(
      "Enter a file path to save to.",
    );
  });

  it("explains a result with no raw form and points at json", async () => {
    await expect(
      saveResultToFile(LINK_ONLY, "x.txt", "raw", dir),
    ).rejects.toThrow(
      /no text or binary content.*as json instead \(w, then Enter\)/,
    );
  });

  it("reports a failed write with the resolved path", async () => {
    await expect(
      saveResultToFile(TEXT, "missing/x.json", "json", dir),
    ).rejects.toThrow(`Could not write ${join(dir, "missing/x.json")}:`);
  });
});
