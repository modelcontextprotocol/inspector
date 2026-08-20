/**
 * Unit tests for proxy-security.ts
 *
 * Tests cover:
 *  - isBlockedProxyAddress: IPv4, IPv6, IPv4-mapped IPv6 (hex + dotted), edge cases
 *  - assertSafeProxyTarget: safe IPs, blocked IPs, literal-IP hosts, DNS errors
 *  - createPinnedAgent: correct agent type, lookup always returns pinned IP
 *  - TOCTOU guarantee: the pinned agent never invokes the OS resolver
 */

import http from "node:http";
import https from "node:https";
import type dnsTypes from "node:dns";
import type { AddressInfo } from "node:net";
import nodeFetch from "node-fetch";
import { vi, describe, it, expect, afterEach } from "vitest";

// Mock node:dns/promises before importing the module under test so that
// assertSafeProxyTarget's dnsLookup is replaceable in each test.
vi.mock("node:dns/promises", () => ({
  lookup: vi.fn(),
}));

import * as dns from "node:dns/promises";
import {
  isBlockedProxyAddress,
  assertSafeProxyTarget,
  createPinnedAgent,
  ProxyTargetError,
} from "../proxy-security.js";

// Convenience cast — vitest doesn't know the mock shape yet.
const mockLookup = dns.lookup as ReturnType<typeof vi.fn>;

afterEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// isBlockedProxyAddress
// ---------------------------------------------------------------------------

describe("isBlockedProxyAddress", () => {
  describe("IPv4 link-local (169.254.0.0/16)", () => {
    it("blocks 169.254.169.254 (AWS metadata)", () => {
      expect(isBlockedProxyAddress("169.254.169.254")).toBe(true);
    });

    it("blocks 169.254.0.1 (first address in range)", () => {
      expect(isBlockedProxyAddress("169.254.0.1")).toBe(true);
    });

    it("blocks 169.254.255.255 (last address in range)", () => {
      expect(isBlockedProxyAddress("169.254.255.255")).toBe(true);
    });

    it("allows 169.253.0.1 (just outside the range)", () => {
      expect(isBlockedProxyAddress("169.253.0.1")).toBe(false);
    });

    it("allows 170.254.0.1 (just outside the range)", () => {
      expect(isBlockedProxyAddress("170.254.0.1")).toBe(false);
    });

    it("allows loopback 127.0.0.1", () => {
      expect(isBlockedProxyAddress("127.0.0.1")).toBe(false);
    });

    it("allows a public IP", () => {
      expect(isBlockedProxyAddress("93.184.216.34")).toBe(false);
    });
  });

  describe("IPv6 link-local (fe80::/10)", () => {
    it("blocks fe80::1", () => {
      expect(isBlockedProxyAddress("fe80::1")).toBe(true);
    });

    it("blocks fe80::aabb:ccdd (arbitrary link-local)", () => {
      expect(isBlockedProxyAddress("fe80::aabb:ccdd")).toBe(true);
    });

    it("allows ::1 (loopback)", () => {
      expect(isBlockedProxyAddress("::1")).toBe(false);
    });

    it("allows 2001:db8::1 (documentation range)", () => {
      expect(isBlockedProxyAddress("2001:db8::1")).toBe(false);
    });
  });

  describe("AWS IPv6 IMDS (fd00:ec2::254)", () => {
    it("blocks fd00:ec2::254 exactly", () => {
      expect(isBlockedProxyAddress("fd00:ec2::254")).toBe(true);
    });

    it("allows fd00:ec2::255 (adjacent address)", () => {
      expect(isBlockedProxyAddress("fd00:ec2::255")).toBe(false);
    });
  });

  describe("IPv4-mapped IPv6 variants of 169.254.169.254", () => {
    it("blocks dotted form ::ffff:169.254.169.254", () => {
      expect(isBlockedProxyAddress("::ffff:169.254.169.254")).toBe(true);
    });

    it("blocks hex form ::ffff:a9fe:a9fe (WHATWG URL serialization)", () => {
      expect(isBlockedProxyAddress("::ffff:a9fe:a9fe")).toBe(true);
    });

    it("allows IPv4-mapped loopback ::ffff:127.0.0.1", () => {
      expect(isBlockedProxyAddress("::ffff:127.0.0.1")).toBe(false);
    });
  });

  describe("non-IP strings", () => {
    it("allows empty string (not an IP)", () => {
      expect(isBlockedProxyAddress("")).toBe(false);
    });

    it("allows hostname string (not an IP)", () => {
      expect(isBlockedProxyAddress("example.com")).toBe(false);
    });
  });
});

