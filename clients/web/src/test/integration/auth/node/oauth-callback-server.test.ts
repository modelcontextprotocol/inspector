import { describe, it, expect, afterEach, vi } from "vitest";
import { connect } from "node:net";
import {
  createOAuthCallbackServer,
  type OAuthCallbackServer,
} from "@inspector/core/auth/node/oauth-callback-server.js";
import { runRunnerInteractiveOAuth } from "@inspector/core/auth/node/runner-interactive-oauth.js";

/**
 * Send a raw HTTP request line over a socket so we can use request targets
 * (like `//`) that `fetch` would normalize/reject before they reach the
 * server. Returns the raw response text.
 */
function rawRequest(port: number, requestLine: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = connect(port, "127.0.0.1", () => {
      socket.write(`${requestLine}\r\nHost: localhost\r\n\r\n`);
    });
    let data = "";
    socket.setEncoding("utf8");
    socket.on("data", (chunk) => {
      data += chunk;
    });
    socket.on("end", () => resolve(data));
    socket.on("error", reject);
  });
}

describe("OAuthCallbackServer", () => {
  let server: OAuthCallbackServer;

  afterEach(async () => {
    if (server) await server.stop();
  });

  it("start() returns port and redirectUrl", async () => {
    server = createOAuthCallbackServer();
    const result = await server.start({ port: 0 });

    expect(result.port).toBeGreaterThan(0);
    expect(result.redirectUrl).toBe(
      `http://127.0.0.1:${result.port}/oauth/callback`,
    );
  });

  it("start() supports custom host, path, and port", async () => {
    server = createOAuthCallbackServer();
    const result = await server.start({
      hostname: "127.0.0.1",
      port: 0,
      path: "/custom/path",
    });

    expect(result.redirectUrl).toBe(
      `http://127.0.0.1:${result.port}/custom/path`,
    );
  });

  it("GET /oauth/callback?code=abc&state=xyz returns 200 and invokes onCallback", async () => {
    server = createOAuthCallbackServer();
    const received: { code?: string; state?: string } = {};
    const result = await server.start({
      port: 0,
      onCallback: async (p) => {
        received.code = p.code;
        received.state = p.state;
      },
    });

    const res = await fetch(
      `http://localhost:${result.port}/oauth/callback?code=authcode123&state=mystate`,
    );

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    const html = await res.text();
    expect(html).toContain("OAuth complete");
    expect(html).toContain("close this window");
    expect(received.code).toBe("authcode123");
    expect(received.state).toBe("mystate");
  });

  it("GET /oauth/callback?code=abc returns 200 and invokes onCallback without state", async () => {
    server = createOAuthCallbackServer();
    const received: { code?: string; state?: string } = {};
    const result = await server.start({
      port: 0,
      onCallback: async (p) => {
        received.code = p.code;
        received.state = p.state;
      },
    });

    const res = await fetch(
      `http://localhost:${result.port}/oauth/callback?code=xyz`,
    );

    expect(res.status).toBe(200);
    expect(received.code).toBe("xyz");
    expect(received.state).toBeUndefined();
  });

  it("GET /oauth/callback/extra returns 404 (single path only)", async () => {
    server = createOAuthCallbackServer();
    const result = await server.start({ port: 0 });

    const res = await fetch(
      `http://localhost:${result.port}/oauth/callback/extra?code=test-code`,
    );

    expect(res.status).toBe(404);
    const html = await res.text();
    expect(html).toContain("not the OAuth callback");
    expect(html).not.toContain("OAuth complete");
  });

  it("GET /oauth/callback?error=access_denied returns 400 and invokes onError", async () => {
    server = createOAuthCallbackServer();
    const errors: Array<{
      error: string;
      error_description?: string | null;
    }> = [];
    const result = await server.start({
      port: 0,
      onError: (p) => errors.push(p),
    });

    const res = await fetch(
      `http://localhost:${result.port}/oauth/callback?error=access_denied&error_description=User%20denied`,
    );

    expect(res.status).toBe(400);
    const html = await res.text();
    expect(html).toContain("OAuth failed");
    // #2847: the query-string text is labeled as the server's words.
    expect(html).toContain(
      "The authorization server said: Error: access_denied.",
    );
    expect(errors).toHaveLength(1);
    expect(errors[0]!.error).toBe("access_denied");
    expect(errors[0]!.error_description).toBe("User denied");
  });

  it("GET /oauth/callback (missing code and error) returns 400", async () => {
    server = createOAuthCallbackServer();
    const result = await server.start({ port: 0 });

    const res = await fetch(
      `http://localhost:${result.port}/oauth/callback?state=foo`,
    );

    expect(res.status).toBe(400);
    const html = await res.text();
    expect(html).toContain("OAuth failed");
  });

  it("GET /other returns 404", async () => {
    server = createOAuthCallbackServer();
    const result = await server.start({ port: 0 });

    const res = await fetch(`http://localhost:${result.port}/other`);

    expect(res.status).toBe(404);
    expect(await res.text()).toContain("not the OAuth callback");
  });

  it("POST /oauth/callback returns 405 with the not-the-callback page", async () => {
    server = createOAuthCallbackServer();
    const result = await server.start({ port: 0 });

    const res = await fetch(
      `http://localhost:${result.port}/oauth/callback?code=x`,
      { method: "POST" },
    );

    expect(res.status).toBe(405);
    const html = await res.text();
    expect(html).toContain("not the OAuth callback");
    expect(html).not.toContain("OAuth complete");
  });

  it("stops server after first successful callback so second request fails", async () => {
    server = createOAuthCallbackServer();
    const result = await server.start({
      port: 0,
      onCallback: async () => {},
    });

    const first = await fetch(
      `http://localhost:${result.port}/oauth/callback?code=first`,
    );
    expect(first.status).toBe(200);

    // Server stops after sending 200, so second request gets connection refused
    await expect(
      fetch(`http://localhost:${result.port}/oauth/callback?code=second`),
    ).rejects.toThrow();
  });

  it("stop() closes the server", async () => {
    server = createOAuthCallbackServer();
    const result = await server.start({ port: 0 });
    await server.stop();

    await expect(
      fetch(`http://localhost:${result.port}/oauth/callback?code=x`),
    ).rejects.toThrow();
  });

  it("succeeds with 200 when no onCallback handler is configured", async () => {
    server = createOAuthCallbackServer();
    const result = await server.start({ port: 0 });

    const res = await fetch(
      `http://localhost:${result.port}/oauth/callback?code=lonely`,
    );

    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("OAuth complete");
  });

  it("returns 409 when a callback arrives after handled=true but before stop completes", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });

    server = createOAuthCallbackServer();
    const result = await server.start({
      port: 0,
      // Hold onCallback open so handled=true is set but the server hasn't
      // yet finished stopping — second request slips into the 409 branch.
      onCallback: async () => {
        await gate;
      },
    });

    const firstP = fetch(
      `http://localhost:${result.port}/oauth/callback?code=first`,
    );
    // Give the server time to register handled=true before second hit.
    await new Promise((r) => setTimeout(r, 50));
    const secondP = fetch(
      `http://localhost:${result.port}/oauth/callback?code=second`,
    );
    const second = await secondP;
    expect(second.status).toBe(409);
    const html = await second.text();
    expect(html).toContain("already received its callback");
    expect(html).not.toContain("OAuth complete");
    release();
    const first = await firstP;
    expect(first.status).toBe(200);
  });

  it("returns 400 when the request target is an unparseable URL", async () => {
    server = createOAuthCallbackServer();
    const result = await server.start({ port: 0 });

    // `GET //` makes req.url === "//", which `new URL("//", base)` rejects,
    // exercising the try/catch 400 branch in handleRequest.
    const raw = await rawRequest(result.port, "GET // HTTP/1.1");
    expect(raw).toContain("400 Bad Request");
    // #2843: a request that is not the callback must not claim success.
    expect(raw).toContain("not the OAuth callback");
    expect(raw).not.toContain("OAuth complete");
  });

  it("returns 400 JSON for an unparseable URL when Accept: application/json", async () => {
    server = createOAuthCallbackServer();
    const result = await server.start({ port: 0 });

    const raw = await rawRequest(
      result.port,
      "GET // HTTP/1.1\r\nAccept: application/json",
    );
    expect(raw).toContain("400 Bad Request");
    expect(raw).toContain('{"error":"Bad Request"}');
  });

  it("start() rejects when the callback path is not absolute", async () => {
    server = createOAuthCallbackServer();
    await expect(
      server.start({ port: 0, path: "no-leading-slash" }),
    ).rejects.toThrow(/Callback path must start with '\/'/);
  });

  it("POST returns 405 with a JSON body when Accept: application/json", async () => {
    server = createOAuthCallbackServer();
    const result = await server.start({ port: 0 });

    const res = await fetch(
      `http://localhost:${result.port}/oauth/callback?code=x`,
      { method: "POST", headers: { Accept: "application/json" } },
    );

    expect(res.status).toBe(405);
    expect(res.headers.get("content-type")).toContain("text/html");
    expect(await res.json()).toEqual({ error: "Method Not Allowed" });
  });

  it("returns 404 with a JSON body when Accept: application/json", async () => {
    server = createOAuthCallbackServer();
    const result = await server.start({ port: 0 });

    const res = await fetch(`http://localhost:${result.port}/nope`, {
      headers: { Accept: "application/json" },
    });

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Not Found" });
  });

  it("returns 409 with a JSON body when Accept: application/json", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });

    server = createOAuthCallbackServer();
    const result = await server.start({
      port: 0,
      onCallback: async () => {
        await gate;
      },
    });

    const firstP = fetch(
      `http://localhost:${result.port}/oauth/callback?code=first`,
    );
    await new Promise((r) => setTimeout(r, 50));
    const second = await fetch(
      `http://localhost:${result.port}/oauth/callback?code=second`,
      { headers: { Accept: "application/json" } },
    );
    expect(second.status).toBe(409);
    expect(await second.json()).toEqual({ error: "Callback already handled" });
    release();
    await firstP;
  });

  it("onCallback rejection returns 500 and error HTML", async () => {
    server = createOAuthCallbackServer();
    const result = await server.start({
      port: 0,
      onCallback: async () => {
        throw new Error("exchange failed");
      },
    });

    const res = await fetch(
      `http://localhost:${result.port}/oauth/callback?code=abc`,
    );

    expect(res.status).toBe(500);
    const html = await res.text();
    expect(html).toContain("OAuth failed");
    expect(html).toContain("exchange failed");
  });

  it("onCallback rejection with a non-Error stringifies the value (500)", async () => {
    server = createOAuthCallbackServer();
    const result = await server.start({
      port: 0,
      onCallback: async () => {
        throw "string-failure";
      },
    });

    const res = await fetch(
      `http://localhost:${result.port}/oauth/callback?code=abc`,
    );

    expect(res.status).toBe(500);
    expect(await res.text()).toContain("string-failure");
  });

  it("GET with error but no error_description still returns 400 and calls onError", async () => {
    server = createOAuthCallbackServer();
    const errors: Array<{
      error: string;
      error_description?: string | null;
    }> = [];
    const result = await server.start({
      port: 0,
      onError: (p) => errors.push(p),
    });

    const res = await fetch(
      `http://localhost:${result.port}/oauth/callback?error=invalid_request`,
    );

    expect(res.status).toBe(400);
    expect(errors).toHaveLength(1);
    expect(errors[0]!.error).toBe("invalid_request");
    expect(errors[0]!.error_description).toBeUndefined();
  });

  it("builds a bracketed redirect URL for an IPv6 hostname", async () => {
    server = createOAuthCallbackServer();
    const result = await server.start({ port: 0, hostname: "::1" });

    expect(result.redirectUrl).toBe(
      `http://[::1]:${result.port}/oauth/callback`,
    );
  });
  describe("expectedState (#2847)", () => {
    const STATE = "flow-state-123";

    it("ignores a success callback with the wrong state and keeps listening", async () => {
      server = createOAuthCallbackServer();
      const codes: string[] = [];
      const result = await server.start({
        port: 0,
        expectedState: STATE,
        onCallback: async (p) => {
          codes.push(p.code);
        },
      });
      const base = `http://localhost:${result.port}/oauth/callback`;

      const wrong = await fetch(`${base}?code=forged&state=other`);
      expect(wrong.status).toBe(400);
      const html = await wrong.text();
      expect(html).toContain("does not belong to the sign-in in progress");
      expect(html).not.toContain("OAuth complete");

      const missing = await fetch(`${base}?code=forged`);
      expect(missing.status).toBe(400);
      expect(codes).toEqual([]);

      const right = await fetch(`${base}?code=real&state=${STATE}`);
      expect(right.status).toBe(200);
      expect(codes).toEqual(["real"]);
    });

    it("ignores an error response with the wrong (or no) state, so it cannot end the flow", async () => {
      server = createOAuthCallbackServer();
      const errors: string[] = [];
      const result = await server.start({
        port: 0,
        expectedState: STATE,
        onError: (p) => errors.push(p.error),
      });
      const base = `http://localhost:${result.port}/oauth/callback`;

      const injected = await fetch(
        `${base}?error=access_denied&error_description=injected+by+another+process`,
      );
      expect(injected.status).toBe(400);
      const html = await injected.text();
      expect(html).not.toContain("injected by another process");
      expect(html).toContain("was ignored");
      expect(errors).toEqual([]);

      const genuine = await fetch(`${base}?error=access_denied&state=${STATE}`);
      expect(genuine.status).toBe(400);
      expect(await genuine.text()).toContain("The authorization server said");
      expect(errors).toEqual(["access_denied"]);
    });

    it("answers a state mismatch with JSON when Accept: application/json", async () => {
      server = createOAuthCallbackServer();
      const result = await server.start({ port: 0, expectedState: STATE });

      const res = await fetch(
        `http://localhost:${result.port}/oauth/callback?code=x&state=nope`,
        { headers: { Accept: "application/json" } },
      );
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "State mismatch" });
    });

    it("holds a callback that arrives before the state is known, then matches it", async () => {
      let resolveState!: (s: string | undefined) => void;
      const expectedState = new Promise<string | undefined>((r) => {
        resolveState = r;
      });
      server = createOAuthCallbackServer();
      const codes: string[] = [];
      const result = await server.start({
        port: 0,
        expectedState,
        onCallback: async (p) => {
          codes.push(p.code);
        },
      });

      const pending = fetch(
        `http://localhost:${result.port}/oauth/callback?code=early&state=${STATE}`,
      );
      await new Promise((r) => setTimeout(r, 20));
      expect(codes).toEqual([]);
      resolveState(STATE);
      expect((await pending).status).toBe(200);
      expect(codes).toEqual(["early"]);
    });

    it("matches only a stateless callback when the flow carries no state", async () => {
      server = createOAuthCallbackServer();
      const codes: string[] = [];
      const result = await server.start({
        port: 0,
        expectedState: Promise.resolve(undefined),
        onCallback: async (p) => {
          codes.push(p.code);
        },
      });
      const base = `http://localhost:${result.port}/oauth/callback`;

      expect((await fetch(`${base}?code=a&state=x`)).status).toBe(400);
      expect((await fetch(`${base}?code=b`)).status).toBe(200);
      expect(codes).toEqual(["b"]);
    });

    it("answers a held callback with 503 when the listener stops first", async () => {
      server = createOAuthCallbackServer();
      const result = await server.start({
        port: 0,
        expectedState: new Promise<string | undefined>(() => {}),
      });

      const pending = fetch(
        `http://localhost:${result.port}/oauth/callback?code=x&state=${STATE}`,
      );
      await new Promise((r) => setTimeout(r, 20));
      await server.stop();
      const res = await pending;
      expect(res.status).toBe(503);
      const html = await res.text();
      expect(html).toContain("no longer waiting");
      expect(html).not.toContain("OAuth complete");
    });

    it("answers 503 JSON when expectedState rejects", async () => {
      server = createOAuthCallbackServer();
      const result = await server.start({
        port: 0,
        expectedState: Promise.reject(new Error("no flow")),
      });

      const res = await fetch(
        `http://localhost:${result.port}/oauth/callback?code=x&state=${STATE}`,
        { headers: { Accept: "application/json" } },
      );
      expect(res.status).toBe(503);
      expect(await res.json()).toEqual({
        error: "Not waiting for a callback",
      });
    });
  });
  it("runRunnerInteractiveOAuth survives an injected error callback and completes on the genuine one (#2847)", async () => {
    const STATE = "genuine-flow-state";
    const redirectUrlProvider = { redirectUrl: "" };
    const requests: Promise<Response>[] = [];
    const completeOAuthFlow = vi.fn(async () => {});

    const result = await runRunnerInteractiveOAuth({
      client: {
        authenticate: async () => {
          const base = redirectUrlProvider.redirectUrl;
          // Another local process races the browser with a stateless error,
          // then the genuine redirect lands. Neither is awaited here — a
          // real navigation is not — and both arrive before the runner has
          // learned the flow's state, so the listener holds them until then.
          requests.push(
            fetch(
              `${base}?error=access_denied&error_description=injected+by+another+process`,
            ),
          );
          await new Promise((r) => setTimeout(r, 20));
          requests.push(fetch(`${base}?code=real-code&state=${STATE}`));
          return new URL(`https://as.example/authorize?state=${STATE}`);
        },
        beginInteractiveAuthorization: async () => {},
        completeOAuthFlow,
        checkAuthChallengeSatisfied: async () => true,
      },
      redirectUrlProvider,
      callbackListen: {
        hostname: "127.0.0.1",
        port: 0,
        pathname: "/oauth/callback",
      },
      callbackTimeoutMs: 10_000,
    });

    expect(result).toEqual({ kind: "success" });
    const [forged, genuine] = await Promise.all(requests);
    expect(forged!.status).toBe(400);
    expect(await forged!.text()).not.toContain("injected by another process");
    expect(genuine!.status).toBe(200);
    expect(completeOAuthFlow).toHaveBeenCalledWith(
      "real-code",
      undefined,
      STATE,
    );
  });
});
