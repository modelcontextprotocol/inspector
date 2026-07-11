import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createServer, type Server } from "node:http";
import {
  createSandboxController,
  resolveSandboxPort,
} from "../../../../server/sandbox-controller.js";

describe("resolveSandboxPort", () => {
  let envSnapshot: { mcp?: string; server?: string };

  beforeEach(() => {
    envSnapshot = {
      mcp: process.env.MCP_SANDBOX_PORT,
      server: process.env.SERVER_PORT,
    };
    delete process.env.MCP_SANDBOX_PORT;
    delete process.env.SERVER_PORT;
  });

  afterEach(() => {
    if (envSnapshot.mcp === undefined) delete process.env.MCP_SANDBOX_PORT;
    else process.env.MCP_SANDBOX_PORT = envSnapshot.mcp;
    if (envSnapshot.server === undefined) delete process.env.SERVER_PORT;
    else process.env.SERVER_PORT = envSnapshot.server;
  });

  it("returns 0 when no env vars are set", () => {
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

  it("returns 0 when SERVER_PORT is non-numeric and no MCP_SANDBOX_PORT", () => {
    process.env.SERVER_PORT = "not-a-port";
    expect(resolveSandboxPort()).toBe(0);
  });

  it("ignores empty-string SERVER_PORT", () => {
    process.env.SERVER_PORT = "";
    expect(resolveSandboxPort()).toBe(0);
  });

  it("ignores negative values", () => {
    process.env.MCP_SANDBOX_PORT = "-1";
    expect(resolveSandboxPort()).toBe(0);
  });
});

describe("createSandboxController", () => {
  it("starts on a dynamic port and serves /sandbox", async () => {
    const controller = createSandboxController({ port: 0 });
    try {
      const { url, port } = await controller.start();
      expect(port).toBeGreaterThan(0);
      expect(url).toBe(`http://localhost:${port}/sandbox`);
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
      expect(csp).toContain("frame-ancestors http://127.0.0.1:*");
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

  it("resolves with empty values when listen fails (EADDRINUSE)", async () => {
    // Bind a placeholder HTTP server to claim a port, then point a sandbox
    // controller at the same port to force EADDRINUSE. The Vite plugin awaits
    // start() in configureServer; if start() ever stops resolving, the entire
    // dev backend hangs. This test pins down the resolve-on-error contract.
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

    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const controller = createSandboxController({ port, host: "127.0.0.1" });
    try {
      const result = await controller.start();
      expect(result).toEqual({ port: 0, url: "" });
      expect(controller.getUrl()).toBeNull();
      // close() must be a no-op since the server never bound.
      await expect(controller.close()).resolves.toBeUndefined();
      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining(`Sandbox: port ${port} in use`),
      );
    } finally {
      errorSpy.mockRestore();
      await new Promise<void>((resolve) => blocker.close(() => resolve()));
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