// ---------------------------------------------------------------------------
// assertSafeProxyTarget
// ---------------------------------------------------------------------------

describe("assertSafeProxyTarget", () => {
  it("resolves and allows a safe hostname", async () => {
    mockLookup.mockResolvedValueOnce([{ address: "93.184.216.34", family: 4 }]);

    const addrs = await assertSafeProxyTarget(new URL("http://example.com/"));
    expect(addrs).toEqual(["93.184.216.34"]);
    expect(mockLookup).toHaveBeenCalledWith("example.com", { all: true });
  });

  it("throws ProxyTargetError when host resolves to blocked IP", async () => {
    mockLookup.mockResolvedValueOnce([
      { address: "169.254.169.254", family: 4 },
    ]);

    await expect(
      assertSafeProxyTarget(new URL("http://evil.example.com/")),
    ).rejects.toThrow(ProxyTargetError);
  });

  it("throws ProxyTargetError when any resolved IP is blocked (mixed results)", async () => {
    mockLookup.mockResolvedValueOnce([
      { address: "93.184.216.34", family: 4 },
      { address: "169.254.169.254", family: 4 },
    ]);

    await expect(
      assertSafeProxyTarget(new URL("http://dual.example.com/")),
    ).rejects.toThrow(ProxyTargetError);
  });

  it("throws ProxyTargetError when DNS lookup fails", async () => {
    mockLookup.mockRejectedValueOnce(new Error("ENOTFOUND"));

    await expect(
      assertSafeProxyTarget(new URL("http://nonexistent.invalid/")),
    ).rejects.toThrow(ProxyTargetError);
  });

  it("skips DNS lookup for literal IPv4 hosts", async () => {
    const addrs = await assertSafeProxyTarget(new URL("http://127.0.0.1/path"));
    expect(addrs).toEqual(["127.0.0.1"]);
    expect(mockLookup).not.toHaveBeenCalled();
  });

  it("throws ProxyTargetError for literal blocked IPv4", async () => {
    await expect(
      assertSafeProxyTarget(new URL("http://169.254.169.254/")),
    ).rejects.toThrow(ProxyTargetError);
    expect(mockLookup).not.toHaveBeenCalled();
  });

  it("skips DNS lookup for literal IPv6 hosts", async () => {
    const addrs = await assertSafeProxyTarget(new URL("http://[::1]/"));
    expect(addrs).toEqual(["::1"]);
    expect(mockLookup).not.toHaveBeenCalled();
  });

  it("returns all validated addresses so caller can pick one for pinning", async () => {
    mockLookup.mockResolvedValueOnce([
      { address: "192.0.2.1", family: 4 },
      { address: "192.0.2.2", family: 4 },
    ]);

    const addrs = await assertSafeProxyTarget(new URL("http://multi.example/"));
    expect(addrs).toHaveLength(2);
    expect(addrs).toContain("192.0.2.1");
    expect(addrs).toContain("192.0.2.2");
  });
});

// ---------------------------------------------------------------------------
// createPinnedAgent
// ---------------------------------------------------------------------------

/** The lookup hook `createPinnedAgent` installed on the agent. */
type PinnedLookup = (
  hostname: string,
  options: dnsTypes.LookupOptions,
  callback: (
    err: NodeJS.ErrnoException | null,
    address: string | dnsTypes.LookupAddress[],
    family?: number,
  ) => void,
) => void;

function pinnedLookup(agent: http.Agent | https.Agent): PinnedLookup {
  const { lookup } = (agent as http.Agent & { options: http.AgentOptions })
    .options;
  if (typeof lookup !== "function") {
    throw new Error("expected createPinnedAgent to install a lookup hook");
  }
  return lookup as PinnedLookup;
}

