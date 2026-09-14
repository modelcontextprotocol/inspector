/**
 * `publishAppDocument` (#2056) — the browser half of dedicated-origin hosting.
 *
 * The contract worth pinning is the failure behavior: every way this can fail
 * must resolve `null` rather than throw, because the caller's response to all
 * of them is the same (render the app the default way), and a throw there
 * would cost the user the app itself.
 */

import { describe, it, expect, vi } from "vitest";
import { publishAppDocument } from "./publishAppDocument";

/**
 * A real `Response`, not a shaped literal. The platform implementation is
 * available here, so building one keeps `ok`/`status`/`json()` honest rather
 * than asserting a hand-written object is a Response.
 */
function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("publishAppDocument", () => {
  it("POSTs the document with the auth header and returns the URL", async () => {
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        jsonResponse({ url: "http://localhost:6278/app-document/abc" }),
      );
    const url = await publishAppDocument(
      { html: "<p>app</p>", csp: "default-src 'none'" },
      { baseUrl: "http://localhost:6274", authToken: "tok", fetchFn },
    );
    expect(url).toBe("http://localhost:6278/app-document/abc");
    expect(fetchFn).toHaveBeenCalledWith(
      "http://localhost:6274/api/app-document",
      expect.objectContaining({
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-mcp-remote-auth": "Bearer tok",
        },
        body: JSON.stringify({ html: "<p>app</p>", csp: "default-src 'none'" }),
      }),
    );
  });

  it("omits the auth header when there is no token, and trims a trailing slash", async () => {
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse({ url: "http://x/y" }));
    await publishAppDocument(
      { html: "<p>app</p>" },
      { baseUrl: "http://localhost:6274/", fetchFn },
    );
    expect(fetchFn).toHaveBeenCalledWith(
      "http://localhost:6274/api/app-document",
      expect.objectContaining({
        headers: { "Content-Type": "application/json" },
      }),
    );
  });

  it.each([
    ["a 503 (no app-origin listener)", jsonResponse({}, 503)],
    ["a 404 (backend predating the route)", jsonResponse({}, 404)],
    ["a body with no url", jsonResponse({})],
    ["a body whose url is not a string", jsonResponse({ url: 42 })],
    ["a body whose url is empty", jsonResponse({ url: "" })],
  ])("resolves null for %s", async (_label, response) => {
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(response);
    await expect(
      publishAppDocument(
        { html: "<p>app</p>" },
        { baseUrl: "http://b", fetchFn },
      ),
    ).resolves.toBeNull();
  });

  it("resolves null on a network error rather than rejecting", async () => {
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockRejectedValue(new Error("offline"));
    await expect(
      publishAppDocument(
        { html: "<p>app</p>" },
        { baseUrl: "http://b", fetchFn },
      ),
    ).resolves.toBeNull();
  });

  it("resolves null when the response body is not JSON", async () => {
    // A real 200 whose body is not JSON, so `json()` rejects for the reason
    // the production path has to survive rather than because a stub threw.
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response("not json", { status: 200 }));
    await expect(
      publishAppDocument(
        { html: "<p>app</p>" },
        { baseUrl: "http://b", fetchFn },
      ),
    ).resolves.toBeNull();
  });

  it("defaults to globalThis.fetch when none is injected", async () => {
    const spy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(jsonResponse({ url: "http://x/y" }));
    try {
      await expect(
        publishAppDocument({ html: "<p>app</p>" }, { baseUrl: "http://b" }),
      ).resolves.toBe("http://x/y");
      expect(spy).toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });
});
