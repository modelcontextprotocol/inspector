import { describe, it, expect, vi } from "vitest";
import type { ElicitRequest } from "@modelcontextprotocol/client";
import {
  AppElicitationController,
  type AppElicitationSession,
} from "./appElicitationController";

const params: ElicitRequest["params"] = {
  message: "Choose an option",
  requestedSchema: { type: "object", properties: {} },
};

/**
 * Queue a request through a session. Defaults to one session per controller,
 * which is what a single connection looks like; the session tests open their
 * own to model a client swap.
 */
function request(
  controller: AppElicitationController,
  requestId: string,
  resourceUri = "ui://demo/pick.html",
  signal: AbortSignal = new AbortController().signal,
  session: AppElicitationSession = defaultSession(controller),
) {
  return session.render({ requestId, resourceUri, params, signal });
}

const sessions = new WeakMap<AppElicitationController, AppElicitationSession>();
function defaultSession(
  controller: AppElicitationController,
): AppElicitationSession {
  let session = sessions.get(controller);
  if (!session) {
    session = controller.openSession();
    sessions.set(controller, session);
  }
  return session;
}

describe("AppElicitationController (#1854)", () => {
  it("queues a request and notifies subscribers", () => {
    const controller = new AppElicitationController();
    const listener = vi.fn();
    controller.subscribe(listener);

    void request(controller, "a").catch(() => {});

    expect(listener).toHaveBeenCalledTimes(1);
    expect(controller.getEntries()).toHaveLength(1);
    expect(controller.getEntries()[0]).toMatchObject({
      requestId: "a",
      resourceUri: "ui://demo/pick.html",
    });
  });

  it("keeps the entries array identity stable between changes", () => {
    // `useSyncExternalStore` re-renders on every getSnapshot identity change,
    // so a fresh array per read would loop forever.
    const controller = new AppElicitationController();
    expect(controller.getEntries()).toBe(controller.getEntries());
  });

  it("settle resolves the render promise and drops the entry", async () => {
    const controller = new AppElicitationController();
    const pending = request(controller, "a");
    controller.settle("a", { action: "accept", content: { choice: "x" } });
    await expect(pending).resolves.toEqual({
      action: "accept",
      content: { choice: "x" },
    });
    expect(controller.getEntries()).toHaveLength(0);
  });

  it("fail rejects the render promise so the client falls back", async () => {
    const controller = new AppElicitationController();
    const pending = request(controller, "a");
    controller.fail("a", new Error("sandbox unavailable"));
    await expect(pending).rejects.toThrow(/sandbox unavailable/);
    expect(controller.getEntries()).toHaveLength(0);
  });

  it("settling an unknown or already-settled id is a no-op", async () => {
    const controller = new AppElicitationController();
    const pending = request(controller, "a");
    controller.settle("a", { action: "cancel" });
    await expect(pending).resolves.toEqual({ action: "cancel" });
    // A second settle must not throw — the modal's unmount and the client's
    // abort can race, and both call in.
    expect(() => controller.settle("a", { action: "decline" })).not.toThrow();
    expect(() => controller.fail("nope", new Error("x"))).not.toThrow();
  });

  it("keeps concurrent requests independent", async () => {
    const controller = new AppElicitationController();
    const first = request(controller, "a", "ui://demo/first.html");
    const second = request(controller, "b", "ui://demo/second.html");
    expect(controller.getEntries().map((e) => e.requestId)).toEqual(["a", "b"]);

    controller.settle("b", { action: "accept", content: { choice: "b" } });
    expect(controller.getEntries().map((e) => e.requestId)).toEqual(["a"]);
    await expect(second).resolves.toMatchObject({ content: { choice: "b" } });

    controller.settle("a", { action: "accept", content: { choice: "a" } });
    await expect(first).resolves.toMatchObject({ content: { choice: "a" } });
  });

  it("drops and rejects an entry when the originating request aborts", async () => {
    const controller = new AppElicitationController();
    const aborter = new AbortController();
    const pending = request(
      controller,
      "a",
      "ui://demo/pick.html",
      aborter.signal,
    );
    expect(controller.getEntries()).toHaveLength(1);
    aborter.abort();
    await expect(pending).rejects.toThrow(/aborted/);
    expect(controller.getEntries()).toHaveLength(0);
  });

  it("never queues a request whose signal already aborted", async () => {
    const controller = new AppElicitationController();
    const aborter = new AbortController();
    aborter.abort();
    await expect(
      request(controller, "a", "ui://demo/pick.html", aborter.signal),
    ).rejects.toThrow(/aborted/);
    expect(controller.getEntries()).toHaveLength(0);
  });

  it("closing a session drops the entries that session queued", async () => {
    // The host closes the old session when the InspectorClient is replaced: the
    // bridge factory resolves its client at call time, so an entry left queued
    // could otherwise rebuild against the NEXT connection and answer through a
    // different server.
    const controller = new AppElicitationController();
    const session = controller.openSession();
    const listener = vi.fn();
    const first = request(controller, "a", "ui://a", undefined, session);
    const second = request(controller, "b", "ui://b", undefined, session);
    controller.subscribe(listener);

    session.close(new Error("connection replaced"));

    await expect(first).rejects.toThrow(/connection replaced/);
    await expect(second).rejects.toThrow(/connection replaced/);
    expect(controller.getEntries()).toHaveLength(0);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("refuses a request a closed session makes during its own teardown", async () => {
    // The half a one-shot sweep cannot provide: the replaced client
    // disconnects asynchronously and can still enqueue, and that entry would be
    // rendered by a factory bound to the REPLACEMENT client.
    const controller = new AppElicitationController();
    const session = controller.openSession();
    session.close(new Error("connection replaced"));
    await expect(
      request(controller, "late", "ui://a", undefined, session),
    ).rejects.toThrow(/session is closed/);
    expect(controller.getEntries()).toHaveLength(0);
  });

  it("leaves another session's entries alone", async () => {
    const controller = new AppElicitationController();
    const oldSession = controller.openSession();
    const newSession = controller.openSession();
    const stale = request(controller, "a", "ui://a", undefined, oldSession);
    const live = request(controller, "b", "ui://b", undefined, newSession);

    oldSession.close(new Error("connection replaced"));

    await expect(stale).rejects.toThrow(/connection replaced/);
    expect(controller.getEntries().map((e) => e.requestId)).toEqual(["b"]);
    controller.settle("b", { action: "cancel" });
    await expect(live).resolves.toEqual({ action: "cancel" });
  });

  it("closing a session with nothing queued notifies nobody", () => {
    const controller = new AppElicitationController();
    const session = controller.openSession();
    const listener = vi.fn();
    controller.subscribe(listener);
    session.close(new Error("nothing to drop"));
    expect(listener).not.toHaveBeenCalled();
  });

  it("stops notifying an unsubscribed listener", () => {
    const controller = new AppElicitationController();
    const listener = vi.fn();
    const unsubscribe = controller.subscribe(listener);
    unsubscribe();
    void request(controller, "a").catch(() => {});
    expect(listener).not.toHaveBeenCalled();
  });
});
