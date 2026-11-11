import { describe, it, expect, vi } from "vitest";
import { discoverAuthorizationServerMetadata } from "@modelcontextprotocol/client";
import {
  FETCH_TARGET_REFUSED_WIRE_CODE,
  FetchTargetError,
  findFetchTargetError,
  formatFetchRefusal,
  isFetchTargetRefusedWire,
  withFetchRefusalReporting,
  type FetchRefusal,
} from "@inspector/core/auth/fetchRefusal.js";
import { discoverAuthorizationServerMetadataFromCandidates } from "@inspector/core/auth/discovery.js";

const REASON =
  "Refusing to fetch from a link-local or metadata address (169.254.169.254)";

describe("FetchTargetError", () => {
  it("carries a name, and the refused URL only when given one", () => {
    const bare = new FetchTargetError("no");
    expect(bare.name).toBe("FetchTargetError");
    expect(bare.url).toBeUndefined();
    expect(new FetchTargetError("no", "http://x/").url).toBe("http://x/");
  });

  it("is found directly or behind a cause chain", () => {
    const refused = new FetchTargetError("no");
    expect(findFetchTargetError(refused)).toBe(refused);
    expect(
      findFetchTargetError(new TypeError("fetch failed", { cause: refused })),
    ).toBe(refused);
    expect(findFetchTargetError(new Error("x"))).toBeUndefined();
  });
});

describe("isFetchTargetRefusedWire", () => {
  it("accepts the /api/fetch refusal body, with or without a URL", () => {
    expect(
      isFetchTargetRefusedWire({
        error: REASON,
        code: FETCH_TARGET_REFUSED_WIRE_CODE,
        url: "http://169.254.169.254/",
      }),
    ).toBe(true);
    expect(
      isFetchTargetRefusedWire({
        error: REASON,
        code: FETCH_TARGET_REFUSED_WIRE_CODE,
      }),
    ).toBe(true);
  });

  it.each([
    ["null", null],
    ["a string", "x"],
    ["another code", { error: REASON, code: "oauth_request_timeout" }],
    ["no message", { code: FETCH_TARGET_REFUSED_WIRE_CODE }],
    [
      "a non-string URL",
      { error: REASON, code: FETCH_TARGET_REFUSED_WIRE_CODE, url: 1 },
    ],
  ])("rejects %s", (_label, value) => {
    expect(isFetchTargetRefusedWire(value)).toBe(false);
  });
});

describe("formatFetchRefusal", () => {
  it("names the URL and the guard's reason", () => {
    expect(
      formatFetchRefusal({ url: "http://169.254.169.254/x", reason: REASON }),
    ).toBe(`Refused to fetch http://169.254.169.254/x: ${REASON}`);
  });
});

describe("withFetchRefusalReporting", () => {
  it("passes a response through without reporting", async () => {
    const onRefusal = vi.fn();
    const res = new Response("ok");
    const wrapped = withFetchRefusalReporting(
      vi.fn<typeof fetch>().mockResolvedValue(res),
      onRefusal,
    );
    await expect(wrapped("http://as.example/")).resolves.toBe(res);
    expect(onRefusal).not.toHaveBeenCalled();
  });

  it("rethrows any other failure unreported", async () => {
    const onRefusal = vi.fn();
    const err = new Error("ECONNREFUSED");
    const wrapped = withFetchRefusalReporting(
      vi.fn<typeof fetch>().mockRejectedValue(err),
      onRefusal,
    );
    await expect(wrapped("http://as.example/")).rejects.toBe(err);
    expect(onRefusal).not.toHaveBeenCalled();
  });

  it("reports the refused hop's URL, then rethrows the original error", async () => {
    const onRefusal = vi.fn();
    const err = new TypeError("fetch failed", {
      cause: new FetchTargetError(REASON, "http://169.254.169.254/hop"),
    });
    const wrapped = withFetchRefusalReporting(
      vi.fn<typeof fetch>().mockRejectedValue(err),
      onRefusal,
    );
    await expect(wrapped("http://as.example/start")).rejects.toBe(err);
    expect(onRefusal).toHaveBeenCalledWith({
      url: "http://169.254.169.254/hop",
      reason: REASON,
    });
  });

  it("falls back to the request URL, with credentials redacted", async () => {
    const onRefusal = vi.fn();
    const wrapped = withFetchRefusalReporting(
      vi.fn<typeof fetch>().mockRejectedValue(new FetchTargetError(REASON)),
      onRefusal,
    );
    await expect(
      wrapped(new URL("http://169.254.169.254/cb?code=secret&state=1")),
    ).rejects.toThrow(REASON);
    expect(onRefusal).toHaveBeenCalledWith({
      url: "http://169.254.169.254/cb?code=%5BREDACTED%5D&state=1",
      reason: REASON,
    });
  });

  // The case the issue reports: discovery recovers from the refusal by trying
  // the next candidate, so nothing is thrown — the report is the only trace.
  it("reports a refusal discovery recovered from", async () => {
    const good = new URL("https://as.example/");
    const base = vi.fn<typeof fetch>((input) => {
      const url = new URL(String(input));
      if (url.hostname === "169.254.169.254") {
        return Promise.reject(new FetchTargetError(REASON, url.href));
      }
      return Promise.resolve(
        Response.json({
          issuer: good.href,
          authorization_endpoint: `${good.href}authorize`,
          token_endpoint: `${good.href}token`,
          response_types_supported: ["code"],
        }),
      );
    });
    const refusals: FetchRefusal[] = [];
    const fetchFn = withFetchRefusalReporting(base, (r) => refusals.push(r));

    const found = await discoverAuthorizationServerMetadataFromCandidates(
      [new URL("http://169.254.169.254/"), good],
      (candidate) =>
        discoverAuthorizationServerMetadata(candidate, { fetchFn }),
    );

    expect(found?.authorizationServerUrl).toBe(good);
    expect(refusals.length).toBeGreaterThan(0);
    expect(refusals[0]).toEqual({
      url: "http://169.254.169.254/.well-known/oauth-authorization-server",
      reason: REASON,
    });
  });
});
