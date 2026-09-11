import { describe, it, expect, vi } from "vitest";
import { createRemoteFetch } from "@inspector/core/mcp/remote/createRemoteFetch.js";
import {
  OAUTH_TIMEOUT_WIRE_CODE,
  OAuthRequestTimeoutError,
} from "@inspector/core/auth/requestTimeout.js";

function ok(body: object): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

const standardRemoteBody = {
  ok: true,
  status: 200,
  statusText: "OK",
  headers: { "content-type": "text/plain" },
  body: "echoed",
};

describe("createRemoteFetch", () => {
  it("forwards a string URL + GET to /api/fetch", async () => {
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockResolvedValue(ok(standardRemoteBody));
    const remoteFetch = createRemoteFetch({
      baseUrl: "http://remote.example/",
      fetchFn: fetchFn as unknown as typeof fetch,
    });
    const res = await remoteFetch("http://upstream.example/data");
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("echoed");
    expect(fetchFn).toHaveBeenCalledTimes(1);
    const init = fetchFn.mock.calls[0]?.[1];
    expect(init?.method).toBe("POST");
    const payload = JSON.parse(init?.body as string);
    expect(payload.url).toBe("http://upstream.example/data");
    expect(payload.method).toBe("GET");
  });

  it("serializes a URL object input and an explicit method override", async () => {
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockResolvedValue(ok(standardRemoteBody));
    const remoteFetch = createRemoteFetch({
      baseUrl: "http://remote.example",
      fetchFn: fetchFn as unknown as typeof fetch,
    });
    await remoteFetch(new URL("http://upstream.example/data"), {
      method: "DELETE",
    });
    const payload = JSON.parse(fetchFn.mock.calls[0]?.[1]?.body as string);
    expect(payload.url).toBe("http://upstream.example/data");
    expect(payload.method).toBe("DELETE");
  });

  it("serializes Request bodies by cloning and reading text", async () => {
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockResolvedValue(ok(standardRemoteBody));
    const remoteFetch = createRemoteFetch({
      baseUrl: "http://remote.example",
      fetchFn: fetchFn as unknown as typeof fetch,
    });
    const req = new Request("http://upstream.example/post", {
      method: "POST",
      body: "from-request",
    });
    await remoteFetch(req);
    const payload = JSON.parse(fetchFn.mock.calls[0]?.[1]?.body as string);
    expect(payload.body).toBe("from-request");
  });

  it("serializes URLSearchParams and FormData bodies into form-urlencoded strings", async () => {
    // mockImplementation creates a fresh Response per call — mockResolvedValue
    // returns the same instance and the second call's body is "already used".
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockImplementation(async () => ok(standardRemoteBody));
    const remoteFetch = createRemoteFetch({
      baseUrl: "http://remote.example",
      fetchFn: fetchFn as unknown as typeof fetch,
    });
    await remoteFetch("http://upstream.example/", {
      method: "POST",
      body: new URLSearchParams({ a: "1", b: "2" }),
    });
    const usp = JSON.parse(fetchFn.mock.calls[0]?.[1]?.body as string);
    expect(usp.body).toBe("a=1&b=2");

    const fd = new FormData();
    fd.set("x", "10");
    fd.set("y", "20");
    await remoteFetch("http://upstream.example/", {
      method: "POST",
      body: fd,
    });
    const fdPayload = JSON.parse(fetchFn.mock.calls[1]?.[1]?.body as string);
    expect(fdPayload.body).toBe("x=10&y=20");
  });

  it("falls back to String() for non-string, non-stream init.body", async () => {
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockResolvedValue(ok(standardRemoteBody));
    const remoteFetch = createRemoteFetch({
      baseUrl: "http://remote.example",
      fetchFn: fetchFn as unknown as typeof fetch,
    });
    const body = {
      toString() {
        return "stringified-body";
      },
    };
    await remoteFetch("http://upstream.example/", {
      method: "POST",
      body: body as unknown as BodyInit,
    });
    const payload = JSON.parse(fetchFn.mock.calls[0]?.[1]?.body as string);
    expect(payload.body).toBe("stringified-body");
  });

  it("sets x-mcp-remote-auth when authToken is provided", async () => {
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockResolvedValue(ok(standardRemoteBody));
    const remoteFetch = createRemoteFetch({
      baseUrl: "http://remote.example",
      authToken: "shh",
      fetchFn: fetchFn as unknown as typeof fetch,
    });
    await remoteFetch("http://upstream.example/");
    const headers = fetchFn.mock.calls[0]?.[1]?.headers as Record<
      string,
      string
    >;
    expect(headers["x-mcp-remote-auth"]).toBe("Bearer shh");
  });

  it("throws when the remote returns a non-ok status", async () => {
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response("upstream blew up", { status: 502 }));
    const remoteFetch = createRemoteFetch({
      baseUrl: "http://remote.example",
      fetchFn: fetchFn as unknown as typeof fetch,
    });
    await expect(remoteFetch("http://upstream.example/")).rejects.toThrow(
      /Remote fetch failed \(502\): upstream blew up/,
    );
  });

  it("rebuilds a Response from the remote's deserialized payload", async () => {
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(
      ok({
        ok: true,
        status: 201,
        statusText: "Created",
        headers: { "x-test": "yes" },
        body: "hello",
      }),
    );
    const remoteFetch = createRemoteFetch({
      baseUrl: "http://remote.example",
      fetchFn: fetchFn as unknown as typeof fetch,
    });
    const res = await remoteFetch("http://upstream.example/");
    expect(res.status).toBe(201);
    expect(res.statusText).toBe("Created");
    expect(res.headers.get("x-test")).toBe("yes");
    expect(await res.text()).toBe("hello");
  });

  describe("cancellation forwarding (#2319)", () => {
    // Without this the caller's abort settled only its own promise: the POST
    // stayed in flight, the backend never saw its request cancelled, and its
    // outbound fetch to the authorization server ran on detached.
    function capture() {
      const fetchFn = vi
        .fn<typeof fetch>()
        .mockResolvedValue(ok(standardRemoteBody));
      const remoteFetch = createRemoteFetch({
        baseUrl: "http://remote.example",
        // A contextually typed forwarding function rather than a double cast:
        // the mock stays inspectable and nothing bypasses the type system.
        fetchFn: (input, init) => fetchFn(input, init),
      });
      return { fetchFn, remoteFetch };
    }

    function signalOf(fetchFn: ReturnType<typeof vi.fn<typeof fetch>>) {
      return (fetchFn.mock.calls[0][1] as RequestInit).signal;
    }

    it("forwards init.signal onto the proxy hop", async () => {
      const { fetchFn, remoteFetch } = capture();
      const caller = new AbortController();

      await remoteFetch("http://upstream.example/", { signal: caller.signal });

      expect(signalOf(fetchFn)).toBe(caller.signal);
    });

    it("forwards a Request's own signal when init has none", async () => {
      const { fetchFn, remoteFetch } = capture();
      const caller = new AbortController();
      // Compared against `request.signal`, not `caller.signal`: the Fetch
      // standard gives `new Request(url, { signal })` a *dependent* signal, so
      // the two are distinct objects in a spec-compliant runtime. Asserting
      // against the controller's would encode non-standard identity and could
      // pass or fail on the host rather than on the behaviour (Copilot).
      const request = new Request("http://upstream.example/", {
        signal: caller.signal,
      });

      await remoteFetch(request);

      expect(signalOf(fetchFn)).toBe(request.signal);
    });

    it("treats an undefined init.signal as absent, keeping the Request's", async () => {
      // WebIDL dictionary conversion: a member present as `undefined` is absent.
      const { fetchFn, remoteFetch } = capture();
      const caller = new AbortController();
      const request = new Request("http://upstream.example/", {
        signal: caller.signal,
      });

      await remoteFetch(request, { signal: undefined });

      // Against `request.signal` for the dependent-signal reason above.
      expect(signalOf(fetchFn)).toBe(request.signal);
    });

    it("honours an explicit null init.signal as no signal", async () => {
      const { fetchFn, remoteFetch } = capture();
      const caller = new AbortController();

      await remoteFetch(
        new Request("http://upstream.example/", { signal: caller.signal }),
        { signal: null },
      );

      expect(signalOf(fetchFn)).toBeUndefined();
    });

    it("sends no signal when the caller supplied none", async () => {
      const { fetchFn, remoteFetch } = capture();

      await remoteFetch("http://upstream.example/");

      expect(signalOf(fetchFn)).toBeUndefined();
    });
  });

  describe("proxy-side deadline (#2319)", () => {
    function remoteReturning(status: number, body: string) {
      const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(
        new Response(body, {
          status,
          headers: { "content-type": "application/json" },
        }),
      );
      return createRemoteFetch({
        baseUrl: "http://remote.example",
        // Forwarding function, not a double cast — see `capture` above.
        fetchFn: (input, init) => fetchFn(input, init),
      });
    }

    it("rebuilds an OAuthRequestTimeoutError from the route's marker", async () => {
      // The one path where a timeout reaches the browser without a client-side
      // wrapper having fired first: the discovery the SDK runs from inside the
      // transport has no wrapper at all, so the backend's deadline is the only
      // one, and it arrives as an ordinary error response.
      const remoteFetch = remoteReturning(
        504,
        JSON.stringify({
          error: "proxied request to https://as.example.com/x timed out",
          code: OAUTH_TIMEOUT_WIRE_CODE,
          url: "https://as.example.com/x",
          timeoutMs: 30000,
        }),
      );

      const err = await remoteFetch("https://as.example.com/x").catch(
        (e: unknown) => e,
      );

      expect(err).toBeInstanceOf(OAuthRequestTimeoutError);
      const timeout = err as OAuthRequestTimeoutError;
      expect(timeout.url).toBe("https://as.example.com/x");
      expect(timeout.timeoutMs).toBe(30000);
    });

    it("leaves an ordinary error response as a plain Error", async () => {
      const remoteFetch = remoteReturning(
        500,
        JSON.stringify({ error: "connect ECONNREFUSED" }),
      );

      const err = await remoteFetch("https://as.example.com/x").catch(
        (e: unknown) => e,
      );

      expect(err).not.toBeInstanceOf(OAuthRequestTimeoutError);
      expect((err as Error).message).toMatch(/Remote fetch failed \(500\)/);
    });

    it("ignores a non-JSON error body rather than throwing on the parse", async () => {
      const remoteFetch = remoteReturning(502, "<html>bad gateway</html>");

      const err = await remoteFetch("https://as.example.com/x").catch(
        (e: unknown) => e,
      );

      expect((err as Error).message).toMatch(/Remote fetch failed \(502\)/);
    });

    it("ignores a marker whose fields are the wrong shape", async () => {
      // An upstream could serve JSON of its own through a failing proxy; the
      // guard checks the field types, not just the code.
      const remoteFetch = remoteReturning(
        504,
        JSON.stringify({ code: OAUTH_TIMEOUT_WIRE_CODE, url: 5 }),
      );

      const err = await remoteFetch("https://as.example.com/x").catch(
        (e: unknown) => e,
      );

      expect(err).not.toBeInstanceOf(OAuthRequestTimeoutError);
    });
  });
});
