import { describe, it, expect } from "vitest";
import { TypedEventTarget } from "@inspector/core/mcp/typedEventTarget";
import { waitForChangeEvent } from "./waitForChangeEvent";

interface TestEventMap {
  ping: number;
}

describe("waitForChangeEvent", () => {
  it("resolves with the event detail when the event fires", async () => {
    const target = new TypedEventTarget<TestEventMap>();
    const pending = waitForChangeEvent(target, "ping", 1000);
    target.dispatchTypedEvent("ping", 42);
    await expect(pending).resolves.toBe(42);
  });

  it("rejects with a readable message naming the event on timeout", async () => {
    // The point of the helper: a connect-path refresh that never dispatches its
    // change event surfaces as a fast, named failure instead of hanging to the
    // vitest per-test timeout.
    const target = new TypedEventTarget<TestEventMap>();
    await expect(waitForChangeEvent(target, "ping", 25)).rejects.toThrow(
      'Timed out after 25ms waiting for "ping" event',
    );
  });

  it("does not reject after the event has already resolved", async () => {
    const target = new TypedEventTarget<TestEventMap>();
    const pending = waitForChangeEvent(target, "ping", 25);
    target.dispatchTypedEvent("ping", 7);
    await expect(pending).resolves.toBe(7);
    // Wait past the timeout window; the cleared timer must not reject a
    // settled promise (an unhandled rejection would fail the run).
    await new Promise((resolve) => setTimeout(resolve, 50));
  });
});
