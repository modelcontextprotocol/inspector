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
    const addrs = await assertSafeProxyTarget(
      new URL("http://127.0.0.1/path"),
    );
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

describe("createPinnedAgent", () => {
  it("returns an http.Agent for http: protocol", () => {
    const agent = createPinnedAgent("http:", "127.0.0.1");
    expect(agent).toBeInstanceOf(http.Agent);
    expect(agent).not.toBeInstanceOf(https.Agent);
  });

  it("returns an https.Agent for https: protocol", () => {
    const agent = createPinnedAgent("https:", "127.0.0.1");
    expect(agent).toBeInstanceOf(https.Agent);
  });

  it("pinned lookup always returns the IPv4 address regardless of queried hostname", () =>
    new Promise<void>((resolve) => {
      const agent = createPinnedAgent("http:", "192.0.2.99");
      const lookup = (agent as http.Agent & { options: { lookup: Function } })
        .options.lookup;

      lookup(
        "example.com",
        {},
        (err: Error | null, address: string, family: number) => {
          expect(err).toBeNull();
          expect(address).toBe("192.0.2.99");
          expect(family).toBe(4);
          resolve();
        },
      );
    }));

  it("pinned lookup always returns the IPv6 address and family 6", () =>
    new Promise<void>((resolve) => {
      const agent = createPinnedAgent("http:", "2001:db8::1");
      const lookup = (agent as http.Agent & { options: { lookup: Function } })
        .options.lookup;

      lookup(
        "example.com",
        {},
        (err: Error | null, address: string, family: number) => {
          expect(err).toBeNull();
          expect(address).toBe("2001:db8::1");
          expect(family).toBe(6);
          resolve();
        },
      );
    }));

  it("TOCTOU guarantee: lookup never invokes the OS resolver", () => {
    const agent = createPinnedAgent("http:", "10.0.0.1");
    const lookup = (agent as http.Agent & { options: { lookup: Function } })
      .options.lookup;

    const osDnsLookup = vi.fn();
    lookup("any-hostname.example", {}, osDnsLookup);

    // osDnsLookup was called as the callback, not as a resolver —
    // the pinned implementation calls it synchronously with the fixed IP.
    expect(osDnsLookup).toHaveBeenCalledTimes(1);
    expect(osDnsLookup).toHaveBeenCalledWith(null, "10.0.0.1", 4);
  });
});
