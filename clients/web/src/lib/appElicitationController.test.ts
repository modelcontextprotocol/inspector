import { describe, it, expect, vi } from "vitest";
import type { ElicitRequest } from "@modelcontextprotocol/client";
import { AppElicitationController } from "./appElicitationController";

const params: ElicitRequest["params"] = {
  message: "Choose an option",
  requestedSchema: { type: "object", properties: {} },
};

function request(
  controller: AppElicitationController,
  requestId: string,
  resourceUri = "ui://demo/pick.html",
  signal: AbortSignal = new AbortController().signal,
) {
  return controller.render({ requestId, resourceUri, params, signal });
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

  it("stops notifying an unsubscribed listener", () => {
    const controller = new AppElicitationController();
    const listener = vi.fn();
    const unsubscribe = controller.subscribe(listener);
    unsubscribe();
    void request(controller, "a").catch(() => {});
    expect(listener).not.toHaveBeenCalled();
  });
});
