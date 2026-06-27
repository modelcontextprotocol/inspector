/**
 * Tests for shared storage path resolution and atomic file I/O (store-io.ts).
 * Node-only fs code -> lives in the integration project (node env).
 */

import { describe, it, expect, afterEach, beforeEach } from "vitest";
import {
  mkdtempSync,
  rmSync,
  existsSync,
  readFileSync,
  writeFileSync,
  chmodSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  getDefaultStorageDir,
  getDefaultMcpConfigPath,
  getStoreFilePath,
  readStoreFile,
  writeStoreFile,
  flushStoreFileWrites,
  deleteStoreFile,
  serializeStore,
  parseStore,
} from "@inspector/core/storage/store-io.js";

describe("store-io", () => {
  describe("getDefaultStorageDir / getDefaultMcpConfigPath", () => {
    const savedHome = process.env.HOME;
    const savedUserProfile = process.env.USERPROFILE;

    afterEach(() => {
      if (savedHome === undefined) delete process.env.HOME;
      else process.env.HOME = savedHome;
      if (savedUserProfile === undefined) delete process.env.USERPROFILE;
      else process.env.USERPROFILE = savedUserProfile;
    });

    it("uses HOME when set", () => {
      process.env.HOME = "/home/alice";
      delete process.env.USERPROFILE;
      expect(getDefaultStorageDir()).toBe(
        join("/home/alice", ".mcp-inspector", "storage"),
      );
      expect(getDefaultMcpConfigPath()).toBe(
        join("/home/alice", ".mcp-inspector", "mcp.json"),
      );
    });

    it("falls back to USERPROFILE when HOME is unset (Windows)", () => {
      delete process.env.HOME;
      process.env.USERPROFILE = "C:\\Users\\bob";
      expect(getDefaultStorageDir()).toBe(
        join("C:\\Users\\bob", ".mcp-inspector", "storage"),
      );
      expect(getDefaultMcpConfigPath()).toBe(
        join("C:\\Users\\bob", ".mcp-inspector", "mcp.json"),
      );
    });

    it('falls back to "." when neither HOME nor USERPROFILE is set', () => {
      delete process.env.HOME;
      delete process.env.USERPROFILE;
      expect(getDefaultStorageDir()).toBe(
        join(".", ".mcp-inspector", "storage"),
      );
      expect(getDefaultMcpConfigPath()).toBe(
        join(".", ".mcp-inspector", "mcp.json"),
      );
    });
  });

  describe("getStoreFilePath", () => {
    it("joins the storage dir with the store id and .json", () => {
      expect(getStoreFilePath("/dir", "myStore")).toBe(
        join("/dir", "myStore.json"),
      );
    });
  });

  describe("readStoreFile", () => {
    let tempDir: string | null = null;

    afterEach(() => {
      if (tempDir) {
        try {
          rmSync(tempDir, { recursive: true });
        } catch {
          // Ignore cleanup errors
        }
        tempDir = null;
      }
    });

    it("returns the file contents when the file exists", async () => {
      tempDir = mkdtempSync(join(tmpdir(), "inspector-readstore-"));
      const filePath = join(tempDir, "store.json");
      writeFileSync(filePath, '{"a":1}', "utf-8");
      expect(await readStoreFile(filePath)).toBe('{"a":1}');
    });

    it("returns null when the file does not exist (ENOENT)", async () => {
      tempDir = mkdtempSync(join(tmpdir(), "inspector-readstore-"));
      const filePath = join(tempDir, "missing.json");
      expect(await readStoreFile(filePath)).toBeNull();
    });

    it("throws on a non-ENOENT read error (e.g. reading a directory)", async () => {
      tempDir = mkdtempSync(join(tmpdir(), "inspector-readstore-"));
      // Reading a directory as a file yields EISDIR, not ENOENT.
      await expect(readStoreFile(tempDir)).rejects.toThrow();
    });
  });

  describe("writeStoreFile / flushStoreFileWrites", () => {
    let tempDir: string | null = null;

    beforeEach(() => {
      tempDir = mkdtempSync(join(tmpdir(), "inspector-writestore-"));
    });

    afterEach(() => {
      if (tempDir) {
        try {
          rmSync(tempDir, { recursive: true });
        } catch {
          // Ignore cleanup errors
        }
        tempDir = null;
      }
    });

    it("writes data atomically and creates parent directories", async () => {
      const filePath = join(tempDir!, "nested", "deep", "store.json");
      await writeStoreFile(filePath, '{"hi":1}');
      expect(existsSync(filePath)).toBe(true);
      expect(readFileSync(filePath, "utf-8")).toBe('{"hi":1}');
    });

    it("chains concurrent writes to the same path (last write wins)", async () => {
      const filePath = join(tempDir!, "store.json");
      const a = writeStoreFile(filePath, '{"v":1}');
      const b = writeStoreFile(filePath, '{"v":2}');
      await Promise.all([a, b]);
      await flushStoreFileWrites(filePath);
      expect(JSON.parse(readFileSync(filePath, "utf-8"))).toEqual({ v: 2 });
    });

    it("flushStoreFileWrites(path) awaits a specific in-flight write", async () => {
      const filePath = join(tempDir!, "store.json");
      const write = writeStoreFile(filePath, '{"flush":true}');
      await flushStoreFileWrites(filePath);
      expect(existsSync(filePath)).toBe(true);
      await write;
    });

    it("flushStoreFileWrites() awaits all in-flight writes", async () => {
      const a = join(tempDir!, "a.json");
      const b = join(tempDir!, "b.json");
      const writes = Promise.all([
        writeStoreFile(a, '{"n":1}'),
        writeStoreFile(b, '{"n":2}'),
      ]);
      await flushStoreFileWrites();
      expect(existsSync(a)).toBe(true);
      expect(existsSync(b)).toBe(true);
      await writes;
    });

    it("resolves immediately when nothing is in flight", async () => {
      await expect(flushStoreFileWrites()).resolves.toBeUndefined();
      await expect(
        flushStoreFileWrites(join(tempDir!, "none.json")),
      ).resolves.toBeUndefined();
    });

    it("swallows a prior write's rejection so a chained write still runs (.catch branch)", async () => {
      // First write targets a path under a *file* (not a dir), so mkdir fails
      // and the write rejects. The second write to the same resolved key is
      // chained via `(prior ?? Promise.resolve()).catch(() => {})`, so the
      // rejection is swallowed and the second write proceeds.
      const blocker = join(tempDir!, "blocker");
      writeFileSync(blocker, "x", "utf-8");
      const badPath = join(blocker, "store.json"); // parent is a file -> ENOTDIR

      const first = writeStoreFile(badPath, '{"v":1}');
      await expect(first).rejects.toThrow();

      // A second write to the same key after the first settled still works once
      // the blocker is removed.
      rmSync(blocker);
      const second = writeStoreFile(badPath, '{"v":2}');
      await expect(second).resolves.toBeUndefined();
      expect(JSON.parse(readFileSync(badPath, "utf-8"))).toEqual({ v: 2 });
    });

    it("a chained write swallows the prior in-flight write's rejection", async () => {
      // Queue two writes to the same key while the first is still in flight and
      // destined to reject (parent is a file). The second's `.catch(() => {})`
      // on the chained prior promise must absorb the rejection.
      const blocker = join(tempDir!, "blocker2");
      writeFileSync(blocker, "x", "utf-8");
      const badPath = join(blocker, "store.json");

      const first = writeStoreFile(badPath, '{"v":1}');
      const second = writeStoreFile(badPath, '{"v":2}');
      await expect(first).rejects.toThrow();
      // Second also rejects (blocker still present) but does NOT reject with the
      // first's error unhandled — the chain swallowed it.
      await expect(second).rejects.toThrow();
    });

    it("leaves a newer write's entry in place when an earlier write settles (finally branch)", async () => {
      const filePath = join(tempDir!, "store.json");
      // Two overlapping writes share a key. When the first settles, its
      // finally must NOT delete the map entry, because the second write
      // replaced it. Awaiting the second then flushing exercises both the
      // "replaced" finally branch (first) and the "delete" branch (second).
      const first = writeStoreFile(filePath, '{"order":1}');
      const second = writeStoreFile(filePath, '{"order":2}');
      await first;
      await second;
      // After the last write settles, the pending entry is cleaned up so a
      // subsequent flush is a no-op.
      await expect(flushStoreFileWrites(filePath)).resolves.toBeUndefined();
      expect(JSON.parse(readFileSync(filePath, "utf-8"))).toEqual({ order: 2 });
    });
  });

  describe("deleteStoreFile", () => {
    let tempDir: string | null = null;

    afterEach(() => {
      if (tempDir) {
        try {
          chmodSync(tempDir, 0o700);
          rmSync(tempDir, { recursive: true });
        } catch {
          // Ignore cleanup errors
        }
        tempDir = null;
      }
    });

    it("deletes an existing file", async () => {
      tempDir = mkdtempSync(join(tmpdir(), "inspector-delete-"));
      const filePath = join(tempDir, "store.json");
      writeFileSync(filePath, "{}", "utf-8");
      expect(existsSync(filePath)).toBe(true);
      await deleteStoreFile(filePath);
      expect(existsSync(filePath)).toBe(false);
    });

    it("ignores ENOENT when the file is already gone", async () => {
      tempDir = mkdtempSync(join(tmpdir(), "inspector-delete-"));
      const filePath = join(tempDir, "missing.json");
      await expect(deleteStoreFile(filePath)).resolves.toBeUndefined();
    });

    it("rethrows a non-ENOENT error (e.g. unlinking a directory)", async () => {
      tempDir = mkdtempSync(join(tmpdir(), "inspector-delete-"));
      // Unlinking a directory yields EPERM/EISDIR, not ENOENT.
      const dirPath = join(tempDir, "subdir");
      writeFileSync(join(tempDir, "keep"), "x");
      const { mkdirSync } = await import("node:fs");
      mkdirSync(dirPath);
      await expect(deleteStoreFile(dirPath)).rejects.toThrow();
    });
  });

  describe("serializeStore / parseStore", () => {
    it("serializes to pretty-printed JSON", () => {
      expect(serializeStore({ a: 1, b: [2, 3] })).toBe(
        '{\n  "a": 1,\n  "b": [\n    2,\n    3\n  ]\n}',
      );
    });

    it("parses a JSON string round-trip", () => {
      const obj = { x: "y", n: 42 };
      expect(parseStore(serializeStore(obj))).toEqual(obj);
    });
  });
});
