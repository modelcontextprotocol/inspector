/**
 * Unit tests for `acceptDaemonConnection`'s per-connection wiring: the
 * elicitation channel, destroyed-socket guards, and stream cleanup. A fake
 * in-memory Duplex stands in for the net.Socket so every path is exercised
 * deterministically (no accept/connect races).
 */
import { describe, it, expect } from "vitest";
import { Duplex } from "node:stream";
import type * as net from "node:net";
import {
  acceptDaemonConnection,
  MAX_REQUEST_LINE_BYTES,
  type ElicitationChannel,
} from "../src/daemon/ipc-glue.js";
import type {
  DaemonRequest,
  ElicitationRequestFrame,
  ElicitationResponseFrame,
} from "../src/daemon/protocol.js";

class FakeSocket extends Duplex {
  written: string[] = [];
  override _read(): void {}
  override _write(
    chunk: unknown,
    _encoding: BufferEncoding,
    callback: (error?: Error | null) => void,
  ): void {
    this.written.push(String(chunk));
    callback();
  }
  pushLine(line: string): void {
    this.push(line + "\n");
  }
  get all(): string {
    return this.written.join("");
  }
}

function accept(
  handle: (
    request: DaemonRequest,
    elicitation: ElicitationChannel,
    signal?: AbortSignal,
  ) => Promise<{
    response: { id: string; ok: true; result: unknown };
    startStream?: (
      writeData: (data: unknown) => void,
      endStream: () => void,
    ) => () => void;
  }>,
): FakeSocket {
  const socket = new FakeSocket();
  acceptDaemonConnection(socket as unknown as net.Socket, handle);
  return socket;
}

/** Await an event-driven condition (no fixed sleeps). */
async function until(condition: () => boolean): Promise<void> {
  while (!condition()) {
    await new Promise((resolve) => setImmediate(resolve));
  }
}

const REQUEST = JSON.stringify({ id: "r1", op: "rpc", params: {} });

function elicitationRequest(id: string): ElicitationRequestFrame {
  return {
    id,
    kind: "elicitation-request",
    elicitationId: `elicit-${id}`,
    mode: "form",
    message: "pick one",
    origin: "server-request",
  };
}

function elicitationResponse(id: string): ElicitationResponseFrame {
  return {
    id,
    kind: "elicitation-response",
    elicitationId: `elicit-${id}`,
    action: "accept",
    content: {},
  };
}

describe("acceptDaemonConnection elicitation channel", () => {
  it("pauses a call for an elicitation exchange and resumes on the answer", async () => {
    const socket = accept(async (request, elicitation) => {
      const answer = await elicitation.request(elicitationRequest("e1"));
      return {
        response: { id: request.id, ok: true, result: { action: answer } },
      };
    });

    socket.pushLine(REQUEST);
    await until(() => socket.all.includes('"elicitation-request"'));

    socket.pushLine(JSON.stringify(elicitationResponse("e1")));
    await until(() => socket.all.includes('"ok":true'));
    expect(socket.all).toContain('"action"');
  });

  it("ignores non-answer lines while an exchange is pending", async () => {
    const socket = accept(async (request, elicitation) => {
      const answer = await elicitation.request(elicitationRequest("e2"));
      return { response: { id: request.id, ok: true, result: answer } };
    });

    socket.pushLine(REQUEST);
    await until(() => socket.all.includes('"elicitation-request"'));

    // None of these are elicitation answers; each falls through to the
    // request parser and earns an invalid_request response.
    socket.pushLine("not-json");
    socket.pushLine("null");
    socket.pushLine(JSON.stringify({ kind: "other" }));
    await until(() => socket.all.split('"invalid_request"').length - 1 === 3);

    socket.pushLine(JSON.stringify(elicitationResponse("e2")));
    await until(() => socket.all.includes('"ok":true'));
  });

  it("rejects a second exchange while one is already pending", async () => {
    let secondError: Error | undefined;
    const socket = accept(async (request, elicitation) => {
      const first = elicitation.request(elicitationRequest("e3"));
      await elicitation
        .request(elicitationRequest("e4"))
        .catch((error: Error) => {
          secondError = error;
        });
      socket.pushLine(JSON.stringify(elicitationResponse("e3")));
      await first;
      return { response: { id: request.id, ok: true, result: {} } };
    });

    socket.pushLine(REQUEST);
    await until(() => socket.all.includes('"ok":true'));
    expect(secondError?.message).toMatch(/already pending/);
  });

  it("rejects a pending exchange when the connection drops", async () => {
    let rejection: Error | undefined;
    const settled = { done: false };
    const socket = accept(async (request, elicitation) => {
      elicitation.request(elicitationRequest("e5")).catch((error: Error) => {
        rejection = error;
        settled.done = true;
      });
      return { response: { id: request.id, ok: true, result: {} } };
    });

    socket.pushLine(REQUEST);
    await until(() => socket.all.includes('"elicitation-request"'));
    socket.destroy();
    await until(() => settled.done);
    expect(rejection?.message).toMatch(/Connection closed/);
  });

  it("rejects immediately when the socket is already destroyed", async () => {
    let rejection: Error | undefined;
    const settled = { done: false };
    let channel: ElicitationChannel | undefined;
    const socket = accept(async (request, elicitation) => {
      channel = elicitation;
      return { response: { id: request.id, ok: true, result: {} } };
    });

    socket.pushLine(REQUEST);
    await until(() => socket.all.includes('"ok":true'));
    socket.destroy();
    await until(() => socket.destroyed);
    await channel!.request(elicitationRequest("e6")).catch((error: Error) => {
      rejection = error;
      settled.done = true;
    });
    expect(settled.done).toBe(true);
    expect(rejection?.message).toMatch(/Connection closed/);
  });
});

