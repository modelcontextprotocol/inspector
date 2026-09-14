/**
 * `POST /api/app-document` (#2056) — the authenticated seam the browser hands a
 * wrapped MCP App document back through so the backend can serve it from a
 * dedicated origin.
 *
 * The route owns validation and the two "can't host it" answers; the listener
 * that actually serves the bytes is `clients/web/server/app-origin-controller`
 * and is tested separately.
 */

import { describe, it, expect, vi } from "vitest";
import { createRemoteApp } from "@inspector/core/mcp/remote/node/server.js";

function post(body: unknown): Request {
  return new Request("http://test/api/app-document", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

function appWith(
  publishAppDocument?: (doc: {
    html: string;
    csp?: string;
  }) => { url: string } | null,
) {
  return createRemoteApp({
    dangerouslyOmitAuth: true,
    allowedOrigins: ["http://127.0.0.1:6274"],
    initialConfig: { defaultEnvironment: {} },
    publishAppDocument,
  }).app;
}

describe("createRemoteApp POST /api/app-document", () => {
  it("publishes the document and returns the URL", async () => {
    const publish = vi
      .fn<(doc: { html: string; csp?: string }) => { url: string } | null>()
      .mockReturnValue({ url: "http://localhost:6278/app-document/abc" });
    const res = await appWith(publish).request(
      post({ html: "<h1>hi</h1>", csp: "default-src 'none'" }),
    );
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      url: "http://localhost:6278/app-document/abc",
    });
    expect(publish).toHaveBeenCalledWith({
      html: "<h1>hi</h1>",
      csp: "default-src 'none'",
    });
  });

  it("accepts a document with no csp", async () => {
    const publish = vi
      .fn<(doc: { html: string; csp?: string }) => { url: string } | null>()
      .mockReturnValue({ url: "http://localhost:6278/app-document/abc" });
    const res = await appWith(publish).request(post({ html: "<h1>hi</h1>" }));
    expect(res.status).toBe(200);
    expect(publish).toHaveBeenCalledWith({
      html: "<h1>hi</h1>",
      csp: undefined,
    });
  });

  it("answers 503 when the backend supplies no publisher", async () => {
    // An embedder with no app-origin listener at all — the browser reads this
    // as "no dedicated origin available" and renders the app the default way.
    const res = await appWith().request(post({ html: "<h1>hi</h1>" }));
    expect(res.status).toBe(503);
  });

  it("answers 503 when the publisher declines (listener never bound)", async () => {
    const res = await appWith(() => null).request(
      post({ html: "<h1>hi</h1>" }),
    );
    expect(res.status).toBe(503);
  });

  it("rejects a malformed body", async () => {
    const res = await appWith(() => ({ url: "http://x/y" })).request(
      post("{not json"),
    );
    expect(res.status).toBe(400);
  });

  it.each([
    ["a JSON null body", "null"],
    ["a JSON array body", "[1,2]"],
  ])("rejects %s with 400 rather than a 500", async (_label, raw) => {
    // Both parse cleanly, so the try/catch above sees nothing — destructuring
    // them is what used to throw, outside it, turning a bad shape into a 500.
    const publish = vi
      .fn<(doc: { html: string; csp?: string }) => { url: string } | null>()
      .mockReturnValue({ url: "http://x/y" });
    const res = await appWith(publish).request(post(raw));
    expect(res.status).toBe(400);
    expect(publish).not.toHaveBeenCalled();
  });

  it.each([
    ["missing html", {}],
    ["empty html", { html: "" }],
    ["non-string html", { html: 42 }],
    ["non-string csp", { html: "<p>x</p>", csp: 42 }],
  ])("rejects %s with 400", async (_label, body) => {
    const publish = vi
      .fn<(doc: { html: string; csp?: string }) => { url: string } | null>()
      .mockReturnValue({ url: "http://x/y" });
    const res = await appWith(publish).request(post(body));
    expect(res.status).toBe(400);
    expect(publish).not.toHaveBeenCalled();
  });

  it.each([
    ["a CR/LF-carrying csp", "default-src 'none'\r\nX-Evil: 1"],
    ["a NUL-carrying csp", "default-src 'none'\u0000"],
  ])("rejects %s with 400", async (_label, csp) => {
    // The controller hands `csp` to `res.writeHead()` verbatim. Node throws
    // ERR_INVALID_CHAR there SYNCHRONOUSLY, inside the handler for a later,
    // unrelated request — so accepting one here turns a bad publish into a
    // thrown listener rather than a 400 anyone can see.
    const publish = vi
      .fn<(doc: { html: string; csp?: string }) => { url: string } | null>()
      .mockReturnValue({ url: "http://x/y" });
    const res = await appWith(publish).request(post({ html: "<p>x</p>", csp }));
    expect(res.status).toBe(400);
    expect(publish).not.toHaveBeenCalled();
  });

  it("rejects an oversized csp with 413 — it is retained per document", async () => {
    const publish = vi
      .fn<(doc: { html: string; csp?: string }) => { url: string } | null>()
      .mockReturnValue({ url: "http://x/y" });
    const res = await appWith(publish).request(
      post({ html: "<p>x</p>", csp: "a".repeat(8 * 1024 + 1) }),
    );
    expect(res.status).toBe(413);
    expect(publish).not.toHaveBeenCalled();
  });

  it("rejects an oversized BODY before parsing it", async () => {
    // Distinct from the document check below, which only runs once the whole
    // request has been buffered and parsed — and only bounds `html`.
    const publish = vi
      .fn<(doc: { html: string; csp?: string }) => { url: string } | null>()
      .mockReturnValue({ url: "http://x/y" });
    const res = await appWith(publish).request(
      post(`{"junk":"${"x".repeat(24 * 1024 * 1024 + 1024)}"}`),
    );
    expect(res.status).toBe(413);
    expect(publish).not.toHaveBeenCalled();
  });

  it("rejects an oversized document with 413 rather than pinning it in memory", async () => {
    const publish = vi
      .fn<(doc: { html: string; csp?: string }) => { url: string } | null>()
      .mockReturnValue({ url: "http://x/y" });
    const res = await appWith(publish).request(
      post({ html: "x".repeat(8 * 1024 * 1024 + 1) }),
    );
    expect(res.status).toBe(413);
    expect(publish).not.toHaveBeenCalled();
  });

  it("requires the auth token like every other /api route", async () => {
    const { app } = createRemoteApp({
      authToken: "s3cret",
      allowedOrigins: ["http://127.0.0.1:6274"],
      initialConfig: { defaultEnvironment: {} },
      publishAppDocument: () => ({ url: "http://x/y" }),
    });
    const unauthorized = await app.request(post({ html: "<p>x</p>" }));
    expect(unauthorized.status).toBe(401);

    const authorized = await app.request(
      new Request("http://test/api/app-document", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-mcp-remote-auth": "Bearer s3cret",
        },
        body: JSON.stringify({ html: "<p>x</p>" }),
      }),
    );
    expect(authorized.status).toBe(200);
  });
});
