import { describe, it, expect, vi } from "vitest";
import { createRemoteFetch } from "@inspector/core/mcp/remote/createRemoteFetch.js";

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
});
