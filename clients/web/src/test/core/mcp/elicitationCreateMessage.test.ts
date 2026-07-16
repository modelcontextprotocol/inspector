import { describe, it, expect, vi } from "vitest";
import type { ElicitRequest } from "@modelcontextprotocol/client";
import { ElicitationCreateMessage } from "@inspector/core/mcp/elicitationCreateMessage.js";

function urlRequest(): ElicitRequest {
  return {
    method: "elicitation/create",
    params: {
      mode: "url",
      url: "https://example.com/authorize",
      message: "Authorize to continue.",
      elicitationId: "elicit-1",
    },
  } as ElicitRequest;
}

describe("ElicitationCreateMessage.completeIfPending", () => {
  it("resolves as accepted and removes when still pending", async () => {
    const resolve = vi.fn();
    const onRemove = vi.fn();
    const message = new ElicitationCreateMessage(
      urlRequest(),
      resolve,
      onRemove,
    );

    message.completeIfPending();
    // respond() is async (it awaits the microtask in remove path); flush.
    await Promise.resolve();

    expect(resolve).toHaveBeenCalledWith({ action: "accept" });
    expect(onRemove).toHaveBeenCalledWith(message.id);
  });

  it("is a no-op once the elicitation has already been responded to", async () => {
    const resolve = vi.fn();
    const onRemove = vi.fn();
    const message = new ElicitationCreateMessage(
      urlRequest(),
      resolve,
      onRemove,
    );

    await message.respond({ action: "cancel" });
    resolve.mockClear();
    onRemove.mockClear();

    // A late completion notification must not re-resolve (respond() would throw
    // "already resolved").
    expect(() => message.completeIfPending()).not.toThrow();
    await Promise.resolve();
    expect(resolve).not.toHaveBeenCalled();
    expect(onRemove).not.toHaveBeenCalled();
  });
});

describe("ElicitationCreateMessage.cancel", () => {
  it("resolves a pending elicitation as cancelled without removing it", () => {
    const resolve = vi.fn();
    const onRemove = vi.fn();
    const message = new ElicitationCreateMessage(
      urlRequest(),
      resolve,
      onRemove,
    );

    message.cancel();

    // Settles the awaiting promise (so callTool unblocks on teardown) but does
    // not splice the queue — disconnect() clears it wholesale.
    expect(resolve).toHaveBeenCalledWith({ action: "cancel" });
    expect(onRemove).not.toHaveBeenCalled();
  });

  it("is a no-op once already responded to", async () => {
    const resolve = vi.fn();
    const onRemove = vi.fn();
    const message = new ElicitationCreateMessage(
      urlRequest(),
      resolve,
      onRemove,
    );

    await message.respond({ action: "accept" });
    resolve.mockClear();

    message.cancel();
    expect(resolve).not.toHaveBeenCalled();
  });
});
