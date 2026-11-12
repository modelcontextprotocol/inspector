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
import { writeFormattedResult } from "@inspector/core/cli/handlers/format-output.js";
import { isWindows } from "./helpers/platform.js";

/** Run `fn` with `process.platform` reporting `platform`. */
function withPlatform<T>(platform: NodeJS.Platform, fn: () => T): T {
  const real = Object.getOwnPropertyDescriptor(
    process,
    "platform",
  ) as PropertyDescriptor;
  Object.defineProperty(process, "platform", { value: platform });
  try {
    return fn();
  } finally {
    Object.defineProperty(process, "platform", real);
  }
}

describe("daemon paths", () => {
  const backup: Record<string, string | undefined> = {};

  afterEach(() => {
    for (const key of [
      "MCP_INSPECTOR_DAEMON_DIR",
      "MCP_STORAGE_DIR",
      "HOME",
      "TMPDIR",
      "TEMP",
      "TMP",
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
    if (isWindows) {
      // The endpoint is a pipe keyed by the directory, not a file inside it.
      expect(getDaemonSocketPath()).toMatch(
        /^\\\\\.\\pipe\\mcp-conn-[0-9a-f]{16}$/,
      );
      expect(getDaemonSocketPath()).toBe(getDaemonSocketPath(path.resolve(a)));
      expect(getDaemonSocketPath()).not.toBe(
        getDaemonSocketPath(path.resolve(b)),
      );
    } else {
      expect(getDaemonSocketPath()).toBe(
        path.join(path.resolve(a), "mcpdod.sock"),
      );
    }
    expect(getDaemonLockPath()).toBe(path.join(path.resolve(a), "mcpdod.lock"));
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

  // POSIX-only: asserts 0700 mode bits, and `ensureDaemonDir`'s ownership and
  // mode checks are a no-op on Windows (no getuid, no UNIX mode semantics).
  it.skipIf(isWindows)(
    "tightens a pre-existing loose daemon directory to 0700 and rejects symlinks",
    () => {
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
    },
  );

  it("createPrivateDaemonDir nests under a short 0700 tmpdir layout", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-conn-t-"));
    // os.tmpdir() reads TMPDIR on POSIX and TEMP/TMP on Windows.
    setEnv("TMPDIR", tmp + path.sep);
    setEnv("TEMP", tmp);
    setEnv("TMP", tmp);
    const dir = createPrivateDaemonDir();
    // $TMPDIR/mcp-conn-<uid>/<8-hex>; short enough that mcpdod.sock stays inside
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

  // Each platform arm below is otherwise reached only on its own OS, and the
  // per-file coverage gate runs on Linux, macOS and Windows alike (#2922), so
  // the platform is faked rather than the case skipped.
  it.each([
    ["linux", 107],
    ["darwin", 103],
  ] as const)(
    "assertSocketPathWithinLimit enforces the %s sun_path limit (%i bytes)",
    (platform, limit) => {
      withPlatform(platform, () => {
        const at = "/" + "x".repeat(limit - 1);
        expect(Buffer.byteLength(at)).toBe(limit);
        expect(() => assertSocketPathWithinLimit(at)).not.toThrow();
        expect(() => assertSocketPathWithinLimit(at + "x")).toThrow(
          /too long for this platform/,
        );
      });
    },
  );

  it("derives a socket file inside the daemon dir off Windows", () => {
    withPlatform("linux", () => {
      expect(getDaemonSocketPath("/some/daemon/dir")).toBe(
        path.join("/some/daemon/dir", "mcpdod.sock"),
      );
    });
  });

  it("assertTrustedPrivateRoot rejects a non-directory and accepts a root it owns", () => {
    // The checks run wherever `process.getuid` exists; Windows has none, so
    // stand in the owner's uid there to reach them on every host.
    const realGetuid = process.getuid;
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-conn-trust-"));
    try {
      const root = path.join(tmp, "root");
      fs.mkdirSync(root, { mode: 0o755 });
      process.getuid = realGetuid ?? (() => fs.lstatSync(root).uid);
      const file = path.join(tmp, "not-a-dir");
      fs.writeFileSync(file, "");
      expect(() => assertTrustedPrivateRoot(file)).toThrow(/not a directory/);
      expect(() => assertTrustedPrivateRoot(root)).not.toThrow();
    } finally {
      process.getuid = realGetuid;
      fs.rmSync(tmp, { recursive: true, force: true });
    }
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
