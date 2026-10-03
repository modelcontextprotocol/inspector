import { describe, it, expect, vi } from "vitest";
import {
  CHALLENGE_BODY_MAX_BYTES,
  CHALLENGE_BODY_READ_MS,
  TRUNCATED_BODY_SUFFIX,
  WITHHELD_TRUNCATED_JSON_BODY,
  createFetchTracker,
  findHeader,
  redactSensitiveHeaders,
  redactBody,
  redactUrlQuery,
  REDACTED_HEADER_VALUE,
  REDACTED_VALUE,
} from "@inspector/core/mcp/fetchTracking.js";
import type {
  FetchRequestEntryBase,
  FetchStreamState,
} from "@inspector/core/mcp/types.js";

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

// Serialize a recorded entry MINUS its volatile `id` for whole-entry
// secret-leak assertions. The tracker mints `id` as
// `${timestamp}-${Math.random().toString(36)…}` (see fetchTracking.ts), so its
// random base36 tail can coincidentally contain a short secret substring (e.g.
// the base36 id `…sw7kshhf0` contains "shh"), which would fail a naive
// `JSON.stringify(entry).not.toContain(secret)` even though redaction worked.
// The `id` is generated independently of any secret and can never legitimately
// carry one, so excluding it keeps the leak check meaningful and deterministic
// while every other (deterministic) field is still checked.
function serializedWithoutId(entry: FetchRequestEntryBase): string {
  // Overwriting `id` with `undefined` drops it from the JSON (stringify omits
  // undefined-valued keys) without an unused destructured binding.
  return JSON.stringify({ ...entry, id: undefined });
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
    expect(serializedWithoutId(tracked[0]!)).not.toContain("live-access-token");
    expect(serializedWithoutId(tracked[0]!)).not.toContain("session=secret");
    expect(serializedWithoutId(tracked[0]!)).not.toContain(
      "inspector-backend-token",
    );
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
    expect(serializedWithoutId(tracked[0]!)).not.toContain("leaked-on-error");
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
    expect(serializedWithoutId(tracked[0]!)).not.toContain("issued-secret");
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
    expect(serializedWithoutId(tracked[0]!)).not.toContain("secret-auth-code");
    expect(serializedWithoutId(tracked[0]!)).not.toContain("shh");
    expect(serializedWithoutId(tracked[0]!)).not.toContain("pkce123");
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

  it("redacts a nested sensitive key in a JSON request body through the tracker", async () => {
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
    const liveBody = JSON.stringify({
      params: { arguments: { access_token: "sekret", page: 2 } },
    });
    await fetcher("https://example.com/mcp", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: liveBody,
    });
    // Recorded copy has the nested secret masked; non-sensitive siblings kept.
    expect(JSON.parse(tracked[0]!.requestBody!)).toEqual({
      params: { arguments: { access_token: REDACTED_VALUE, page: 2 } },
    });
    expect(serializedWithoutId(tracked[0]!)).not.toContain("sekret");
    // The live outbound request body is byte-identical (unredacted).
    expect(outboundInit?.body).toBe(liveBody);
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

describe("createFetchTracker — 401/403 challenge bodies (#2297)", () => {
  function track(response: Response) {
    const tracked: FetchRequestEntryBase[] = [];
    const updateResponseBody = vi.fn();
    const fetcher = createFetchTracker((async () => response) as typeof fetch, {
      trackRequest: (entry) => tracked.push(entry),
      updateResponseBody,
    });
    return { fetcher, tracked, updateResponseBody };
  }

  it("records the body on the entry itself, before returning", async () => {
    const body = JSON.stringify({ error: "invalid_token" });
    const { fetcher, tracked, updateResponseBody } = track(
      new Response(body, {
        status: 401,
        headers: { "content-type": "application/json" },
      }),
    );

    const res = await fetcher("https://mcp.example/mcp", { method: "POST" });

    expect(tracked).toHaveLength(1);
    expect(tracked[0]?.responseStatus).toBe(401);
    expect(tracked[0]?.responseBody).toBe(body);
    expect(updateResponseBody).not.toHaveBeenCalled();
    // The caller still gets an unread body.
    expect(await res.text()).toBe(body);
  });

  it("does the same for a 403", async () => {
    const { fetcher, tracked } = track(
      new Response("insufficient_scope", { status: 403 }),
    );
    await fetcher("https://mcp.example/mcp", { method: "POST" });
    expect(tracked[0]?.responseBody).toBe("insufficient_scope");
  });

  it("stops at the byte cap and marks the body truncated", async () => {
    const chunk = new Uint8Array(CHALLENGE_BODY_MAX_BYTES / 2).fill(97);
    let pulls = 0;
    const cancel = vi.fn();
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulls += 1;
        controller.enqueue(chunk);
      },
      cancel,
    });
    const { fetcher, tracked } = track(new Response(stream, { status: 401 }));

    const res = await fetcher("https://mcp.example/mcp", { method: "POST" });

    const recorded = tracked[0]?.responseBody ?? "";
    expect(recorded.endsWith(TRUNCATED_BODY_SUFFIX)).toBe(true);
    expect(recorded.length - TRUNCATED_BODY_SUFFIX.length).toBe(
      CHALLENGE_BODY_MAX_BYTES,
    );
    // With the clone released, cancelling the caller's branch reaches the source.
    await res.body?.cancel();
    expect(cancel).toHaveBeenCalled();
    expect(pulls).toBeLessThan(10);
  });

  it("gives up on a stalled body at the deadline and releases the source", async () => {
    vi.useFakeTimers();
    try {
      const cancel = vi.fn();
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode("partial"));
        },
        cancel,
      });
      const { fetcher, tracked } = track(new Response(stream, { status: 401 }));

      const pending = fetcher("https://mcp.example/mcp", { method: "POST" });
      await vi.advanceTimersByTimeAsync(CHALLENGE_BODY_READ_MS);
      const res = await pending;

      expect(tracked[0]?.responseBody).toBe(`partial${TRUNCATED_BODY_SUFFIX}`);
      await res.body?.cancel();
      expect(cancel).toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("records the entry with no body when the clone cannot be made", async () => {
    const response = new Response("nope", { status: 401 });
    vi.spyOn(response, "clone").mockImplementation(() => {
      throw new Error("clone failed");
    });
    const { fetcher, tracked } = track(response);

    await fetcher("https://mcp.example/mcp", { method: "POST" });

    expect(tracked).toHaveLength(1);
    expect(tracked[0]?.responseStatus).toBe(401);
    expect(tracked[0]?.responseBody).toBeUndefined();
  });

  it("records the entry with no body when the read errors", async () => {
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.error(new Error("socket reset"));
      },
    });
    const { fetcher, tracked } = track(new Response(stream, { status: 401 }));

    await fetcher("https://mcp.example/mcp", { method: "POST" });

    expect(tracked[0]?.responseStatus).toBe(401);
    expect(tracked[0]?.responseBody).toBeUndefined();
  });
});

