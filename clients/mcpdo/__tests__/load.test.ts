import { describe, it, expect, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { runMcp } from "./helpers/mcp-runner.js";
import {
  createSampleTestConfig,
  deleteConfigFile,
} from "../../cli/__tests__/helpers/fixtures.js";
import { expectCliSuccess } from "../../cli/__tests__/helpers/assertions.js";
import { callDaemon } from "../src/daemon/client.js";
import { resolveLoadFlags } from "../src/connection/load-flags.js";
import { formatLoadSummaryHuman } from "../src/connection/format-human.js";
import { writeRpcOutcome } from "../src/connection/dispatch.js";
import {
  DEFAULT_LOAD_CONCURRENCY,
  DEFAULT_LOAD_DURATION_MS,
  type LoadSummary,
} from "@inspector/core/cli/handlers/load-test.js";
import { PLAIN } from "@inspector/core/cli/style.js";

/**
 * `mcpdo tools/call --load` (#2744): the flag rules, the summary rendering,
 * and one end-to-end run through an auto-spawned daemon.
 */

const SUMMARY: LoadSummary = {
  tool: "echo",
  concurrency: 4,
  durationMs: 1500,
  requestLimit: 40,
  rate: 20,
  requests: 30,
  ok: 27,
  toolErrors: 1,
  errors: 2,
  errorRate: 0.1,
  elapsedMs: 1500,
  throughput: 20,
  latencyMs: { min: 1, mean: 2.5, p50: 2, p90: 4, p99: 5, max: 6 },
  errorMessages: [{ message: "Request timed out", count: 2 }],
};

describe("resolveLoadFlags", () => {
  it("returns undefined for an ordinary call", () => {
    expect(resolveLoadFlags({ toolName: "echo" })).toBeUndefined();
  });

  it("applies the engine's defaults", () => {
    expect(resolveLoadFlags({ load: true, toolName: "echo" })).toEqual({
      concurrency: DEFAULT_LOAD_CONCURRENCY,
      durationMs: DEFAULT_LOAD_DURATION_MS,
    });
  });

  it("passes every bound through", () => {
    expect(
      resolveLoadFlags({
        load: true,
        toolName: "echo",
        loadConcurrency: 3,
        loadDuration: 2,
        loadRequests: 9,
        loadRate: 5,
      }),
    ).toEqual({ concurrency: 3, durationMs: 2000, requests: 9, rate: 5 });
  });

  it.each([
    [{ loadConcurrency: 2 }, "--load-concurrency requires --load."],
    [{ loadDuration: 1 }, "--load-duration requires --load."],
    [{ loadRequests: 1 }, "--load-requests requires --load."],
    [{ loadRate: 1 }, "--load-rate requires --load."],
    [
      { load: true, appInfo: true },
      "--load cannot be combined with --app-info.",
    ],
  ])("rejects %j", (flags, message) => {
    expect(() => resolveLoadFlags({ toolName: "echo", ...flags })).toThrow(
      message,
    );
  });

  it("requires a tool name", () => {
    expect(() => resolveLoadFlags({ load: true })).toThrow(
      "--load requires a tool name.",
    );
  });
});

describe("formatLoadSummaryHuman", () => {
  it("renders bounds, outcomes, latency and top errors", () => {
    const text = formatLoadSummaryHuman(SUMMARY, PLAIN);
    expect(text).toBe(
      [
        "Load test `echo` (concurrency 4, duration 1.5s, limit 40, rate 20/s)",
        "  Requests:   30 in 1.50s (20/s)",
        "  Outcomes:   27 ok, 1 tool errors, 2 errors",
        "  Error rate: 10.00%",
        "  Latency:    min 1 / mean 2.5 / p50 2 / p90 4 / p99 5 / max 6 ms",
        "  Top errors:",
        "    2× Request timed out",
      ].join("\n"),
    );
  });

  it("handles a run where nothing completed", () => {
    const text = formatLoadSummaryHuman({
      concurrency: 1,
      requests: 0,
      ok: 0,
      toolErrors: 0,
      errors: 0,
      errorRate: 0,
      elapsedMs: 0,
      throughput: 0,
      latencyMs: null,
      errorMessages: [],
    });
    expect(text).toContain("Load test (concurrency 1)");
    expect(text).toContain("Error rate: 0.00%");
    expect(text).toContain("Latency:    no calls completed");
    expect(text).not.toContain("Top errors");
  });
});

describe("writeRpcOutcome for a load result", () => {
  async function capture(format: "text" | "json"): Promise<string> {
    let out = "";
    const original = process.stdout.write;
    process.stdout.write = ((chunk: unknown, ...rest: unknown[]) => {
      out += String(chunk);
      const cb = rest.find((r) => typeof r === "function") as
        | (() => void)
        | undefined;
      cb?.();
      return true;
    }) as typeof process.stdout.write;
    try {
      await writeRpcOutcome({ format, style: PLAIN }, "tools/call", "echo", {
        kind: "load",
        summary: SUMMARY,
      });
    } finally {
      process.stdout.write = original;
    }
    return out;
  }

  it("prints the bare summary as JSON", async () => {
    expect(JSON.parse(await capture("json"))).toEqual(SUMMARY);
  });

  it("prints the human summary as text", async () => {
    expect(await capture("text")).toContain("Load test `echo`");
  });
});

describe("mcpdo tools/call --load", () => {
  let configPath: string | undefined;
  let storageDir: string | undefined;

  afterEach(async () => {
    if (storageDir) {
      const socketPath = path.join(storageDir, "mcpdod.sock");
      if (fs.existsSync(socketPath)) {
        try {
          await callDaemon("daemon/stop", {}, { socketPath, timeoutMs: 2000 });
        } catch {
          // already stopped
        }
      }
      fs.rmSync(storageDir, { recursive: true, force: true });
      storageDir = undefined;
    }
    if (configPath) {
      deleteConfigFile(configPath);
      configPath = undefined;
    }
  });

  function env(): Record<string, string> {
    storageDir = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-load-e2e-"));
    return {
      MCP_STORAGE_DIR: storageDir,
      MCP_INSPECTOR_DAEMON_DIR: storageDir,
      MCP_ALLOW_DEFAULT_CONNECTION: "1",
    };
  }

  it("loads a tool over a live connection and leaves it usable", async () => {
    configPath = createSampleTestConfig();
    const e = env();
    expectCliSuccess(
      await runMcp(["connect", "test-stdio", "--config", configPath], {
        env: e,
        timeout: 20000,
      }),
    );

    const loaded = await runMcp(
      [
        "tools/call",
        "echo",
        "message:=hi",
        "--load",
        "--load-requests",
        "12",
        "--load-concurrency",
        "3",
        "--format",
        "json",
      ],
      { env: e, timeout: 20000 },
    );
    expectCliSuccess(loaded);
    expect(JSON.parse(loaded.stdout)).toMatchObject({
      tool: "echo",
      concurrency: 3,
      requestLimit: 12,
      requests: 12,
      ok: 12,
      errors: 0,
      errorRate: 0,
    });

    // The queue slot is released: an ordinary call runs afterwards.
    expectCliSuccess(
      await runMcp(
        ["tools/call", "echo", "message:=after", "--format", "json"],
        {
          env: e,
          timeout: 20000,
        },
      ),
    );
  });

  it("fails before loading when the tool does not exist", async () => {
    configPath = createSampleTestConfig();
    const e = env();
    expectCliSuccess(
      await runMcp(["connect", "test-stdio", "--config", configPath], {
        env: e,
        timeout: 20000,
      }),
    );
    const result = await runMcp(
      ["tools/call", "no_such_tool", "--load", "--load-requests", "2"],
      { env: e, timeout: 20000 },
    );
    expect(result.exitCode).toBe(5);
    expect(result.stderr).toContain("Tool 'no_such_tool' not found on server.");
  });

  it.each([
    [
      ["tools/call", "echo", "--load-requests", "2"],
      "--load-requests requires --load.",
    ],
    [["tools/call", "--load"], "--load requires a tool name."],
    [
      ["tools/call", "echo", "--load", "--load-concurrency", "0"],
      "--load-concurrency must be a positive integer.",
    ],
  ])("rejects %j before reaching a daemon", async (args, message) => {
    const result = await runMcp(args, { env: env() });
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain(message);
  });
});
