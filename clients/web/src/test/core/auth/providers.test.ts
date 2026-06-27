import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  ConsoleNavigation,
  CallbackNavigation,
  MutableRedirectUrlProvider,
  BaseOAuthClientProvider,
  type OAuthProviderConfig,
} from "@inspector/core/auth/providers.js";
import type { OAuthStorage } from "@inspector/core/auth/storage.js";
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

    it("tolerates a callback that returns a Promise (fire-and-forget)", () => {
      const callback = vi.fn(async () => undefined);
      const navigation = new CallbackNavigation(callback);
      const authUrl = new URL("http://example.com/authorize?async=1");

      // Should not throw even though the returned Promise is not awaited; the
      // `void result` branch handles the Promise case.
      expect(() => navigation.navigateToAuthorization(authUrl)).not.toThrow();
      expect(callback).toHaveBeenCalledWith(authUrl);
      expect(navigation.getAuthorizationUrl()).toBe(authUrl);
    });
  });

  describe("MutableRedirectUrlProvider", () => {
    it("returns the mutable redirectUrl for any execution mode", () => {
      const provider = new MutableRedirectUrlProvider();
      expect(provider.getRedirectUrl()).toBe("");

      provider.redirectUrl = "http://127.0.0.1:9000/oauth/callback";
      expect(provider.getRedirectUrl()).toBe(
        "http://127.0.0.1:9000/oauth/callback",
      );
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

    it("runs beforeNavigate synchronously BEFORE assigning location.href", () => {
      // The pre-redirect persistence relies on this ordering: the hook must
      // observe the still-current document (location.href not yet reassigned)
      // so a keepalive request it fires outlives the navigation.
      const order: string[] = [];
      const authUrl = new URL("http://example.com/authorize?state=normal:abc");
      const navigation = new BrowserNavigation(undefined, (url) => {
        order.push("before");
        // At hook time the redirect has not happened yet.
        expect((global as GlobalWithWindow).window!.location.href).toBe(
          "http://localhost:5173",
        );
        expect(url.toString()).toBe(authUrl.toString());
      });

      navigation.navigateToAuthorization(authUrl);
      order.push("after");

      expect(order).toEqual(["before", "after"]);
      expect((global as GlobalWithWindow).window!.location.href).toBe(
        authUrl.toString(),
      );
    });

    it("still navigates when no beforeNavigate hook is provided", () => {
      const navigation = new BrowserNavigation();
      const authUrl = new URL("http://example.com/authorize");
      navigation.navigateToAuthorization(authUrl);
      expect((global as GlobalWithWindow).window!.location.href).toBe(
        authUrl.toString(),
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

  describe("BaseOAuthClientProvider", () => {
    const SERVER = "https://mcp.example.com";

    function makeStorage(): OAuthStorage {
      return {
        getScope: vi.fn(() => undefined),
        getClientInformation: vi.fn(async () => undefined),
        saveClientInformation: vi.fn(async () => undefined),
        savePreregisteredClientInformation: vi.fn(async () => undefined),
        saveScope: vi.fn(async () => undefined),
        getTokens: vi.fn(async () => undefined),
        saveTokens: vi.fn(async () => undefined),
        saveCodeVerifier: vi.fn(async () => undefined),
        getCodeVerifier: vi.fn(() => undefined),
        clear: vi.fn(),
        getServerMetadata: vi.fn(() => null),
        saveServerMetadata: vi.fn(async () => undefined),
      } as unknown as OAuthStorage;
    }

    function makeProvider(
      storage: OAuthStorage,
      navCallback = vi.fn(),
    ): BaseOAuthClientProvider {
      const config: OAuthProviderConfig = {
        storage,
        redirectUrlProvider: new MutableRedirectUrlProvider(),
        navigation: new CallbackNavigation(navCallback),
      };
      return new BaseOAuthClientProvider(SERVER, config);
    }

    it("clear() delegates to storage.clear with the server url", () => {
      const storage = makeStorage();
      const provider = makeProvider(storage);

      provider.clear();

      expect(storage.clear).toHaveBeenCalledWith(SERVER);
    });

    it("clientInformation() returns preregistered info when present", async () => {
      const storage = makeStorage();
      vi.mocked(storage.getClientInformation).mockImplementation(
        async (_url: string, preregistered?: boolean) =>
          preregistered ? { client_id: "pre" } : { client_id: "dyn" },
      );
      const provider = makeProvider(storage);

      expect(await provider.clientInformation()).toEqual({ client_id: "pre" });
    });

    it("clientInformation() falls back to dynamic info when no preregistered info", async () => {
      const storage = makeStorage();
      vi.mocked(storage.getClientInformation).mockImplementation(
        async (_url: string, preregistered?: boolean) =>
          preregistered ? undefined : { client_id: "dyn" },
      );
      const provider = makeProvider(storage);

      expect(await provider.clientInformation()).toEqual({ client_id: "dyn" });
    });

    it("codeVerifier() throws when none is saved", () => {
      const storage = makeStorage();
      const provider = makeProvider(storage);

      expect(() => provider.codeVerifier()).toThrow(
        /No code verifier saved for session/,
      );
    });

    it("codeVerifier() returns the saved verifier", () => {
      const storage = makeStorage();
      vi.mocked(storage.getCodeVerifier).mockReturnValue("cv-1");
      const provider = makeProvider(storage);

      expect(provider.codeVerifier()).toBe("cv-1");
    });

    it("clientMetadata reflects the stored scope when present", () => {
      const storage = makeStorage();
      vi.mocked(storage.getScope).mockReturnValue("read write");
      const provider = makeProvider(storage);

      expect(provider.clientMetadata.scope).toBe("read write");
    });

    it("redirectToAuthorization dispatches an event when an event target is set", () => {
      const storage = makeStorage();
      const navCallback = vi.fn();
      const provider = makeProvider(storage, navCallback);
      const target = new EventTarget();
      const handler = vi.fn();
      target.addEventListener("oauthAuthorizationRequired", handler);
      provider.setEventTarget(target);

      const url = new URL("https://mcp.example.com/authorize");
      provider.redirectToAuthorization(url);

      expect(handler).toHaveBeenCalledTimes(1);
      expect(provider.getCapturedAuthUrl()).toBe(url);
      expect(navCallback).toHaveBeenCalledWith(url);

      provider.clearCapturedAuthUrl();
      expect(provider.getCapturedAuthUrl()).toBeNull();
    });

    it("redirectToAuthorization works without an event target", () => {
      const storage = makeStorage();
      const navCallback = vi.fn();
      const provider = makeProvider(storage, navCallback);

      const url = new URL("https://mcp.example.com/authorize");
      expect(() => provider.redirectToAuthorization(url)).not.toThrow();
      expect(provider.getCapturedAuthUrl()).toBe(url);
      expect(navCallback).toHaveBeenCalledWith(url);
    });

    it("delegates token and scope persistence to storage", async () => {
      const storage = makeStorage();
      const provider = makeProvider(storage);

      await provider.saveTokens({ access_token: "t", token_type: "Bearer" });
      await provider.saveScope("openid");
      await provider.saveClientInformation({ client_id: "c" });
      await provider.savePreregisteredClientInformation({ client_id: "p" });
      await provider.saveCodeVerifier("cv");
      await provider.saveServerMetadata({
        issuer: SERVER,
        authorization_endpoint: `${SERVER}/a`,
        token_endpoint: `${SERVER}/t`,
        response_types_supported: ["code"],
      });

      expect(storage.saveTokens).toHaveBeenCalledWith(SERVER, {
        access_token: "t",
        token_type: "Bearer",
      });
      expect(storage.saveScope).toHaveBeenCalledWith(SERVER, "openid");
      expect(storage.saveClientInformation).toHaveBeenCalledWith(SERVER, {
        client_id: "c",
      });
      expect(storage.savePreregisteredClientInformation).toHaveBeenCalledWith(
        SERVER,
        { client_id: "p" },
      );
      expect(storage.saveCodeVerifier).toHaveBeenCalledWith(SERVER, "cv");
      expect(storage.saveServerMetadata).toHaveBeenCalled();
      expect(await provider.tokens()).toBeUndefined();
      expect(provider.getServerMetadata()).toBeNull();
      expect(await provider.state()).toMatch(/quick/);
    });
  });
});
