import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  ConsoleNavigation,
  CallbackNavigation,
  MutableRedirectUrlProvider,
  BaseOAuthClientProvider,
  type OAuthProviderConfig,
} from "@inspector/core/auth/providers.js";
import {
  auth,
  type StoredOAuthClientInformation,
} from "@modelcontextprotocol/client";
import type { OAuthStorage } from "@inspector/core/auth/storage.js";
import { OAuthStorageBase } from "@inspector/core/auth/oauth-storage.js";
import { OAuthMemoryStore } from "@inspector/core/auth/store.js";
import type { OAuthPersistBackend } from "@inspector/core/auth/oauth-persist.js";
import { ensureCimdClientRegistration } from "@inspector/core/auth/cimd.js";
import {
  createWebStoragePkceFlowStore,
  type PkceFlowStore,
} from "@inspector/core/auth/pkce-flow-store.js";
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
      const authUrl = new URL(
        `http://example.com/authorize?state=${"a".repeat(64)}`,
      );
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
        load: vi.fn().mockResolvedValue(undefined),
        getScope: vi.fn().mockResolvedValue(undefined),
        getClientInformation: vi.fn(async () => undefined),
        getClientRegistrationKind: vi.fn(async () => undefined),
        saveClientInformation: vi.fn(async () => undefined),
        savePreregisteredClientInformation: vi.fn(async () => undefined),
        saveScope: vi.fn(async () => undefined),
        getTokens: vi.fn(async () => undefined),
        saveTokens: vi.fn(async () => undefined),
        saveCodeVerifier: vi.fn(async () => undefined),
        getCodeVerifier: vi.fn().mockResolvedValue(undefined),
        clear: vi.fn(async () => undefined),
        clearTokens: vi.fn(async () => undefined),
        clearClientInformation: vi.fn(async () => undefined),
        clearCodeVerifier: vi.fn(async () => undefined),
        clearDiscoveryState: vi.fn(async () => undefined),
        getDiscoveryState: vi.fn().mockResolvedValue(undefined),
        saveDiscoveryState: vi.fn(async () => undefined),
        getServerMetadata: vi.fn().mockResolvedValue(null),
        saveServerMetadata: vi.fn(async () => undefined),
      } as unknown as OAuthStorage;
    }

    function makeProvider(
      storage: OAuthStorage,
      navCallback = vi.fn(),
      extraConfig: Partial<OAuthProviderConfig> = {},
    ): BaseOAuthClientProvider {
      const config: OAuthProviderConfig = {
        storage,
        redirectUrlProvider: new MutableRedirectUrlProvider(),
        navigation: new CallbackNavigation(navCallback),
        ...extraConfig,
      };
      return new BaseOAuthClientProvider(SERVER, config);
    }

    it("clear() delegates to storage.clear with the server url", async () => {
      const storage = makeStorage();
      const provider = makeProvider(storage);

      await provider.clear();

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

    it("codeVerifier() throws when none is saved", async () => {
      const storage = makeStorage();
      const provider = makeProvider(storage);

      await expect(provider.codeVerifier()).rejects.toThrow(
        /No code verifier saved for session/,
      );
    });

    it("codeVerifier() returns the saved verifier", async () => {
      const storage = makeStorage();
      vi.mocked(storage.getCodeVerifier).mockResolvedValue("cv-1");
      const provider = makeProvider(storage);

      expect(await provider.codeVerifier()).toBe("cv-1");
    });

    it("clientMetadata reflects the stored scope when present", async () => {
      const storage = makeStorage();
      vi.mocked(storage.getScope).mockResolvedValue("read write");
      const provider = makeProvider(storage);
      await provider.prepareForAuth();

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

    it("redirectToAuthorization captures URL but skips navigation when suppressed", () => {
      const storage = makeStorage();
      const navCallback = vi.fn();
      const provider = makeProvider(storage, navCallback);
      const url = new URL("https://mcp.example.com/authorize");

      provider.setSuppressAuthorizationNavigation(true);
      provider.redirectToAuthorization(url);

      expect(provider.getCapturedAuthUrl()).toBe(url);
      expect(navCallback).not.toHaveBeenCalled();

      provider.setSuppressAuthorizationNavigation(false);
      provider.redirectToAuthorization(url);
      expect(navCallback).toHaveBeenCalledWith(url);
    });

    // #2018 — the provider is the seam where per-server custom parameters reach
    // the authorize URL, since the SDK builds that URL with no hook of its own.
    function makeProviderWithParams(
      storage: OAuthStorage,
      authorizationParams: Record<string, string>,
      navCallback = vi.fn(),
    ): BaseOAuthClientProvider {
      return new BaseOAuthClientProvider(SERVER, {
        storage,
        redirectUrlProvider: new MutableRedirectUrlProvider(),
        navigation: new CallbackNavigation(navCallback),
        authorizationParams,
      });
    }

    it("redirectToAuthorization merges configured authorization params", () => {
      const storage = makeStorage();
      const navCallback = vi.fn();
      const provider = makeProviderWithParams(
        storage,
        { kc_idp_hint: "corp-idp" },
        navCallback,
      );
      const target = new EventTarget();
      const handler = vi.fn();
      target.addEventListener("oauthAuthorizationRequired", handler);
      provider.setEventTarget(target);

      const url = new URL("https://mcp.example.com/authorize?client_id=abc");
      provider.redirectToAuthorization(url);

      const navigated = navCallback.mock.calls[0]?.[0] as URL;
      expect(navigated.searchParams.get("kc_idp_hint")).toBe("corp-idp");
      expect(navigated.searchParams.get("client_id")).toBe("abc");
      // The captured URL, the event detail, and the navigation all agree.
      expect(provider.getCapturedAuthUrl()?.href).toBe(navigated.href);
      const detail = (handler.mock.calls[0]?.[0] as CustomEvent<{ url: URL }>)
        .detail;
      expect(detail.url.href).toBe(navigated.href);
      // The URL the SDK handed in is left untouched.
      expect(url.searchParams.get("kc_idp_hint")).toBeNull();
    });

    it("redirectToAuthorization refuses a reserved authorization param", () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const storage = makeStorage();
      const navCallback = vi.fn();
      const provider = makeProviderWithParams(
        storage,
        { state: "spoofed" },
        navCallback,
      );

      const url = new URL("https://mcp.example.com/authorize?state=real");
      provider.redirectToAuthorization(url);

      const navigated = navCallback.mock.calls[0]?.[0] as URL;
      expect(navigated.searchParams.get("state")).toBe("real");
      expect(warn).toHaveBeenCalled();
      warn.mockRestore();
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

      expect(storage.saveTokens).toHaveBeenCalledWith(
        SERVER,
        {
          access_token: "t",
          token_type: "Bearer",
        },
        { issuer: undefined },
      );
      expect(storage.saveScope).toHaveBeenCalledWith(SERVER, "openid");
      expect(storage.saveClientInformation).toHaveBeenCalledWith(
        SERVER,
        {
          client_id: "c",
        },
        { registrationKind: "dcr", issuer: undefined },
      );
      expect(storage.savePreregisteredClientInformation).toHaveBeenCalledWith(
        SERVER,
        { client_id: "p" },
      );
      expect(storage.saveCodeVerifier).toHaveBeenCalledWith(SERVER, "cv");
      expect(storage.saveServerMetadata).toHaveBeenCalled();
      expect(await provider.tokens()).toBeUndefined();
      expect(await provider.getServerMetadata()).toBeNull();
      const state = await provider.state();
      expect(typeof state).toBe("string");
      expect(state.length).toBeGreaterThan(0);
    });

    it("declares application_type 'native' in DCR client metadata (SEP-837)", () => {
      const provider = makeProvider(makeStorage());
      expect(provider.clientMetadata.application_type).toBe("native");
    });

    describe("requestRefreshToken (#2068)", () => {
      function makeProviderWithRefresh(
        requestRefreshToken: boolean | undefined,
      ): BaseOAuthClientProvider {
        return new BaseOAuthClientProvider(SERVER, {
          storage: makeStorage(),
          redirectUrlProvider: new MutableRedirectUrlProvider(),
          navigation: new CallbackNavigation(vi.fn()),
          requestRefreshToken,
        });
      }

      it("declares the refresh_token grant by default", () => {
        expect(makeProvider(makeStorage()).clientMetadata.grant_types).toEqual([
          "authorization_code",
          "refresh_token",
        ]);
      });

      it("declares the refresh_token grant when explicitly enabled", () => {
        expect(
          makeProviderWithRefresh(true).clientMetadata.grant_types,
        ).toEqual(["authorization_code", "refresh_token"]);
      });

      it("treats an omitted setting as enabled", () => {
        expect(
          makeProviderWithRefresh(undefined).clientMetadata.grant_types,
        ).toEqual(["authorization_code", "refresh_token"]);
      });

      // The point of the opt-out: the SDK's determineScope() only appends
      // `offline_access` when the client metadata declares `refresh_token`.
      // This asserts our half — the grant list. That the authorize URL then
      // carries neither `offline_access` nor `prompt=consent` is proved against
      // a real AS in the e2e suite (inspectorClient-oauth-e2e.test.ts), since
      // the SDK, not this array, is what ultimately writes that URL.
      it("drops the refresh_token grant when disabled", () => {
        expect(
          makeProviderWithRefresh(false).clientMetadata.grant_types,
        ).toEqual(["authorization_code"]);
      });

      // The regression that makes the opt-out actually work for a server that
      // already authorized once. A successful default-on grant persists the
      // AS-granted scope — `offline_access` included — and the provider reloads
      // it here. Handing that straight back to the SDK puts the token in scope
      // again, and `startAuthorization` appends `prompt=consent` off the scope
      // alone, so the box would be unchecked and AADSTS90094 would persist.
      describe("scope inherited from an earlier default-on grant", () => {
        function makeProviderWithScopes(
          storedScope: string,
          configuredScope: string | undefined,
          requestRefreshToken: boolean,
        ): { provider: BaseOAuthClientProvider; storage: OAuthStorage } {
          const storage = makeStorage();
          vi.mocked(storage.getScope).mockResolvedValue(storedScope);
          const provider = new BaseOAuthClientProvider(SERVER, {
            storage,
            redirectUrlProvider: new MutableRedirectUrlProvider(),
            navigation: new CallbackNavigation(vi.fn()),
            requestRefreshToken,
            configuredScope,
          });
          return { provider, storage };
        }

        it("drops the inherited offline_access from the requested scope", async () => {
          const { provider } = makeProviderWithScopes(
            "mcp offline_access",
            "mcp",
            false,
          );
          await provider.prepareForAuth();

          expect(provider.scope).toBe("mcp");
          expect(provider.clientMetadata.scope).toBe("mcp");
        });

        it("honors an offline_access the user configured", async () => {
          const { provider } = makeProviderWithScopes(
            "mcp offline_access",
            "mcp offline_access",
            false,
          );
          await provider.prepareForAuth();

          expect(provider.scope).toBe("mcp offline_access");
        });

        it("leaves the scope alone while the grant is declared", async () => {
          const { provider } = makeProviderWithScopes(
            "mcp offline_access",
            "mcp",
            true,
          );
          await provider.prepareForAuth();

          expect(provider.scope).toBe("mcp offline_access");
        });

        // Filtered at the point of request, never in storage: re-checking the
        // box must restore the previous behavior rather than find the value
        // destroyed, and the persisted scope is also what scope-satisfaction
        // checks read.
        it("does not rewrite the persisted scope", async () => {
          const { provider, storage } = makeProviderWithScopes(
            "mcp offline_access",
            "mcp",
            false,
          );
          await provider.prepareForAuth();
          void provider.scope;

          expect(storage.saveScope).not.toHaveBeenCalled();
        });
      });
    });

    describe("scopeForRefresh (#2805)", () => {
      function makeRefreshProvider(opts: {
        scopeOnRefresh?: boolean;
        storedScope?: string;
        configuredScope?: string;
        requestRefreshToken?: boolean;
      }): BaseOAuthClientProvider {
        const storage = makeStorage();
        vi.mocked(storage.getScope).mockResolvedValue(opts.storedScope);
        return new BaseOAuthClientProvider(SERVER, {
          storage,
          redirectUrlProvider: new MutableRedirectUrlProvider(),
          navigation: new CallbackNavigation(vi.fn()),
          scopeOnRefresh: opts.scopeOnRefresh,
          configuredScope: opts.configuredScope,
          requestRefreshToken: opts.requestRefreshToken,
        });
      }

      const grantedTokens = {
        access_token: "at",
        token_type: "Bearer",
        refresh_token: "rt",
        scope: "mcp tools:read",
      };

      // The default must leave the SDK's refresh request untouched: an
      // `undefined` here is what makes `auth()` send no `scope` at all.
      it("sends no scope by default", async () => {
        const provider = makeRefreshProvider({ storedScope: "mcp" });
        expect(await provider.scopeForRefresh(grantedTokens)).toBeUndefined();
      });

      it("sends no scope when explicitly off", async () => {
        const provider = makeRefreshProvider({
          scopeOnRefresh: false,
          storedScope: "mcp",
        });
        expect(await provider.scopeForRefresh(grantedTokens)).toBeUndefined();
      });

      it("sends the granted scope saved with the tokens", async () => {
        const provider = makeRefreshProvider({
          scopeOnRefresh: true,
          storedScope: "mcp",
          configuredScope: "mcp",
        });
        expect(await provider.scopeForRefresh(grantedTokens)).toBe(
          "mcp tools:read",
        );
      });

      // RFC 6749 §5.1: a token response omits `scope` when it equals the
      // requested one, so the request scope is what was granted.
      it("falls back to the stored request scope when the tokens carry none", async () => {
        const provider = makeRefreshProvider({
          scopeOnRefresh: true,
          storedScope: "  mcp offline_access ",
          configuredScope: "mcp",
        });
        expect(
          await provider.scopeForRefresh({ ...grantedTokens, scope: "  " }),
        ).toBe("mcp offline_access");
      });

      it("falls back to the configured scope when storage holds none", async () => {
        const provider = makeRefreshProvider({
          scopeOnRefresh: true,
          configuredScope: "mcp",
        });
        expect(
          await provider.scopeForRefresh({
            access_token: "at",
            token_type: "Bearer",
          }),
        ).toBe("mcp");
      });

      it("returns undefined when no scope is known anywhere", async () => {
        const provider = makeRefreshProvider({ scopeOnRefresh: true });
        expect(
          await provider.scopeForRefresh({
            access_token: "at",
            token_type: "Bearer",
          }),
        ).toBeUndefined();
      });

      // The fallback is the scope the authorization request used, and that
      // request went through the #2068 filter — so the fallback does too.
      it("applies the #2068 offline_access filter to the fallback scope", async () => {
        const provider = makeRefreshProvider({
          scopeOnRefresh: true,
          storedScope: "mcp offline_access",
          configuredScope: "mcp",
          requestRefreshToken: false,
        });
        expect(
          await provider.scopeForRefresh({
            access_token: "at",
            token_type: "Bearer",
          }),
        ).toBe("mcp");
      });
    });

    describe("SEP-2352 issuer threading", () => {
      it("forwards ctx.issuer to storage on clientInformation/tokens reads", async () => {
        const storage = makeStorage();
        const provider = makeProvider(storage);
        const issuer = "https://as.example.com";

        await provider.clientInformation({ issuer });
        await provider.tokens({ issuer });

        // Preregistered lookup (issuer-independent) then the per-issuer dynamic slot.
        expect(storage.getClientInformation).toHaveBeenCalledWith(SERVER, true);
        expect(storage.getClientInformation).toHaveBeenCalledWith(
          SERVER,
          false,
          issuer,
        );
        expect(storage.getTokens).toHaveBeenCalledWith(SERVER, issuer);
      });

      it("keys saves by ctx.issuer and defaults registration kind to dcr", async () => {
        const storage = makeStorage();
        const provider = makeProvider(storage);
        const issuer = "https://as.example.com";

        await provider.saveClientInformation({ client_id: "c" }, { issuer });
        await provider.saveTokens(
          { access_token: "t", token_type: "Bearer" },
          { issuer },
        );

        expect(storage.saveClientInformation).toHaveBeenCalledWith(
          SERVER,
          { client_id: "c" },
          { registrationKind: "dcr", issuer },
        );
        expect(storage.saveTokens).toHaveBeenCalledWith(
          SERVER,
          { access_token: "t", token_type: "Bearer" },
          { issuer },
        );
      });

      // #2751: the static client's stamp used to land in a dynamic slot the
      // preregistered read never looks at, and re-seeding dropped it anyway.
      describe("static client issuer stamp", () => {
        const ISSUER = "https://as.example.com";
        const STATIC = { client_id: "static", client_secret: "s3cret" };

        function makeStaticStorage(
          preregistered: StoredOAuthClientInformation | undefined,
        ): OAuthStorage {
          const storage = makeStorage();
          vi.mocked(storage.getClientInformation).mockImplementation(
            async (_url: string, isPreregistered?: boolean) =>
              isPreregistered ? preregistered : undefined,
          );
          return storage;
        }

        it("writes the SDK back-stamp of the static client to the preregistered slot", async () => {
          const storage = makeStaticStorage(STATIC);
          const provider = makeProvider(storage);

          await provider.saveClientInformation(
            { ...STATIC, issuer: ISSUER },
            { issuer: ISSUER },
          );

          expect(
            storage.savePreregisteredClientInformation,
          ).toHaveBeenCalledWith(SERVER, { ...STATIC, issuer: ISSUER });
          expect(storage.saveClientInformation).not.toHaveBeenCalled();
        });

        it("keeps a different client_id in its registration slot", async () => {
          const storage = makeStaticStorage(STATIC);
          const provider = makeProvider(storage);

          await provider.saveClientInformation(
            { client_id: "dyn" },
            { issuer: ISSUER },
          );

          expect(
            storage.savePreregisteredClientInformation,
          ).not.toHaveBeenCalled();
          expect(storage.saveClientInformation).toHaveBeenCalledWith(
            SERVER,
            { client_id: "dyn" },
            { registrationKind: "dcr", issuer: ISSUER },
          );
        });

        it("leaves our own saves alone even when the client_id matches", async () => {
          const storage = makeStaticStorage(STATIC);
          const provider = makeProvider(storage);

          await provider.saveClientInformation(STATIC, {
            registrationKind: "cimd",
            issuer: ISSUER,
          });

          expect(
            storage.savePreregisteredClientInformation,
          ).not.toHaveBeenCalled();
          expect(storage.getClientInformation).not.toHaveBeenCalled();
        });

        it("returns the static client with a matching stamp as stored", async () => {
          const storage = makeStaticStorage({ ...STATIC, issuer: ISSUER });
          const provider = makeProvider(storage);

          expect(await provider.clientInformation({ issuer: ISSUER })).toEqual({
            ...STATIC,
            issuer: ISSUER,
          });
          expect(await provider.clientInformation()).toEqual({
            ...STATIC,
            issuer: ISSUER,
          });
        });

        it("returns the static client unstamped when the stamp names another issuer", async () => {
          const storage = makeStaticStorage({ ...STATIC, issuer: ISSUER });
          const provider = makeProvider(storage);

          expect(
            await provider.clientInformation({
              issuer: "https://other-as.example.com",
            }),
          ).toEqual({ ...STATIC, issuer: undefined });
        });

        it("keeps the stamp when re-seeding the same static client", async () => {
          const storage = makeStaticStorage({ ...STATIC, issuer: ISSUER });
          const provider = makeProvider(storage);

          await provider.savePreregisteredClientInformation(STATIC);

          expect(
            storage.savePreregisteredClientInformation,
          ).toHaveBeenCalledWith(SERVER, { ...STATIC, issuer: ISSUER });
        });

        it.each([
          ["client_id", { ...STATIC, client_id: "rotated" }],
          ["client_secret", { ...STATIC, client_secret: "rotated" }],
        ])(
          "drops the stamp when re-seeding with a changed %s",
          async (_field, changed) => {
            const storage = makeStaticStorage({ ...STATIC, issuer: ISSUER });
            const provider = makeProvider(storage);

            await provider.savePreregisteredClientInformation(changed);

            expect(
              storage.savePreregisteredClientInformation,
            ).toHaveBeenCalledWith(SERVER, changed);
          },
        );

        // The regression end to end: real storage, the real startup seed and
        // the SDK's own `auth()`, whose unstamped-credential warning is what
        // repeated on every run.
        describe("across SDK auth() runs", () => {
          const ISSUER_B = "https://as-b.example.com";

          /**
           * A persisted store that outlives any one process: each
           * {@link startProcess} reloads it into fresh storage and memory, so a
           * stamp that does not survive serialization is lost between runs.
           */
          function makeDisk() {
            let saved: string | null = null;
            const backend: OAuthPersistBackend = {
              read: async () => (saved === null ? null : JSON.parse(saved)),
              write: async (snapshot) => {
                saved = JSON.stringify(snapshot);
              },
            };
            return {
              startProcess: (): OAuthStorage =>
                new OAuthStorageBase(new OAuthMemoryStore(), backend),
            };
          }

          /** Discovery naming `issuer` as the resource's authorization server. */
          function discoveryFetch(issuer: string): typeof fetch {
            return async (input: RequestInfo | URL) => {
              const url = String(input);
              if (url.includes("/.well-known/oauth-protected-resource")) {
                return new Response(
                  JSON.stringify({
                    resource: SERVER,
                    authorization_servers: [issuer],
                  }),
                );
              }
              if (url.startsWith(issuer)) {
                return new Response(
                  JSON.stringify({
                    issuer,
                    authorization_endpoint: `${issuer}/authorize`,
                    token_endpoint: `${issuer}/token`,
                    response_types_supported: ["code"],
                  }),
                );
              }
              throw new Error(`unexpected fetch: ${url}`);
            };
          }

          /** One process lifetime: seed from config, then let the SDK authorize. */
          async function startAndAuthorize(
            storage: OAuthStorage,
            issuer: string,
          ) {
            const redirectUrlProvider = new MutableRedirectUrlProvider();
            redirectUrlProvider.redirectUrl = "http://localhost/oauth/callback";
            const provider = makeProvider(storage, vi.fn(), {
              redirectUrlProvider,
            });
            await provider.savePreregisteredClientInformation(STATIC);
            expect(
              await auth(provider, {
                serverUrl: SERVER,
                fetchFn: discoveryFetch(issuer),
              }),
            ).toBe("REDIRECT");
          }

          let warn: ReturnType<typeof vi.spyOn>;
          beforeEach(() => {
            warn = vi.spyOn(console, "warn").mockImplementation(() => {});
          });
          afterEach(() => {
            warn.mockRestore();
          });

          function sep2352Warnings(): unknown[][] {
            return warn.mock.calls.filter((args: unknown[]) =>
              String(args[0]).includes("SEP-2352"),
            );
          }

          it("keeps the stamp across a restart, so the SDK warns only once", async () => {
            const disk = makeDisk();

            await startAndAuthorize(disk.startProcess(), ISSUER);
            // First use: nothing was stamped yet, so the SDK warns and stamps.
            expect(sep2352Warnings()).toHaveLength(1);
            warn.mockClear();

            const storage = disk.startProcess();
            await startAndAuthorize(storage, ISSUER);

            expect(sep2352Warnings()).toHaveLength(0);
            expect(await storage.getClientInformation(SERVER, true)).toEqual({
              ...STATIC,
              issuer: ISSUER,
            });
            expect(
              await storage.getClientInformation(SERVER, false, ISSUER),
            ).toBeUndefined();
          });

          it("re-binds the static client when discovery resolves another issuer", async () => {
            const disk = makeDisk();
            const first = disk.startProcess();
            await startAndAuthorize(first, ISSUER);
            // SDK auth() reuses the cached AS; drop it so discovery re-resolves.
            await first.clearDiscoveryState(SERVER);

            const storage = disk.startProcess();
            await startAndAuthorize(storage, ISSUER_B);

            expect(await storage.getClientInformation(SERVER, true)).toEqual({
              ...STATIC,
              issuer: ISSUER_B,
            });
          });
        });

        it("seeds an unstamped static client as given", async () => {
          const storage = makeStaticStorage({ ...STATIC });
          const provider = makeProvider(storage);

          await provider.savePreregisteredClientInformation(STATIC);

          expect(
            storage.savePreregisteredClientInformation,
          ).toHaveBeenCalledWith(SERVER, STATIC);
        });
      });

      // #2242: the SDK binds an existing registration to its issuer by calling
      // `saveClientInformation(info, { issuer })` with no registration kind.
      // Treating every such save as DCR relabeled a CIMD registration
      // "Dynamic (DCR)" in Connection Info, even though no `POST /register`
      // ever happened.
      describe("registration kind on an unstamped (SDK) save", () => {
        const ISSUER = "https://as.example.com";
        const METADATA_URL = "https://app.example.com/client-metadata.json";

        /** Discovery state as SDK `auth()` persists it before saving client info. */
        function seedDiscovery(
          storage: OAuthStorage,
          issuer: string,
          cimd: boolean,
        ) {
          vi.mocked(storage.getDiscoveryState).mockResolvedValue({
            authorizationServerUrl: issuer,
            authorizationServerMetadata: {
              issuer,
              authorization_endpoint: `${issuer}/authorize`,
              token_endpoint: `${issuer}/token`,
              response_types_supported: ["code"],
              ...(cimd && { client_id_metadata_document_supported: true }),
            },
          });
        }

        /** Storage whose issuer slot already holds a CIMD registration. */
        function makeCimdStorage(): OAuthStorage {
          const storage = makeStorage();
          vi.mocked(storage.getClientInformation).mockImplementation(
            async (_url: string, preregistered?: boolean) =>
              preregistered ? undefined : { client_id: METADATA_URL },
          );
          vi.mocked(storage.getClientRegistrationKind).mockResolvedValue(
            "cimd",
          );
          return storage;
        }

        it("keeps cimd when back-stamping a registration recorded as cimd", async () => {
          const storage = makeCimdStorage();
          const provider = makeProvider(storage, vi.fn(), {
            clientMetadataUrl: METADATA_URL,
          });

          await provider.saveClientInformation(
            { client_id: METADATA_URL },
            { issuer: ISSUER },
          );

          expect(storage.saveClientInformation).toHaveBeenCalledWith(
            SERVER,
            { client_id: METADATA_URL },
            { registrationKind: "cimd", issuer: ISSUER },
          );
        });

        // RFC 7591 §3.2 leaves a dynamically issued `client_id` opaque, so an
        // existing DCR may carry the configured metadata URL. Back-stamping it
        // must not relabel it (Copilot).
        it("keeps dcr when back-stamping a DCR that uses the metadata URL", async () => {
          const storage = makeStorage();
          vi.mocked(storage.getClientInformation).mockImplementation(
            async (_url: string, preregistered?: boolean) =>
              preregistered ? undefined : { client_id: METADATA_URL },
          );
          vi.mocked(storage.getClientRegistrationKind).mockResolvedValue("dcr");
          // Even with an AS that does advertise CIMD.
          seedDiscovery(storage, ISSUER, true);
          const provider = makeProvider(storage, vi.fn(), {
            clientMetadataUrl: METADATA_URL,
          });

          await provider.saveClientInformation(
            { client_id: METADATA_URL },
            { issuer: ISSUER },
          );

          expect(storage.saveClientInformation).toHaveBeenCalledWith(
            SERVER,
            { client_id: METADATA_URL },
            { registrationKind: "dcr", issuer: ISSUER },
          );
        });

        // Nothing stored for this issuer, so the SDK is creating the
        // registration. It reaches its URL-based-client-ID branch exactly when
        // the AS advertises CIMD — read back from the discovery state it
        // persisted moments earlier.
        it("records cimd for a new registration when the AS advertises CIMD", async () => {
          const storage = makeStorage();
          seedDiscovery(storage, ISSUER, true);
          const provider = makeProvider(storage, vi.fn(), {
            clientMetadataUrl: METADATA_URL,
          });

          await provider.saveClientInformation(
            { client_id: METADATA_URL },
            { issuer: ISSUER },
          );

          expect(storage.saveClientInformation).toHaveBeenCalledWith(
            SERVER,
            { client_id: METADATA_URL },
            { registrationKind: "cimd", issuer: ISSUER },
          );
        });

        it("records dcr for a new registration when the AS does not advertise CIMD", async () => {
          const storage = makeStorage();
          seedDiscovery(storage, ISSUER, false);
          const provider = makeProvider(storage, vi.fn(), {
            clientMetadataUrl: METADATA_URL,
          });

          await provider.saveClientInformation(
            { client_id: METADATA_URL },
            { issuer: ISSUER },
          );

          expect(storage.saveClientInformation).toHaveBeenCalledWith(
            SERVER,
            { client_id: METADATA_URL },
            { registrationKind: "dcr", issuer: ISSUER },
          );
        });

        it("records dcr when the discovery state describes a different issuer", async () => {
          const storage = makeStorage();
          seedDiscovery(storage, "https://as-other.example.com", true);
          const provider = makeProvider(storage, vi.fn(), {
            clientMetadataUrl: METADATA_URL,
          });

          await provider.saveClientInformation(
            { client_id: METADATA_URL },
            { issuer: ISSUER },
          );

          expect(storage.saveClientInformation).toHaveBeenCalledWith(
            SERVER,
            { client_id: METADATA_URL },
            { registrationKind: "dcr", issuer: ISSUER },
          );
        });

        it("records dcr for a server-minted client_id while CIMD is configured", async () => {
          const storage = makeCimdStorage();
          seedDiscovery(storage, ISSUER, true);
          const provider = makeProvider(storage, vi.fn(), {
            clientMetadataUrl: METADATA_URL,
          });

          await provider.saveClientInformation(
            { client_id: "dcr-minted-id" },
            { issuer: ISSUER },
          );

          // The id is not the metadata URL, so no registration slot is read —
          // only the preregistered one, to rule out a static back-stamp (#2751).
          expect(storage.getClientInformation).not.toHaveBeenCalledWith(
            SERVER,
            false,
            ISSUER,
          );
          expect(storage.getDiscoveryState).not.toHaveBeenCalled();
          expect(storage.saveClientInformation).toHaveBeenCalledWith(
            SERVER,
            { client_id: "dcr-minted-id" },
            { registrationKind: "dcr", issuer: ISSUER },
          );
        });

        it("records dcr when CIMD is not configured for this connection", async () => {
          const storage = makeCimdStorage();
          seedDiscovery(storage, ISSUER, true);
          const provider = makeProvider(storage);

          await provider.saveClientInformation(
            { client_id: METADATA_URL },
            { issuer: ISSUER },
          );

          expect(storage.saveClientInformation).toHaveBeenCalledWith(
            SERVER,
            { client_id: METADATA_URL },
            { registrationKind: "dcr", issuer: ISSUER },
          );
        });

        // SEP-2352 keys registrations per authorization server, so a second AS
        // behind one resource is a separate determination. Driven against a real
        // `OAuthStorageBase` and the real `ensureCimdClientRegistration`, because
        // the behaviour under test is how the pre-registration binds provenance to
        // a discovered issuer and how storage promotes and clears slots — neither
        // of which a mock would express (Copilot).
        describe("across two authorization servers", () => {
          const ISSUER_B = "https://as-b.example.com";

          function makeRealStorage(): OAuthStorage {
            const backend: OAuthPersistBackend = {
              read: async () => null,
              write: async () => {},
            };
            return new OAuthStorageBase(new OAuthMemoryStore(), backend);
          }

          /**
           * Discovery that points the resource at `issuer` as its authorization
           * server and declares CIMD support per `cimd`. The RFC 9728 document
           * has to name the AS, so that the RFC 8414 §3.3 issuer echo the SDK
           * enforces resolves against the AS URL rather than the resource's.
           */
          function discoveryFetch(issuer: string, cimd: boolean): typeof fetch {
            return async (input: RequestInfo | URL) => {
              const url = String(input);
              if (url.includes("/.well-known/oauth-protected-resource")) {
                return new Response(
                  JSON.stringify({
                    resource: SERVER,
                    authorization_servers: [issuer],
                  }),
                );
              }
              if (url.startsWith(issuer)) {
                return new Response(
                  JSON.stringify({
                    issuer,
                    authorization_endpoint: `${issuer}/authorize`,
                    token_endpoint: `${issuer}/token`,
                    response_types_supported: ["code"],
                    ...(cimd && {
                      client_id_metadata_document_supported: true,
                    }),
                  }),
                );
              }
              throw new Error(`unexpected fetch: ${url}`);
            };
          }

          /** Issuer A pre-registers via CIMD, then the SDK binds it. */
          async function bindIssuerA(storage: OAuthStorage) {
            const provider = makeProvider(storage, vi.fn(), {
              clientMetadataUrl: METADATA_URL,
            });
            await ensureCimdClientRegistration({
              serverUrl: SERVER,
              provider,
              fetchFn: discoveryFetch(ISSUER, true),
            });
            await provider.saveClientInformation(
              { client_id: METADATA_URL },
              { issuer: ISSUER },
            );
            expect(
              await storage.getClientRegistrationKind(SERVER, ISSUER),
            ).toBe("cimd");
            return provider;
          }

          it("keeps cimd when a second CIMD-supporting issuer takes over", async () => {
            const storage = makeRealStorage();
            const provider = await bindIssuerA(storage);

            // Issuer B also advertises CIMD, so the pre-registration records it
            // for B too — it must not early-return on issuer A's client.
            await ensureCimdClientRegistration({
              serverUrl: SERVER,
              provider,
              fetchFn: discoveryFetch(ISSUER_B, true),
            });
            await storage.saveDiscoveryState(SERVER, {
              authorizationServerUrl: ISSUER_B,
              authorizationServerMetadata: {
                issuer: ISSUER_B,
                authorization_endpoint: `${ISSUER_B}/authorize`,
                token_endpoint: `${ISSUER_B}/token`,
                response_types_supported: ["code"],
                client_id_metadata_document_supported: true,
              },
            });
            await provider.saveClientInformation(
              { client_id: METADATA_URL },
              { issuer: ISSUER_B },
            );

            expect(
              await storage.getClientRegistrationKind(SERVER, ISSUER_B),
            ).toBe("cimd");
            expect(
              await storage.getClientRegistrationKind(SERVER, ISSUER),
            ).toBe("cimd");
          });

          it("records dcr when a second issuer without CIMD mints the same URL as its client_id", async () => {
            const storage = makeRealStorage();
            const provider = await bindIssuerA(storage);

            // Issuer B does *not* advertise CIMD, so nothing is recorded for B...
            await ensureCimdClientRegistration({
              serverUrl: SERVER,
              provider,
              fetchFn: discoveryFetch(ISSUER_B, false),
            });
            // Discovery state as SDK `auth()` persists it for issuer B — which
            // is what tells the save apart from a CIMD one. Seeded explicitly so
            // the assertion rests on B's advertised capabilities rather than on
            // discovery state merely being absent.
            await storage.saveDiscoveryState(SERVER, {
              authorizationServerUrl: ISSUER_B,
              authorizationServerMetadata: {
                issuer: ISSUER_B,
                authorization_endpoint: `${ISSUER_B}/authorize`,
                token_endpoint: `${ISSUER_B}/token`,
                response_types_supported: ["code"],
              },
            });

            // ...and RFC 7591 §3.2 lets it mint an opaque id that happens to be
            // the very URL issuer A uses as its CIMD client_id.
            await provider.saveClientInformation(
              { client_id: METADATA_URL },
              { issuer: ISSUER_B },
            );

            expect(
              await storage.getClientRegistrationKind(SERVER, ISSUER_B),
            ).toBe("dcr");
            // Issuer A's own provenance is untouched.
            expect(
              await storage.getClientRegistrationKind(SERVER, ISSUER),
            ).toBe("cimd");
          });

          // Copilot: an AS advertising CIMD does not make an *existing* dynamic
          // registration a CIMD one. RFC 7591 §3.2 leaves the id opaque, so a
          // real DCR may carry the metadata URL; end to end, it must stay `dcr`.
          it("does not relabel an existing DCR whose client_id is the metadata URL", async () => {
            const storage = makeRealStorage();
            const provider = makeProvider(storage, vi.fn(), {
              clientMetadataUrl: METADATA_URL,
            });

            // A real dynamic registration that happens to use the same URL.
            await provider.saveClientInformation(
              { client_id: METADATA_URL },
              { registrationKind: "dcr", issuer: ISSUER },
            );

            // The AS does advertise CIMD, so the pre-registration runs and finds
            // that registration already in place.
            await ensureCimdClientRegistration({
              serverUrl: SERVER,
              provider,
              fetchFn: discoveryFetch(ISSUER, true),
            });
            // The SDK's issuer back-stamp of that same registration.
            await provider.saveClientInformation(
              { client_id: METADATA_URL },
              { issuer: ISSUER },
            );

            expect(
              await storage.getClientRegistrationKind(SERVER, ISSUER),
            ).toBe("dcr");
          });

          // SDK v2 `auth()` answers `invalid_client` with
          // `invalidateCredentials("client")` and an immediate retry. That clear
          // removes the registration *and* its kind, so the retry takes the
          // new-registration path and must be answered from the discovery state
          // — which the clear does not touch (Copilot). Asserted against real
          // storage, since the point is what `clearClientInformation` does.
          it("keeps cimd through invalid-client recovery, which clears the credential", async () => {
            const storage = makeRealStorage();
            const provider = await bindIssuerA(storage);
            // Discovery state as SDK `auth()` persisted it for issuer A.
            await storage.saveDiscoveryState(SERVER, {
              authorizationServerUrl: ISSUER,
              authorizationServerMetadata: {
                issuer: ISSUER,
                authorization_endpoint: `${ISSUER}/authorize`,
                token_endpoint: `${ISSUER}/token`,
                response_types_supported: ["code"],
                client_id_metadata_document_supported: true,
              },
            });

            await provider.invalidateCredentials("client");

            // The credential and its recorded kind are both gone...
            expect(
              await storage.getClientInformation(SERVER, false, ISSUER),
            ).toBeUndefined();
            expect(
              await storage.getClientRegistrationKind(SERVER, ISSUER),
            ).toBeUndefined();

            // ...so the SDK's retry re-runs its URL-based client-ID branch.
            await provider.saveClientInformation(
              { client_id: METADATA_URL },
              { issuer: ISSUER },
            );

            expect(
              await storage.getClientRegistrationKind(SERVER, ISSUER),
            ).toBe("cimd");
          });

          it("records dcr for a second issuer that mints its own client_id", async () => {
            const storage = makeRealStorage();
            const provider = await bindIssuerA(storage);

            await provider.saveClientInformation(
              { client_id: "b-registered-id" },
              { issuer: ISSUER_B },
            );

            expect(
              await storage.getClientRegistrationKind(SERVER, ISSUER_B),
            ).toBe("dcr");
          });
        });

        it("an explicit registrationKind wins and consults no storage reads", async () => {
          const storage = makeCimdStorage();
          const provider = makeProvider(storage, vi.fn(), {
            clientMetadataUrl: METADATA_URL,
          });

          await provider.saveClientInformation(
            { client_id: METADATA_URL },
            { registrationKind: "cimd" },
          );

          expect(storage.getClientInformation).not.toHaveBeenCalled();
          expect(storage.getClientRegistrationKind).not.toHaveBeenCalled();
          expect(storage.saveClientInformation).toHaveBeenCalledWith(
            SERVER,
            { client_id: METADATA_URL },
            { registrationKind: "cimd", issuer: undefined },
          );
        });
      });

      it("round-trips discovery state to storage", async () => {
        const storage = makeStorage();
        const provider = makeProvider(storage);
        const discoveryState = {
          authorizationServerUrl: "https://as.example.com",
        };

        await provider.saveDiscoveryState(discoveryState);
        await provider.discoveryState();

        expect(storage.saveDiscoveryState).toHaveBeenCalledWith(
          SERVER,
          discoveryState,
        );
        expect(storage.getDiscoveryState).toHaveBeenCalledWith(SERVER);
      });

      it("maps invalidateCredentials scopes to the matching storage clear", async () => {
        const storage = makeStorage();
        const provider = makeProvider(storage);

        await provider.invalidateCredentials("all");
        await provider.invalidateCredentials("client");
        await provider.invalidateCredentials("tokens");
        await provider.invalidateCredentials("verifier");
        await provider.invalidateCredentials("discovery");

        expect(storage.clear).toHaveBeenCalledWith(SERVER);
        expect(storage.clearClientInformation).toHaveBeenCalledWith(SERVER);
        expect(storage.clearTokens).toHaveBeenCalledWith(SERVER);
        expect(storage.clearCodeVerifier).toHaveBeenCalledWith(SERVER);
        expect(storage.clearDiscoveryState).toHaveBeenCalledWith(SERVER);
      });
    });

    describe("per-flow PKCE verifier (#2726)", () => {
      function makeFlowStore(): PkceFlowStore {
        const store = new Map<string, string>();
        return createWebStoragePkceFlowStore(() => ({
          getItem: (key) => store.get(key) ?? null,
          setItem: (key, value) => void store.set(key, value),
          removeItem: (key) => void store.delete(key),
        }));
      }

      it("keys the verifier by the state it generated, not the shared slot", async () => {
        const storage = makeStorage();
        const flowStore = makeFlowStore();
        const provider = makeProvider(storage, vi.fn(), { flowStore });

        const state = await provider.state();
        await provider.saveCodeVerifier("cv-a");

        expect(storage.saveCodeVerifier).not.toHaveBeenCalled();
        expect(await flowStore.getCodeVerifier(state, SERVER)).toBe("cv-a");
        expect(await provider.codeVerifier()).toBe("cv-a");
      });

      it("gives two overlapping flows for one server their own verifiers", async () => {
        const storage = makeStorage();
        const flowStore = makeFlowStore();
        const providerA = makeProvider(storage, vi.fn(), { flowStore });
        const providerB = makeProvider(storage, vi.fn(), { flowStore });

        const stateA = await providerA.state();
        await providerA.saveCodeVerifier("cv-a");
        const stateB = await providerB.state();
        await providerB.saveCodeVerifier("cv-b");

        // The callback legs run on fresh providers, as after a page reload.
        const callbackB = makeProvider(storage, vi.fn(), { flowStore });
        callbackB.resumeAuthorizationFlow(stateB);
        expect(await callbackB.codeVerifier()).toBe("cv-b");
        await callbackB.clearAuthorizationFlow();

        const callbackA = makeProvider(storage, vi.fn(), { flowStore });
        callbackA.resumeAuthorizationFlow(stateA);
        expect(await callbackA.codeVerifier()).toBe("cv-a");
      });

      it("fails clearly for a state with no stored verifier instead of using another flow's", async () => {
        const storage = makeStorage();
        vi.mocked(storage.getCodeVerifier).mockResolvedValue("someone-elses");
        const flowStore = makeFlowStore();
        const other = makeProvider(storage, vi.fn(), { flowStore });
        await other.state();
        await other.saveCodeVerifier("cv-other");

        const provider = makeProvider(storage, vi.fn(), { flowStore });
        provider.resumeAuthorizationFlow("a".repeat(64));

        await expect(provider.codeVerifier()).rejects.toThrow(
          /No code verifier saved for this authorization flow/,
        );
        expect(storage.getCodeVerifier).not.toHaveBeenCalled();
      });

      it("binds no flow for a state that is not one of ours", async () => {
        const storage = makeStorage();
        const provider = makeProvider(storage, vi.fn(), {
          flowStore: makeFlowStore(),
        });

        provider.resumeAuthorizationFlow("not-our-state");

        await expect(provider.codeVerifier()).rejects.toThrow(
          /No code verifier saved for this authorization flow/,
        );
      });

      it("invalidateCredentials('verifier') clears only the bound flow", async () => {
        const storage = makeStorage();
        const flowStore = makeFlowStore();
        const provider = makeProvider(storage, vi.fn(), { flowStore });
        const state = await provider.state();
        await provider.saveCodeVerifier("cv");

        await provider.invalidateCredentials("verifier");

        expect(await flowStore.getCodeVerifier(state, SERVER)).toBeUndefined();
        expect(storage.clearCodeVerifier).not.toHaveBeenCalled();
      });

      it("clearAuthorizationFlow() is a no-op without a flow store or a bound flow", async () => {
        const storage = makeStorage();
        await makeProvider(storage).clearAuthorizationFlow();

        const flowStore = makeFlowStore();
        const clear = vi.spyOn(flowStore, "clearCodeVerifier");
        await makeProvider(storage, vi.fn(), {
          flowStore,
        }).clearAuthorizationFlow();

        expect(clear).not.toHaveBeenCalled();
        expect(storage.clearCodeVerifier).not.toHaveBeenCalled();
      });

      it("keeps the shared slot when no flow store is configured", async () => {
        const storage = makeStorage();
        const provider = makeProvider(storage);

        await provider.state();
        await provider.saveCodeVerifier("cv");

        expect(storage.saveCodeVerifier).toHaveBeenCalledWith(SERVER, "cv");
      });
    });
  });
});
