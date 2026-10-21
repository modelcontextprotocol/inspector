import { describe, it, expect, vi, afterEach } from "vitest";
import { Hono } from "hono";
import {
  ALLOWED_HOSTS_ENV,
  configuredAllowedHosts,
  createHostAllowList,
  hostAllowListMiddleware,
  parseAllowedHostsEnv,
  parseHostHeader,
} from "../../../../server/host-allow-list.js";

const LOOPBACK_ORIGINS = [
  "http://localhost:6274",
  "http://127.0.0.1:6274",
  "http://[::1]:6274",
];

describe("parseHostHeader", () => {
  it.each([
    ["localhost", "localhost"],
    ["localhost:6274", "localhost"],
    ["LocalHost:6274", "localhost"],
    ["  example.com  ", "example.com"],
    ["example.com.", "example.com"],
    ["example.com.:443", "example.com"],
    ["127.0.0.1:6274", "127.0.0.1"],
    ["[::1]", "[::1]"],
    ["[::1]:6274", "[::1]"],
    ["[2001:DB8::1]:80", "[2001:db8::1]"],
    ["host:0", "host"],
    ["host:65535", "host"],
  ])("parses %j as %j", (value, expected) => {
    expect(parseHostHeader(value)).toBe(expected);
  });

  it.each([
    "",
    "   ",
    ":6274",
    ".",
    "[::1",
    "[not-ipv6]",
    "[::1]6274",
    "[::1]:",
    "[::1]:abc",
    "host:",
    "host:abc",
    "host:65536",
    "host:123456",
    "host:80:80",
    "::1",
    "evil.example, x.localhost",
    "evil.example x.localhost",
    "bücher.example",
  ])("rejects %j as malformed", (value) => {
    expect(parseHostHeader(value)).toBeNull();
  });
});

describe("parseAllowedHostsEnv", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("is empty when unset or blank", () => {
    expect(parseAllowedHostsEnv(undefined)).toEqual([]);
    expect(parseAllowedHostsEnv("")).toEqual([]);
    expect(parseAllowedHostsEnv(" , ,")).toEqual([]);
  });

  it("trims, lowercases and drops a trailing dot", () => {
    expect(
      parseAllowedHostsEnv(" Inspector.Example.com , .Corp.Example. ,proxy"),
    ).toEqual(["inspector.example.com", ".corp.example", "proxy"]);
  });

  it("converts an internationalized entry to punycode", () => {
    expect(parseAllowedHostsEnv("Bücher.example,.bücher.example")).toEqual([
      "xn--bcher-kva.example",
      ".xn--bcher-kva.example",
    ]);
  });

  it.each([
    "https://inspector.example.com",
    "inspector.example.com:6274",
    "inspector.example.com/path",
    "*.example.com",
    "*",
    "user@host",
    "two words",
    ".",
    "..",
    "a!b.example",
  ])("warns about and drops %j", (entry) => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(parseAllowedHostsEnv(`good.example,${entry}`)).toEqual([
      "good.example",
    ]);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain(ALLOWED_HOSTS_ENV);
    expect(warn.mock.calls[0][0]).toContain(entry);
  });
});

describe("configuredAllowedHosts", () => {
  it("adds the bind host, the origin hosts and the extras, deduplicated", () => {
    expect(
      configuredAllowedHosts({
        bindHost: "Inspector.LAN",
        allowedOrigins: [
          "https://inspector.example.com",
          "http://inspector.lan:6274",
          "http://[2001:db8::1]:6274",
        ],
        extraHosts: ["Proxy.Internal.", ".corp.example"],
      }),
    ).toEqual([
      "inspector.lan",
      "inspector.example.com",
      "[2001:db8::1]",
      "proxy.internal",
      ".corp.example",
    ]);
  });

  it("adds nothing for a wildcard bind", () => {
    expect(
      configuredAllowedHosts({ bindHost: "0.0.0.0", allowedOrigins: [] }),
    ).toEqual([]);
    expect(
      configuredAllowedHosts({ bindHost: "::", allowedOrigins: [] }),
    ).toEqual([]);
  });

  it("canonicalizes an IPv6 bind host to its bracketed form", () => {
    expect(
      configuredAllowedHosts({ bindHost: "::1", allowedOrigins: [] }),
    ).toEqual(["[::1]"]);
  });

  it("skips an origin that does not parse or has no host", () => {
    expect(
      configuredAllowedHosts({
        bindHost: "0.0.0.0",
        allowedOrigins: ["not a url", "file:///x"],
      }),
    ).toEqual([]);
  });
});

