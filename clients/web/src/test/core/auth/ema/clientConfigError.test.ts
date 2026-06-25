import { describe, it, expect } from "vitest";
import {
  EmaClientNotConfiguredError,
  emaClientNotConfiguredMessage,
  isEmaClientNotConfiguredError,
} from "@inspector/core/auth/ema/clientConfigError.js";

describe("clientConfigError", () => {
  describe("emaClientNotConfiguredMessage", () => {
    it("returns disabled guidance when Enterprise IdP is turned off", () => {
      expect(emaClientNotConfiguredMessage("disabled")).toContain(
        "Enterprise IdP is turned off in Client Settings",
      );
    });

    it("returns setup guidance when IdP is not configured", () => {
      expect(emaClientNotConfiguredMessage("not_configured")).toContain(
        "client IdP is not configured",
      );
    });
  });

  describe("EmaClientNotConfiguredError", () => {
    it("uses the reason-specific message", () => {
      const err = new EmaClientNotConfiguredError("disabled");
      expect(err.message).toBe(emaClientNotConfiguredMessage("disabled"));
      expect(err.reason).toBe("disabled");
      expect(err.name).toBe("EmaClientNotConfiguredError");
    });
  });

  describe("isEmaClientNotConfiguredError", () => {
    it("returns true for EmaClientNotConfiguredError", () => {
      expect(
        isEmaClientNotConfiguredError(
          new EmaClientNotConfiguredError("not_configured"),
        ),
      ).toBe(true);
    });

    it("returns false for other errors", () => {
      expect(isEmaClientNotConfiguredError(new Error("other"))).toBe(false);
    });
  });
});
