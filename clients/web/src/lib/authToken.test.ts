import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  API_SERVER_ENV_VARS,
  INSPECTOR_API_TOKEN_GLOBAL,
} from "@inspector/core/mcp/remote/constants.js";
import { OAUTH_CALLBACK_PATH } from "../utils/oauthFlow";
import { getAuthToken, redirectUrlProvider } from "./authToken";

const KEY = API_SERVER_ENV_VARS.AUTH_TOKEN;

// happy-dom won't let `window.location` be reassigned, so drive the query
// string through the History API instead.
function setSearch(search: string): void {
  window.history.replaceState(null, "", `/${search}`);
}

// happy-dom hands back a fresh Storage wrapper per `window.sessionStorage`
// access, so a spy on the instance never sees the call. Replace the property
// itself to exercise the "storage is unavailable" branches (privacy mode, a
// sandboxed iframe).
const realSessionStorage = window.sessionStorage;
function stubSessionStorage(overrides: Partial<Storage>): void {
  Object.defineProperty(window, "sessionStorage", {
    configurable: true,
    value: { ...realSessionStorage, ...overrides },
  });
}
function restoreSessionStorage(): void {
  Object.defineProperty(window, "sessionStorage", {
    configurable: true,
    value: realSessionStorage,
  });
}

describe("redirectUrlProvider", () => {
  it("points at the backend's OAuth callback on the current origin", () => {
    expect(redirectUrlProvider.getRedirectUrl()).toBe(
      `${window.location.origin}${OAUTH_CALLBACK_PATH}`,
    );
  });
});

describe("getAuthToken", () => {
  beforeEach(() => {
    setSearch("");
    window.sessionStorage.clear();
    Reflect.deleteProperty(window, INSPECTOR_API_TOKEN_GLOBAL);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    restoreSessionStorage();
    setSearch("");
    window.sessionStorage.clear();
    Reflect.deleteProperty(window, INSPECTOR_API_TOKEN_GLOBAL);
  });

  it("prefers the injected global and persists it", () => {
    Reflect.set(window, INSPECTOR_API_TOKEN_GLOBAL, "from-global");
    setSearch(`?${KEY}=from-url`);
    window.sessionStorage.setItem(KEY, "from-storage");

    expect(getAuthToken()).toBe("from-global");
    expect(window.sessionStorage.getItem(KEY)).toBe("from-global");
  });

  it("ignores a non-string or empty global and falls through to the URL", () => {
    Reflect.set(window, INSPECTOR_API_TOKEN_GLOBAL, "");
    setSearch(`?${KEY}=from-url`);

    expect(getAuthToken()).toBe("from-url");

    Reflect.set(window, INSPECTOR_API_TOKEN_GLOBAL, 123);
    expect(getAuthToken()).toBe("from-url");
    expect(window.sessionStorage.getItem(KEY)).toBe("from-url");
  });

  it("falls back to sessionStorage when neither source is present", () => {
    window.sessionStorage.setItem(KEY, "from-storage");
    expect(getAuthToken()).toBe("from-storage");
  });

  it("returns undefined when nothing carries a token", () => {
    expect(getAuthToken()).toBeUndefined();
  });

  it("still resolves when sessionStorage writes throw", () => {
    const setItem = vi.fn(() => {
      throw new Error("blocked");
    });
    stubSessionStorage({ setItem });
    Reflect.set(window, INSPECTOR_API_TOKEN_GLOBAL, "from-global");

    expect(getAuthToken()).toBe("from-global");
    expect(setItem).toHaveBeenCalledWith(KEY, "from-global");
  });

  it("returns undefined when sessionStorage reads throw", () => {
    const getItem = vi.fn(() => {
      throw new Error("blocked");
    });
    stubSessionStorage({ getItem });

    expect(getAuthToken()).toBeUndefined();
    expect(getItem).toHaveBeenCalledWith(KEY);
  });
});
