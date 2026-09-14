/**
 * The dedicated app origin (#2056): the listener that serves an MCP App whose
 * UI resource declares `_meta.ui.domain`, so the app document has a real origin
 * and its requests carry a real `Origin` instead of `null`.
 *
 * The behaviors pinned here are the ones the feature's value rests on: the
 * document is reachable at the URL `publish` hands back, it is served with the
 * per-app CSP as a real response header plus a `frame-ancestors` naming the
 * sandbox proxy, an id nobody published is a 404, and every degradation path
 * (no listener, port taken, unusable bind host) leaves the caller able to fall
 * back to the default opaque-origin render rather than losing the app.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createServer, type Server } from "node:http";
import { EventEmitter } from "node:events";
import {
  createAppOriginController,
  DEFAULT_APP_ORIGIN_PORT,
  parseDocumentId,
  resolveAppOriginPort,
  appDocumentEmbedders,
} from "../../../../server/app-origin-controller.js";
import { RUNNER_OAUTH_CALLBACK_DEFAULT_PORT } from "@inspector/core/auth/node/runner-oauth-callback.js";

describe("resolveAppOriginPort", () => {
  const saved = process.env.MCP_APP_ORIGIN_PORT;
  afterEach(() => {
    if (saved === undefined) delete process.env.MCP_APP_ORIGIN_PORT;
    else process.env.MCP_APP_ORIGIN_PORT = saved;
  });

  it("defaults to the fixed port so it can be forwarded", () => {
    delete process.env.MCP_APP_ORIGIN_PORT;
    expect(resolveAppOriginPort()).toBe(DEFAULT_APP_ORIGIN_PORT);
  });

  it("does not default to the runners' fixed OAuth callback port", () => {
    // Both listeners are fixed-by-default and both live in the 627x family, so
    // the next free number is the obvious pick for each — which is how they
    // collided. This one can move (it warns and retries on a dynamic port);
    // the OAuth callback cannot, because apps pre-register
    // `http://127.0.0.1:<that port>/oauth/callback`. A `--web` holding the
    // port would therefore break a later `--cli`/`--tui` OAuth flow, and the
    // handoff recipe runs those side by side.
    expect(DEFAULT_APP_ORIGIN_PORT).not.toBe(
      RUNNER_OAUTH_CALLBACK_DEFAULT_PORT,
    );
  });

  it("honors a valid MCP_APP_ORIGIN_PORT, including an explicit 0", () => {
    process.env.MCP_APP_ORIGIN_PORT = "9200";
    expect(resolveAppOriginPort()).toBe(9200);
    process.env.MCP_APP_ORIGIN_PORT = "0";
    expect(resolveAppOriginPort()).toBe(0);
  });

  it.each(["6278abc", "70000", "-1", "nope", "  "])(
    "warns and falls back for an invalid value %j",
    (value) => {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      try {
        process.env.MCP_APP_ORIGIN_PORT = value;
        expect(resolveAppOriginPort()).toBe(DEFAULT_APP_ORIGIN_PORT);
        // A blank value is "unset", not "invalid" — nothing to warn about.
        if (value.trim()) {
          expect(warnSpy).toHaveBeenCalledWith(
            expect.stringContaining("MCP_APP_ORIGIN_PORT"),
          );
        } else {
          expect(warnSpy).not.toHaveBeenCalled();
        }
      } finally {
        warnSpy.mockRestore();
      }
    },
  );
});

describe("parseDocumentId", () => {
  const id = "a".repeat(32);

  it("reads the id out of a document path, query string and all", () => {
    expect(parseDocumentId(`/app-document/${id}`)).toBe(id);
    expect(parseDocumentId(`/app-document/${id}?x=1`)).toBe(id);
    expect(parseDocumentId(`/app-document/${id}#frag`)).toBe(id);
  });

  it.each([
    ["undefined target", undefined],
    ["another path", "/sandbox"],
    ["no id", "/app-document/"],
    ["a non-hex id", "/app-document/" + "z".repeat(32)],
    ["a short id", "/app-document/abc"],
    ["a traversal attempt", "/app-document/../../etc/passwd"],
    ["a nested path", `/app-document/${id}/extra`],
  ])("rejects %s", (_label, url) => {
    expect(parseDocumentId(url as string | undefined)).toBeNull();
  });
});

describe("appDocumentEmbedders", () => {
  it("admits the sandbox proxy AND the Inspector page", () => {
    // `frame-ancestors` is checked against EVERY ancestor, not just the parent:
    // the document is framed by the proxy, which is framed by the app page.
    // Omitting the app page's origin blocks the frame outright (it renders as a
    // chrome-error frame that never reaches the bridge).
    expect(
      appDocumentEmbedders("http://127.0.0.1:6275/sandbox", [
        "http://127.0.0.1:6274",
        "http://localhost:6274",
      ]),
    ).toEqual([
      "http://127.0.0.1:6275",
      "http://127.0.0.1:6274",
      "http://localhost:6274",
    ]);
  });

  it("still returns the allow-list when the sandbox never bound", () => {
    expect(appDocumentEmbedders(null, ["http://127.0.0.1:6274"])).toEqual([
      "http://127.0.0.1:6274",
    ]);
  });

  it.each([[null], [undefined], [""]])(
    "returns undefined for %j with no allow-list, so frame-ancestors falls back to loopback",
    (value) => {
      // Not `[]`: an empty list would make the directive `'none'` and block the
      // app frame outright, which is worse than a permissive loopback fallback.
      expect(
        appDocumentEmbedders(value as string | null | undefined),
      ).toBeUndefined();
    },
  );
});

describe("createAppOriginController", () => {
  let controller: ReturnType<typeof createAppOriginController> | null = null;

  beforeEach(() => {
    controller = null;
  });

  afterEach(async () => {
    await controller?.close();
  });

  it("serves a published document at the URL it hands back, with the CSP as a header", async () => {
    controller = createAppOriginController({
      port: 0,
      host: "127.0.0.1",
      embedderOrigins: ["http://127.0.0.1:6275"],
    });
    const { url } = await controller.start();
    expect(url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    expect(controller.getOrigin()).toBe(url);

    const published = controller.publish({
      html: "<!doctype html><p>app</p>",
      csp: "default-src 'none'; connect-src https://api.example.com",
    });
    expect(published).not.toBeNull();
    expect(published!.url.startsWith(`${url}/app-document/`)).toBe(true);

    const res = await fetch(published!.url);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/html; charset=utf-8");
    // `nosniff` matters more here than on a page we authored: these bytes are
    // server-supplied and untrusted.
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("cache-control")).toContain("no-store");
    // The per-app policy, plus a frame-ancestors naming the sandbox proxy —
    // the only page allowed to frame this document.
    expect(res.headers.get("content-security-policy")).toBe(
      "default-src 'none'; connect-src https://api.example.com; frame-ancestors http://127.0.0.1:6275",
    );
    await expect(res.text()).resolves.toBe("<!doctype html><p>app</p>");
  });

  it("serves only frame-ancestors when the document carries no csp", async () => {
    controller = createAppOriginController({ port: 0, host: "127.0.0.1" });
    await controller.start();
    const published = controller.publish({ html: "<p>x</p>" })!;
    const res = await fetch(published.url);
    // No embedderOrigins supplied → the loopback fallback, same as the sandbox
    // proxy's own directive.
    expect(res.headers.get("content-security-policy")).toBe(
      "frame-ancestors http://127.0.0.1:* http://localhost:*",
    );
  });

  it("mints a distinct, unguessable id per document", async () => {
    controller = createAppOriginController({ port: 0, host: "127.0.0.1" });
    const { url } = await controller.start();
    const a = controller.publish({ html: "<p>a</p>" })!;
    const b = controller.publish({ html: "<p>b</p>" })!;
    expect(a.url).not.toBe(b.url);
    expect(a.url.slice(`${url}/app-document/`.length)).toMatch(
      /^[0-9a-f]{32}$/,
    );
    await expect((await fetch(a.url)).text()).resolves.toBe("<p>a</p>");
    await expect((await fetch(b.url)).text()).resolves.toBe("<p>b</p>");
  });

  it("404s an unknown id and any non-document request", async () => {
    controller = createAppOriginController({ port: 0, host: "127.0.0.1" });
    const { url } = await controller.start();
    expect((await fetch(`${url}/app-document/${"b".repeat(32)}`)).status).toBe(
      404,
    );
    expect((await fetch(`${url}/`)).status).toBe(404);
    expect((await fetch(`${url}/sandbox`)).status).toBe(404);
  });

  it("404s a non-GET request to a real document", async () => {
    controller = createAppOriginController({ port: 0, host: "127.0.0.1" });
    await controller.start();
    const published = controller.publish({ html: "<p>x</p>" })!;
    expect((await fetch(published.url, { method: "POST" })).status).toBe(404);
    expect((await fetch(published.url)).status).toBe(200);
  });

  it("returns null from publish before start, so the caller falls back to srcdoc", async () => {
    controller = createAppOriginController({ port: 0, host: "127.0.0.1" });
    expect(controller.publish({ html: "<p>x</p>" })).toBeNull();
    expect(controller.getOrigin()).toBeNull();
  });

  it("evicts the oldest document past the cap rather than growing unbounded", async () => {
    controller = createAppOriginController({ port: 0, host: "127.0.0.1" });
    await controller.start();
    const first = controller.publish({ html: "<p>first</p>" })!;
    // 32 is the cap; publishing 32 more must have pushed the first out.
    for (let i = 0; i < 32; i++) {
      controller.publish({ html: `<p>${i}</p>` });
    }
    expect((await fetch(first.url)).status).toBe(404);
  });

  it("evicts against a retained-size budget, not just the entry count", async () => {
    // The count bound alone permits MAX_DOCUMENTS * 8Mi retained for an hour,
    // on documents a server under test chooses the size of. Publish a few
    // large ones — well under the 32-entry cap — and the earliest must stop
    // being served.
    const c = createAppOriginController({ port: 0, host: "127.0.0.1" });
    controller = c;
    const { url } = await c.start();
    // 24Mi each: three fit under no count bound, but the third pushes total
    // retained past the 64Mi budget and the first has to go.
    const big = "x".repeat(24 * 1024 * 1024);
    const first = c.publish({ html: big });
    const second = c.publish({ html: big });
    expect(first).not.toBeNull();
    expect(second).not.toBeNull();
    const third = c.publish({ html: big });
    expect(third).not.toBeNull();

    expect((await fetch(first!.url)).status).toBe(404);
    // The newest is always served — its frame is about to fetch it.
    expect((await fetch(third!.url)).status).toBe(200);
    expect(url).toBe(c.getOrigin());
  });

  it("404s a document past its TTL", async () => {
    // Fake `Date` ONLY — the TTL is the sole thing that reads it, and faking
    // the timer queue too would deadlock the real HTTP round-trip below.
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      controller = createAppOriginController({ port: 0, host: "127.0.0.1" });
      await controller.start();
      const published = controller.publish({ html: "<p>x</p>" })!;
      expect((await fetch(published.url)).status).toBe(200);
      vi.setSystemTime(Date.now() + 61 * 60 * 1000);
      expect((await fetch(published.url)).status).toBe(404);
    } finally {
      vi.useRealTimers();
    }
  });

  it("returns the same handle when start() is called twice", async () => {
    controller = createAppOriginController({ port: 0, host: "127.0.0.1" });
    const first = await controller.start();
    const second = await controller.start();
    expect(second).toEqual(first);
  });

  it("drops published documents on close so nothing is served after teardown", async () => {
    controller = createAppOriginController({ port: 0, host: "127.0.0.1" });
    await controller.start();
    const published = controller.publish({ html: "<p>x</p>" })!;
    await controller.close();
    expect(controller.getOrigin()).toBeNull();
    expect(controller.publish({ html: "<p>y</p>" })).toBeNull();
    await expect(fetch(published.url)).rejects.toThrow();
    controller = null;
  });

  it("advertises localhost for a wildcard bind", async () => {
    controller = createAppOriginController({ port: 0, host: "0.0.0.0" });
    const { url } = await controller.start();
    // `http://0.0.0.0:PORT` isn't reachable from a browser, but a wildcard bind
    // does serve loopback.
    expect(url).toMatch(/^http:\/\/localhost:\d+$/);
  });

  /** Claim a port so a subsequent listen on it fails with EADDRINUSE. */
  async function claimPort(): Promise<{
    port: number;
    release: () => Promise<void>;
  }> {
    const blocker: Server = createServer();
    await new Promise<void>((resolve) =>
      blocker.listen(0, "127.0.0.1", () => resolve()),
    );
    const addr = blocker.address();
    const port =
      typeof addr === "object" && addr !== null && "port" in addr
        ? addr.port
        : 0;
    expect(port).toBeGreaterThan(0);
    return {
      port,
      release: () =>
        new Promise<void>((resolve) => blocker.close(() => resolve())),
    };
  }

  it("falls back to an OS-assigned port when the fixed port is taken, loudly", async () => {
    const { port, release } = await claimPort();
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    controller = createAppOriginController({ port, host: "127.0.0.1" });
    try {
      const result = await controller.start();
      expect(result.port).toBeGreaterThan(0);
      expect(result.port).not.toBe(port);
      const published = controller.publish({ html: "<p>x</p>" })!;
      expect((await fetch(published.url)).status).toBe(200);
      // Loud: an app's backend may allowlist this origin, so a port that
      // silently moved is the failure the fixed default exists to prevent.
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining(`App origin: port ${port} in use`),
      );
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining("MCP_APP_ORIGIN_PORT"),
      );
    } finally {
      warnSpy.mockRestore();
      await release();
    }
  });

  it("degrades to publish()===null when listen fails for a non-EADDRINUSE reason", async () => {
    // The backends await start() during boot; if it ever stopped resolving the
    // whole web server would hang. Instead it resolves empty and every publish
    // answers null, which the renderer reads as "no dedicated origin".
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    controller = createAppOriginController({
      port: 0,
      host: "203.0.113.1", // TEST-NET-3: not assigned to any local interface
    });
    try {
      const result = await controller.start();
      expect(result).toEqual({ port: 0, url: "" });
      expect(controller.getOrigin()).toBeNull();
      expect(controller.publish({ html: "<p>x</p>" })).toBeNull();
      await expect(controller.close()).resolves.toBeUndefined();
      expect(errorSpy).toHaveBeenCalledWith(
        "App origin server error:",
        expect.objectContaining({ code: expect.any(String) }),
      );
    } finally {
      errorSpy.mockRestore();
      controller = null;
    }
  });

  it("stops minting URLs when the listener errors AFTER it bound", async () => {
    // `publish` gates on `origin`, not on `server`. An error arriving once the
    // listener is live must therefore clear `origin` too — otherwise the
    // browser keeps being handed URLs on a dead port and never takes the
    // srcdoc fallback the caller is promised.
    vi.resetModules();
    let emitter!: EventEmitter;
    vi.doMock("node:http", async () => {
      const actual =
        await vi.importActual<typeof import("node:http")>("node:http");
      return {
        ...actual,
        createServer: () => {
          emitter = new EventEmitter();
          return Object.assign(emitter, {
            listen: (_p: number, _h: string, cb?: () => void) =>
              setImmediate(() => cb?.()),
            address: () => ({
              address: "127.0.0.1",
              family: "IPv4",
              port: 6278,
            }),
            close: (cb?: () => void) => cb?.(),
          });
        },
      };
    });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const mod = await import("../../../../server/app-origin-controller.js");
      const c = mod.createAppOriginController({
        port: 6278,
        host: "127.0.0.1",
      });
      await c.start();
      expect(c.getOrigin()).toBe("http://127.0.0.1:6278");
      expect(c.publish({ html: "<p>x</p>" })).not.toBeNull();

      emitter.emit(
        "error",
        Object.assign(new Error("boom"), { code: "EPIPE" }),
      );

      expect(c.getOrigin()).toBeNull();
      expect(c.publish({ html: "<p>x</p>" })).toBeNull();
    } finally {
      errorSpy.mockRestore();
      vi.doUnmock("node:http");
      vi.resetModules();
    }
  });

  it("gives up after one retry when the dynamic fallback also fails", async () => {
    // Guards the `retriedDynamic` latch. A real `listen(0)` effectively always
    // succeeds, so a claimed port only ever produces ONE EADDRINUSE — under
    // which this test would pass with the latch deleted. Mock `node:http` so
    // every listen fails: without the latch this recurses until timeout.
    vi.resetModules();
    const listenCalls: number[] = [];
    vi.doMock("node:http", async () => {
      const actual =
        await vi.importActual<typeof import("node:http")>("node:http");
      return {
        ...actual,
        createServer: () => {
          const emitter = new EventEmitter();
          return Object.assign(emitter, {
            listen: (p: number) => {
              listenCalls.push(p);
              setImmediate(() =>
                emitter.emit(
                  "error",
                  Object.assign(new Error("in use"), { code: "EADDRINUSE" }),
                ),
              );
            },
            address: () => null,
            close: (cb?: () => void) => cb?.(),
          });
        },
      };
    });
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const mod = await import("../../../../server/app-origin-controller.js");
      const c = mod.createAppOriginController({
        port: DEFAULT_APP_ORIGIN_PORT,
        host: "127.0.0.1",
      });
      const result = await c.start();
      expect(result).toEqual({ port: 0, url: "" });
      // Exactly two listens: the fixed port, then one dynamic retry.
      expect(listenCalls).toEqual([DEFAULT_APP_ORIGIN_PORT, 0]);
      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining("in use. Apps declaring _meta.ui.domain"),
      );
    } finally {
      warnSpy.mockRestore();
      errorSpy.mockRestore();
      vi.doUnmock("node:http");
      vi.resetModules();
    }
  });
});
