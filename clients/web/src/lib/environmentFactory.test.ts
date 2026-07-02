/**
 * Tests for the browser `InspectorClientEnvironment` assembly.
 *
 * The three remote factories are mocked so we can (a) assert the `baseUrl` /
 * `authToken` derived from `window.location` are threaded into each, and
 * (b) capture the internal `fetchFn` wrapper and invoke it to prove it
 * delegates to `globalThis.fetch` (exercising the arrow body that exists to
 * preserve the global receiver). `BrowserNavigation` and the OAuth storage
 * accessor are the real implementations.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { BrowserNavigation } from "@inspector/core/auth/browser/index.js";
import type { RedirectUrlProvider } from "@inspector/core/auth/index.js";

interface CapturedOptions {
  baseUrl: string;
  authToken: string | undefined;
  fetchFn: typeof fetch;
}

const captured: {
  transport?: CapturedOptions;
  fetch?: CapturedOptions;
  logger?: CapturedOptions;
} = {};

vi.mock("@inspector/core/mcp/remote/index.js", () => ({
  createRemoteTransport: (opts: CapturedOptions) => {
    captured.transport = opts;
    return { transport: true };
  },
  createRemoteFetch: (opts: CapturedOptions) => {
    captured.fetch = opts;
    return (async () => new Response("ok")) as unknown as typeof fetch;
  },
  createRemoteLogger: (opts: CapturedOptions) => {
    captured.logger = opts;
    return { info: vi.fn() };
  },
}));

import { createWebEnvironment } from "./environmentFactory";

const REDIRECT: RedirectUrlProvider = {
  getRedirectUrl: () => "http://localhost/callback",
};

describe("createWebEnvironment", () => {
  beforeEach(() => {
    captured.transport = undefined;
    captured.fetch = undefined;
    captured.logger = undefined;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("threads the window.location origin and auth token into every remote factory", () => {
    const expectedBaseUrl = `${window.location.protocol}//${window.location.host}`;
    const { environment, logger } = createWebEnvironment("tok-123", REDIRECT);

    for (const opts of [captured.transport, captured.fetch, captured.logger]) {
      expect(opts?.baseUrl).toBe(expectedBaseUrl);
      expect(opts?.authToken).toBe("tok-123");
    }

    // The returned logger is the same instance the factory produced.
    expect(logger).toBe(environment.logger);
    expect(environment.transport).toEqual({ transport: true });
    expect(typeof environment.fetch).toBe("function");
  });

  it("passes an undefined auth token straight through", () => {
    createWebEnvironment(undefined, REDIRECT);
    expect(captured.logger?.authToken).toBeUndefined();
  });

  it("wraps fetch so the call preserves the global receiver", async () => {
    const spy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response("delegated", { status: 200 }));
    createWebEnvironment("tok", REDIRECT);

    // Every factory receives the identical wrapper; invoking it must delegate.
    const wrapper = captured.transport!.fetchFn;
    const res = await wrapper("http://example.test/x");
    expect(spy).toHaveBeenCalledWith("http://example.test/x");
    expect(res.status).toBe(200);
  });

  it("builds a BrowserNavigation and wires the OAuth storage + redirect provider", () => {
    const onBeforeRedirect = vi.fn();
    const { environment } = createWebEnvironment(
      "tok",
      REDIRECT,
      onBeforeRedirect,
    );

    const oauth = environment.oauth;
    expect(oauth?.navigation).toBeInstanceOf(BrowserNavigation);
    expect(oauth?.redirectUrlProvider).toBe(REDIRECT);
    expect(oauth?.storage).toBeDefined();
  });

  it("works without an onBeforeOAuthRedirect callback", () => {
    const { environment } = createWebEnvironment(undefined, REDIRECT);
    expect(environment.oauth?.navigation).toBeInstanceOf(BrowserNavigation);
  });
});
