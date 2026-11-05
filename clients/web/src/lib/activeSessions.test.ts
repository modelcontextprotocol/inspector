import { afterEach, describe, expect, it, vi } from "vitest";
import type { RemoteSessionSummary } from "@inspector/core/mcp/remote/index.js";
import {
  browserActiveSessionsApi,
  listActiveSessions,
  terminateActiveSession,
} from "./activeSessions";

const SESSION: RemoteSessionSummary = {
  sessionId: "s1",
  serverName: "Everything",
  transport: "stdio",
  createdAt: "2026-03-01T00:00:00.000Z",
  consumerAttached: false,
  lastConsumerSeenAt: null,
  queuedEvents: 0,
  transportDead: false,
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("listActiveSessions", () => {
  it("GETs the session list with the auth header and returns it", async () => {
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockResolvedValue(json({ sessions: [SESSION] }));
    const sessions = await listActiveSessions({
      baseUrl: "http://host/",
      authToken: "tok",
      fetchFn,
    });
    expect(sessions).toEqual([SESSION]);
    const [url, init] = fetchFn.mock.calls[0]!;
    expect(url).toBe("http://host/api/mcp/sessions");
    expect(init).toMatchObject({
      method: "GET",
      headers: { "x-mcp-remote-auth": "Bearer tok" },
    });
  });

  it("sends no auth header without a token", async () => {
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockResolvedValue(json({ sessions: [] }));
    await listActiveSessions({ baseUrl: "http://host", fetchFn });
    expect(fetchFn.mock.calls[0]![1]!.headers).toEqual({});
  });

  it("uses the global fetch by default", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(json({ sessions: [] }));
    vi.stubGlobal("fetch", fetchMock);
    await listActiveSessions({ baseUrl: "http://host" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("throws the backend's error message on a failed request", async () => {
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockResolvedValue(json({ error: "Authentication required" }, 401));
    await expect(
      listActiveSessions({ baseUrl: "http://host", fetchFn }),
    ).rejects.toThrow("Listing sessions failed: Authentication required");
  });

  it("falls back to the status when the error body is not JSON or has no message", async () => {
    const notJson = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response("boom", { status: 502 }));
    await expect(
      listActiveSessions({ baseUrl: "http://host", fetchFn: notJson }),
    ).rejects.toThrow("Listing sessions failed: HTTP 502");

    const noMessage = vi
      .fn<typeof fetch>()
      .mockResolvedValue(json({ error: "" }, 500));
    await expect(
      listActiveSessions({ baseUrl: "http://host", fetchFn: noMessage }),
    ).rejects.toThrow("Listing sessions failed: HTTP 500");
  });

  it("rejects a response with no sessions array", async () => {
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(json({}));
    await expect(
      listActiveSessions({ baseUrl: "http://host", fetchFn }),
    ).rejects.toThrow("malformed response");
  });
});

describe("terminateActiveSession", () => {
  it("DELETEs the encoded session id", async () => {
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(json({ ok: true }));
    await terminateActiveSession("a/b", {
      baseUrl: "http://host",
      authToken: "tok",
      fetchFn,
    });
    const [url, init] = fetchFn.mock.calls[0]!;
    expect(url).toBe("http://host/api/mcp/sessions/a%2Fb");
    expect(init).toMatchObject({ method: "DELETE" });
  });

  it("throws when the backend refuses", async () => {
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockResolvedValue(json({ error: "Session not found" }, 404));
    await expect(
      terminateActiveSession("gone", { baseUrl: "http://host", fetchFn }),
    ).rejects.toThrow("Terminating the session failed: Session not found");
  });
});

describe("browserActiveSessionsApi", () => {
  it("targets this page's origin with the recovered API token", () => {
    window.sessionStorage.setItem("MCP_INSPECTOR_API_TOKEN", "from-storage");
    try {
      expect(browserActiveSessionsApi()).toEqual({
        baseUrl: window.location.origin,
        authToken: "from-storage",
      });
    } finally {
      window.sessionStorage.removeItem("MCP_INSPECTOR_API_TOKEN");
    }
  });
});