describe("acceptDaemonConnection guards", () => {
  it("aborts the per-request signal when the caller's socket closes", async () => {
    let seen: AbortSignal | undefined;
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const socket = accept(async (request, _elicitation, signal) => {
      seen = signal;
      await gate;
      return { response: { id: request.id, ok: true, result: {} } };
    });

    socket.pushLine(REQUEST);
    await until(() => seen !== undefined);
    // Caller still attached: nothing aborted.
    expect(seen!.aborted).toBe(false);
    socket.destroy();
    await until(() => seen!.aborted === true);
    release();
  });

  it("drops the response when the socket dies mid-handle", async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const handled = { done: false };
    const socket = accept(async (request) => {
      await gate;
      handled.done = true;
      return { response: { id: request.id, ok: true, result: {} } };
    });

    socket.pushLine(REQUEST);
    socket.destroy();
    await until(() => socket.destroyed);
    release();
    await until(() => handled.done);
    // One more tick for the post-await destroyed guard.
    await new Promise((resolve) => setImmediate(resolve));
    expect(socket.all).toBe("");
  });

  it("disposes an opened stream when the socket died mid-handle", async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let started = 0;
    let stops = 0;
    const socket = accept(async (request) => {
      await gate;
      return {
        response: { id: request.id, ok: true, result: {} },
        // e.g. resources/subscribe: producer-side state exists before the
        // starter runs; the glue must start it inert and stop it so the
        // daemon doesn't keep a hidden subscription with no consumer.
        startStream: (writeData, endStream) => {
          started += 1;
          // The inert writer/end are safe to call: nothing reaches the wire.
          writeData({ n: 1 });
          endStream();
          return () => {
            stops += 1;
          };
        },
      };
    });

    socket.pushLine(REQUEST);
    socket.destroy();
    await until(() => socket.destroyed);
    release();
    await until(() => stops === 1);
    expect(started).toBe(1);
    expect(socket.all).toBe("");
  });

  it("ends the stream when the producer invokes endStream", async () => {
    let end: () => void = () => {};
    let stops = 0;
    const socket = accept(async (request) => ({
      response: { id: request.id, ok: true, result: {} },
      startStream: (writeData, endStream) => {
        end = endStream;
        writeData({ n: 1 });
        return () => {
          stops += 1;
        };
      },
    }));

    socket.pushLine(REQUEST);
    await until(() => socket.all.includes('"stream":"data"'));

    end();
    await until(() => socket.all.includes('"stream":"end"'));
    expect(stops).toBe(1);

    // A duplicate end (or a later close event) does not double-stop.
    end();
    socket.emit("close");
    await new Promise((resolve) => setImmediate(resolve));
    expect(stops).toBe(1);
  });

  it("cleans up a stream once on socket error and ignores late writes", async () => {
    let lateWrite: (data: unknown) => void = () => {};
    let stops = 0;
    const socket = accept(async (request) => ({
      response: { id: request.id, ok: true, result: {} },
      startStream: (writeData) => {
        lateWrite = writeData;
        writeData({ n: 1 });
        return () => {
          stops += 1;
        };
      },
    }));

    socket.pushLine(REQUEST);
    await until(() => socket.all.includes('"stream":"data"'));

    // Error on a still-writable socket: cleanup must emit the end frame,
    // half-close, and the readline teardown must not throw.
    socket.emit("error", new Error("peer reset"));
    await until(() => socket.all.includes('"stream":"end"'));
    expect(stops).toBe(1);

    // Late writes after cleanup are no-ops, and a duplicate cleanup
    // (close after error) does not double-stop.
    lateWrite({ n: 2 });
    socket.emit("close");
    await new Promise((resolve) => setImmediate(resolve));
    expect(stops).toBe(1);
    expect(socket.all.split('"stream":"data"').length - 1).toBe(1);
  });
});

describe("request line cap", () => {
  it("never hands a terminated oversized line to the handler", async () => {
    // Deterministic cross-chunk variant of the e2e cap tests: a valid JSON
    // request padded past the cap, split so the chunk that crosses the limit
    // also carries the terminating newline. Both the byte accounting and the
    // post-reject line guard must hold, or the handler sees the request.
    let handled = 0;
    const socket = accept(async (request) => {
      handled += 1;
      return { response: { id: request.id, ok: true, result: {} } };
    });
    const padded =
      REQUEST + " ".repeat(MAX_REQUEST_LINE_BYTES + 1024 - REQUEST.length);
    socket.push(padded.slice(0, 600 * 1024));
    socket.push(padded.slice(600 * 1024) + "\n");
    await until(() => socket.destroyed);
    await new Promise((resolve) => setImmediate(resolve));
    expect(handled).toBe(0);
  });
});