describe("createPinnedAgent", () => {
  it("returns an http.Agent for http: protocol", () => {
    const agent = createPinnedAgent("http:", ["127.0.0.1"]);
    expect(agent).toBeInstanceOf(http.Agent);
    expect(agent).not.toBeInstanceOf(https.Agent);
  });

  it("returns an https.Agent for https: protocol", () => {
    const agent = createPinnedAgent("https:", ["127.0.0.1"]);
    expect(agent).toBeInstanceOf(https.Agent);
  });

  it("pinned lookup returns the IPv4 address regardless of queried hostname", () => {
    const lookup = pinnedLookup(createPinnedAgent("http:", ["192.0.2.99"]));

    const callback = vi.fn();
    lookup("example.com", {}, callback);

    expect(callback).toHaveBeenCalledWith(null, "192.0.2.99", 4);
  });

  it("pinned lookup returns the IPv6 address and family 6", () => {
    const lookup = pinnedLookup(createPinnedAgent("http:", ["2001:db8::1"]));

    const callback = vi.fn();
    lookup("example.com", {}, callback);

    expect(callback).toHaveBeenCalledWith(null, "2001:db8::1", 6);
  });

  // Node's net.connect runs with autoSelectFamily on (Node >= 20), so it calls
  // the hook with { all: true } and requires the ARRAY callback shape. Handing
  // it a scalar there fails every hostname request with ERR_INVALID_IP_ADDRESS.
  it("pinned lookup returns the array shape when called with { all: true }", () => {
    const lookup = pinnedLookup(createPinnedAgent("http:", ["192.0.2.99"]));

    const callback = vi.fn();
    lookup("example.com", { all: true }, callback);

    expect(callback).toHaveBeenCalledWith(null, [
      { address: "192.0.2.99", family: 4 },
    ]);
  });

  it("pinned lookup returns the array shape for IPv6 too", () => {
    const lookup = pinnedLookup(createPinnedAgent("http:", ["2001:db8::1"]));

    const callback = vi.fn();
    lookup("example.com", { all: true }, callback);

    expect(callback).toHaveBeenCalledWith(null, [
      { address: "2001:db8::1", family: 6 },
    ]);
  });

  // Every validated address is handed to the hook, so Node keeps its normal
  // address-family fallback for a dual-stack host whose first address is
  // unreachable — while still only ever seeing prevalidated addresses.
  it("passes every validated address through for dual-stack fallback", () => {
    const lookup = pinnedLookup(
      createPinnedAgent("http:", ["2001:db8::1", "192.0.2.7"]),
    );

    const callback = vi.fn();
    lookup("dual.example", { all: true }, callback);

    expect(callback).toHaveBeenCalledWith(null, [
      { address: "2001:db8::1", family: 6 },
      { address: "192.0.2.7", family: 4 },
    ]);
  });

  it("throws when given no validated address", () => {
    expect(() => createPinnedAgent("http:", [])).toThrow(ProxyTargetError);
  });

  // A dual-stack host whose first (IPv6) address is dead: the connection must
  // still complete via the second, validated address.
  it("falls back to a later validated address when the first is unreachable", async () => {
    const server = http.createServer((_req, res) => res.end("fallback-ok"));
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", () => resolve()),
    );
    const { port } = server.address() as AddressInfo;

    try {
      // 2001:db8::1 is the documentation range — nothing answers there.
      const agent = createPinnedAgent("http:", ["2001:db8::1", "127.0.0.1"]);
      const response = await nodeFetch(`http://dual.invalid:${port}/`, {
        agent,
      });

      expect(response.status).toBe(200);
      await expect(response.text()).resolves.toBe("fallback-ok");
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it("TOCTOU guarantee: lookup never invokes the OS resolver", () => {
    const lookup = pinnedLookup(createPinnedAgent("http:", ["10.0.0.1"]));

    const callback = vi.fn();
    lookup("any-hostname.example", {}, callback);

    // The callback is invoked synchronously with the fixed IP — no resolver.
    expect(callback).toHaveBeenCalledTimes(1);
    expect(callback).toHaveBeenCalledWith(null, "10.0.0.1", 4);
  });

  // End-to-end over the production call path: node-fetch → http.Agent →
  // net.connect. The hostname is deliberately unresolvable, so the request can
  // only succeed if the connection went to the pinned IP, and it exercises the
  // real { all: true } callback shape rather than a hand-rolled invocation.
  it("routes a real request to the pinned IP for an unresolvable hostname", async () => {
    const server = http.createServer((_req, res) => res.end("pinned-ok"));
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", () => resolve()),
    );
    const { port } = server.address() as AddressInfo;

    try {
      const agent = createPinnedAgent("http:", ["127.0.0.1"]);
      const response = await nodeFetch(
        `http://pinned-target.invalid:${port}/`,
        { agent },
      );

      expect(response.status).toBe(200);
      await expect(response.text()).resolves.toBe("pinned-ok");
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
