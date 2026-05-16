import { describe, it, expect, vi } from "vitest";
import { RemoteInspectorClientStorage } from "@inspector/core/mcp/remote/sessionStorage.js";
import type { InspectorClientSessionState } from "@inspector/core/mcp/sessionStorage.js";

function makeStorage(fetchFn: typeof fetch, authToken?: string) {
  return new RemoteInspectorClientStorage({
    baseUrl: "http://remote.example/",
    fetchFn,
    authToken,
  });
}

function sampleState(): InspectorClientSessionState {
  return {
    fetchRequests: [
      {
        id: "1",
        timestamp: new Date("2026-01-01T00:00:00Z"),
        method: "GET",
        url: "http://example.com/",
        requestHeaders: {},
        category: "transport" as const,
      },
    ],
    createdAt: 1735689600000,
    updatedAt: 1735689600001,
  };
}

describe("RemoteInspectorClientStorage", () => {
  it("saveSession POSTs serialized state with timestamps as ISO strings", async () => {
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(null, { status: 204 }));
    const storage = makeStorage(fetchFn as unknown as typeof fetch, "tok");

    await storage.saveSession("sid", sampleState());
    expect(fetchFn).toHaveBeenCalledTimes(1);
    const [url, init] = fetchFn.mock.calls[0]!;
    expect(url).toBe("http://remote.example/api/storage/inspector-session-sid");
    expect(init?.method).toBe("POST");
    expect((init?.headers as Record<string, string>)["x-mcp-remote-auth"]).toBe(
      "Bearer tok",
    );
    const body = JSON.parse(init?.body as string);
    expect(body.fetchRequests[0].timestamp).toBe("2026-01-01T00:00:00.000Z");
  });

  it("saveSession leaves non-Date timestamps untouched", async () => {
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(null, { status: 204 }));
    const storage = makeStorage(fetchFn as unknown as typeof fetch);
    const state = sampleState();
    // Pre-coerce to a number to exercise the ternary's else branch.
    state.fetchRequests[0]!.timestamp = 99 as unknown as Date;
    await storage.saveSession("sid", state);
    const body = JSON.parse(fetchFn.mock.calls[0]?.[1]?.body as string);
    expect(body.fetchRequests[0].timestamp).toBe(99);
  });

  it("saveSession throws on non-ok response", async () => {
    const fetchFn = vi.fn(async () => new Response("nope", { status: 500 }));
    const storage = makeStorage(fetchFn as unknown as typeof fetch);
    await expect(storage.saveSession("sid", sampleState())).rejects.toThrow(
      /500 nope/,
    );
  });

  it("loadSession returns undefined on 404", async () => {
    const fetchFn = vi.fn(async () => new Response(null, { status: 404 }));
    const storage = makeStorage(fetchFn as unknown as typeof fetch);
    expect(await storage.loadSession("missing")).toBeUndefined();
  });

  it("loadSession throws on other error statuses", async () => {
    const fetchFn = vi.fn(async () => new Response("broken", { status: 500 }));
    const storage = makeStorage(fetchFn as unknown as typeof fetch);
    await expect(storage.loadSession("any")).rejects.toThrow(/500 broken/);
  });

  it("loadSession converts ISO-string timestamps back into Date objects", async () => {
    const fetchFn = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            fetchRequests: [
              {
                id: "1",
                timestamp: "2026-01-01T00:00:00.000Z",
                method: "GET",
                url: "http://example.com/",
                requestHeaders: {},
              },
            ],
            createdAt: 1735689600000,
            updatedAt: 1735689600001,
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        ),
    );
    const storage = makeStorage(fetchFn as unknown as typeof fetch);
    const state = await storage.loadSession("sid");
    expect(state?.fetchRequests[0]?.timestamp).toBeInstanceOf(Date);
    expect((state?.fetchRequests[0]?.timestamp as Date).toISOString()).toBe(
      "2026-01-01T00:00:00.000Z",
    );
  });

  it("loadSession preserves Date timestamps already provided as Date instances", async () => {
    const fetchFn = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            fetchRequests: [
              {
                id: "1",
                timestamp: new Date("2026-02-02T00:00:00Z").toISOString(),
                method: "GET",
                url: "http://example.com/",
                requestHeaders: {},
              },
            ],
            createdAt: 1,
            updatedAt: 2,
          }),
        ),
    );
    const storage = makeStorage(fetchFn as unknown as typeof fetch);
    const state = await storage.loadSession("sid");
    expect((state?.fetchRequests[0]?.timestamp as Date).getTime()).toBe(
      new Date("2026-02-02T00:00:00Z").getTime(),
    );
  });

  it("deleteSession tolerates 404 and rethrows on other errors", async () => {
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(new Response(null, { status: 404 }))
      .mockResolvedValueOnce(new Response("oops", { status: 500 }));
    const storage = makeStorage(fetchFn as unknown as typeof fetch);
    await expect(storage.deleteSession("sid")).resolves.toBeUndefined();
    await expect(storage.deleteSession("sid")).resolves.toBeUndefined();
    await expect(storage.deleteSession("sid")).rejects.toThrow(/500 oops/);
  });

  it("does not send auth header when no token is configured", async () => {
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(null, { status: 204 }));
    const storage = makeStorage(fetchFn as unknown as typeof fetch);
    await storage.saveSession("sid", sampleState());
    expect(
      (fetchFn.mock.calls[0]?.[1]?.headers as Record<string, string>)[
        "x-mcp-remote-auth"
      ],
    ).toBeUndefined();
  });
});
