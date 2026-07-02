import { describe, it, expect, vi } from "vitest";
import {
  createFetchTracker,
  redactSensitiveHeaders,
  redactBody,
  redactUrlQuery,
  REDACTED_HEADER_VALUE,
  REDACTED_VALUE,
} from "@inspector/core/mcp/fetchTracking.js";
import type { FetchRequestEntryBase } from "@inspector/core/mcp/types.js";

// The tracker fires `trackRequest` synchronously with an entry whose
// responseBody is always undefined, then reads the body in the background
// and calls `updateResponseBody(id, body)` when done. This helper waits a
// microtask so the background read can complete before assertions.
const flush = () => new Promise((r) => setTimeout(r, 0));

// happy-dom's Headers.forEach preserves the original key casing whereas
// Node's lowercases — normalise in tests so assertions are env-independent.
function lowerKeys(
  headers: Record<string, string> | undefined,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers ?? {})) out[k.toLowerCase()] = v;
  return out;
}

describe("createFetchTracker", () => {
  it("tracks a successful GET request and emits the response body asynchronously", async () => {
    const baseFetch = vi.fn(
      async () =>
        new Response("hello", {
          status: 200,
          statusText: "OK",
          headers: { "content-type": "text/plain" },
        }),
    );
    const tracked: FetchRequestEntryBase[] = [];
    const bodies: Array<{ id: string; body: string }> = [];
    const fetcher = createFetchTracker(baseFetch as typeof fetch, {
      trackRequest: (entry) => tracked.push(entry),
      updateResponseBody: (id, body) => bodies.push({ id, body }),
    });

    const res = await fetcher("https://example.com/data");
    expect(res.status).toBe(200);
    expect(tracked).toHaveLength(1);
    expect(tracked[0]?.method).toBe("GET");
    expect(tracked[0]?.url).toBe("https://example.com/data");
    expect(tracked[0]?.responseBody).toBeUndefined();
    expect(tracked[0]?.responseStatus).toBe(200);

    await flush();
    expect(bodies).toEqual([{ id: tracked[0]!.id, body: "hello" }]);
  });

  it("accepts URL objects and Request instances as input", async () => {
    const baseFetch = vi.fn(async () => new Response("ok"));
    const tracked: FetchRequestEntryBase[] = [];
    const fetcher = createFetchTracker(baseFetch as typeof fetch, {
      trackRequest: (entry) => tracked.push(entry),
    });

    await fetcher(new URL("https://example.com/foo"));
    await fetcher(
      new Request("https://example.com/bar", {
        method: "POST",
        body: "hello",
        headers: { "x-custom": "yes" },
      }),
    );
    expect(tracked).toHaveLength(2);
    expect(tracked[0]?.url).toBe("https://example.com/foo");
    expect(tracked[1]?.url).toBe("https://example.com/bar");
    expect(tracked[1]?.requestHeaders["x-custom"]).toBe("yes");
    expect(tracked[1]?.requestBody).toBe("hello");
  });

  it("falls back to String() for non-string init bodies and yields undefined when conversion throws", async () => {
    const baseFetch = vi.fn(async () => new Response("ok"));
    const tracked: FetchRequestEntryBase[] = [];
    const fetcher = createFetchTracker(baseFetch as typeof fetch, {
      trackRequest: (entry) => tracked.push(entry),
    });

    const throwingBody = {
      toString() {
        throw new Error("not coercible");
      },
    };
    await fetcher("https://example.com/x", {
      method: "POST",
      body: throwingBody as unknown as BodyInit,
    });
    expect(tracked[0]?.requestBody).toBeUndefined();
  });

  it("captures the error path when baseFetch throws", async () => {
    const baseFetch = vi.fn(async () => {
      throw new Error("network down");
    });
    const tracked: FetchRequestEntryBase[] = [];
    const fetcher = createFetchTracker(baseFetch as typeof fetch, {
      trackRequest: (entry) => tracked.push(entry),
    });

    await expect(
      fetcher("https://example.com/fail", { method: "POST" }),
    ).rejects.toThrow("network down");
    expect(tracked).toHaveLength(1);
    expect(tracked[0]?.error).toBe("network down");
    expect(tracked[0]?.responseStatus).toBeUndefined();
  });

  it("captures the error path when baseFetch throws a non-Error", async () => {
    const baseFetch = vi.fn(async () => {
      throw "stringly-typed";
    });
    const tracked: FetchRequestEntryBase[] = [];
    const fetcher = createFetchTracker(baseFetch as typeof fetch, {
      trackRequest: (entry) => tracked.push(entry),
    });

    await expect(fetcher("https://example.com/fail")).rejects.toBe(
      "stringly-typed",
    );
    expect(tracked[0]?.error).toBe("stringly-typed");
  });

  it("skips body reading on GET event-stream responses (long-lived stream)", async () => {
    const baseFetch = vi.fn(
      async () =>
        new Response("ignored", {
          headers: { "content-type": "text/event-stream" },
        }),
    );
    const tracked: FetchRequestEntryBase[] = [];
    const bodies: Array<{ id: string; body: string }> = [];
    const fetcher = createFetchTracker(baseFetch as typeof fetch, {
      trackRequest: (entry) => tracked.push(entry),
      updateResponseBody: (id, body) => bodies.push({ id, body }),
    });
    await fetcher("https://example.com/events", { method: "GET" });
    await flush();
    expect(tracked[0]?.responseBody).toBeUndefined();
    expect(bodies).toHaveLength(0);
  });

  it("skips body reading on GET application/x-ndjson responses", async () => {
    const baseFetch = vi.fn(
      async () =>
        new Response("ignored", {
          headers: { "content-type": "application/x-ndjson" },
        }),
    );
    const tracked: FetchRequestEntryBase[] = [];
    const bodies: Array<{ id: string; body: string }> = [];
    const fetcher = createFetchTracker(baseFetch as typeof fetch, {
      trackRequest: (entry) => tracked.push(entry),
      updateResponseBody: (id, body) => bodies.push({ id, body }),
    });
    await fetcher("https://example.com/events", { method: "GET" });
    await flush();
    expect(bodies).toHaveLength(0);
  });

  it("emits the body for a POST event-stream response after the stream closes (bounded)", async () => {
    // Streamable HTTP POST /mcp answers with SSE that closes after the
    // reply. The tracker must NOT block on this read — the transport
    // needs to consume the stream first to drive progress notifications.
    // Body therefore arrives asynchronously via updateResponseBody.
    const sse =
      'event: message\ndata: {"jsonrpc":"2.0","id":1,"result":{"tools":[]}}\n\n';
    const baseFetch = vi.fn(
      async () =>
        new Response(sse, {
          headers: { "content-type": "text/event-stream" },
        }),
    );
    const tracked: FetchRequestEntryBase[] = [];
    const bodies: Array<{ id: string; body: string }> = [];
    const fetcher = createFetchTracker(baseFetch as typeof fetch, {
      trackRequest: (entry) => tracked.push(entry),
      updateResponseBody: (id, body) => bodies.push({ id, body }),
    });
    await fetcher("https://example.com/mcp", { method: "POST" });
    expect(tracked[0]?.responseBody).toBeUndefined();
    await flush();
    expect(bodies).toEqual([{ id: tracked[0]!.id, body: sse }]);
  });

  it("emits the body for a POST /mcp JSON response asynchronously", async () => {
    const baseFetch = vi.fn(
      async () =>
        new Response('{"jsonrpc":"2.0","id":1,"result":{"tools":[]}}', {
          status: 200,
          statusText: "OK",
          headers: { "content-type": "application/json" },
        }),
    );
    const tracked: FetchRequestEntryBase[] = [];
    const bodies: Array<{ id: string; body: string }> = [];
    const fetcher = createFetchTracker(baseFetch as typeof fetch, {
      trackRequest: (entry) => tracked.push(entry),
      updateResponseBody: (id, body) => bodies.push({ id, body }),
    });
    await fetcher("https://example.com/mcp", { method: "POST" });
    expect(tracked[0]?.responseBody).toBeUndefined();
    await flush();
    expect(bodies).toEqual([
      {
        id: tracked[0]!.id,
        body: '{"jsonrpc":"2.0","id":1,"result":{"tools":[]}}',
      },
    ]);
  });

  it("does not block the caller awaiting the response body", async () => {
    // If the body promise hangs forever (simulating a long-lived stream
    // mid-flight), the tracker still has to resolve the outer fetcher
    // promise immediately. Otherwise the transport blocks waiting on us.
    const neverEnding = new ReadableStream({
      start() {
        // Never enqueue, never close — `.text()` on a clone of this would hang.
      },
    });
    const baseFetch = vi.fn(
      async () => new Response(neverEnding, { status: 200 }),
    );
    const tracked: FetchRequestEntryBase[] = [];
    const fetcher = createFetchTracker(baseFetch as typeof fetch, {
      trackRequest: (entry) => tracked.push(entry),
    });
    const res = await fetcher("https://example.com/slow", { method: "POST" });
    expect(res.status).toBe(200);
    expect(tracked).toHaveLength(1);
    expect(tracked[0]?.responseBody).toBeUndefined();
  });

  it("survives a Request whose body cannot be cloned/read", async () => {
    const baseFetch = vi.fn(async () => new Response("ok"));
    const tracked: FetchRequestEntryBase[] = [];
    const fetcher = createFetchTracker(baseFetch as typeof fetch, {
      trackRequest: (entry) => tracked.push(entry),
    });

    const req = new Request("https://example.com/post", {
      method: "POST",
      body: "payload",
    });
    // Force clone() to throw, exercising the inner catch
    Object.defineProperty(req, "clone", {
      value: () => {
        throw new Error("clone failed");
      },
    });
    await fetcher(req);
    expect(tracked[0]?.requestBody).toBeUndefined();
  });

  it("does not call updateResponseBody when response.clone() throws", async () => {
    const tracked: FetchRequestEntryBase[] = [];
    const bodies: Array<{ id: string; body: string }> = [];
    const baseFetch = vi.fn(async () => {
      const r = new Response("body");
      Object.defineProperty(r, "clone", {
        value: () => {
          throw new Error("nope");
        },
      });
      return r;
    });
    const fetcher = createFetchTracker(baseFetch as typeof fetch, {
      trackRequest: (entry) => tracked.push(entry),
      updateResponseBody: (id, body) => bodies.push({ id, body }),
    });
    await fetcher("https://example.com/data");
    await flush();
    expect(tracked[0]?.responseBody).toBeUndefined();
    expect(bodies).toHaveLength(0);
  });

  it("redacts Authorization and Cookie request headers in the recorded entry", async () => {
    let outboundInit: RequestInit | undefined;
    const baseFetch = vi.fn(
      async (_input: RequestInfo | URL, init?: RequestInit) => {
        outboundInit = init;
        return new Response("ok");
      },
    );
    const tracked: FetchRequestEntryBase[] = [];
    const fetcher = createFetchTracker(baseFetch as typeof fetch, {
      trackRequest: (entry) => tracked.push(entry),
    });
    await fetcher("https://example.com/mcp", {
      method: "POST",
      headers: {
        Authorization: "Bearer live-access-token",
        cookie: "session=secret",
        "X-Api-Key": "sk-123",
        "x-mcp-remote-auth": "Bearer inspector-backend-token",
        "X-Custom": "kept",
      },
    });
    const headers = lowerKeys(tracked[0]!.requestHeaders);
    expect(headers["authorization"]).toBe(REDACTED_HEADER_VALUE);
    expect(headers["cookie"]).toBe(REDACTED_HEADER_VALUE);
    expect(headers["x-api-key"]).toBe(REDACTED_HEADER_VALUE);
    expect(headers["x-mcp-remote-auth"]).toBe(REDACTED_HEADER_VALUE);
    expect(headers["x-custom"]).toBe("kept");
    expect(JSON.stringify(tracked[0])).not.toContain("live-access-token");
    expect(JSON.stringify(tracked[0])).not.toContain("session=secret");
    expect(JSON.stringify(tracked[0])).not.toContain("inspector-backend-token");
    // The actual outbound request still carries the live token — redaction is
    // only for the recorded entry.
    expect(new Headers(outboundInit?.headers).get("authorization")).toBe(
      "Bearer live-access-token",
    );
  });

  it("redacts Authorization on the error path too", async () => {
    const baseFetch = vi.fn(async () => {
      throw new Error("network down");
    });
    const tracked: FetchRequestEntryBase[] = [];
    const fetcher = createFetchTracker(baseFetch as typeof fetch, {
      trackRequest: (entry) => tracked.push(entry),
    });
    await expect(
      fetcher("https://example.com/fail", {
        headers: { Authorization: "Bearer leaked-on-error" },
      }),
    ).rejects.toThrow("network down");
    expect(lowerKeys(tracked[0]!.requestHeaders)["authorization"]).toBe(
      REDACTED_HEADER_VALUE,
    );
    expect(JSON.stringify(tracked[0])).not.toContain("leaked-on-error");
  });

  it("redacts sensitive response headers in the recorded entry", async () => {
    // Set-Cookie is a forbidden response-header name in the Fetch API (the
    // browser strips it from a constructed Response), so exercise the
    // response-side redaction with x-api-key instead — it proves the same
    // wiring without fighting the test environment.
    const baseFetch = vi.fn(
      async () =>
        new Response("ok", {
          headers: {
            "x-api-key": "issued-secret",
            "content-type": "text/plain",
          },
        }),
    );
    const tracked: FetchRequestEntryBase[] = [];
    const fetcher = createFetchTracker(baseFetch as typeof fetch, {
      trackRequest: (entry) => tracked.push(entry),
    });
    await fetcher("https://example.com/login");
    const responseHeaders = lowerKeys(tracked[0]!.responseHeaders);
    expect(responseHeaders["x-api-key"]).toBe(REDACTED_HEADER_VALUE);
    expect(responseHeaders["content-type"]).toBe("text/plain");
    expect(JSON.stringify(tracked[0])).not.toContain("issued-secret");
  });

  it("redacts a form-encoded OAuth token request body without touching the live request", async () => {
    let outboundInit: RequestInit | undefined;
    const baseFetch = vi.fn(
      async (_input: RequestInfo | URL, init?: RequestInit) => {
        outboundInit = init;
        return new Response("ok");
      },
    );
    const tracked: FetchRequestEntryBase[] = [];
    const fetcher = createFetchTracker(baseFetch as typeof fetch, {
      trackRequest: (entry) => tracked.push(entry),
    });
    const liveBody =
      "grant_type=authorization_code&code=secret-auth-code&client_secret=shh&code_verifier=pkce123&client_id=public";
    await fetcher("https://auth.example.com/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: liveBody,
    });
    const recorded = new URLSearchParams(tracked[0]!.requestBody);
    expect(recorded.get("code")).toBe(REDACTED_VALUE);
    expect(recorded.get("client_secret")).toBe(REDACTED_VALUE);
    expect(recorded.get("code_verifier")).toBe(REDACTED_VALUE);
    expect(recorded.get("grant_type")).toBe("authorization_code");
    expect(recorded.get("client_id")).toBe("public");
    expect(JSON.stringify(tracked[0])).not.toContain("secret-auth-code");
    expect(JSON.stringify(tracked[0])).not.toContain("shh");
    expect(JSON.stringify(tracked[0])).not.toContain("pkce123");
    // The live outbound request body is byte-identical.
    expect(outboundInit?.body).toBe(liveBody);
  });

  it("redacts a JSON token response body asynchronously", async () => {
    const baseFetch = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            access_token: "live-access",
            refresh_token: "live-refresh",
            token_type: "Bearer",
            expires_in: 3600,
          }),
          { headers: { "content-type": "application/json" } },
        ),
    );
    const tracked: FetchRequestEntryBase[] = [];
    const bodies: Array<{ id: string; body: string }> = [];
    const fetcher = createFetchTracker(baseFetch as typeof fetch, {
      trackRequest: (entry) => tracked.push(entry),
      updateResponseBody: (id, body) => bodies.push({ id, body }),
    });
    await fetcher("https://auth.example.com/token", { method: "POST" });
    await flush();
    expect(bodies).toHaveLength(1);
    const parsed = JSON.parse(bodies[0]!.body) as Record<string, unknown>;
    expect(parsed.access_token).toBe(REDACTED_VALUE);
    expect(parsed.refresh_token).toBe(REDACTED_VALUE);
    expect(parsed.token_type).toBe("Bearer");
    expect(parsed.expires_in).toBe(3600);
    expect(bodies[0]!.body).not.toContain("live-access");
    expect(bodies[0]!.body).not.toContain("live-refresh");
  });

  it("redacts sensitive query params in the recorded URL (success + error paths)", async () => {
    const baseFetch = vi.fn(async () => new Response("ok"));
    const tracked: FetchRequestEntryBase[] = [];
    const fetcher = createFetchTracker(baseFetch as typeof fetch, {
      trackRequest: (entry) => tracked.push(entry),
    });
    await fetcher(
      "https://auth.example.com/callback?state=xyz&code=secret-code&access_token=leaky",
    );
    expect(tracked[0]!.url).toContain("state=xyz");
    expect(tracked[0]!.url).toContain(
      `code=${encodeURIComponent(REDACTED_VALUE)}`,
    );
    expect(tracked[0]!.url).not.toContain("secret-code");
    expect(tracked[0]!.url).not.toContain("leaky");

    const failing = createFetchTracker(
      vi.fn(async () => {
        throw new Error("boom");
      }) as typeof fetch,
      { trackRequest: (entry) => tracked.push(entry) },
    );
    await expect(
      failing("https://auth.example.com/token?refresh_token=leaked-on-error"),
    ).rejects.toThrow("boom");
    expect(tracked[1]!.url).not.toContain("leaked-on-error");
  });

  it("leaves non-sensitive bodies and URLs untouched", async () => {
    const baseFetch = vi.fn(
      async () =>
        new Response('{"tools":[]}', {
          headers: { "content-type": "application/json" },
        }),
    );
    const tracked: FetchRequestEntryBase[] = [];
    const bodies: Array<{ id: string; body: string }> = [];
    const fetcher = createFetchTracker(baseFetch as typeof fetch, {
      trackRequest: (entry) => tracked.push(entry),
      updateResponseBody: (id, body) => bodies.push({ id, body }),
    });
    await fetcher("https://example.com/mcp?page=2", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: '{"method":"tools/list"}',
    });
    await flush();
    expect(tracked[0]!.url).toBe("https://example.com/mcp?page=2");
    expect(tracked[0]!.requestBody).toBe('{"method":"tools/list"}');
    expect(bodies[0]!.body).toBe('{"tools":[]}');
  });

  it("does not throw on a malformed body — logs it as-is", async () => {
    const baseFetch = vi.fn(async () => new Response("ok"));
    const tracked: FetchRequestEntryBase[] = [];
    const fetcher = createFetchTracker(baseFetch as typeof fetch, {
      trackRequest: (entry) => tracked.push(entry),
    });
    const malformed = "{ this is not: valid json ]]";
    await fetcher("https://example.com/x", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: malformed,
    });
    expect(tracked[0]!.requestBody).toBe(malformed);
  });
});

