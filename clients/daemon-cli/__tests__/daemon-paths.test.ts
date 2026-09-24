import { describe, it, expect, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  assertSocketPathWithinLimit,
  assertTrustedPrivateRoot,
  createPrivateDaemonDir,
  ensureDaemonDir,
  getDaemonDir,
  getDaemonLockPath,
  getDaemonSocketPath,
} from "../src/daemon/paths.js";
import { writeFormattedResult } from "@inspector/cli/handlers/format-output.js";

describe("daemon paths", () => {
  const backup: Record<string, string | undefined> = {};

  afterEach(() => {
    for (const key of [
      "MCP_INSPECTOR_DAEMON_DIR",
      "MCP_STORAGE_DIR",
      "HOME",
      "TMPDIR",
    ]) {
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

  it("createPrivateDaemonDir nests under a short 0700 tmpdir layout", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-conn-t-"));
    setEnv("TMPDIR", tmp + path.sep);
    const dir = createPrivateDaemonDir();
    // $TMPDIR/mcp-conn-<uid>/<8-hex>; short enough that daemon.sock stays inside
    // the platform sun_path limit even for macOS /var/folders tmpdirs.
    expect(dir.startsWith(tmp)).toBe(true);
    expect(path.basename(dir)).toMatch(/^[0-9a-f]{8}$/);
    expect(path.basename(path.dirname(dir))).toMatch(/^mcp-conn-/);
    expect(fs.statSync(dir).isDirectory()).toBe(true);
    if (process.platform !== "win32") {
      expect(fs.statSync(dir).mode & 0o777).toBe(0o700);
      expect(fs.statSync(path.dirname(dir)).mode & 0o777).toBe(0o700);
    }
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("createPrivateDaemonDir refuses a symlinked mcp-conn root", () => {
    if (process.platform === "win32") return;
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-conn-sym-"));
    setEnv("TMPDIR", tmp + path.sep);
    // Another user pre-planting the predictable root as a symlink to a dir
    // they control must fail closed, not be adopted by recursive mkdir.
    const target = path.join(tmp, "attacker-controlled");
    fs.mkdirSync(target, { mode: 0o700 });
    fs.symlinkSync(target, path.join(tmp, `mcp-conn-${process.getuid!()}`));
    expect(() => createPrivateDaemonDir()).toThrow(/not a directory/);
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("assertTrustedPrivateRoot tightens a loose pre-existing root", () => {
    if (process.platform === "win32") return;
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-conn-loose-"));
    const root = path.join(tmp, "root");
    fs.mkdirSync(root, { mode: 0o755 });
    assertTrustedPrivateRoot(root);
    expect(fs.statSync(root).mode & 0o777).toBe(0o700);
    // A file in the root's place fails closed too.
    const file = path.join(tmp, "not-a-dir");
    fs.writeFileSync(file, "");
    expect(() => assertTrustedPrivateRoot(file)).toThrow(/not a directory/);
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("assertSocketPathWithinLimit rejects paths over the sun_path limit", () => {
    expect(() =>
      assertSocketPathWithinLimit("/tmp/short/daemon.sock"),
    ).not.toThrow();
    const long = "/" + "x".repeat(150) + "/daemon.sock";
    expect(() => assertSocketPathWithinLimit(long)).toThrow(
      /too long for this platform/,
    );
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
