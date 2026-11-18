/**
 * `withServerOriginHeaders` — the server's custom headers on OAuth requests to
 * the server's own origin, and nowhere else (#2985).
 */

import { describe, expect, it, vi } from "vitest";
import {
  RESERVED_HEADERS,
  withServerOriginHeaders,
  type CustomHeaderRow,
} from "@inspector/core/auth/serverOriginHeaders.js";
import {
  deadlineForRequestInit,
  stampRequestDeadline,
} from "@inspector/core/auth/requestTimeout.js";

const SERVER = "https://mcp.example.com/mcp";
const ROUTING: CustomHeaderRow[] = [{ key: "X-Environment", value: "staging" }];

function setup(
  options: {
    rows?: readonly CustomHeaderRow[];
    getServerUrl?: () => string | undefined;
  } = { rows: ROUTING },
) {
  const base = vi.fn<typeof fetch>().mockResolvedValue(new Response("ok"));
  const wrapped = withServerOriginHeaders(
    base,
    options.getServerUrl ?? (() => SERVER),
    () => options.rows,
  );
  /** The headers the base fetch received on its most recent call. */
  const sent = () => {
    const [input, init] = base.mock.calls.at(-1)!;
    return new Headers(
      init?.headers ?? (input instanceof Request ? input.headers : undefined),
    );
  };
  return { base, wrapped, sent };
}

describe("withServerOriginHeaders", () => {
  it("adds the custom headers to a request on the server's origin", async () => {
    const { wrapped, sent } = setup();
    await wrapped(
      "https://mcp.example.com/.well-known/oauth-protected-resource",
    );
    expect(sent().get("x-environment")).toBe("staging");
  });

  it("keeps the request's method, body and own headers", async () => {
    const { base, wrapped, sent } = setup();
    const signal = new AbortController().signal;
    await wrapped(new URL("https://mcp.example.com/token"), {
      method: "POST",
      body: "grant_type=refresh_token",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      signal,
    });
    const init = base.mock.calls[0]![1]!;
    expect(init.method).toBe("POST");
    expect(init.body).toBe("grant_type=refresh_token");
    expect(init.signal).toBe(signal);
    expect(sent().get("content-type")).toBe(
      "application/x-www-form-urlencoded",
    );
    expect(sent().get("x-environment")).toBe("staging");
  });

  it("merges into the headers a Request input carries", async () => {
    const { wrapped, sent } = setup();
    await wrapped(
      new Request("https://mcp.example.com/register", {
        headers: { "MCP-Protocol-Version": "2025-06-18" },
      }),
    );
    expect(sent().get("mcp-protocol-version")).toBe("2025-06-18");
    expect(sent().get("x-environment")).toBe("staging");
  });

  it.each([
    ["another host", "https://auth.example.com/token"],
    ["another port", "https://mcp.example.com:8443/token"],
    ["another scheme", "http://mcp.example.com/token"],
    ["an unparseable URL", "/relative/token"],
  ])("passes a request to %s through untouched", async (_name, url) => {
    const { base, wrapped } = setup();
    const init: RequestInit = { method: "POST" };
    await wrapped(url, init);
    expect(base).toHaveBeenCalledWith(url, init);
  });

  it("never replaces a header the request already set", async () => {
    const { wrapped, sent } = setup({
      rows: [
        { key: "x-environment", value: "staging" },
        { key: "X-Tenant", value: "acme" },
      ],
    });
    await wrapped("https://mcp.example.com/token", {
      headers: { "X-Environment": "from-request" },
    });
    expect(sent().get("x-environment")).toBe("from-request");
    expect(sent().get("x-tenant")).toBe("acme");
  });

  it("resolves a duplicated name the way the transport does: last row wins", async () => {
    const { wrapped, sent } = setup({
      rows: [
        { key: "X-Environment", value: "production" },
        { key: "x-environment", value: "staging" },
      ],
    });
    await wrapped("https://mcp.example.com/token");
    expect(sent().get("x-environment")).toBe("staging");
  });

  it("carries the request's stamped deadline onto the init it replaces", async () => {
    const { base, wrapped } = setup();
    const init: RequestInit = { method: "POST" };
    stampRequestDeadline(init, 1234);
    await wrapped("https://mcp.example.com/token", init);
    const sentInit = base.mock.calls[0]![1];
    expect(sentInit).not.toBe(init);
    expect(deadlineForRequestInit(sentInit)).toBe(1234);
  });

  it.each([...RESERVED_HEADERS])(
    "never adds the reserved header %s",
    async (name) => {
      const { wrapped, sent } = setup({
        rows: [{ key: name.toUpperCase(), value: "custom" }, ...ROUTING],
      });
      await wrapped("https://mcp.example.com/token");
      expect(sent().get(name)).toBeNull();
      expect(sent().get("x-environment")).toBe("staging");
    },
  );

  it("skips blank and illegal rows, and trims the name", async () => {
    const { wrapped, sent } = setup({
      rows: [
        { key: "  ", value: "blank" },
        { key: "bad name", value: "illegal name" },
        { key: "X-Injected", value: "a\r\nX-Other: b" },
        { key: " X-Environment ", value: "staging" },
      ],
    });
    await wrapped("https://mcp.example.com/token");
    expect([...sent().keys()].map((k) => k.toLowerCase())).toEqual([
      "x-environment",
    ]);
  });

  it("passes the call through untouched when no row applies", async () => {
    const { base, wrapped } = setup({
      rows: [{ key: "Authorization", value: "Bearer static" }],
    });
    const init: RequestInit = { method: "GET" };
    await wrapped("https://mcp.example.com/token", init);
    expect(base).toHaveBeenCalledWith("https://mcp.example.com/token", init);
  });

  it.each<[string, readonly CustomHeaderRow[] | undefined]>([
    ["no settings", undefined],
    ["no rows", []],
  ])("is inert with %s", async (_name, rows) => {
    const { base, wrapped } = setup({ rows });
    await wrapped("https://mcp.example.com/token");
    expect(base).toHaveBeenCalledWith(
      "https://mcp.example.com/token",
      undefined,
    );
  });

  it.each<[string, () => string | undefined]>([
    ["absent", () => undefined],
    ["unparseable", () => "not a url"],
    ["opaque-origin", () => "data:text/plain,x"],
    [
      "unavailable (the getter throws)",
      () => {
        throw new Error("OAuth is only supported for HTTP-based transports");
      },
    ],
  ])("is inert when the server URL is %s", async (_name, getServerUrl) => {
    const { base, wrapped } = setup({ rows: ROUTING, getServerUrl });
    await wrapped("data:text/plain,y");
    expect(base).toHaveBeenCalledWith("data:text/plain,y", undefined);
  });

  it("reads the headers and the server URL per request", async () => {
    const base = vi.fn<typeof fetch>().mockResolvedValue(new Response("ok"));
    let rows: CustomHeaderRow[] = [];
    const wrapped = withServerOriginHeaders(
      base,
      () => SERVER,
      () => rows,
    );
    await wrapped("https://mcp.example.com/token");
    expect(base.mock.calls[0]![1]).toBeUndefined();
    rows = ROUTING;
    await wrapped("https://mcp.example.com/token");
    expect(
      new Headers(base.mock.calls[1]![1]!.headers).get("x-environment"),
    ).toBe("staging");
  });
});
