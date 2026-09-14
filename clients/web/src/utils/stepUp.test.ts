import { describe, expect, it } from "vitest";
import type { AuthChallenge } from "@inspector/core/auth/challenge.js";
import type { ServerEntry } from "@inspector/core/mcp/types.js";
import { isEmaStepUp, isStepUpConfirmation } from "./stepUp";

const challenge = (
  reason: AuthChallenge["reason"] = "insufficient_scope",
): AuthChallenge => ({ reason });

// Only `settings.enterpriseManaged` is read, so the rest of a ServerEntry is
// irrelevant here — build the narrow shape the adapters project from.
const server = (enterpriseManaged?: boolean): ServerEntry =>
  ({ settings: { enterpriseManaged } }) as ServerEntry;

describe("isEmaStepUp", () => {
  it("is true for insufficient_scope on an enterprise-managed server", () => {
    expect(isEmaStepUp(challenge(), server(true))).toBe(true);
  });

  it("is false when the server is not enterprise-managed", () => {
    expect(isEmaStepUp(challenge(), server(false))).toBe(false);
  });

  it("is false when there is no server at all", () => {
    expect(isEmaStepUp(challenge(), undefined)).toBe(false);
  });

  it("is false for a challenge that is not a scope step-up", () => {
    expect(isEmaStepUp(challenge("unauthorized"), server(true))).toBe(false);
  });
});

describe("isStepUpConfirmation", () => {
  it("covers both the standard and the enterprise-managed step-up", () => {
    expect(isStepUpConfirmation(challenge(), server(true))).toBe(true);
    expect(isStepUpConfirmation(challenge(), server(false))).toBe(true);
    expect(isStepUpConfirmation(challenge(), undefined)).toBe(true);
  });

  it("is false for a challenge that is not a scope step-up", () => {
    expect(isStepUpConfirmation(challenge("unauthorized"), server(true))).toBe(
      false,
    );
  });
});
