import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  BrowserRedirectUrlProvider,
  LocalServerRedirectUrlProvider,
  ManualRedirectUrlProvider,
  BrowserNavigation,
  ConsoleNavigation,
  CallbackNavigation,
} from "../../auth/providers.js";

describe("RedirectUrlProvider", () => {
  describe("LocalServerRedirectUrlProvider", () => {
    it("should return normal callback URL for normal mode", () => {
      const provider = new LocalServerRedirectUrlProvider(3000, "normal");
      const url = provider.getRedirectUrl();

      expect(url).toBe("http://localhost:3000/oauth/callback");
    });

    it("should return guided callback URL for guided mode", () => {
      const provider = new LocalServerRedirectUrlProvider(3000, "guided");
      const url = provider.getRedirectUrl();

      expect(url).toBe("http://localhost:3000/oauth/callback/guided");
    });

    it("should default to normal mode", () => {
      const provider = new LocalServerRedirectUrlProvider(3000);
      const url = provider.getRedirectUrl();

      expect(url).toBe("http://localhost:3000/oauth/callback");
    });
  });

  describe("ManualRedirectUrlProvider", () => {
    it("should return normal callback URL for normal mode", () => {
      const provider = new ManualRedirectUrlProvider(
        "http://example.com",
        "normal",
      );
      const url = provider.getRedirectUrl();

      expect(url).toBe("http://example.com/oauth/callback");
    });

    it("should return guided callback URL for guided mode", () => {
      const provider = new ManualRedirectUrlProvider(
        "http://example.com",
        "guided",
      );
      const url = provider.getRedirectUrl();

      expect(url).toBe("http://example.com/oauth/callback/guided");
    });

    it("should handle base URL with trailing slash", () => {
      const provider = new ManualRedirectUrlProvider(
        "http://example.com/",
        "normal",
      );
      const url = provider.getRedirectUrl();

      expect(url).toBe("http://example.com/oauth/callback");
    });

    it("should default to normal mode", () => {
      const provider = new ManualRedirectUrlProvider("http://example.com");
      const url = provider.getRedirectUrl();

      expect(url).toBe("http://example.com/oauth/callback");
    });
  });

  describe("BrowserRedirectUrlProvider", () => {
    // Mock window.location for Node.js environment
    const originalWindow = global.window;

    beforeEach(() => {
      (global as any).window = {
        location: {
          origin: "http://localhost:5173",
        },
      };
    });

    afterEach(() => {
      global.window = originalWindow;
    });

    it("should return normal callback URL for normal mode", () => {
      const provider = new BrowserRedirectUrlProvider("normal");
      const url = provider.getRedirectUrl();

      expect(url).toBe("http://localhost:5173/oauth/callback");
    });

    it("should return guided callback URL for guided mode", () => {
      const provider = new BrowserRedirectUrlProvider("guided");
      const url = provider.getRedirectUrl();

      expect(url).toBe("http://localhost:5173/oauth/callback/guided");
    });

    it("should default to normal mode", () => {
      const provider = new BrowserRedirectUrlProvider();
      const url = provider.getRedirectUrl();

      expect(url).toBe("http://localhost:5173/oauth/callback");
    });

    it("should throw error in non-browser environment", () => {
      delete (global as any).window;
      const provider = new BrowserRedirectUrlProvider();

      expect(() => provider.getRedirectUrl()).toThrow(
        "BrowserRedirectUrlProvider requires browser environment",
      );
    });
  });
});

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
    it("should store authorization URL for later retrieval", () => {
      const navigation = new CallbackNavigation();
      const authUrl = new URL("http://example.com/authorize?client_id=123");

      expect(navigation.getAuthorizationUrl()).toBeNull();

      navigation.navigateToAuthorization(authUrl);

      expect(navigation.getAuthorizationUrl()).toBe(authUrl);
    });
  });

  describe("BrowserNavigation", () => {
    // Mock window.location for Node.js environment
    const originalWindow = global.window;

    beforeEach(() => {
      (global as any).window = {
        location: {
          href: "http://localhost:5173",
        },
      };
    });

    afterEach(() => {
      global.window = originalWindow;
    });

    it("should set window.location.href to authorization URL", () => {
      const navigation = new BrowserNavigation();
      const authUrl = new URL("http://example.com/authorize?client_id=123");

      navigation.navigateToAuthorization(authUrl);

      expect((global as any).window.location.href).toBe(authUrl.toString());
    });

    it("should throw error in non-browser environment", () => {
      delete (global as any).window;
      const navigation = new BrowserNavigation();
      const authUrl = new URL("http://example.com/authorize");

      expect(() => navigation.navigateToAuthorization(authUrl)).toThrow(
        "BrowserNavigation requires browser environment",
      );
    });
  });
});
