import { describe, it, expect, afterEach, vi } from "vitest";
import { consumeMethodOutcome } from "../src/handlers/consume-outcome.js";
import type { MethodOutcome } from "../src/handlers/method-types.js";

/**
 * The long-lived stream path's stdout error handling (#2412). A reader that
 * exits early (`| head`) makes the next stdout write fail with EPIPE; without a
 * listener that is an uncaught `'error'` event and the CLI crashes.
 *
 * Listeners are invoked directly rather than via `process.emit` /
 * `process.stdout.emit`, for the same reason `run-method.test.ts` gives: a
 * process-wide SIGINT reaches `when-exit`'s handler and can kill the worker.
 */

type Listener = (...args: unknown[]) => void;

function snapshot() {
  return {
    error: new Set(process.stdout.listeners("error")),
    sigint: new Set(process.listeners("SIGINT")),
    sigterm: new Set(process.listeners("SIGTERM")),
  };
}

function added(before: Set<unknown>, now: unknown[]): Listener[] {
  return now.filter((l) => !before.has(l)) as Listener[];
}

function streamOutcome(stop: () => void): MethodOutcome {
  return {
    kind: "stream",
    label: "t",
    start: (write) => {
      write({ hi: true });
      return stop;
    },
  };
}

function epipe(): NodeJS.ErrnoException {
  return Object.assign(new Error("write EPIPE"), { code: "EPIPE" });
}

describe("consumeMethodOutcome stream stdout errors (#2412)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  function muteStdout() {
    vi.spyOn(process.stdout, "write").mockImplementation(((
      _chunk: unknown,
      ...rest: unknown[]
    ) => {
      const cb = rest.find((r) => typeof r === "function") as
        | (() => void)
        | undefined;
      cb?.();
      return true;
    }) as typeof process.stdout.write);
  }

  it("ends cleanly on EPIPE, unsubscribes once, and detaches every listener", async () => {
    muteStdout();
    const stop = vi.fn();
    const before = snapshot();
    const done = consumeMethodOutcome(streamOutcome(stop), {});

    const onError = added(before.error, process.stdout.listeners("error"));
    expect(onError).toHaveLength(1);
    onError[0]!(epipe());

    await expect(done).resolves.toBeUndefined();
    expect(stop).toHaveBeenCalledTimes(1);
    expect(added(before.error, process.stdout.listeners("error"))).toEqual([]);
    expect(added(before.sigint, process.listeners("SIGINT"))).toEqual([]);
    expect(added(before.sigterm, process.listeners("SIGTERM"))).toEqual([]);
  });

  it("rejects a non-EPIPE stdout error into the CLI error path", async () => {
    muteStdout();
    const stop = vi.fn();
    const before = snapshot();
    const done = consumeMethodOutcome(streamOutcome(stop), {});

    const failure = Object.assign(new Error("write ENOSPC"), {
      code: "ENOSPC",
    });
    added(before.error, process.stdout.listeners("error"))[0]!(failure);

    await expect(done).rejects.toBe(failure);
    expect(stop).toHaveBeenCalledTimes(1);
    expect(added(before.error, process.stdout.listeners("error"))).toEqual([]);
    expect(added(before.sigint, process.listeners("SIGINT"))).toEqual([]);
  });

  it("treats a non-Error value on stdout as a failure, not a broken pipe", async () => {
    muteStdout();
    const before = snapshot();
    const done = consumeMethodOutcome(streamOutcome(vi.fn()), {});
    added(before.error, process.stdout.listeners("error"))[0]!("EPIPE");
    await expect(done).rejects.toBe("EPIPE");
  });

  it("ends on SIGTERM and detaches the stdout listener too", async () => {
    muteStdout();
    const stop = vi.fn();
    const before = snapshot();
    const done = consumeMethodOutcome(streamOutcome(stop), {});

    const onTerm = added(before.sigterm, process.listeners("SIGTERM"));
    expect(onTerm).toHaveLength(1);
    onTerm[0]!("SIGTERM");

    await expect(done).resolves.toBeUndefined();
    expect(stop).toHaveBeenCalledTimes(1);
    expect(added(before.error, process.stdout.listeners("error"))).toEqual([]);
  });

  it("detaches every listener when start throws", async () => {
    const before = snapshot();
    const failure = new Error("subscribe failed");
    await expect(
      consumeMethodOutcome(
        {
          kind: "stream",
          label: "t",
          start: () => {
            throw failure;
          },
        },
        {},
      ),
    ).rejects.toBe(failure);
    expect(added(before.error, process.stdout.listeners("error"))).toEqual([]);
    expect(added(before.sigint, process.listeners("SIGINT"))).toEqual([]);
    expect(added(before.sigterm, process.listeners("SIGTERM"))).toEqual([]);
  });
});
