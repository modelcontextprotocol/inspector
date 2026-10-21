import { describe, it, expect } from "vitest";
import {
  SdkError,
  SdkErrorCode,
  SdkHttpError,
} from "@modelcontextprotocol/client";
import {
  annotateRateLimit,
  attachRetryAfter,
  isRateLimitError,
  MAX_UNCLAIMED_RATE_LIMITS,
  parseRetryAfter,
  RateLimitLedger,
  requestIdsOf,
  type AnnotatedRateLimitData,
} from "@inspector/core/mcp/rateLimit.js";
import type { FetchRequestEntryBase } from "@inspector/core/mcp/types.js";

const NOW = Date.parse("2026-10-19T12:00:00Z");

function entry(
  overrides: Partial<FetchRequestEntryBase> = {},
): FetchRequestEntryBase {
  return {
    id: "fetch-1",
    timestamp: new Date(NOW),
    method: "POST",
    url: "http://localhost/mcp",
    requestHeaders: {},
    requestBody: JSON.stringify({
      jsonrpc: "2.0",
      id: 7,
      method: "tools/list",
    }),
    responseStatus: 429,
    responseHeaders: { "Retry-After": "30" },
    ...overrides,
  };
}

function throttled(data: Record<string, unknown> = {}): SdkHttpError {
  return new SdkHttpError(
    SdkErrorCode.ClientHttpNotImplemented,
    "Error POSTing to endpoint: slow down",
    { status: 429, statusText: "Too Many Requests", ...data },
  );
}

describe("requestIdsOf", () => {
  it("reads a single request's id, string or number", () => {
    expect(
      requestIdsOf('{"jsonrpc":"2.0","id":7,"method":"tools/list"}'),
    ).toEqual([7]);
    expect(requestIdsOf('{"jsonrpc":"2.0","id":"a","method":"x"}')).toEqual([
      "a",
    ]);
  });

  it("reads every request in a batch, skipping notifications and junk", () => {
    expect(
      requestIdsOf(
        JSON.stringify([
          { jsonrpc: "2.0", id: 1, method: "a" },
          { jsonrpc: "2.0", method: "notifications/x" },
          { jsonrpc: "2.0", id: 2, result: {} },
          { jsonrpc: "2.0", id: null, method: "b" },
          null,
          { jsonrpc: "2.0", id: 3, method: "c" },
        ]),
      ),
    ).toEqual([1, 3]);
  });

  it("finds nothing in a missing or non-JSON body", () => {
    expect(requestIdsOf(undefined)).toEqual([]);
    expect(requestIdsOf("not json")).toEqual([]);
    expect(requestIdsOf("42")).toEqual([]);
  });
});

describe("RateLimitLedger", () => {
  it("files a 429's header, whatever its casing, under its request id, once", () => {
    const ledger = new RateLimitLedger();
    ledger.record(entry());
    expect(ledger.take(7)).toBe("30");
    expect(ledger.take(7)).toBeUndefined();
  });

  it("keeps each overlapping request's own header", () => {
    const ledger = new RateLimitLedger();
    ledger.record(entry());
    ledger.record(
      entry({
        requestBody: JSON.stringify({ jsonrpc: "2.0", id: 8, method: "x" }),
        responseHeaders: { "retry-after": "5" },
      }),
    );
    expect(ledger.take(7)).toBe("30");
    expect(ledger.take(8)).toBe("5");
  });

  it("files a 429 with no header as having none", () => {
    const ledger = new RateLimitLedger();
    ledger.record(entry({ responseHeaders: {} }));
    expect(ledger.take(7)).toBeUndefined();
  });

  it("ignores anything that is not a 429", () => {
    const ledger = new RateLimitLedger();
    ledger.record(entry({ responseStatus: 503 }));
    ledger.record(entry({ responseStatus: undefined }));
    expect(ledger.take(7)).toBeUndefined();
  });

  it("drops the oldest unclaimed 429 past its cap", () => {
    const ledger = new RateLimitLedger();
    for (let id = 0; id <= MAX_UNCLAIMED_RATE_LIMITS; id++) {
      ledger.record(
        entry({
          requestBody: JSON.stringify({ jsonrpc: "2.0", id, method: "x" }),
        }),
      );
    }
    expect(ledger.take(0)).toBeUndefined();
    expect(ledger.take(1)).toBe("30");
    expect(ledger.take(MAX_UNCLAIMED_RATE_LIMITS)).toBe("30");
  });

  it("forgets everything on clear", () => {
    const ledger = new RateLimitLedger();
    ledger.record(entry());
    ledger.clear();
    expect(ledger.take(7)).toBeUndefined();
  });
});

describe("attachRetryAfter", () => {
  it("stamps the header onto a 429's data", () => {
    const err = throttled();
    attachRetryAfter(err, "30");
    expect(err.data.retryAfter).toBe("30");
  });

  it("keeps a header already relayed on the error", () => {
    const err = throttled({ retryAfter: "5" });
    attachRetryAfter(err, "30");
    expect(err.data.retryAfter).toBe("5");
  });

  it("leaves a non-429, or a missing header, alone", () => {
    const unavailable = throttled({ status: 503 });
    attachRetryAfter(unavailable, "30");
    expect(unavailable.data.retryAfter).toBeUndefined();
    const err = throttled();
    attachRetryAfter(err, undefined);
    expect(err.data).not.toHaveProperty("retryAfter");
    expect(() => attachRetryAfter(undefined, "30")).not.toThrow();
  });
});