describe("redactUrlQuery", () => {
  it("redacts sensitive params and keeps the path + other params", () => {
    expect(
      redactUrlQuery("https://x.example/cb?state=ok&code=abc&client_secret=s"),
    ).toBe(
      `https://x.example/cb?state=ok&code=${encodeURIComponent(
        REDACTED_VALUE,
      )}&client_secret=${encodeURIComponent(REDACTED_VALUE)}`,
    );
  });

  it("returns URLs without a query string unchanged", () => {
    expect(redactUrlQuery("https://x.example/path")).toBe(
      "https://x.example/path",
    );
  });

  it("returns URLs with only non-sensitive params unchanged", () => {
    expect(redactUrlQuery("https://x.example/p?a=1&b=2")).toBe(
      "https://x.example/p?a=1&b=2",
    );
  });

  it("matches param names case-insensitively", () => {
    const out = redactUrlQuery("https://x.example/cb?CODE=abc");
    expect(out).toContain(encodeURIComponent(REDACTED_VALUE));
    expect(out).not.toContain("abc");
  });

  it("preserves a trailing fragment", () => {
    expect(redactUrlQuery("https://x.example/p?token=t#section")).toBe(
      `https://x.example/p?token=${encodeURIComponent(REDACTED_VALUE)}#section`,
    );
  });

  it("collapses repeated sensitive params to a single redacted value", () => {
    expect(redactUrlQuery("https://x.example/p?code=a&code=b")).toBe(
      `https://x.example/p?code=${encodeURIComponent(REDACTED_VALUE)}`,
    );
  });
});

