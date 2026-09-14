/**
 * Regression tests for #1999 — an SSE client that disconnects *while the
 * priming write is in flight* used to leak the stream's subscriber and park
 * the handler forever.
 *
 * Both SSE handlers in `core/mcp/remote/node/server.ts` install their
 * subscriber (session event consumer / server-list subscriber + file watcher)
 * synchronously, then prime the stream so Firefox's `fetch()` resolves
 * (#1858), and only then registered their `onAbort` cleanup. Priming is an
 * `await`, and Hono's `onAbort` has no already-aborted replay — so a
 * disconnect inside that window fired zero listeners: the subscriber stayed
 * installed, the `mcp.json` watcher was never stopped, and the promise the
 * handler was holding open on never resolved.
 *
 * `primeAndHoldSseStream` is the fix: one listener, registered before the
 * first `await`, that both cleans up and releases the hold. These tests drive
 * it with a stream whose priming write is controllable, which is the only way
 * to hit that window deterministically — against a real Hono stream the write
 * settles on its own microtask.
 */

import { describe, it, expect } from "vitest";
import { StreamingApi } from "hono/utils/stream";
import {
  primeAndHoldSseStream,
  type PrimableSseStream,
} from "@inspector/core/mcp/remote/node/server.js";

/** A stream whose priming write stays pending until the test releases it. */
function controllableStream(): {
  stream: PrimableSseStream;
  /** Deliver the disconnect Hono would deliver. */
  abort: () => void;
  /** Settle the pending priming write. */
  finishWrite: () => void;
  writes: string[];
  closes: number;
} {
  const listeners: (() => void)[] = [];
  const writes: string[] = [];
  let releaseWrite = (): void => {};
  const state = { closes: 0 };
  const stream: PrimableSseStream = {
    write: (input: string) => {
      writes.push(input);
      return new Promise<void>((resolve) => {
        releaseWrite = resolve;
      });
    },
    onAbort: (listener: () => void) => {
      listeners.push(listener);
    },
    close: async () => {
      state.closes += 1;
    },
  };
  return {
    stream,
    abort: () => {
      // Hono fires only the subscribers registered at this moment, with a
      // bare `subscriber()` call — see `hono/utils/stream`.
      for (const l of [...listeners]) l();
    },
    finishWrite: () => releaseWrite(),
    writes,
    get closes() {
      return state.closes;
    },
  };
}

/** Reject rather than hang if the handler is never released. */
async function withinTick(promise: Promise<void>): Promise<void> {
  const timeout = new Promise<never>((_, reject) => {
    setTimeout(() => reject(new Error("handler was never released")), 500);
  });
  await Promise.race([promise, timeout]);
}

describe("primeAndHoldSseStream (#1999)", () => {
  it("runs cleanup when the client aborts during the priming write", async () => {
    const s = controllableStream();
    let cleanups = 0;

    const held = primeAndHoldSseStream(s.stream, () => {
      cleanups += 1;
    });

    // The write is still pending — exactly the window the pre-fix code
    // registered no listener in.
    await Promise.resolve();
    expect(s.writes).toEqual([":\n\n"]);
    expect(cleanups).toBe(0);

    s.abort();
    expect(cleanups).toBe(1);

    // The handler must also come back, or Hono never closes the stream.
    s.finishWrite();
    await withinTick(held);
    expect(s.closes).toBe(1);
  });

  it("primes the stream before holding it open", async () => {
    const s = controllableStream();
    const held = primeAndHoldSseStream(s.stream, () => {});
    await Promise.resolve();

    expect(s.writes).toEqual([":\n\n"]);

    s.finishWrite();
    s.abort();
    await withinTick(held);
  });

  it("holds the handler open until the abort, not merely until the write", async () => {
    const s = controllableStream();
    let released = false;
    const held = primeAndHoldSseStream(s.stream, () => {}).then(() => {
      released = true;
    });

    s.finishWrite();
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(released).toBe(false);

    s.abort();
    await withinTick(held);
    expect(released).toBe(true);
  });

  it("runs cleanup once, on the first abort", async () => {
    const s = controllableStream();
    let cleanups = 0;
    const held = primeAndHoldSseStream(s.stream, () => {
      cleanups += 1;
    });

    s.finishWrite();
    s.abort();
    // Hono guards re-entry itself, but the helper must not depend on that —
    // so drive the listener a second time directly.
    s.abort();
    await withinTick(held);
    expect(cleanups).toBe(1);
    expect(s.closes).toBe(1);
  });

  it("does not reject when cleanup's own close loses the race", async () => {
    const s = controllableStream();
    const stream: PrimableSseStream = {
      ...s.stream,
      close: () => Promise.reject(new Error("peer already gone")),
    };
    const held = primeAndHoldSseStream(stream, () => {});

    s.finishWrite();
    s.abort();
    await expect(withinTick(held)).resolves.toBeUndefined();
  });

  it("documents the Hono behavior it exists for: onAbort has no replay", async () => {
    // The premise of the whole fix. If Hono ever replays the abort to a
    // late subscriber, this fails and the ordering guard can be revisited.
    const { readable, writable } = new TransformStream();
    const stream = new StreamingApi(writable, readable);

    await stream.responseReadable.cancel();

    let late = 0;
    stream.onAbort(() => {
      late += 1;
    });
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(late).toBe(0);
  });
});
