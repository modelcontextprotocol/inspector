import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { DaemonServer } from "../src/daemon/server.js";
import type { InspectorClient } from "@inspector/core/mcp/inspectorClient.js";

/**
 * Covers `rpc` cancellation when the caller's IPC socket closes: an abort
 * mid-call cancels the in-flight tool call (so the per-client rpc queue
 * isn't wedged behind work nobody awaits), and a queued rpc whose caller
 * already hung up fails fast instead of running on a dead socket's behalf.
 */

const runMethodMock = vi.hoisted(() => ({
  impl: undefined as unknown as (...args: unknown[]) => Promise<unknown>,
}));
vi.mock("@inspector/cli/handlers/run-method.js", () => ({
  runMethod: (...args: unknown[]) => runMethodMock.impl(...args),
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function fakeClient(): {
  client: InspectorClient;
  cancelToolCall: ReturnType<typeof vi.fn>;
  getAmbientSignal: () => AbortSignal | undefined;
} {
  const target = new EventTarget();
  const cancelToolCall = vi.fn().mockReturnValue(true);
  let ambientSignal: AbortSignal | undefined;
  const client = {
    addEventListener: (type: string, listener: EventListener) =>
      target.addEventListener(type, listener),
    removeEventListener: (type: string, listener: EventListener) =>
      target.removeEventListener(type, listener),
    getStatus: () => "connected",
    cancelToolCall,
    setAmbientRequestSignal: (signal: AbortSignal | undefined) => {
      ambientSignal = signal;
      return () => {
        ambientSignal = undefined;
      };
    },
  } as unknown as InspectorClient;
  return { client, cancelToolCall, getAmbientSignal: () => ambientSignal };
}

describe("daemon rpc abort on caller disconnect", () => {
  let dir: string;
  let server: DaemonServer;
  let client: InspectorClient;
  let cancelToolCall: ReturnType<typeof vi.fn>;
  let getAmbientSignal: () => AbortSignal | undefined;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-rpc-abort-"));
    server = new DaemonServer({ dir, idleMs: 0 });
    const fake = fakeClient();
    client = fake.client;
    cancelToolCall = fake.cancelToolCall;
    getAmbientSignal = fake.getAmbientSignal;
    const registry = server.registry as unknown as Record<string, unknown>;
    registry.connectionFor = () => ({ name: "srv", client });
    registry.liveClientFor = async () => client;
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  function rpc(id: string, signal?: AbortSignal, method = "tools/call") {
    return server.handle(
      { id, op: "rpc", params: { method, name: "srv" } },
      undefined,
      signal,
    );
  }

  it("cancels the in-flight tool call when the caller aborts mid-call", async () => {
    const running = deferred<void>();
    const result = deferred<unknown>();
    runMethodMock.impl = async () => {
      running.resolve();
      return result.promise;
    };
    const abort = new AbortController();
    const call = rpc("r1", abort.signal);
    await running.promise;
    expect(cancelToolCall).not.toHaveBeenCalled();

    abort.abort();
    expect(cancelToolCall).toHaveBeenCalledTimes(1);

    // The real cancel rejects the SDK request; simulate that settle.
    result.reject(new Error("Pending request aborted"));
    const response = await call;
    expect(response.ok).toBe(false);
  });

  it("does not cancel when the call settles normally", async () => {
    runMethodMock.impl = async () => ({ kind: "result", result: { n: 1 } });
    const abort = new AbortController();
    const response = await rpc("r2", abort.signal);
    expect(response.ok).toBe(true);
    // Abort after settle must not reach into a later call.
    abort.abort();
    expect(cancelToolCall).not.toHaveBeenCalled();
  });

  it("fails a queued rpc fast when its caller already hung up", async () => {
    const firstRunning = deferred<void>();
    const firstResult = deferred<unknown>();
    runMethodMock.impl = async () => {
      firstRunning.resolve();
      return firstResult.promise;
    };
    const first = rpc("r3");
    await firstRunning.promise;

    // Queue a second call behind the hung first, then hang up its caller.
    const abort = new AbortController();
    const runMethodCalls: number[] = [];
    const prior = runMethodMock.impl;
    runMethodMock.impl = async (...args) => {
      runMethodCalls.push(1);
      return prior(...args);
    };
    const second = rpc("r4", abort.signal);
    abort.abort();

    firstResult.resolve({ kind: "result", result: {} });
    expect((await first).ok).toBe(true);
    const response = await second;
    expect(response.ok).toBe(false);
    if (!response.ok) {
      expect(response.error?.code).toBe("caller_gone");
    }
    expect(runMethodCalls).toHaveLength(0);
  });

  it("frees the connection when a non-tool request's caller aborts (R2)", async () => {
    // Reproduces the wedge: the daemon serializes every method on a connection,
    // so a non-tool request the server never answers (e.g. `resources/read`)
    // held the queue slot forever once the caller hung up — `cancelToolCall()`
    // is a no-op for it. The fix makes the caller's signal the client's ambient
    // request signal, so core aborts the in-flight request and the slot frees.
    // This stub stands in for core honoring that ambient signal: it settles
    // only when the signal aborts, and never otherwise. If the daemon failed to
    // wire the ambient signal, `getAmbientSignal()` is undefined and the call
    // hangs forever — the wedge this test guards against.
    const firstRunning = deferred<void>();
    runMethodMock.impl = async (_clientArg, args) => {
      const method = (args as { method?: string } | undefined)?.method;
      if (method === "resources/read") {
        firstRunning.resolve();
        const ambient = getAmbientSignal();
        return new Promise((_resolve, reject) => {
          ambient?.addEventListener(
            "abort",
            () => reject(new Error("Pending request aborted")),
            { once: true },
          );
        });
      }
      // The follow-up command settles normally once it gets to run.
      return { kind: "result", result: { ok: true } };
    };

    const abort = new AbortController();
    const first = rpc("r5", abort.signal, "resources/read");
    await firstRunning.promise;

    // The caller's signal must be the client's ambient request signal while the
    // call runs — that is what threads cancellation into the in-flight request.
    expect(getAmbientSignal()).toBe(abort.signal);

    // A second command queues behind the hung first; it must not be wedged.
    const second = rpc("r6", undefined, "tools/list");

    // The caller hangs up → the ambient signal aborts the in-flight request.
    abort.abort();
    const firstResponse = await first;
    expect(firstResponse.ok).toBe(false);

    // The queue slot freed, so the follow-up runs and settles normally.
    const secondResponse = await second;
    expect(secondResponse.ok).toBe(true);

    // The ambient signal is cleared once the call settles (disposer ran).
    expect(getAmbientSignal()).toBeUndefined();
  });
});