describe("redactBody", () => {
  it("returns undefined / empty bodies unchanged", () => {
    expect(redactBody(undefined, "application/json")).toBeUndefined();
    expect(redactBody("", "application/json")).toBe("");
  });

  it("redacts form-encoded fields (with a charset in the content-type)", () => {
    const out = redactBody(
      "client_secret=s&grant_type=client_credentials",
      "application/x-www-form-urlencoded; charset=utf-8",
    );
    const params = new URLSearchParams(out);
    expect(params.get("client_secret")).toBe(REDACTED_VALUE);
    expect(params.get("grant_type")).toBe("client_credentials");
  });

  it("leaves a form body with no sensitive fields byte-identical", () => {
    const body = "grant_type=client_credentials&scope=read";
    expect(redactBody(body, "application/x-www-form-urlencoded")).toBe(body);
  });

  it("redacts nested JSON objects and arrays", () => {
    const out = redactBody(
      JSON.stringify({
        outer: { password: "p", keep: "v" },
        list: [{ token: "t1" }, { token: "t2" }],
      }),
      "application/json",
    );
    const parsed = JSON.parse(out!) as {
      outer: { password: string; keep: string };
      list: Array<{ token: string }>;
    };
    expect(parsed.outer.password).toBe(REDACTED_VALUE);
    expect(parsed.outer.keep).toBe("v");
    expect(parsed.list.map((e) => e.token)).toEqual([
      REDACTED_VALUE,
      REDACTED_VALUE,
    ]);
  });

  it("sniffs JSON when the content-type is missing", () => {
    const out = redactBody('{"access_token":"x"}', undefined);
    expect(JSON.parse(out!)).toEqual({ access_token: REDACTED_VALUE });
  });

  it("leaves a JSON scalar (no field names) unchanged", () => {
    expect(redactBody('"just a string"', "application/json")).toBe(
      '"just a string"',
    );
  });

  it("returns a non-JSON, non-form body unchanged", () => {
    expect(redactBody("plain text log line", "text/plain")).toBe(
      "plain text log line",
    );
  });

  it("does not throw on malformed JSON", () => {
    const bad = "{not json";
    expect(redactBody(bad, "application/json")).toBe(bad);
  });
});

describe("redactSensitiveHeaders", () => {
  it("redacts case-insensitively while preserving the original key casing", () => {
    const out = redactSensitiveHeaders({
      Authorization: "Bearer x",
      "PROXY-AUTHORIZATION": "Basic y",
      "X-Trace": "abc",
    });
    expect(out).toEqual({
      Authorization: REDACTED_HEADER_VALUE,
      "PROXY-AUTHORIZATION": REDACTED_HEADER_VALUE,
      "X-Trace": "abc",
    });
  });

  it("returns a new object and never mutates the input", () => {
    const input = { authorization: "Bearer x" };
    const out = redactSensitiveHeaders(input);
    expect(out).not.toBe(input);
    expect(input.authorization).toBe("Bearer x");
  });
});
