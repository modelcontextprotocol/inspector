import { describe, it, expect, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  createPrivateDaemonDir,
  ensureDaemonDir,
  getDaemonDir,
  getDaemonLockPath,
  getDaemonSocketPath,
  getInspectorHome,
} from "../src/daemon/paths.js";
import { writeFormattedResult } from "../src/handlers/format-output.js";

describe("daemon paths", () => {
  const backup: Record<string, string | undefined> = {};

  afterEach(() => {
    for (const key of ["MCP_INSPECTOR_DAEMON_DIR", "MCP_STORAGE_DIR", "HOME"]) {
      if (key in backup) {
        if (backup[key] === undefined) delete process.env[key];
        else process.env[key] = backup[key];
        delete backup[key];
      }
    }
  });

  function setEnv(key: string, value: string | undefined) {
    backup[key] = process.env[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }

  it("prefers MCP_INSPECTOR_DAEMON_DIR over MCP_STORAGE_DIR", () => {
    const a = path.join(os.tmpdir(), "daemon-a");
    const b = path.join(os.tmpdir(), "daemon-b");
    setEnv("MCP_STORAGE_DIR", b);
    setEnv("MCP_INSPECTOR_DAEMON_DIR", a);
    expect(getDaemonDir()).toBe(path.resolve(a));
    expect(getDaemonSocketPath()).toBe(
      path.join(path.resolve(a), "daemon.sock"),
    );
    expect(getDaemonLockPath()).toBe(path.join(path.resolve(a), "daemon.lock"));
  });

  it("falls back to MCP_STORAGE_DIR then ~/.mcp-inspector", () => {
    const storage = path.join(os.tmpdir(), "daemon-storage");
    setEnv("MCP_INSPECTOR_DAEMON_DIR", undefined);
    setEnv("MCP_STORAGE_DIR", storage);
    expect(getDaemonDir()).toBe(path.resolve(storage));
    setEnv("MCP_STORAGE_DIR", undefined);
    expect(getDaemonDir()).toContain(".mcp-inspector");
  });

  it("creates the daemon directory", () => {
    const dir = path.join(os.tmpdir(), `daemon-mkdir-${Date.now()}`);
    ensureDaemonDir(dir);
    expect(fs.statSync(dir).isDirectory()).toBe(true);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("createPrivateDaemonDir nests under ~/.mcp-inspector/private", () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-home-"));
    setEnv("HOME", home);
    setEnv("MCP_INSPECTOR_DAEMON_DIR", undefined);
    setEnv("MCP_STORAGE_DIR", undefined);
    expect(getInspectorHome()).toBe(path.join(home, ".mcp-inspector"));
    const dir = createPrivateDaemonDir();
    expect(dir.startsWith(path.join(home, ".mcp-inspector", "private"))).toBe(
      true,
    );
    expect(fs.statSync(dir).isDirectory()).toBe(true);
    fs.rmSync(home, { recursive: true, force: true });
  });
});

describe("writeFormattedResult", () => {
  it("writes text and json envelopes", async () => {
    let out = "";
    const original = process.stdout.write;
    process.stdout.write = ((chunk: unknown, ...rest: unknown[]) => {
      out += String(chunk);
      const cb = rest.find((x) => typeof x === "function") as
        | (() => void)
        | undefined;
      cb?.();
      return true;
    }) as typeof process.stdout.write;
    try {
      await writeFormattedResult({ ok: 1 }, "text");
      expect(out).toContain('"ok": 1');
      out = "";
      await writeFormattedResult({ ok: 2 }, "json");
      expect(JSON.parse(out)).toEqual({ result: { ok: 2 } });
    } finally {
      process.stdout.write = original;
    }
  });
});
