import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { DaemonServer } from "../src/daemon/server.js";
import {
  ElicitationParkRegistry,
  ParkingElicitationChannel,
} from "../src/daemon/elicitation-park.js";
import type {
  ElicitationPendingInfo,
  ElicitationRespondResult,
  RpcResult,
} from "../src/daemon/protocol.js";
import type { InspectorClient } from "@inspector/core/mcp/inspectorClient.js";

/**
 * Covers daemon-side elicitation parking (dual-era support, phase 2):
 * `rpc` from a non-interactive caller (`interactive: false`) returning
 * `elicitation-pending` instead of relaying an inline prompt, `elicitation/respond` resuming the parked call
 * (final result, error, or the next round), expiry, the
 * one-parked-call-per-connection guard, and the registry/channel primitives.
 */

const runMethodMock = vi.hoisted(() => ({
  impl: undefined as unknown as (...args: unknown[]) => Promise<unknown>,
}));
vi.mock("@inspector/cli/handlers/run-method.js", () => ({
  runMethod: (...args: unknown[]) => runMethodMock.impl(...args),
}));

type FakeElicitationMessage = {
  id: string;
  origin: string;
  request: { method: string; params: Record<string, unknown> };
  respond: ReturnType<typeof vi.fn>;
  cancel: ReturnType<typeof vi.fn>;
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const FORM_SCHEMA = {
  type: "object",
  properties: { color: { type: "string" } },
  required: ["color"],
};

function makeFormMessage(id: string): {
  message: FakeElicitationMessage;
  answered: Promise<{ action: string; content?: Record<string, unknown> }>;
  cancelled: Promise<void>;
} {
  const answer = deferred<{
    action: string;
    content?: Record<string, unknown>;
  }>();
  const cancel = deferred<void>();
  const message: FakeElicitationMessage = {
    id,
    origin: "server-request",
    request: {
      method: "elicitation/create",
      params: { message: "Pick a color", requestedSchema: FORM_SCHEMA },
    },
    respond: vi.fn(async (response) => {
      answer.resolve(response as never);
    }),
    cancel: vi.fn(() => {
      cancel.resolve();
      answer.resolve({ action: "cancel" });
    }),
  };
  return { message, answered: answer.promise, cancelled: cancel.promise };
}

function makeUrlMessage(id: string): {
  message: FakeElicitationMessage;
  answered: Promise<{ action: string; content?: Record<string, unknown> }>;
} {
  const answer = deferred<{
    action: string;
    content?: Record<string, unknown>;
  }>();
  const message: FakeElicitationMessage = {
    id,
    origin: "server-request",
    request: {
      method: "elicitation/create",
      params: {
        message: "Finish signup",
        url: "https://example.com/signup?flow=abc",
      },
    },
    respond: vi.fn(async (response) => {
      answer.resolve(response as never);
    }),
    cancel: vi.fn(() => answer.resolve({ action: "cancel" })),
  };
  return { message, answered: answer.promise };
}

function fakeClient(): { client: InspectorClient; emit: (m: unknown) => void } {
  const target = new EventTarget();
  const client = {
    addEventListener: (type: string, listener: EventListener) =>
      target.addEventListener(type, listener),
    removeEventListener: (type: string, listener: EventListener) =>
      target.removeEventListener(type, listener),
    getStatus: () => "connected",
  } as unknown as InspectorClient;
  return {
    client,
    emit: (detail) =>
      target.dispatchEvent(
        new CustomEvent("newPendingElicitation", { detail }),
      ),
  };
}

describe("daemon elicitation parking", () => {
  let dir: string;
  let server: DaemonServer;
  let client: InspectorClient;
  let emit: (m: unknown) => void;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-elicit-park-"));
    server = new DaemonServer({ dir, idleMs: 0 });
    const fake = fakeClient();
    client = fake.client;
    emit = fake.emit;
    const registry = server.registry as unknown as Record<string, unknown>;
    registry.connectionFor = () => ({ name: "srv", client });
    registry.liveClientFor = async () => client;
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  function rpcCallTool(id: string) {
    return server.handle({
      id,
      op: "rpc",
      params: {
        method: "tools/call",
        toolName: "collect",
        name: "srv",
        interactive: false,
      },
    });
  }

  function respond(
    id: string,
    params: Record<string, unknown>,
  ): ReturnType<DaemonServer["handle"]> {
    return server.handle({ id, op: "elicitation/respond", params });
  }

  it("parks a form elicitation, then respond accept resumes to the final result", async () => {
    const { message, answered } = makeFormMessage("elicit-1");
    runMethodMock.impl = async () => {
      emit(message);
      const answer = await answered;
      return {
        kind: "result",
        result: { echoed: answer.content, action: answer.action },
      };
    };

    const first = await rpcCallTool("r1");
    expect(first.ok).toBe(true);
    const pending = (first as { result: RpcResult }).result;
    expect(pending.kind).toBe("elicitation-pending");
    const info = (pending as { elicitation: ElicitationPendingInfo })
      .elicitation;
    expect(info).toMatchObject({
      elicitationId: "elicit-1",
      connection: "srv",
      method: "tools/call",
      toolName: "collect",
      mode: "form",
      message: "Pick a color",
      requestedSchema: FORM_SCHEMA,
      origin: "server-request",
    });
    expect(info.expiresAt).toBeGreaterThan(Date.now());

    const second = await respond("r2", {
      elicitationId: "elicit-1",
      action: "accept",
      content: { color: "teal" },
    });
    expect(second.ok).toBe(true);
    const result = (second as { result: ElicitationRespondResult }).result;
    expect(result.method).toBe("tools/call");
    expect(result.toolName).toBe("collect");
    expect(result.outcome).toEqual({
      kind: "result",
      result: { echoed: { color: "teal" }, action: "accept" },
      appInfo: undefined,
    });
    expect(message.respond).toHaveBeenCalledWith({
      action: "accept",
      content: { color: "teal" },
    });
  });

  it("chains rounds: respond returns the next pending elicitation, then the result", async () => {
    const round1 = makeFormMessage("elicit-a");
    const round2 = makeFormMessage("elicit-b");
    runMethodMock.impl = async () => {
      emit(round1.message);
      await round1.answered;
      emit(round2.message);
      const answer = await round2.answered;
      return { kind: "result", result: { final: answer.content } };
    };

    const first = await rpcCallTool("r1");
    expect((first as { result: RpcResult }).result.kind).toBe(
      "elicitation-pending",
    );

    const mid = await respond("r2", {
      elicitationId: "elicit-a",
      action: "accept",
      content: { color: "red" },
    });
    expect(mid.ok).toBe(true);
    const midOutcome = (mid as { result: ElicitationRespondResult }).result
      .outcome;
    expect(midOutcome.kind).toBe("elicitation-pending");
    const nextId = (midOutcome as { elicitation: ElicitationPendingInfo })
      .elicitation.elicitationId;
    expect(nextId).toBe("elicit-b");
    // The answered round's id is no longer respondable.
    const stale = await respond("r3", {
      elicitationId: "elicit-a",
      action: "cancel",
    });
    expect(stale.ok).toBe(false);
    expect((stale as { error: { code: string } }).error.code).toBe(
      "elicitation_not_found",
    );

    const done = await respond("r4", {
      elicitationId: "elicit-b",
      action: "accept",
      content: { color: "blue" },
    });
    expect(done.ok).toBe(true);
    expect(
      (done as { result: ElicitationRespondResult }).result.outcome,
    ).toMatchObject({ kind: "result", result: { final: { color: "blue" } } });
  });

  it("relays decline and cancel; url mode accepts --done and rejects decline/content", async () => {
    // decline (form)
    const declineRound = makeFormMessage("elicit-d");
    runMethodMock.impl = async () => {
      emit(declineRound.message);
      const answer = await declineRound.answered;
      return { kind: "result", result: { action: answer.action } };
    };
    await rpcCallTool("r1");
    const declined = await respond("r2", {
      elicitationId: "elicit-d",
      action: "decline",
    });
    expect(
      (declined as { result: ElicitationRespondResult }).result.outcome,
    ).toMatchObject({ kind: "result", result: { action: "decline" } });
    expect(declineRound.message.respond).toHaveBeenCalledWith({
      action: "decline",
      content: undefined,
    });

    // url mode
    const urlRound = makeUrlMessage("elicit-u");
    runMethodMock.impl = async () => {
      emit(urlRound.message);
      const answer = await urlRound.answered;
      return { kind: "result", result: { action: answer.action } };
    };
    const parked = await rpcCallTool("r3");
    const info = (
      (parked as { result: RpcResult }).result as {
        elicitation: ElicitationPendingInfo;
      }
    ).elicitation;
    expect(info.mode).toBe("url");
    expect(info.url).toBe("https://example.com/signup?flow=abc");

    const badDecline = await respond("r4", {
      elicitationId: "elicit-u",
      action: "decline",
    });
    expect(badDecline.ok).toBe(false);
    expect((badDecline as { error: { code: string } }).error.code).toBe(
      "invalid_params",
    );
    const badContent = await respond("r5", {
      elicitationId: "elicit-u",
      action: "accept",
      content: { nope: 1 },
    });
    expect(badContent.ok).toBe(false);

    // Validation failures put the entry back — a corrected accept still works.
    const done = await respond("r6", {
      elicitationId: "elicit-u",
      action: "accept",
    });
    expect(done.ok).toBe(true);
    expect(
      (done as { result: ElicitationRespondResult }).result.outcome,
    ).toMatchObject({ kind: "result", result: { action: "accept" } });
    expect(urlRound.message.respond).toHaveBeenCalledWith({
      action: "accept",
      content: undefined,
    });
  });

  it("returns the plain result when a parked-mode call never elicits, and propagates failures", async () => {
    runMethodMock.impl = async () => ({ kind: "result", result: { n: 1 } });
    const plain = await rpcCallTool("r1");
    expect((plain as { result: RpcResult }).result).toMatchObject({
      kind: "result",
      result: { n: 1 },
    });

    runMethodMock.impl = async () => {
      throw new Error("server exploded");
    };
    const failed = await rpcCallTool("r2");
    expect(failed.ok).toBe(false);
    expect((failed as { error: { message: string } }).error.message).toContain(
      "server exploded",
    );
  });

  it("propagates a failure that lands after the elicitation was answered", async () => {
    const round = makeFormMessage("elicit-f");
    runMethodMock.impl = async () => {
      emit(round.message);
      await round.answered;
      throw new Error("tool failed after input");
    };
    await rpcCallTool("r1");
    const failed = await respond("r2", {
      elicitationId: "elicit-f",
      action: "accept",
      content: { color: "red" },
    });
    expect(failed.ok).toBe(false);
    expect((failed as { error: { message: string } }).error.message).toContain(
      "tool failed after input",
    );
  });

  it("rejects new rpcs on a connection with a parked call", async () => {
    const round = makeFormMessage("elicit-g");
    runMethodMock.impl = async () => {
      emit(round.message);
      await round.answered;
      return { kind: "result", result: {} };
    };
    await rpcCallTool("r1");
    const blocked = await server.handle({
      id: "r2",
      op: "rpc",
      params: { method: "tools/list", name: "srv" },
    });
    expect(blocked.ok).toBe(false);
    expect((blocked as { error: { code: string } }).error.code).toBe(
      "elicitation_pending",
    );
    expect((blocked as { error: { message: string } }).error.message).toContain(
      "elicitation/respond elicit-g",
    );
    // Unblock: cancel it.
    const cancelled = await respond("r3", {
      elicitationId: "elicit-g",
      action: "cancel",
    });
    expect(cancelled.ok).toBe(true);
  });

  it("expires an unanswered parked elicitation and cancels the message", async () => {
    server = new DaemonServer({ dir, idleMs: 0, elicitationTtlMs: 40 });
    const registry = server.registry as unknown as Record<string, unknown>;
    registry.connectionFor = () => ({ name: "srv", client });
    registry.liveClientFor = async () => client;

    const round = makeFormMessage("elicit-x");
    runMethodMock.impl = async () => {
      emit(round.message);
      await round.answered;
      return { kind: "result", result: {} };
    };
    const parked = await rpcCallTool("r1");
    expect((parked as { result: RpcResult }).result.kind).toBe(
      "elicitation-pending",
    );
    await round.cancelled;
    expect(round.message.cancel).toHaveBeenCalled();
    const late = await respond("r2", {
      elicitationId: "elicit-x",
      action: "accept",
      content: { color: "red" },
    });
    expect(late.ok).toBe(false);
    expect((late as { error: { code: string } }).error.code).toBe(
      "elicitation_not_found",
    );
  });

  it("expired park cannot swallow a new call's elicitation (stale subscriber unwired)", async () => {
    server = new DaemonServer({ dir, idleMs: 0, elicitationTtlMs: 40 });
    const registry = server.registry as unknown as Record<string, unknown>;
    registry.connectionFor = () => ({ name: "srv", client });
    registry.liveClientFor = async () => client;

    // First call parks, then its park expires while the server-side call
    // keeps running (the server never gives up) — so its outcome `finally`
    // (the normal unwire point) has not fired.
    const round1 = makeFormMessage("elicit-stale");
    const neverSettles = deferred<never>();
    runMethodMock.impl = async () => {
      emit(round1.message);
      await neverSettles.promise;
      return { kind: "result", result: {} };
    };
    const parked1 = await rpcCallTool("r1");
    expect((parked1 as { result: RpcResult }).result.kind).toBe(
      "elicitation-pending",
    );
    await round1.cancelled; // expiry fired

    // A new call in that window: its elicitation must reach ITS subscriber,
    // not the expired park's closed channel (which would auto-cancel it).
    const round2 = makeFormMessage("elicit-fresh");
    runMethodMock.impl = async () => {
      emit(round2.message);
      await round2.answered;
      return { kind: "result", result: { ok: true } };
    };
    const parked2 = await rpcCallTool("r2");
    expect((parked2 as { result: RpcResult }).result.kind).toBe(
      "elicitation-pending",
    );
    expect(round2.message.cancel).not.toHaveBeenCalled();
    const done = await respond("r3", {
      elicitationId: "elicit-fresh",
      action: "accept",
      content: { color: "red" },
    });
    expect(done.ok).toBe(true);
  });

  it("disconnect cancels the parked call; respond then reports not found", async () => {
    const registry = server.registry as unknown as Record<string, unknown>;
    registry.disconnect = async () => ({ name: "srv" });

    const round = makeFormMessage("elicit-z");
    runMethodMock.impl = async () => {
      emit(round.message);
      await round.answered;
      return { kind: "result", result: {} };
    };
    await rpcCallTool("r1");
    const gone = await server.handle({
      id: "r2",
      op: "disconnect",
      params: { name: "srv" },
    });
    expect(gone.ok).toBe(true);
    expect(round.message.cancel).toHaveBeenCalled();
    const late = await respond("r3", {
      elicitationId: "elicit-z",
      action: "cancel",
    });
    expect(late.ok).toBe(false);
    expect((late as { error: { code: string } }).error.code).toBe(
      "elicitation_not_found",
    );
  });

  it("picks up a call that settled on its own while parked (server gave up waiting)", async () => {
    const round = makeFormMessage("elicit-s");
    runMethodMock.impl = async () => {
      emit(round.message);
      // Server-side timeout: the call completes without our answer.
      return { kind: "result", result: { timedOut: true } };
    };
    const parked = await rpcCallTool("r1");
    expect((parked as { result: RpcResult }).result.kind).toBe(
      "elicitation-pending",
    );
    const done = await respond("r2", {
      elicitationId: "elicit-s",
      action: "accept",
      content: { color: "red" },
    });
    expect(done.ok).toBe(true);
    expect(
      (done as { result: ElicitationRespondResult }).result.outcome,
    ).toMatchObject({ kind: "result", result: { timedOut: true } });
  });

  it("validates respond params", async () => {
    const missing = await respond("r1", { action: "accept" });
    expect((missing as { error: { code: string } }).error.code).toBe(
      "invalid_params",
    );
    const badAction = await respond("r2", {
      elicitationId: "x",
      action: "shrug",
    });
    expect((badAction as { error: { code: string } }).error.code).toBe(
      "invalid_params",
    );
    const unknown = await respond("r3", {
      elicitationId: "nope",
      action: "cancel",
    });
    expect((unknown as { error: { code: string } }).error.code).toBe(
      "elicitation_not_found",
    );
  });
});

describe("ParkingElicitationChannel / ElicitationParkRegistry primitives", () => {
  const frame = (elicitationId: string) =>
    ({
      id: "req-1",
      kind: "elicitation-request",
      elicitationId,
      mode: "form",
      message: "hi",
      origin: "server-request",
    }) as const;

  it("answer() is a no-op with nothing pending; request after close rejects", async () => {
    const channel = new ParkingElicitationChannel();
    channel.answer({
      id: "req-1",
      kind: "elicitation-response",
      elicitationId: "none",
      action: "cancel",
    });
    channel.close(new Error("gone"));
    await expect(channel.request(frame("later"))).rejects.toThrow("gone");
  });

  it("close rejects a pending request and clears the waiter", async () => {
    const channel = new ParkingElicitationChannel();
    const pending = channel.request(frame("e1"));
    expect(channel.pendingFrame()?.elicitationId).toBe("e1");
    channel.close(new Error("teardown"));
    await expect(pending).rejects.toThrow("teardown");
    expect(channel.pendingFrame()).toBeNull();
  });

  it("waitForElicitation resolves immediately when a request is already pending", async () => {
    const channel = new ParkingElicitationChannel();
    const pending = channel.request(frame("e1"));
    const seen = await channel.waitForElicitation();
    expect(seen.elicitationId).toBe("e1");
    channel.close(new Error("teardown"));
    await expect(pending).rejects.toThrow("teardown");
  });

  it("forClient and cancelForConnection ignore non-matching entries", async () => {
    const registry = new ElicitationParkRegistry(0);
    const channel = new ParkingElicitationChannel();
    const pending = channel.request(frame("e1"));
    const client = {} as InspectorClient;
    registry.add({
      info: {
        elicitationId: "e1",
        connection: "srv",
        method: "tools/call",
        mode: "form",
        message: "hi",
        origin: "server-request",
      },
      client,
      channel,
      outcome: new Promise<never>(() => {}),
      unwire: () => {},
    });
    expect(registry.forClient({} as InspectorClient)).toBeUndefined();
    expect(registry.forClient(client)).toBeDefined();
    // A different connection's teardown must not cancel this parked call.
    registry.cancelForConnection("other");
    expect(registry.forClient(client)).toBeDefined();
    registry.cancelAll();
    await expect(pending).rejects.toThrow(/going away/);
  });

  it("cancelAll settles every parked entry", async () => {
    const registry = new ElicitationParkRegistry(0);
    const channel = new ParkingElicitationChannel();
    const pending = channel.request(frame("e1"));
    const unwire = vi.fn();
    registry.add({
      info: {
        elicitationId: "e1",
        connection: "srv",
        method: "tools/call",
        mode: "form",
        message: "hi",
        origin: "server-request",
      },
      client: {} as InspectorClient,
      channel,
      outcome: new Promise<never>(() => {}),
      unwire,
    });
    registry.cancelAll();
    await expect(pending).rejects.toThrow(/going away/);
    expect(() => registry.take("e1")).toThrow(/No pending elicitation/);
    // Cancel must also unwire the bridge subscriber of the abandoned call.
    expect(unwire).toHaveBeenCalled();
  });

  it("expiry unwires the bridge subscriber of the abandoned call", async () => {
    const registry = new ElicitationParkRegistry(20);
    const channel = new ParkingElicitationChannel();
    const pending = channel.request(frame("e2"));
    const unwire = vi.fn();
    registry.add({
      info: {
        elicitationId: "e2",
        connection: "srv",
        method: "tools/call",
        mode: "form",
        message: "hi",
        origin: "server-request",
      },
      client: {} as InspectorClient,
      channel,
      outcome: new Promise<never>(() => {}),
      unwire,
    });
    await expect(pending).rejects.toThrow(/expired/);
    expect(unwire).toHaveBeenCalled();
  });
});