describe("createHostAllowList", () => {
  const loopback = createHostAllowList({
    bindHost: "127.0.0.1",
    allowedOrigins: LOOPBACK_ORIGINS,
  });

  it.each([
    "localhost",
    "localhost:6274",
    "LOCALHOST:6274",
    "localhost.:6274",
    "inspector.localhost",
    "a.b.localhost:8080",
    "127.0.0.1:6274",
    "127.0.0.1",
    "192.168.1.50:6274",
    "10.0.0.1:8080",
    "[::1]:6274",
    "[::1]",
    "[2001:db8::1]:6274",
    "[::ffff:127.0.0.1]:6274",
  ])("allows %j on a loopback bind", (host) => {
    expect(loopback(host)).toBe(true);
  });

  it.each([
    "evil.example:6274",
    "evil.example",
    "localhost.evil.example",
    "evillocalhost",
    "127.0.0.1.nip.io:6274",
    "2130706433:6274",
    "",
    "[::1",
    "localhost:notaport",
  ])("rejects %j on a loopback bind", (host) => {
    expect(loopback(host)).toBe(false);
  });

  it("rejects a missing Host header", () => {
    expect(loopback(undefined)).toBe(false);
  });

  it("does not compare the port (a remapped port still matches)", () => {
    expect(loopback("localhost:8080")).toBe(true);
    const named = createHostAllowList({
      bindHost: "127.0.0.1",
      allowedOrigins: ["https://inspector.example.com"],
    });
    expect(named("inspector.example.com:9999")).toBe(true);
  });

  it("allows the hosts named by allowedOrigins", () => {
    const allow = createHostAllowList({
      bindHost: "0.0.0.0",
      allowedOrigins: [...LOOPBACK_ORIGINS, "https://Inspector.Example.com"],
    });
    expect(allow("inspector.example.com")).toBe(true);
    expect(allow("INSPECTOR.EXAMPLE.COM:443")).toBe(true);
    expect(allow("other.example.com")).toBe(false);
  });

  it("allows a specific named bind host", () => {
    const allow = createHostAllowList({
      bindHost: "inspector.lan",
      allowedOrigins: ["http://inspector.lan:6274"],
    });
    expect(allow("inspector.lan:6274")).toBe(true);
    const bindOnly = createHostAllowList({
      bindHost: "Inspector.LAN",
      allowedOrigins: [],
    });
    expect(bindOnly("inspector.lan")).toBe(true);
  });

  it("allows exact extra hosts and leading-dot domains", () => {
    const allow = createHostAllowList({
      bindHost: "0.0.0.0",
      allowedOrigins: LOOPBACK_ORIGINS,
      extraHosts: ["inspector", ".corp.example"],
    });
    expect(allow("inspector:6274")).toBe(true);
    expect(allow("corp.example")).toBe(true);
    expect(allow("a.corp.example:6274")).toBe(true);
    expect(allow("a.b.corp.example")).toBe(true);
    expect(allow("notcorp.example")).toBe(false);
    expect(allow("inspector.evil")).toBe(false);
    expect(allow("evil.example")).toBe(false);
  });
});

describe("hostAllowListMiddleware", () => {
  function app(extraHosts?: string[]) {
    const a = new Hono();
    a.use(
      "*",
      hostAllowListMiddleware({
        bindHost: "127.0.0.1",
        allowedOrigins: LOOPBACK_ORIGINS,
        extraHosts,
      }),
    );
    a.get("*", (c) => c.text("served"));
    return a;
  }

  it("passes an allowed host through to the route", async () => {
    const res = await app().request("http://localhost:6274/", {
      headers: { host: "localhost:6274" },
    });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("served");
  });

  it("answers 403 for a disallowed host, naming the escape hatch", async () => {
    const res = await app().request("http://evil.example:6274/", {
      headers: { host: "evil.example:6274" },
    });
    expect(res.status).toBe(403);
    const body = await res.text();
    expect(body).not.toBe("served");
    expect(body).toContain("evil.example:6274");
    expect(body).toContain(ALLOWED_HOSTS_ENV);
  });

  it("answers 403 when the Host header is absent", async () => {
    // `app.request` builds a Request with no `host` header unless one is set.
    const res = await app().request("http://localhost/");
    expect(res.status).toBe(403);
    expect(await res.text()).toContain('Host ""');
  });

  it("admits a host named in the extra hosts", async () => {
    const res = await app(["inspector"]).request("http://inspector/", {
      headers: { host: "inspector:6274" },
    });
    expect(res.status).toBe(200);
  });
});