describe("parseRetryAfter", () => {
  it("reads delta-seconds", () => {
    expect(parseRetryAfter("30", NOW)).toBe(30_000);
    expect(parseRetryAfter(" 0 ", NOW)).toBe(0);
  });

  it("reads an HTTP-date as the delay from now", () => {
    expect(parseRetryAfter("Mon, 19 Oct 2026 12:01:30 GMT", NOW)).toBe(90_000);
  });

  it("clamps a date already past to zero", () => {
    expect(parseRetryAfter("Mon, 19 Oct 2026 11:00:00 GMT", NOW)).toBe(0);
  });

  it("treats a missing or malformed value as absent", () => {
    expect(parseRetryAfter(undefined, NOW)).toBeUndefined();
    expect(parseRetryAfter("soon", NOW)).toBeUndefined();
    // `Date.parse` alone reads these as dates.
    expect(parseRetryAfter("-5", NOW)).toBeUndefined();
    expect(parseRetryAfter("1.5", NOW)).toBeUndefined();
    expect(parseRetryAfter("2026-10-19T12:01:30Z", NOW)).toBeUndefined();
    // The right shape, but no real date: `Date.parse` rolls an impossible
    // day over (31 Nov → 1 Dec) and ignores a weekday that does not match.
    expect(parseRetryAfter("Tue, 31 Nov 2026 12:00:00 GMT", NOW)).toBe(
      undefined,
    );
    expect(parseRetryAfter("Tue, 19 Oct 2026 12:01:30 GMT", NOW)).toBe(
      undefined,
    );
    expect(parseRetryAfter("Mon, 99 Foo 2026 12:00:00 GMT", NOW)).toBe(
      undefined,
    );
  });
});

describe("isRateLimitError", () => {
  it("matches only an SdkHttpError with status 429", () => {
    expect(isRateLimitError(throttled())).toBe(true);
    expect(isRateLimitError(throttled({ status: 503 }))).toBe(false);
    expect(
      isRateLimitError(new SdkError(SdkErrorCode.RequestTimeout, "timed out")),
    ).toBe(false);
    expect(
      isRateLimitError(Object.assign(new Error("x"), { status: 429 })),
    ).toBe(false);
    expect(isRateLimitError(undefined)).toBe(false);
  });
});

describe("annotateRateLimit", () => {
  it("names the method and the retry delay, keeping class, code, status and cause", () => {
    const original = throttled({ retryAfter: "30" });
    const annotated = annotateRateLimit(original, "tools/call", NOW);

    expect(SdkHttpError.isInstance(annotated)).toBe(true);
    const error = annotated as SdkHttpError;
    expect(error.message).toBe(
      "Rate limited by the server (HTTP 429) on tools/call. " +
        "The server asked to retry after 30s. " +
        "Error POSTing to endpoint: slow down",
    );
    expect(error.code).toBe(SdkErrorCode.ClientHttpNotImplemented);
    expect(error.status).toBe(429);
    expect(error.statusText).toBe("Too Many Requests");
    expect(error.cause).toBe(original);
    const data = error.data as AnnotatedRateLimitData;
    expect(data.method).toBe("tools/call");
    expect(data.retryAfter).toBe("30");
    expect(data.retryAfterMs).toBe(30_000);
  });

  it("ignores a retryAfter on the data that is not a string", () => {
    const annotated = annotateRateLimit(
      throttled({ retryAfter: 5 }),
      "tools/list",
      NOW,
    ) as SdkHttpError;
    expect(annotated.message).toContain(
      "The server sent no Retry-After header.",
    );
  });

  it("says when the server sent no Retry-After", () => {
    const annotated = annotateRateLimit(
      throttled(),
      "tools/list",
      NOW,
    ) as SdkHttpError;
    expect(annotated.message).toContain(
      "The server sent no Retry-After header.",
    );
    const data = annotated.data as AnnotatedRateLimitData;
    expect(data.retryAfter).toBeUndefined();
    expect(data.retryAfterMs).toBeUndefined();
  });

  it("reports an unparseable Retry-After verbatim rather than guessing", () => {
    const annotated = annotateRateLimit(
      throttled({ retryAfter: "soon" }),
      "tools/list",
      NOW,
    ) as SdkHttpError;
    expect(annotated.message).toContain(
      "The server sent an unparseable Retry-After (soon).",
    );
    const data = annotated.data as AnnotatedRateLimitData;
    expect(data.retryAfter).toBe("soon");
    expect(data.retryAfterMs).toBeUndefined();
  });

  it("defaults the clock to now", () => {
    const annotated = annotateRateLimit(
      throttled({ retryAfter: "1" }),
      "tools/list",
    ) as SdkHttpError;
    expect(annotated.message).toContain("retry after 1s");
  });

  it("returns anything that is not a 429 untouched", () => {
    const unavailable = throttled({ status: 503 });
    expect(annotateRateLimit(unavailable, "tools/list", NOW)).toBe(unavailable);
    const timeout = new SdkError(SdkErrorCode.RequestTimeout, "timed out");
    expect(annotateRateLimit(timeout, "tools/list", NOW)).toBe(timeout);
  });
});
