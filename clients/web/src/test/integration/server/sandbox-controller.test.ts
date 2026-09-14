import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createServer, type Server } from "node:http";
import { EventEmitter } from "node:events";
import {
  createSandboxController,
  DEFAULT_SANDBOX_PORT,
  resolveSandboxPort,
  sandboxFrameAncestors,
} from "../../../../server/sandbox-controller.js";

describe("sandboxFrameAncestors", () => {
  it("derives the directive from the provided allow-list", () => {
    expect(
      sandboxFrameAncestors([
        "http://192.168.1.50:6274",
        "https://inspector.example.com",
      ]),
    ).toBe(
      "frame-ancestors http://192.168.1.50:6274 https://inspector.example.com",
    );
  });

  it.each([[undefined], [[]]])(
    "falls back to the loopback family when the list is %j",
    (origins) => {
      // No `[::1]` source — a bracketed IPv6 literal is not a valid CSP
      // host-source (see sandbox-controller.ts).
      expect(sandboxFrameAncestors(origins as string[] | undefined)).toBe(
        "frame-ancestors http://127.0.0.1:* http://localhost:*",
      );
    },
  );

  it("drops malformed and IPv6-literal entries that can't be valid CSP sources", () => {
    // A newline would make writeHead throw ERR_INVALID_CHAR; a ';' would inject
    // extra directives; a bracketed IPv6 literal isn't a valid CSP host-source.
    // Only the well-formed origin survives.
    expect(
      sandboxFrameAncestors([
        "http://good.example:6274",
        "http://a:1; sandbox",
        "http://b:2\nX-Evil: 1",
        "http://[::1]:6274",
        "http://*.example.com", // a wildcard would widen the embedder set
        "not a url",
      ]),
    ).toBe("frame-ancestors http://good.example:6274");
  });

  it("falls back to loopback when every entry is malformed or IPv6-literal", () => {
    expect(
      sandboxFrameAncestors(["http://a:1; sandbox", "http://[::1]:6274"]),
    ).toBe("frame-ancestors http://127.0.0.1:* http://localhost:*");
  });
});

describe("resolveSandboxPort", () => {
  let envSnapshot: { mcp?: string; server?: string };
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    envSnapshot = {
      mcp: process.env.MCP_SANDBOX_PORT,
      server: process.env.SERVER_PORT,
    };
    delete process.env.MCP_SANDBOX_PORT;
    delete process.env.SERVER_PORT;
    // A set-but-invalid MCP_SANDBOX_PORT warns; keep it off the test console.
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
    if (envSnapshot.mcp === undefined) delete process.env.MCP_SANDBOX_PORT;
    else process.env.MCP_SANDBOX_PORT = envSnapshot.mcp;
    if (envSnapshot.server === undefined) delete process.env.SERVER_PORT;
    else process.env.SERVER_PORT = envSnapshot.server;
  });

  // Regression guard for #2008: the default must be a FIXED port. An
  // OS-assigned one changes every run, so it can never be named in a dev
  // container's `forwardPorts`, a `docker run -p`, or an SSH tunnel — leaving
  // the Apps tab unreachable in every such environment.
  it("returns a fixed default port when no env vars are set", () => {
    expect(resolveSandboxPort()).toBe(DEFAULT_SANDBOX_PORT);
    expect(resolveSandboxPort()).not.toBe(0);
  });

  it("still honors an explicit MCP_SANDBOX_PORT=0 as OS-assigned", () => {
    process.env.MCP_SANDBOX_PORT = "0";
    expect(resolveSandboxPort()).toBe(0);
  });

  it("prefers MCP_SANDBOX_PORT over SERVER_PORT", () => {
    process.env.MCP_SANDBOX_PORT = "9001";
    process.env.SERVER_PORT = "9100";
    expect(resolveSandboxPort()).toBe(9001);
  });

  it("falls back to SERVER_PORT when MCP_SANDBOX_PORT is unset", () => {
    process.env.SERVER_PORT = "9100";
    expect(resolveSandboxPort()).toBe(9100);
  });

  it("ignores non-numeric MCP_SANDBOX_PORT and falls back", () => {
    process.env.MCP_SANDBOX_PORT = "garbage";
    process.env.SERVER_PORT = "9100";
    expect(resolveSandboxPort()).toBe(9100);
  });

  it("ignores empty-string MCP_SANDBOX_PORT and falls back", () => {
    process.env.MCP_SANDBOX_PORT = "";
    process.env.SERVER_PORT = "9100";
    expect(resolveSandboxPort()).toBe(9100);
  });

  it("falls back to the default when SERVER_PORT is non-numeric and no MCP_SANDBOX_PORT", () => {
    process.env.SERVER_PORT = "not-a-port";
    expect(resolveSandboxPort()).toBe(DEFAULT_SANDBOX_PORT);
  });

  it("ignores empty-string SERVER_PORT", () => {
    process.env.SERVER_PORT = "";
    expect(resolveSandboxPort()).toBe(DEFAULT_SANDBOX_PORT);
  });

  it("ignores negative values", () => {
    process.env.MCP_SANDBOX_PORT = "-1";
    expect(resolveSandboxPort()).toBe(DEFAULT_SANDBOX_PORT);
  });

  it("rejects a partial-parse value (6274abc) rather than binding 6274", () => {
    process.env.MCP_SANDBOX_PORT = "6274abc";
    process.env.SERVER_PORT = "9100";
    expect(resolveSandboxPort()).toBe(9100);
  });

  it("rejects an out-of-range value (70000) so it can't crash listen", () => {
    process.env.MCP_SANDBOX_PORT = "70000";
    expect(resolveSandboxPort()).toBe(DEFAULT_SANDBOX_PORT);
  });
});

