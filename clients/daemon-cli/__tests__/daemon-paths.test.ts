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

  it("tightens a pre-existing loose daemon directory to 0700 and rejects symlinks", () => {
    // mkdirSync never re-modes an existing dir; ~/.mcp-inspector commonly
    // pre-exists at 0755, so ensureDaemonDir must tighten it itself.
    const base = fs.mkdtempSync(path.join(os.tmpdir(), "daemon-tighten-"));
    const loose = path.join(base, "loose");
    fs.mkdirSync(loose, { mode: 0o755 });
    fs.chmodSync(loose, 0o755);
    ensureDaemonDir(loose);
    expect(fs.statSync(loose).mode & 0o077).toBe(0);

    const target = path.join(base, "target");
    fs.mkdirSync(target, { mode: 0o700 });
    const link = path.join(base, "link");
    fs.symlinkSync(target, link);
    expect(() => ensureDaemonDir(link)).toThrow(/not a directory/);
    fs.rmSync(base, { recursive: true, force: true });
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

  it("uses a deterministic named-pipe path on Windows with no sun_path limit", () => {
    const realPlatform = Object.getOwnPropertyDescriptor(
      process,
      "platform",
    ) as PropertyDescriptor;
    Object.defineProperty(process, "platform", { value: "win32" });
    try {
      const pipe = getDaemonSocketPath("/some/daemon/dir");
      expect(pipe).toMatch(/^\\\\\.\\pipe\\mcp-conn-[0-9a-f]{16}$/);
      // Same dir (any casing) -> same pipe; different dir -> different pipe.
      expect(getDaemonSocketPath("/SOME/DAEMON/DIR")).toBe(pipe);
      expect(getDaemonSocketPath("/other/daemon/dir")).not.toBe(pipe);
      // Pipe names are not sun_path-constrained.
      const long = "\\\\.\\pipe\\" + "x".repeat(300);
      expect(() => assertSocketPathWithinLimit(long)).not.toThrow();
    } finally {
      Object.defineProperty(process, "platform", realPlatform);
    }
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
