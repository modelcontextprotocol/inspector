import { describe, it, expect } from "vitest";
import type { PendingReauth } from "./pendingReauth.js";

describe("PendingReauth", () => {
  it("carries step-up source through deferred resume", () => {
    const pending: PendingReauth = {
      serverId: "srv-1",
      challenge: {
        reason: "insufficient_scope",
        requiredScopes: ["weather:read"],
      },
      authorizationUrl: new URL("https://as.example/authorize"),
      authKind: "step_up",
      source: "tool",
    };
    expect(pending.source).toBe("tool");
  });
});
