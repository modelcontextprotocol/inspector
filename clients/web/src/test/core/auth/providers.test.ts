import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  ConsoleNavigation,
  CallbackNavigation,
} from "@inspector/core/auth/providers.js";
import {
  BrowserNavigation,
  BrowserOAuthClientProvider,
} from "@inspector/core/auth/browser/providers.js";

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

  describe("BrowserOAuthClientProvider", () => {
    // Cast through unknown so we can install a minimal { location } stub
    // without needing the full Window surface in tests.
    type GlobalWithWindow = typeof globalThis & {
      window?: unknown;
      sessionStorage?: Storage;
    };
    const originalWindow = (global as GlobalWithWindow).window;
    const originalSessionStorage = (global as GlobalWithWindow).sessionStorage;

    class MemorySessionStorage implements Storage {
      private map = new Map<string, string>();
      get length() {
        return this.map.size;
      }
      key(i: number) {
        return [...this.map.keys()][i] ?? null;
      }
      getItem(k: string) {
        return this.map.get(k) ?? null;
      }
      setItem(k: string, v: string) {
        this.map.set(k, v);
      }
      removeItem(k: string) {
        this.map.delete(k);
      }
      clear() {
        this.map.clear();
      }
    }

    beforeEach(() => {
      // Cast through `unknown` so we can install a minimal { location } stub
      // without needing the full Window surface in tests.
      (global as unknown as { window?: unknown }).window = {
        location: {
          origin: "http://localhost:5173",
          href: "http://localhost:5173",
        },
      };
      (global as GlobalWithWindow).sessionStorage = new MemorySessionStorage();
    });

    afterEach(() => {
      (global as unknown as { window?: unknown }).window = originalWindow;
      (global as GlobalWithWindow).sessionStorage = originalSessionStorage;
    });

    it("constructs and exposes redirectUrl derived from window.location.origin", () => {
      const provider = new BrowserOAuthClientProvider(
        "https://mcp.example.com",
      );
      expect(provider.redirectUrl).toBe("http://localhost:5173/oauth/callback");
    });

    it("throws if window is undefined", () => {
      (global as unknown as { window?: unknown }).window = undefined;
      expect(
        () => new BrowserOAuthClientProvider("https://mcp.example.com"),
      ).toThrow(/requires browser environment/);
    });
  });
});