describe("createFetchTracker — challenge body bounds and redaction (#2297)", () => {
  function trackOne(response: Response) {
    const tracked: FetchRequestEntryBase[] = [];
    const fetcher = createFetchTracker((async () => response) as typeof fetch, {
      trackRequest: (entry) => tracked.push(entry),
    });
    return { fetcher, tracked };
  }

  /** A body that delivers `prefix` and then never ends. */
  function stalledBody(prefix: string): ReadableStream<Uint8Array> {
    return new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(prefix));
      },
    });
  }

  async function withDeadlineElapsed<T>(run: () => Promise<T>): Promise<T> {
    vi.useFakeTimers();
    try {
      const pending = run();
      await vi.advanceTimersByTimeAsync(CHALLENGE_BODY_READ_MS);
      return await pending;
    } finally {
      vi.useRealTimers();
    }
  }

  it("caps a single chunk larger than the budget at the byte limit", async () => {
    const oversized = new Uint8Array(1024 * 1024).fill(97);
    const { fetcher, tracked } = trackOne(
      new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(oversized);
            controller.close();
          },
        }),
        { status: 401 },
      ),
    );

    await fetcher("https://mcp.example/mcp", { method: "POST" });

    const recorded = tracked[0]?.responseBody ?? "";
    expect(recorded.endsWith(TRUNCATED_BODY_SUFFIX)).toBe(true);
    expect(recorded.length - TRUNCATED_BODY_SUFFIX.length).toBe(
      CHALLENGE_BODY_MAX_BYTES,
    );
  });

  it("records the body of a 401 to a long-lived-stream GET", async () => {
    const { fetcher, tracked } = trackOne(
      new Response("unauthorized", {
        status: 401,
        headers: { "content-type": "text/event-stream" },
      }),
    );

    await fetcher("https://mcp.example/mcp", { method: "GET" });

    expect(tracked[0]?.responseBody).toBe("unauthorized");
  });

  it("withholds a cut-off JSON body rather than logging an unredacted prefix", async () => {
    const { fetcher, tracked } = trackOne(
      new Response(stalledBody('{"access_token":"live-access","token_type'), {
        status: 401,
        headers: { "content-type": "application/json" },
      }),
    );

    await withDeadlineElapsed(() =>
      fetcher("https://mcp.example/token", { method: "POST" }),
    );

    expect(tracked[0]?.responseBody).toBe(WITHHELD_TRUNCATED_JSON_BODY);
    expect(serializedWithoutId(tracked[0]!)).not.toContain("live-access");
  });

  it("withholds a cut-off body that sniffs as JSON with no content-type", async () => {
    const { fetcher, tracked } = trackOne(
      new Response(stalledBody('  [{"refresh_token":"live-refresh"'), {
        status: 403,
      }),
    );

    await withDeadlineElapsed(() =>
      fetcher("https://mcp.example/token", { method: "POST" }),
    );

    expect(tracked[0]?.responseBody).toBe(WITHHELD_TRUNCATED_JSON_BODY);
  });

  it("still redacts a complete JSON challenge body", async () => {
    const { fetcher, tracked } = trackOne(
      new Response(JSON.stringify({ error: "x", access_token: "live" }), {
        status: 401,
        headers: { "content-type": "application/json" },
      }),
    );

    await fetcher("https://mcp.example/token", { method: "POST" });

    expect(tracked[0]?.responseBody).toBe(
      JSON.stringify({ error: "x", access_token: REDACTED_VALUE }),
    );
  });

  it("redacts a cut-off form body field by field", async () => {
    const { fetcher, tracked } = trackOne(
      new Response(stalledBody("error=invalid&access_token=live&scope=re"), {
        status: 401,
        headers: { "content-type": "application/x-www-form-urlencoded" },
      }),
    );

    await withDeadlineElapsed(() =>
      fetcher("https://mcp.example/token", { method: "POST" }),
    );

    const recorded = tracked[0]?.responseBody ?? "";
    expect(recorded).not.toContain("live");
    expect(recorded.endsWith(TRUNCATED_BODY_SUFFIX)).toBe(true);
  });
});