describe("createSandboxController", () => {
  it("starts on a dynamic port and serves /sandbox", async () => {
    const controller = createSandboxController({ port: 0 });
    try {
      const { url, port } = await controller.start();
      expect(port).toBeGreaterThan(0);
      // Default host is now the IPv4 loopback address, not the name (#1951).
      expect(url).toBe(`http://127.0.0.1:${port}/sandbox`);
      expect(controller.getUrl()).toBe(url);

      const res = await fetch(url);
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toContain("text/html");
      // Defense-in-depth CSP on the proxy itself: only frame-ancestors, so the
      // proxy can only be embedded by the local inspector. Fetch directives are
      // deliberately ABSENT — a srcdoc iframe inherits its embedder's policy
      // container, so any default-src/connect-src here would intersect with and
      // override the per-app CSP baked into the inner document.
      const csp = res.headers.get("content-security-policy") ?? "";
      // Assert the FULL directive (toBe, not toContain) so re-adding a source —
      // e.g. the `http://[::1]:*` that F2 proved harmful — would fail the test.
      // No `[::1]` — a bracketed IPv6 literal is not a valid CSP host-source.
      expect(csp).toBe("frame-ancestors http://127.0.0.1:* http://localhost:*");
      expect(csp).not.toContain("default-src");
      expect(csp).not.toContain("connect-src");
      const body = await res.text();
      // Either the real proxy file (sandbox-resource-ready) or the fallback
      // "Sandbox not loaded" string, depending on whether static/ resolves.
      expect(body.length).toBeGreaterThan(0);
    } finally {
      await controller.close();
    }
  });

  it("serves a CSP derived from allowedOrigins (the shipped default path)", async () => {
    // Both real callers always pass allowedOrigins, so the header the product
    // actually serves is the derived exact-origin directive, not the fallback.
    const controller = createSandboxController({
      port: 0,
      allowedOrigins: [
        "http://localhost:6274",
        "http://127.0.0.1:6274",
        "http://[::1]:6274", // dropped — not a valid CSP host-source
      ],
    });
    try {
      const { url } = await controller.start();
      const res = await fetch(url);
      const csp = res.headers.get("content-security-policy") ?? "";
      expect(csp).toBe(
        "frame-ancestors http://localhost:6274 http://127.0.0.1:6274",
      );
    } finally {
      await controller.close();
    }
  });

  it("advertises localhost in the sandbox URL for a wildcard bind", async () => {
    // 0.0.0.0 isn't reachable from the browser, but a wildcard bind serves
    // loopback — so the URL handed to the client (and printed in the banner)
    // uses localhost.
    const controller = createSandboxController({ port: 0, host: "0.0.0.0" });
    try {
      const { url, port } = await controller.start();
      expect(url).toBe(`http://localhost:${port}/sandbox`);
    } finally {
      await controller.close();
    }
  });

  it("uses the canonical (unmapped) host in the sandbox URL", async () => {
    // Same canonicalization as the origin allow-list, so the served sandbox URL
    // is reachable — ::ffff:127.0.0.1 answers at 127.0.0.1, not [::ffff:...].
    const controller = createSandboxController({
      port: 0,
      host: "::ffff:127.0.0.1",
    });
    try {
      const { url, port } = await controller.start();
      expect(url).toBe(`http://127.0.0.1:${port}/sandbox`);
    } finally {
      await controller.close();
    }
  });

  it("returns 404 for paths other than /sandbox", async () => {
    const controller = createSandboxController({ port: 0 });
    try {
      const { port } = await controller.start();
      const res = await fetch(`http://localhost:${port}/not-here`);
      expect(res.status).toBe(404);
    } finally {
      await controller.close();
    }
  });

  it("returns 404 for non-GET requests", async () => {
    const controller = createSandboxController({ port: 0 });
    try {
      const { port } = await controller.start();
      const res = await fetch(`http://localhost:${port}/sandbox`, {
        method: "POST",
      });
      expect(res.status).toBe(404);
    } finally {
      await controller.close();
    }
  });

  it("treats /sandbox/ as /sandbox", async () => {
    const controller = createSandboxController({ port: 0 });
    try {
      const { port } = await controller.start();
      const res = await fetch(`http://localhost:${port}/sandbox/`);
      expect(res.status).toBe(200);
    } finally {
      await controller.close();
    }
  });

  it("getUrl returns null before start and null after close", async () => {
    const controller = createSandboxController({ port: 0 });
    expect(controller.getUrl()).toBeNull();
    await controller.start();
    expect(controller.getUrl()).not.toBeNull();
    await controller.close();
    expect(controller.getUrl()).toBeNull();
  });

  it("returns the cached URL when start is called twice", async () => {
    const controller = createSandboxController({ port: 0 });
    try {
      const first = await controller.start();
      const second = await controller.start();
      expect(second.url).toBe(first.url);
      expect(second.port).toBe(first.port);
    } finally {
      await controller.close();
    }
  });

  it("close is a noop when not started", async () => {
    const controller = createSandboxController({ port: 0 });
    await expect(controller.close()).resolves.toBeUndefined();
  });

  it("honors a custom host", async () => {
    const controller = createSandboxController({ port: 0, host: "127.0.0.1" });
    try {
      const { url } = await controller.start();
      expect(url).toMatch(/^http:\/\/127\.0\.0\.1:/);
    } finally {
      await controller.close();
    }
  });

  it("resolves with empty values + logs generically when listen fails with a non-EADDRINUSE error", async () => {
    // An unresolvable bind host makes Node emit an `error` whose `code` is
    // not EADDRINUSE (ENOTFOUND/EADDRNOTAVAIL depending on platform). This
    // drives the non-EADDRINUSE branch of the error handler: a generic
    // "Sandbox server error" log plus the same resolve-with-empty contract.
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const controller = createSandboxController({
      port: 0,
      host: "256.256.256.256",
    });
    try {
      const result = await controller.start();
      expect(result).toEqual({ port: 0, url: "" });
      expect(controller.getUrl()).toBeNull();
      await expect(controller.close()).resolves.toBeUndefined();
      expect(errorSpy).toHaveBeenCalledWith(
        "Sandbox server error:",
        expect.objectContaining({ code: expect.any(String) }),
      );
      // It must NOT have taken the EADDRINUSE branch.
      expect(errorSpy).not.toHaveBeenCalledWith(
        expect.stringContaining("in use"),
      );
    } finally {
      errorSpy.mockRestore();
    }
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

  it("falls back to an OS-assigned port when the fixed port is taken", async () => {
    // #2008 made the default port fixed, which introduced a collision the
    // dynamic default never had: a second Inspector, or anything else already
    // on 6275, would have taken the Apps tab down entirely. Retrying on a
    // dynamic port keeps it working locally.
    const { port, release } = await claimPort();
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const controller = createSandboxController({ port, host: "127.0.0.1" });
    try {
      const result = await controller.start();
      expect(result.port).toBeGreaterThan(0);
      expect(result.port).not.toBe(port);
      expect(result.url).toBe(`http://127.0.0.1:${result.port}/sandbox`);
      expect(controller.getUrl()).toBe(result.url);
      // The sandbox must actually be serving on the fallback port, not merely
      // reporting one.
      expect((await fetch(result.url)).status).toBe(200);
      // Loud, not silent: a pinned-and-forwarded port that quietly moved is the
      // very failure the fixed default exists to prevent.
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining(`Sandbox: port ${port} in use`),
      );
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining("MCP_SANDBOX_PORT"),
      );
    } finally {
      warnSpy.mockRestore();
      await controller.close();
      await release();
    }
  });

  it("resolves with empty values when even the dynamic retry fails", async () => {
    // The Vite plugin awaits start() in configureServer; if start() ever stops
    // resolving, the entire dev backend hangs. This pins the resolve-on-error
    // contract for the case the retry can't rescue — an explicit `port: 0` that
    // fails has nowhere left to fall back to, so it degrades as before.
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const controller = createSandboxController({ port: 0, host: "127.0.0.1" });
    try {
      // Force the listen to fail the way a dynamic listen can (an unusable bind
      // address), since port 0 cannot collide.
      const broken = createSandboxController({
        port: 0,
        host: "203.0.113.1", // TEST-NET-3: not assigned to any local interface
      });
      const result = await broken.start();
      expect(result).toEqual({ port: 0, url: "" });
      expect(broken.getUrl()).toBeNull();
      // close() must be a no-op since the server never bound.
      await expect(broken.close()).resolves.toBeUndefined();
      expect(errorSpy).toHaveBeenCalledWith(
        "Sandbox server error:",
        expect.objectContaining({ code: "EADDRNOTAVAIL" }),
      );
    } finally {
      errorSpy.mockRestore();
      await controller.close();
    }
  });

  it("gives up after one retry when the dynamic fallback also fails", async () => {
    // Guards the `retriedDynamic` latch. A real `listen(0)` effectively always
    // succeeds, so claiming a port only ever produces ONE EADDRINUSE — under
    // which this test would pass with the latch deleted. Mock `node:http` so
    // every listen fails with EADDRINUSE: the first trips the retry, the second
    // must be caught by the latch and settle. Without the latch this recurses
    // until the test times out rather than resolving.
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
      const mod = await import("../../../../server/sandbox-controller.js");
      const controller = mod.createSandboxController({
        port: 6275,
        host: "127.0.0.1",
      });
      // Settles rather than looping — the contract the Vite plugin depends on.
      const result = await controller.start();
      expect(result).toEqual({ port: 0, url: "" });
      expect(controller.getUrl()).toBeNull();
      // Exactly two listens: the fixed port, then one dynamic retry. A third
      // would mean the latch failed to bound the loop.
      expect(listenCalls).toEqual([6275, 0]);
      expect(
        warnSpy.mock.calls.filter((c) =>
          String(c[0]).includes("falling back to an OS-assigned port"),
        ),
      ).toHaveLength(1);
      // The second failure degrades loudly instead of retrying again.
      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining("Sandbox: port 6275 in use"),
      );
    } finally {
      warnSpy.mockRestore();
      errorSpy.mockRestore();
      vi.doUnmock("node:http");
      vi.resetModules();
    }
  });

  it("serves a fallback page when the sandbox HTML file can't be read", async () => {
    // The static `sandbox_proxy.html` always ships, so the only way to reach
    // the read-failure fallback is to make `readFileSync` throw. Mock
    // `node:fs` for an isolated module instance so the rest of the suite keeps
    // the real fs.
    vi.resetModules();
    vi.doMock("node:fs", async () => {
      const actual = await vi.importActual<typeof import("node:fs")>("node:fs");
      return {
        ...actual,
        readFileSync: () => {
          throw new Error("disk gone");
        },
      };
    });
    try {
      const mod = await import("../../../../server/sandbox-controller.js");
      const controller = mod.createSandboxController({ port: 0 });
      try {
        const { port } = await controller.start();
        const res = await fetch(`http://localhost:${port}/sandbox`);
        expect(res.status).toBe(200);
        const body = await res.text();
        expect(body).toContain("Sandbox not loaded");
        expect(body).toContain("disk gone");
      } finally {
        await controller.close();
      }
    } finally {
      vi.doUnmock("node:fs");
      vi.resetModules();
    }
  });
});
