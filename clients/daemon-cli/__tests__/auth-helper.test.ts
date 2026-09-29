import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { PassThrough } from "node:stream";
import type { CallbackNavigation } from "@inspector/core/auth/index.js";

const authorizeInFrontend = vi.fn();

vi.mock("../src/connection/authorize.js", () => ({
  authorizeInFrontend: (...args: unknown[]) => authorizeInFrontend(...args),
}));

import {
  AUTH_HELPER_COMMAND,
  obtainPendingAuthUrl,
  pendingAuthMarkerPath,
  readLivePendingAuthMarker,
  runAuthHelper,
  type PendingAuthMarker,
} from "../src/connection/auth-helper.js";

const SERVER_URL = "https://mcp.example.com/mcp";

describe("auth-helper", () => {
  let dir: string;
  let prevDaemonDir: string | undefined;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-auth-helper-"));
    prevDaemonDir = process.env.MCP_INSPECTOR_DAEMON_DIR;
    process.env.MCP_INSPECTOR_DAEMON_DIR = dir;
    authorizeInFrontend.mockReset();
  });

  afterEach(() => {
    if (prevDaemonDir === undefined)
      delete process.env.MCP_INSPECTOR_DAEMON_DIR;
    else process.env.MCP_INSPECTOR_DAEMON_DIR = prevDaemonDir;
    fs.rmSync(dir, { recursive: true, force: true });
  });

  function writeMarker(marker: PendingAuthMarker): string {
    const markerPath = pendingAuthMarkerPath(SERVER_URL);
    fs.writeFileSync(markerPath, JSON.stringify(marker), { mode: 0o600 });
    return markerPath;
  }

  describe("readLivePendingAuthMarker", () => {
    it("returns undefined when no marker exists", () => {
      expect(readLivePendingAuthMarker(SERVER_URL)).toBeUndefined();
    });

    it("returns a live marker (unexpired, helper pid running)", () => {
      writeMarker({
        url: "https://as.example/authorize?state=s1",
        pid: process.pid,
        expiresAt: Date.now() + 60_000,
      });
      expect(readLivePendingAuthMarker(SERVER_URL)).toMatchObject({
        url: "https://as.example/authorize?state=s1",
      });
    });

    it("removes and ignores an expired marker", () => {
      const markerPath = writeMarker({
        url: "https://as.example/authorize",
        pid: process.pid,
        expiresAt: Date.now() - 1,
      });
      expect(readLivePendingAuthMarker(SERVER_URL)).toBeUndefined();
      expect(fs.existsSync(markerPath)).toBe(false);
    });

    it("removes and ignores a marker whose helper process is gone", () => {
      const markerPath = writeMarker({
        url: "https://as.example/authorize",
        // Out-of-range / nonexistent pid: process.kill(pid, 0) throws.
        pid: 0x7fffffff,
        expiresAt: Date.now() + 60_000,
      });
      expect(readLivePendingAuthMarker(SERVER_URL)).toBeUndefined();
      expect(fs.existsSync(markerPath)).toBe(false);
    });

    it("ignores malformed marker files", () => {
      fs.writeFileSync(pendingAuthMarkerPath(SERVER_URL), "not-json");
      expect(readLivePendingAuthMarker(SERVER_URL)).toBeUndefined();
      fs.writeFileSync(pendingAuthMarkerPath(SERVER_URL), '{"url":42}');
      expect(readLivePendingAuthMarker(SERVER_URL)).toBeUndefined();
    });
  });

  describe("obtainPendingAuthUrl", () => {
    function writeHelperScript(body: string): string {
      const script = path.join(dir, "fake-helper.mjs");
      fs.writeFileSync(script, body);
      return script;
    }

    it("reuses a live marker's URL without spawning a second helper", async () => {
      writeMarker({
        url: "https://as.example/authorize?state=reuse",
        pid: process.pid,
        expiresAt: Date.now() + 60_000,
      });
      const url = await obtainPendingAuthUrl(
        { type: "streamable-http", url: SERVER_URL },
        undefined,
        // Would fail loudly if a spawn were attempted.
        { helperArgv1: path.join(dir, "does-not-exist.mjs") },
      );
      expect(url).toBe("https://as.example/authorize?state=reuse");
    });

    it("spawns the helper, passes params over stdin, and returns the reported URL", async () => {
      const script = writeHelperScript(`
        let body = "";
        process.stdin.on("data", (c) => (body += c));
        process.stdin.on("end", () => {
          const params = JSON.parse(body);
          if (process.argv[2] !== ${JSON.stringify(AUTH_HELPER_COMMAND)}) {
            process.exit(9);
          }
          process.stdout.write(
            JSON.stringify({
              event: "auth_url",
              url: "https://as.example/authorize?server=" +
                encodeURIComponent(params.serverConfig.url),
            }) + "\\n",
          );
        });
      `);
      const url = await obtainPendingAuthUrl(
        { type: "streamable-http", url: SERVER_URL },
        undefined,
        { helperArgv1: script },
      );
      expect(url).toBe(
        `https://as.example/authorize?server=${encodeURIComponent(SERVER_URL)}`,
      );
    });

    it("maps a helper error event to auth_required", async () => {
      const script = writeHelperScript(`
        process.stdin.resume();
        process.stdin.on("end", () => {
          process.stdout.write(
            JSON.stringify({ event: "error", message: "no AS metadata" }) + "\\n",
          );
        });
      `);
      await expect(
        obtainPendingAuthUrl(
          { type: "streamable-http", url: SERVER_URL },
          undefined,
          { helperArgv1: script },
        ),
      ).rejects.toMatchObject({
        envelope: { code: "auth_required" },
        message: expect.stringContaining("no AS metadata"),
      });
    });

    it("skips marker reuse for stdio configs and still spawns the helper", async () => {
      const script = writeHelperScript(`
        process.stdin.resume();
        process.stdin.on("end", () => {
          process.stdout.write(
            JSON.stringify({ event: "auth_url", url: "https://as.example/stdio" }) + "\\n",
          );
        });
      `);
      const url = await obtainPendingAuthUrl(
        { type: "stdio", command: "srv" },
        undefined,
        { helperArgv1: script },
      );
      expect(url).toBe("https://as.example/stdio");
    });

    it("skips blank, malformed, and unknown-event lines before the URL", async () => {
      const script = writeHelperScript(`
        process.stdin.resume();
        process.stdin.on("end", () => {
          process.stdout.write(
            "\\n" +
            "not json\\n" +
            JSON.stringify({ event: "progress" }) + "\\n" +
            JSON.stringify({ event: "auth_url", url: "https://as.example/after-noise" }) + "\\n",
          );
        });
      `);
      const url = await obtainPendingAuthUrl(
        { type: "streamable-http", url: SERVER_URL },
        undefined,
        { helperArgv1: script },
      );
      expect(url).toBe("https://as.example/after-noise");
    });

    it("waits for a concurrent reserver's marker instead of spawning", async () => {
      const lockPath = `${pendingAuthMarkerPath(SERVER_URL)}.lock`;
      fs.writeFileSync(lockPath, "1234\n", { mode: 0o600 });
      // Publish the marker shortly after, as the winner's helper would.
      const t = setTimeout(() => {
        writeMarker({
          url: "https://as.example/authorize?state=winner",
          pid: process.pid,
          expiresAt: Date.now() + 60_000,
        });
      }, 50);
      try {
        const url = await obtainPendingAuthUrl(
          { type: "streamable-http", url: SERVER_URL },
          undefined,
          // Would fail loudly if a spawn were attempted.
          {
            helperArgv1: path.join(dir, "does-not-exist.mjs"),
            waitMs: 2_000,
            pollMs: 10,
          },
        );
        expect(url).toBe("https://as.example/authorize?state=winner");
      } finally {
        clearTimeout(t);
      }
    });

    it("times out with auth_required when the reserved flow never publishes", async () => {
      const lockPath = `${pendingAuthMarkerPath(SERVER_URL)}.lock`;
      fs.writeFileSync(lockPath, "1234\n", { mode: 0o600 });
      await expect(
        obtainPendingAuthUrl(
          { type: "streamable-http", url: SERVER_URL },
          undefined,
          {
            helperArgv1: path.join(dir, "does-not-exist.mjs"),
            waitMs: 60,
            pollMs: 10,
          },
        ),
      ).rejects.toMatchObject({
        envelope: { code: "auth_required" },
        message: expect.stringContaining("in-progress sign-in"),
      });
    });

    it("steals a stale reservation and releases its own after the flow", async () => {
      const lockPath = `${pendingAuthMarkerPath(SERVER_URL)}.lock`;
      fs.writeFileSync(lockPath, "1234\n", { mode: 0o600 });
      // Backdate past the steal threshold (wait window + slack).
      const old = new Date(Date.now() - 120_000);
      fs.utimesSync(lockPath, old, old);
      const script = writeHelperScript(`
        process.stdin.resume();
        process.stdin.on("end", () => {
          process.stdout.write(
            JSON.stringify({ event: "auth_url", url: "https://as.example/stolen" }) + "\\n",
          );
        });
      `);
      const url = await obtainPendingAuthUrl(
        { type: "streamable-http", url: SERVER_URL },
        undefined,
        { helperArgv1: script },
      );
      expect(url).toBe("https://as.example/stolen");
      // The reservation is released once the URL is obtained.
      expect(fs.existsSync(lockPath)).toBe(false);
    });

    it("maps a helper spawn failure to auth_required", async () => {
      const originalExecPath = process.execPath;
      // A nonexistent interpreter makes spawn emit `error` instead of `exit`.
      process.execPath = path.join(dir, "no-such-node");
      try {
        await expect(
          obtainPendingAuthUrl(
            { type: "streamable-http", url: SERVER_URL },
            undefined,
            { helperArgv1: path.join(dir, "unused.mjs") },
          ),
        ).rejects.toMatchObject({
          envelope: { code: "auth_required" },
          message: expect.stringContaining("Failed to spawn"),
        });
      } finally {
        process.execPath = originalExecPath;
      }
    });

    it("fails when the helper exits before producing a URL", async () => {
      const script = writeHelperScript(`process.exit(2);`);
      await expect(
        obtainPendingAuthUrl(
          { type: "streamable-http", url: SERVER_URL },
          undefined,
          { helperArgv1: script },
        ),
      ).rejects.toMatchObject({
        envelope: { code: "auth_required" },
        message: expect.stringContaining("exited"),
      });
    });
  });

  describe("runAuthHelper", () => {
    function stubStdin(body: string): () => void {
      const stream = new PassThrough();
      const descriptor = Object.getOwnPropertyDescriptor(process, "stdin");
      Object.defineProperty(process, "stdin", {
        value: stream,
        configurable: true,
      });
      stream.end(body);
      return () => {
        if (descriptor) Object.defineProperty(process, "stdin", descriptor);
      };
    }

    function captureStdout(): { lines: () => string[]; restore: () => void } {
      let out = "";
      const original = process.stdout.write;
      process.stdout.write = ((chunk: unknown) => {
        out += typeof chunk === "string" ? chunk : String(chunk);
        return true;
      }) as typeof process.stdout.write;
      return {
        lines: () =>
          out
            .split("\n")
            .filter((l) => l.trim())
            .map((l) => l),
        restore: () => {
          process.stdout.write = original;
        },
      };
    }

    it("writes the marker while the flow runs, emits auth_url and done, and removes the marker on exit", async () => {
      let markerDuringFlow: PendingAuthMarker | undefined;
      authorizeInFrontend.mockImplementation(
        async (
          _config: unknown,
          _settings: unknown,
          options: {
            makeNavigation: (control: { armed: boolean }) => CallbackNavigation;
          },
        ) => {
          const navigation = options.makeNavigation({ armed: true });
          navigation.navigateToAuthorization(
            new URL("https://as.example/authorize?state=s2"),
          );
          markerDuringFlow = readLivePendingAuthMarker(SERVER_URL);
        },
      );
      const restoreStdin = stubStdin(
        JSON.stringify({
          serverConfig: { type: "streamable-http", url: SERVER_URL },
        }),
      );
      const stdout = captureStdout();
      try {
        await runAuthHelper();
      } finally {
        stdout.restore();
        restoreStdin();
      }
      expect(markerDuringFlow).toMatchObject({
        url: "https://as.example/authorize?state=s2",
        pid: process.pid,
      });
      const events = stdout
        .lines()
        .map((l) => JSON.parse(l) as { event: string });
      expect(events.map((e) => e.event)).toEqual(["auth_url", "done"]);
      // Marker removed once the flow completed.
      expect(fs.existsSync(pendingAuthMarkerPath(SERVER_URL))).toBe(false);
    });

    it("stays silent while the navigation is disarmed (SDK auth during plain connect)", async () => {
      authorizeInFrontend.mockImplementation(
        async (
          _config: unknown,
          _settings: unknown,
          options: {
            makeNavigation: (control: { armed: boolean }) => CallbackNavigation;
          },
        ) => {
          const navigation = options.makeNavigation({ armed: false });
          navigation.navigateToAuthorization(
            new URL("https://as.example/authorize?leaked=1"),
          );
        },
      );
      const restoreStdin = stubStdin(
        JSON.stringify({
          serverConfig: { type: "streamable-http", url: SERVER_URL },
        }),
      );
      const stdout = captureStdout();
      try {
        await runAuthHelper();
      } finally {
        stdout.restore();
        restoreStdin();
      }
      const events = stdout
        .lines()
        .map((l) => JSON.parse(l) as { event: string });
      expect(events.map((e) => e.event)).toEqual(["done"]);
      expect(fs.existsSync(pendingAuthMarkerPath(SERVER_URL))).toBe(false);
    });

    it("emits an error event and rethrows when the flow fails", async () => {
      authorizeInFrontend.mockRejectedValueOnce(new Error("flow exploded"));
      const restoreStdin = stubStdin(
        JSON.stringify({
          serverConfig: { type: "streamable-http", url: SERVER_URL },
        }),
      );
      const stdout = captureStdout();
      try {
        await expect(runAuthHelper()).rejects.toThrow("flow exploded");
      } finally {
        stdout.restore();
        restoreStdin();
      }
      const events = stdout
        .lines()
        .map((l) => JSON.parse(l) as { event: string; message?: string });
      expect(events).toEqual([{ event: "error", message: "flow exploded" }]);
    });

    it("emits the URL without writing a marker for stdio configs", async () => {
      authorizeInFrontend.mockImplementation(
        async (
          _config: unknown,
          _settings: unknown,
          options: {
            makeNavigation: (control: { armed: boolean }) => CallbackNavigation;
          },
        ) => {
          const navigation = options.makeNavigation({ armed: true });
          navigation.navigateToAuthorization(
            new URL("https://as.example/authorize?stdio=1"),
          );
        },
      );
      const restoreStdin = stubStdin(
        JSON.stringify({ serverConfig: { type: "stdio", command: "srv" } }),
      );
      const stdout = captureStdout();
      try {
        await runAuthHelper();
        // The EPIPE guard on stdout must swallow late write errors.
        process.stdout.emit("error", new Error("EPIPE"));
      } finally {
        stdout.restore();
        restoreStdin();
      }
      const events = stdout
        .lines()
        .map((l) => JSON.parse(l) as { event: string });
      expect(events.map((e) => e.event)).toEqual(["auth_url", "done"]);
      // No url on the config → no marker file anywhere in the daemon dir.
      expect(fs.readdirSync(dir).filter((f) => f.includes("auth"))).toEqual([]);
    });

    it("stringifies a non-Error flow failure in the error event", async () => {
      authorizeInFrontend.mockRejectedValueOnce("string boom");
      const restoreStdin = stubStdin(
        JSON.stringify({
          serverConfig: { type: "streamable-http", url: SERVER_URL },
        }),
      );
      const stdout = captureStdout();
      try {
        await expect(runAuthHelper()).rejects.toBe("string boom");
      } finally {
        stdout.restore();
        restoreStdin();
      }
      const events = stdout
        .lines()
        .map((l) => JSON.parse(l) as { event: string; message?: string });
      expect(events).toEqual([{ event: "error", message: "string boom" }]);
    });

    it("rejects when stdin errors before EOF", async () => {
      const stream = new PassThrough();
      const descriptor = Object.getOwnPropertyDescriptor(process, "stdin");
      Object.defineProperty(process, "stdin", {
        value: stream,
        configurable: true,
      });
      const stdout = captureStdout();
      try {
        const pending = runAuthHelper();
        stream.emit("error", new Error("broken pipe"));
        await expect(pending).rejects.toThrow("broken pipe");
      } finally {
        stdout.restore();
        if (descriptor) Object.defineProperty(process, "stdin", descriptor);
      }
    });

    it("times out when the parent never sends params", async () => {
      vi.useFakeTimers();
      const stream = new PassThrough();
      const descriptor = Object.getOwnPropertyDescriptor(process, "stdin");
      Object.defineProperty(process, "stdin", {
        value: stream,
        configurable: true,
      });
      const stdout = captureStdout();
      try {
        const pending = runAuthHelper();
        const expectation = expect(pending).rejects.toThrow(
          /timed out waiting for params/,
        );
        await vi.advanceTimersByTimeAsync(30_000);
        await expectation;
      } finally {
        vi.useRealTimers();
        stdout.restore();
        if (descriptor) Object.defineProperty(process, "stdin", descriptor);
      }
    });

    it("rejects params without a serverConfig", async () => {
      const restoreStdin = stubStdin(JSON.stringify({}));
      const stdout = captureStdout();
      try {
        await expect(runAuthHelper()).rejects.toThrow(/serverConfig/);
      } finally {
        stdout.restore();
        restoreStdin();
      }
    });
  });
});
