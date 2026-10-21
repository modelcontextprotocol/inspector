/**
 * Unit tests for request-guards.ts
 *
 * Tests cover:
 *  - isAuthDisabledFlag: only explicit truthy values disable auth
 *  - createOriginValidationMiddleware: missing / allowed / disallowed / "null"
 *    Origin and HEAD requests, with auth enabled and disabled, exercised
 *    through a real express server, plus the same-origin fetch-metadata
 *    check and its opt-out
 */

import http from "node:http";
import type { AddressInfo } from "node:net";
import express from "express";
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import {
  createOriginValidationMiddleware,
  isAuthDisabledFlag,
} from "../request-guards.js";

// ---------------------------------------------------------------------------
// isAuthDisabledFlag
// ---------------------------------------------------------------------------

describe("isAuthDisabledFlag", () => {
  it.each([
    [undefined, false],
    ["", false],
    ["false", false],
    ["FALSE", false],
    ["0", false],
    ["no", false],
    [" ", false],
    ["anything", false],
  ])("leaves auth enabled for %j", (value, expected) => {
    expect(isAuthDisabledFlag(value)).toBe(expected);
  });

  it.each([
    ["true", true],
    ["1", true],
    ["yes", true],
    ["TRUE", true],
    ["Yes", true],
    [" true ", true],
  ])("disables auth for %j", (value, expected) => {
    expect(isAuthDisabledFlag(value)).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// createOriginValidationMiddleware
// ---------------------------------------------------------------------------

const ALLOWED = "http://localhost:6274";
const DISALLOWED = "http://evil.example";

let server: http.Server | undefined;

async function startApp(
  authDisabled: boolean,
  allowSameOriginApi?: boolean,
): Promise<number> {
  const app = express();
  app.get(
    "/stdio",
    createOriginValidationMiddleware(authDisabled, allowSameOriginApi),
    (_req, res) => {
      res.status(200).json({ passed: true });
    },
  );
  server = http.createServer(app);
  await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
  return (server!.address() as AddressInfo).port;
}

function get(
  port: number,
  origin?: string,
  method: "GET" | "HEAD" = "GET",
  extraHeaders: Record<string, string> = {},
): Promise<number> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: "127.0.0.1",
        port,
        path: "/stdio",
        method,
        headers: { ...(origin ? { Origin: origin } : {}), ...extraHeaders },
      },
      (res) => {
        res.resume();
        res.on("end", () => resolve(res.statusCode ?? 0));
      },
    );
    req.on("error", reject);
    req.end();
  });
}

describe("createOriginValidationMiddleware", () => {
  beforeEach(() => {
    vi.stubEnv("ALLOWED_ORIGINS", undefined);
    vi.stubEnv("CLIENT_PORT", undefined);
    // Rejections log to console.error; keep test output clean.
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    if (server) {
      await new Promise<void>((resolve) => server!.close(() => resolve()));
      server = undefined;
    }
  });

  describe("auth disabled", () => {
    it("rejects a request with no Origin", async () => {
      const port = await startApp(true);
      expect(await get(port)).toBe(403);
    });

    it("passes a request with an allowed Origin", async () => {
      const port = await startApp(true);
      expect(await get(port, ALLOWED)).toBe(200);
    });

    it("rejects a request with a disallowed Origin", async () => {
      const port = await startApp(true);
      expect(await get(port, DISALLOWED)).toBe(403);
    });

    // Sandboxed iframes and file:// pages send the literal string "null".
    it('rejects a request with Origin "null"', async () => {
      const port = await startApp(true);
      expect(await get(port, "null")).toBe(403);
    });

    // Express routes HEAD through the GET handler, so the guard must run there too.
    it("rejects a HEAD request with no Origin", async () => {
      const port = await startApp(true);
      expect(await get(port, undefined, "HEAD")).toBe(403);
    });

    it("honors ALLOWED_ORIGINS", async () => {
      vi.stubEnv("ALLOWED_ORIGINS", "http://localhost:8000");
      const port = await startApp(true);
      expect(await get(port, "http://localhost:8000")).toBe(200);
      expect(await get(port, ALLOWED)).toBe(403);
    });
  });

  describe("auth enabled", () => {
    it("passes a request with no Origin (left to the auth check)", async () => {
      const port = await startApp(false);
      expect(await get(port)).toBe(200);
    });

    it("passes a request with an allowed Origin", async () => {
      const port = await startApp(false);
      expect(await get(port, ALLOWED)).toBe(200);
    });

    it("rejects a request with a disallowed Origin", async () => {
      const port = await startApp(false);
      expect(await get(port, DISALLOWED)).toBe(403);
    });
  });

  describe("same-origin requests", () => {
    const SAME_ORIGIN = { "Sec-Fetch-Site": "same-origin" };

    it("rejects Sec-Fetch-Site: same-origin by default", async () => {
      const port = await startApp(false);
      expect(await get(port, undefined, "GET", SAME_ORIGIN)).toBe(403);
    });

    it("rejects it even when the Origin is allowed", async () => {
      const port = await startApp(false);
      expect(await get(port, ALLOWED, "GET", SAME_ORIGIN)).toBe(403);
    });

    it("passes Sec-Fetch-Site: same-site (the real client)", async () => {
      const port = await startApp(false);
      expect(
        await get(port, ALLOWED, "GET", { "Sec-Fetch-Site": "same-site" }),
      ).toBe(200);
    });

    it("passes a same-origin request when the opt-out is set", async () => {
      const port = await startApp(false, true);
      expect(await get(port, undefined, "GET", SAME_ORIGIN)).toBe(200);
    });

    it("still applies the Origin checks when the opt-out is set", async () => {
      const port = await startApp(true, true);
      expect(await get(port, undefined, "GET", SAME_ORIGIN)).toBe(403);
      expect(await get(port, DISALLOWED, "GET", SAME_ORIGIN)).toBe(403);
      expect(await get(port, ALLOWED, "GET", SAME_ORIGIN)).toBe(200);
    });
  });
});
