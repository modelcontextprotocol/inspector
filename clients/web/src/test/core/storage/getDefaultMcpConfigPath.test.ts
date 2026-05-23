import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { join } from "node:path";
import {
  getDefaultMcpConfigPath,
  getDefaultStorageDir,
} from "@inspector/core/storage/store-io.js";

describe("getDefaultMcpConfigPath", () => {
  const origHome = process.env.HOME;
  const origProfile = process.env.USERPROFILE;

  beforeEach(() => {
    delete process.env.HOME;
    delete process.env.USERPROFILE;
  });

  afterEach(() => {
    if (origHome === undefined) delete process.env.HOME;
    else process.env.HOME = origHome;
    if (origProfile === undefined) delete process.env.USERPROFILE;
    else process.env.USERPROFILE = origProfile;
  });

  it("prefers HOME when set", () => {
    process.env.HOME = "/home/example";
    expect(getDefaultMcpConfigPath()).toBe(
      join("/home/example", ".mcp-inspector", "mcp.json"),
    );
  });

  it("falls back to USERPROFILE when HOME is unset (Windows)", () => {
    process.env.USERPROFILE = "C:\\Users\\example";
    expect(getDefaultMcpConfigPath()).toBe(
      join("C:\\Users\\example", ".mcp-inspector", "mcp.json"),
    );
  });

  it("falls back to '.' when neither env var is set", () => {
    expect(getDefaultMcpConfigPath()).toBe(
      join(".", ".mcp-inspector", "mcp.json"),
    );
  });

  it("co-locates with getDefaultStorageDir under the same parent", () => {
    process.env.HOME = "/home/example";
    const cfg = getDefaultMcpConfigPath();
    const storage = getDefaultStorageDir();
    // mcp.json sits one level above the storage/ subdir
    expect(cfg).toBe(join("/home/example", ".mcp-inspector", "mcp.json"));
    expect(storage).toBe(join("/home/example", ".mcp-inspector", "storage"));
  });
});