describe("createFetchTracker — challenge body cancel rejection (#2297)", () => {
  it("swallows the source's cancel() rejection after stopping early", async () => {
    const chunk = new Uint8Array(CHALLENGE_BODY_MAX_BYTES).fill(97);
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(chunk);
      },
      cancel() {
        throw new Error("cancel failed");
      },
    });
    const tracked: FetchRequestEntryBase[] = [];
    const fetcher = createFetchTracker(
      (async () => new Response(stream, { status: 401 })) as typeof fetch,
      { trackRequest: (entry) => tracked.push(entry) },
    );

    const res = await fetcher("https://mcp.example/mcp", { method: "POST" });
    // Cancelling the caller's branch cancels the source, whose rejection then
    // reaches the tracker's own cancel of its clone — which must swallow it.
    await res.body?.cancel().catch(() => undefined);
    await flush();

    expect(tracked[0]?.responseStatus).toBe(401);
    expect(tracked[0]?.responseBody?.endsWith(TRUNCATED_BODY_SUFFIX)).toBe(
      true,
    );
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

  it("redacts a sensitive value's raw-& tail with it (#2532)", () => {
    const out = redactBody(
      "access_token=SECRETabc&SECRETdef&SECRETghi&token_type=bearer",
      "application/x-www-form-urlencoded",
    );
    expect(out).not.toMatch(/SECRET/);
    expect([...new URLSearchParams(out)]).toEqual([
      ["access_token", REDACTED_VALUE],
      ["token_type", "bearer"],
    ]);
  });

  it("folds a tail across an empty segment into the secret (#2532)", () => {
    const out = redactBody(
      "access_token=SECRETabc&&SECRETtail&token_type=bearer",
      "application/x-www-form-urlencoded",
    );
    expect(out).not.toMatch(/SECRET/);
    expect([...new URLSearchParams(out)]).toEqual([
      ["access_token", REDACTED_VALUE],
      ["token_type", "bearer"],
    ]);
  });

  it("keeps a no-= segment that follows a non-sensitive or empty value", () => {
    const out = redactBody(
      "scope=read&flag&access_token=&bare&refresh_token=r&&grant_type=x",
      "application/x-www-form-urlencoded",
    );
    expect([...new URLSearchParams(out)]).toEqual([
      ["scope", "read"],
      ["flag", ""],
      ["access_token", REDACTED_VALUE],
      ["bare", ""],
      ["refresh_token", REDACTED_VALUE],
      ["grant_type", "x"],
    ]);
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

  it("does NOT redact a numeric JSON-RPC error `code` (only string secrets)", () => {
    // The OAuth `code` name collides with a JSON-RPC error `code`, but the
    // latter is a number and never a secret — masking it would break the
    // Network tab's modern spec-error classification (-32020/-32021/…).
    const out = redactBody(
      JSON.stringify({
        jsonrpc: "2.0",
        id: 7,
        error: { code: -32020, message: "header mismatch" },
      }),
      "application/json",
    );
    const parsed = JSON.parse(out!) as {
      error: { code: number; message: string };
    };
    expect(parsed.error.code).toBe(-32020);
    expect(parsed.error.message).toBe("header mismatch");
  });

  it("still redacts a string-valued OAuth `code`", () => {
    const out = redactBody(
      JSON.stringify({ grant_type: "authorization_code", code: "SECRET" }),
      "application/json",
    );
    expect(JSON.parse(out!)).toEqual({
      grant_type: "authorization_code",
      code: REDACTED_VALUE,
    });
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

describe("findHeader", () => {
  it("looks a header up case-insensitively and tolerates a missing record", () => {
    expect(findHeader({ "Content-Type": "text/plain" }, "content-type")).toBe(
      "text/plain",
    );
    expect(findHeader({ "content-type": "text/plain" }, "CONTENT-TYPE")).toBe(
      "text/plain",
    );
    expect(findHeader({ accept: "*/*" }, "content-type")).toBeUndefined();
    expect(findHeader(undefined, "content-type")).toBeUndefined();
  });
});

describe("createFetchTracker long-lived stream watching (#2318)", () => {
  const encoder = new TextEncoder();

  /**
   * A server-controlled SSE body: `push` writes a chunk, `end` closes it, and
   * `fail` errors it — the three ways a real stream advances.
   */
  function controlledStream() {
    let controller!: ReadableStreamDefaultController<Uint8Array>;
    const stream = new ReadableStream<Uint8Array>({
      start(c) {
        controller = c;
      },
    });
    return {
      stream,
      push: (text: string) => controller.enqueue(encoder.encode(text)),
      end: () => controller.close(),
      fail: (err: Error) => controller.error(err),
    };
  }

  /** Track a GET whose response is the given stream, collecting stream updates. */
  async function trackStream(stream: ReadableStream<Uint8Array>) {
    const updates: Array<{ id: string; stream: FetchStreamState }> = [];
    const tracked: FetchRequestEntryBase[] = [];
    const fetcher = createFetchTracker(
      (async () =>
        new Response(stream, {
          headers: { "content-type": "text/event-stream" },
        })) as typeof fetch,
      {
        trackRequest: (entry) => tracked.push(entry),
        updateStream: (id, state) => updates.push({ id, stream: state }),
        streamUpdateIntervalMs: 0,
      },
    );
    const response = await fetcher("https://example.com/mcp", {
      method: "GET",
    });
    return { response, updates, id: tracked[0]!.id };
  }

  it("announces the stream as open with zero events as soon as it is watched", async () => {
    const server = controlledStream();
    const { updates, id } = await trackStream(server.stream);
    // Before a byte arrives — this is the state the #2187 stall shows.
    expect(updates).toEqual([{ id, stream: { eventCount: 0 } }]);
  });

  it("counts each data-carrying SSE event as it is delivered", async () => {
    const server = controlledStream();
    const { updates, id } = await trackStream(server.stream);
    server.push('event: message\ndata: {"jsonrpc":"2.0","method":"a"}\n\n');
    await flush();
    expect(updates.at(-1)).toEqual({ id, stream: { eventCount: 1 } });
    // An event split across chunks is still one event.
    server.push('data: {"jsonrpc"');
    server.push(':"2.0","method":"b"}\n');
    await flush();
    expect(updates.map((u) => u.stream.eventCount)).toEqual([0, 1]);
    server.push("\n");
    await flush();
    expect(updates.map((u) => u.stream.eventCount)).toEqual([0, 1, 2]);
  });

  it("ignores keepalive comments and blocks with no data field, and accepts a bare `data` line and CRLF framing", async () => {
    const server = controlledStream();
    const { updates } = await trackStream(server.stream);
    // A comment-only block (the keepalive shape) and an id-only block are
    // not events; a bare `data` (no colon) is; so is a CRLF-delimited block.
    server.push(": keepalive\n\n");
    server.push("id: 7\n\n");
    server.push("data\n\n");
    server.push("data: x\r\n\r\n");
    await flush();
    expect(updates.map((u) => u.stream.eventCount)).toEqual([0, 1, 2]);
  });

  it("counts every non-blank line on an NDJSON stream", async () => {
    const server = controlledStream();
    const updates: Array<{ id: string; stream: FetchStreamState }> = [];
    const fetcher = createFetchTracker(
      (async () =>
        new Response(server.stream, {
          headers: { "content-type": "application/x-ndjson" },
        })) as typeof fetch,
      {
        updateStream: (id, state) => updates.push({ id, stream: state }),
        streamUpdateIntervalMs: 0,
      },
    );
    await fetcher("https://example.com/mcp", { method: "GET" });
    server.push('{"jsonrpc":"2.0","method":"a"}\n\n');
    server.push('{"jsonrpc":"2.0","method":"b"}\r\n');
    // A partial line is not an event until its newline arrives.
    server.push('{"jsonrpc":"2.0",');
    await flush();
    expect(updates.map((u) => u.stream.eventCount)).toEqual([0, 1, 2]);
    server.push('"method":"c"}\n');
    await flush();
    expect(updates.at(-1)!.stream.eventCount).toBe(3);
  });

  it("drops a partial SSE block at end-of-stream, as the SDK's parser does", async () => {
    const server = controlledStream();
    const { updates } = await trackStream(server.stream);
    // A data line with no dispatching blank line before the stream ends.
    server.push("data: one\n\ndata: two\n");
    server.end();
    await flush();
    const last = updates.at(-1)!.stream;
    expect(last.eventCount).toBe(1);
    expect(last.closedAt).toBeInstanceOf(Date);
  });

  it("accepts bare CR line endings, and a CRLF split across chunks", async () => {
    const server = controlledStream();
    const { updates } = await trackStream(server.stream);
    server.push("data: a\r\rdata: b\r");
    await flush();
    // The trailing CR is held: it may be the first half of a CRLF.
    expect(updates.map((u) => u.stream.eventCount)).toEqual([0, 1]);
    server.push("\n\r\n");
    await flush();
    expect(updates.map((u) => u.stream.eventCount)).toEqual([0, 1, 2]);
  });

  it("classifies the content type and the method case-insensitively", async () => {
    const server = controlledStream();
    const updates: unknown[] = [];
    const fetcher = createFetchTracker(
      (async () =>
        new Response(server.stream, {
          headers: { "content-type": "Text/Event-Stream" },
        })) as typeof fetch,
      {
        updateStream: (id, state) => updates.push({ id, state }),
        streamUpdateIntervalMs: 0,
      },
    );
    await fetcher("https://example.com/mcp", { method: "get" });
    expect(updates).toHaveLength(1);
  });

  it("takes the method from a Request input when init carries none", async () => {
    // A bounded POST reply must go down the body-capture path, not the
    // watcher, when the caller passed a `Request` rather than `init`.
    const bodies: string[] = [];
    const updates: unknown[] = [];
    const tracked: FetchRequestEntryBase[] = [];
    const fetcher = createFetchTracker(
      (async () =>
        new Response("data: x\n\n", {
          headers: { "content-type": "text/event-stream" },
        })) as typeof fetch,
      {
        trackRequest: (entry) => tracked.push(entry),
        updateResponseBody: (_id, body) => bodies.push(body),
        updateStream: (id, state) => updates.push({ id, state }),
        streamUpdateIntervalMs: 0,
      },
    );
    await fetcher(new Request("https://example.com/mcp", { method: "POST" }));
    await flush();
    expect(tracked[0]?.method).toBe("POST");
    expect(bodies).toEqual(["data: x\n\n"]);
    expect(updates).toEqual([]);
  });

  it("coalesces a moving count to one report per interval, and reports the close at once", async () => {
    vi.useFakeTimers();
    try {
      const server = controlledStream();
      const updates: Array<{ id: string; stream: FetchStreamState }> = [];
      const fetcher = createFetchTracker(
        (async () =>
          new Response(server.stream, {
            headers: { "content-type": "text/event-stream" },
          })) as typeof fetch,
        {
          updateStream: (id, state) => updates.push({ id, stream: state }),
          streamUpdateIntervalMs: 100,
        },
      );
      await fetcher("https://example.com/mcp", { method: "GET" });
      // The open is immediate.
      expect(updates.map((u) => u.stream.eventCount)).toEqual([0]);
      server.push("data: a\n\ndata: b\n\ndata: c\n\n");
      await vi.advanceTimersByTimeAsync(0);
      // Three events, no report yet — they are inside one window.
      expect(updates.map((u) => u.stream.eventCount)).toEqual([0]);
      await vi.advanceTimersByTimeAsync(100);
      expect(updates.map((u) => u.stream.eventCount)).toEqual([0, 3]);
      // A close cancels a pending window and reports immediately.
      server.push("data: d\n\n");
      server.end();
      await vi.advanceTimersByTimeAsync(0);
      expect(updates.map((u) => u.stream.eventCount)).toEqual([0, 3, 4]);
      expect(updates.at(-1)!.stream.closedAt).toBeInstanceOf(Date);
      await vi.advanceTimersByTimeAsync(200);
      expect(updates).toHaveLength(3);
    } finally {
      vi.useRealTimers();
    }
  });

  it("counts an event whose bare-CR terminator is the last byte of the stream", async () => {
    const server = controlledStream();
    const { updates } = await trackStream(server.stream);
    server.push("data: x\r\r");
    await flush();
    // Held while the stream is open: the CR could be half of a CRLF.
    expect(updates.map((u) => u.stream.eventCount)).toEqual([0]);
    server.end();
    await flush();
    expect(updates.at(-1)!.stream).toMatchObject({ eventCount: 1 });
    expect(updates.at(-1)!.stream.closedAt).toBeInstanceOf(Date);
  });

  it("returns the response even when the listener throws on the open report", async () => {
    // The open is reported synchronously inside the fetch wrapper; a throw
    // there must not turn a successful response into a rejected fetch.
    const server = controlledStream();
    const response = new Response(server.stream, {
      headers: { "content-type": "text/event-stream" },
    });
    const fetcher = createFetchTracker((async () => response) as typeof fetch, {
      updateStream: () => {
        throw new Error("sink closed");
      },
      streamUpdateIntervalMs: 0,
    });
    await expect(
      fetcher("https://example.com/mcp", { method: "GET" }),
    ).resolves.toBe(response);
    // ...and a throw from a coalesced count does not escape the timer either.
    server.push("data: a\n\n");
    server.end();
    await flush();
  });

  it("survives a stream-update listener that throws on the close", async () => {
    // The watcher's promise is discarded, so a throw from the final report
    // would otherwise be an unhandled rejection — which fails the whole run.
    const server = controlledStream();
    let reports = 0;
    const fetcher = createFetchTracker(
      (async () =>
        new Response(server.stream, {
          headers: { "content-type": "text/event-stream" },
        })) as typeof fetch,
      {
        updateStream: (_id, state) => {
          reports += 1;
          if (state.closedAt) throw new Error("listener exploded");
        },
        streamUpdateIntervalMs: 0,
      },
    );
    await fetcher("https://example.com/mcp", { method: "GET" });
    server.end();
    await flush();
    expect(reports).toBe(2);
  });

  it("reports the close when the server ends the stream", async () => {
    const server = controlledStream();
    const { updates, id } = await trackStream(server.stream);
    server.push("data: one\n\n");
    server.end();
    await flush();
    expect(updates).toHaveLength(3);
    expect(updates[2]!.id).toBe(id);
    expect(updates[2]!.stream.eventCount).toBe(1);
    expect(updates[2]!.stream.closedAt).toBeInstanceOf(Date);
    // Only the close carries `closedAt`.
    expect(updates[0]!.stream.closedAt).toBeUndefined();
    expect(updates[1]!.stream.closedAt).toBeUndefined();
  });

  it("reports the close when the stream errors, with the count so far", async () => {
    const server = controlledStream();
    const { updates } = await trackStream(server.stream);
    server.push("data: one\n\n");
    server.fail(new Error("connection reset"));
    await flush();
    expect(updates).toHaveLength(3);
    expect(updates[2]!.stream).toMatchObject({ eventCount: 1 });
    expect(updates[2]!.stream.closedAt).toBeInstanceOf(Date);
  });

  it("leaves the transport's own copy of the stream intact", async () => {
    const server = controlledStream();
    const { response, updates } = await trackStream(server.stream);
    server.push("data: hello\n\n");
    server.end();
    // The transport reads the original; the watcher read a tee'd clone.
    expect(await response.text()).toBe("data: hello\n\n");
    await flush();
    expect(updates.at(-1)!.stream).toMatchObject({ eventCount: 1 });
  });

  it("does not clone the response when nobody subscribed to stream updates", async () => {
    const response = new Response(controlledStream().stream, {
      headers: { "content-type": "text/event-stream" },
    });
    const clone = vi.spyOn(response, "clone");
    const fetcher = createFetchTracker((async () => response) as typeof fetch, {
      trackRequest: () => {},
    });
    await fetcher("https://example.com/mcp", { method: "GET" });
    expect(clone).not.toHaveBeenCalled();
  });

  it("does not watch a bounded response", async () => {
    const updates: unknown[] = [];
    const fetcher = createFetchTracker(
      (async () =>
        new Response("data: x\n\n", {
          headers: { "content-type": "text/event-stream" },
        })) as typeof fetch,
      {
        updateStream: (id, state) => updates.push({ id, state }),
        streamUpdateIntervalMs: 0,
      },
    );
    // A POST SSE reply is bounded and goes down the body-capture path.
    await fetcher("https://example.com/mcp", { method: "POST" });
    await flush();
    expect(updates).toEqual([]);
  });

  it("gives up quietly when the response cannot be cloned", async () => {
    const response = new Response(controlledStream().stream, {
      headers: { "content-type": "text/event-stream" },
    });
    vi.spyOn(response, "clone").mockImplementation(() => {
      throw new TypeError("already consumed");
    });
    const updates: unknown[] = [];
    const fetcher = createFetchTracker((async () => response) as typeof fetch, {
      updateStream: (id, state) => updates.push({ id, state }),
      streamUpdateIntervalMs: 0,
    });
    await expect(
      fetcher("https://example.com/mcp", { method: "GET" }),
    ).resolves.toBe(response);
    await flush();
    expect(updates).toEqual([]);
  });

  it("gives up quietly when the clone has no body", async () => {
    const response = new Response(controlledStream().stream, {
      headers: { "content-type": "text/event-stream" },
    });
    vi.spyOn(response, "clone").mockImplementation(
      () =>
        new Response(null, {
          headers: { "content-type": "text/event-stream" },
        }),
    );
    const updates: unknown[] = [];
    const fetcher = createFetchTracker((async () => response) as typeof fetch, {
      updateStream: (id, state) => updates.push({ id, state }),
      streamUpdateIntervalMs: 0,
    });
    await fetcher("https://example.com/mcp", { method: "GET" });
    await flush();
    expect(updates).toEqual([]);
  });
});
