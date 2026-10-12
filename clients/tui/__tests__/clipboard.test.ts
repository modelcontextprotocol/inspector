import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  OSC52_LARGE_PAYLOAD_BYTES,
  buildOsc52Sequence,
  copyViaOsc52,
  removeCopyFiles,
  toCopyText,
  writeCopyFile,
} from "../src/utils/clipboard.js";

describe("toCopyText", () => {
  it("passes strings through verbatim", () => {
    expect(toCopyText("raw value")).toBe("raw value");
  });

  it("pretty-prints anything else as JSON", () => {
    expect(toCopyText({ a: 1, b: [true] })).toBe(
      JSON.stringify({ a: 1, b: [true] }, null, 2),
    );
  });

  it("falls back to String() when JSON has no representation", () => {
    expect(toCopyText(undefined)).toBe("undefined");
  });

  it("falls back to String() when JSON.stringify throws", () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(toCopyText(cyclic)).toBe("[object Object]");
    expect(toCopyText(10n)).toBe("10");
  });
});

describe("buildOsc52Sequence", () => {
  it("frames the base64 UTF-8 payload as OSC 52 for the clipboard", () => {
    const seq = buildOsc52Sequence("héllo");
    expect(seq).toBe(
      `\u001b]52;c;${Buffer.from("héllo", "utf8").toString("base64")}\u0007`,
    );
  });
});

describe("copyViaOsc52", () => {
  it("writes the sequence to the sink and reports its size", () => {
    const written: string[] = [];
    const result = copyViaOsc52("abc", { write: (s) => written.push(s) });
    expect(written).toEqual([buildOsc52Sequence("abc")]);
    expect(result).toEqual({ chars: 3, payloadBytes: 4, large: false });
  });

  it("flags a payload over the large-payload threshold", () => {
    const text = "x".repeat(OSC52_LARGE_PAYLOAD_BYTES);
    const result = copyViaOsc52(text, { write: () => undefined });
    expect(result.large).toBe(true);
    expect(result.payloadBytes).toBeGreaterThan(OSC52_LARGE_PAYLOAD_BYTES);
  });
});

describe("writeCopyFile", () => {
  const created: string[] = [];
  afterEach(() => {
    vi.restoreAllMocks();
    for (const dir of created.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("saves the text to an owner-only file in a fresh temp directory", () => {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), "clip-test-"));
    created.push(base);
    const file = writeCopyFile("secret-token", base);
    expect(path.dirname(path.dirname(file))).toBe(base);
    expect(fs.readFileSync(file, "utf8")).toBe("secret-token");
    if (process.platform !== "win32") {
      expect(fs.statSync(file).mode & 0o777).toBe(0o600);
      expect(fs.statSync(path.dirname(file)).mode & 0o777).toBe(0o700);
    }
  });

  it("defaults to the OS temp directory", () => {
    const file = writeCopyFile("v");
    created.push(path.dirname(file));
    expect(file.startsWith(os.tmpdir())).toBe(true);
  });

  it("removes every directory it created on removeCopyFiles (#2648)", () => {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), "clip-test-"));
    created.push(base);
    const first = writeCopyFile("token-a", base);
    const second = writeCopyFile("token-b", base);
    removeCopyFiles();
    expect(fs.existsSync(path.dirname(first))).toBe(false);
    expect(fs.existsSync(path.dirname(second))).toBe(false);
    // The base directory is not ours, so it survives.
    expect(fs.existsSync(base)).toBe(true);
    // A second sweep has nothing left to remove and does not throw.
    expect(() => removeCopyFiles()).not.toThrow();
  });

  it("registers the cleanup as a single process exit listener", () => {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), "clip-test-"));
    created.push(base);
    writeCopyFile("a", base);
    writeCopyFile("b", base);
    const listeners = process
      .listeners("exit")
      .filter((l) => l === removeCopyFiles);
    expect(listeners).toHaveLength(1);
    removeCopyFiles();
  });

  it("still cleans up a directory whose file write failed", () => {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), "clip-test-"));
    created.push(base);
    vi.spyOn(fs, "writeFileSync").mockImplementationOnce(() => {
      throw new Error("disk full");
    });
    expect(() => writeCopyFile("v", base)).toThrow("disk full");
    expect(fs.readdirSync(base)).toHaveLength(1);
    removeCopyFiles();
    expect(fs.readdirSync(base)).toHaveLength(0);
  });

  it("keeps going when a directory cannot be removed", () => {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), "clip-test-"));
    created.push(base);
    const first = writeCopyFile("a", base);
    const second = writeCopyFile("b", base);
    const realRm = fs.rmSync;
    vi.spyOn(fs, "rmSync").mockImplementationOnce(() => {
      throw new Error("EBUSY");
    });
    expect(() => removeCopyFiles()).not.toThrow();
    // The first removal threw; the second still ran.
    expect(fs.existsSync(path.dirname(first))).toBe(true);
    expect(fs.existsSync(path.dirname(second))).toBe(false);
    realRm(path.dirname(first), { recursive: true, force: true });
  });
});
