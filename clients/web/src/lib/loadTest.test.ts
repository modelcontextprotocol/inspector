import { describe, expect, it, vi } from "vitest";
import type { InspectorClient } from "@inspector/core/mcp/index.js";

const runLoadTest = vi.hoisted(() => vi.fn());
vi.mock("@inspector/core/cli/handlers/load-test.js", () => ({
  runLoadTest,
}));

import { runWebLoadTest } from "./loadTest";

// Never touched: `runLoadTest` is mocked, so the client is only passed on.
const client = {} as InspectorClient;

describe("runWebLoadTest", () => {
  it("runs a tool load over the given client with progress and abort wired", async () => {
    const summary = { requests: 3 };
    runLoadTest.mockResolvedValueOnce(summary);
    const controller = new AbortController();
    const onProgress = vi.fn();
    const options = { concurrency: 2, durationMs: 1000 };
    await expect(
      runWebLoadTest(
        client,
        { toolName: "echo", toolArgs: { message: "hi" }, options },
        { signal: controller.signal, onProgress },
      ),
    ).resolves.toBe(summary);
    expect(runLoadTest).toHaveBeenCalledWith(
      client,
      { toolName: "echo", toolArg: { message: "hi" } },
      options,
      {
        signal: controller.signal,
        progress: { everyMs: 1000, emit: onProgress },
      },
    );
  });

  it("passes no tool for a scenario run", async () => {
    runLoadTest.mockResolvedValueOnce({});
    const options = { concurrency: 1 };
    await runWebLoadTest(
      client,
      { options },
      { signal: new AbortController().signal, onProgress: vi.fn() },
    );
    expect(runLoadTest).toHaveBeenLastCalledWith(
      client,
      {},
      options,
      expect.anything(),
    );
  });
});
