import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ConsoleNavigation, CallbackNavigation } from "../../auth/providers.js";
import { BrowserNavigation } from "../../auth/browser/providers.js";

describe("OAuthNavigation", () => {
  describe("ConsoleNavigation", () => {
    it("should log authorization URL to console", () => {
      const navigation = new ConsoleNavigation();
      const authUrl = new URL("http://example.com/authorize?client_id=123");

      const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

      navigation.navigateToAuthorization(authUrl);

      expect(consoleSpy).toHaveBeenCalledWith(
        "Please navigate to: http://example.com/authorize?client_id=123",
      );

      consoleSpy.mockRestore();
    });
  });

  describe("CallbackNavigation", () => {
    it("should invoke callback and store authorization URL for retrieval", () => {
      const callback = vi.fn();
      const navigation = new CallbackNavigation(callback);
      const authUrl = new URL("http://example.com/authorize?client_id=123");

      expect(navigation.getAuthorizationUrl()).toBeNull();

      navigation.navigateToAuthorization(authUrl);

      expect(callback).toHaveBeenCalledWith(authUrl);
      expect(navigation.getAuthorizationUrl()).toBe(authUrl);
    });
  });

  describe("BrowserNavigation", () => {
    // Mock window.location for Node.js environment
    type GlobalWithWindow = typeof globalThis & {
      window?: { location: { href: string } };
    };
    const originalWindow = (global as GlobalWithWindow).window;

    beforeEach(() => {
      (global as GlobalWithWindow).window = {
        location: { href: "http://localhost:5173" },
      } as GlobalWithWindow["window"];
    });

    afterEach(() => {
      (global as GlobalWithWindow).window = originalWindow;
    });

    it("should set window.location.href to authorization URL", () => {
      const navigation = new BrowserNavigation();
      const authUrl = new URL("http://example.com/authorize?client_id=123");

      navigation.navigateToAuthorization(authUrl);

      expect((global as GlobalWithWindow).window!.location.href).toBe(
        authUrl.toString(),
      );
    });

    it("should throw error in non-browser environment", () => {
      (global as GlobalWithWindow).window =
        undefined as unknown as GlobalWithWindow["window"];
      const navigation = new BrowserNavigation();
      const authUrl = new URL("http://example.com/authorize");

      expect(() => navigation.navigateToAuthorization(authUrl)).toThrow(
        "BrowserNavigation requires browser environment",
      );
    });
  });
});
