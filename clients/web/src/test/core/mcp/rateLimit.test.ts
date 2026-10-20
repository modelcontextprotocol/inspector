import { describe, it, expect } from "vitest";
import {
  SdkError,
  SdkErrorCode,
  SdkHttpError,
} from "@modelcontextprotocol/client";
import {
  annotateRateLimit,
  isRateLimitError,
  parseRetryAfter,
  rateLimitResponseOf,
  retryAfterSince,
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

describe("rateLimitResponseOf", () => {
  it("records a 429's Retry-After, whatever its casing, and when it was sent", () => {
    expect(rateLimitResponseOf(entry())).toEqual({
      retryAfter: "30",
      sentAt: NOW,
    });
  });

  it("records a 429 with no Retry-After", () => {
    expect(rateLimitResponseOf(entry({ responseHeaders: {} }))).toEqual({
      sentAt: NOW,
    });
  });

  it("ignores anything that is not a 429", () => {
    expect(rateLimitResponseOf(entry({ responseStatus: 503 }))).toBeUndefined();
    expect(
      rateLimitResponseOf(entry({ responseStatus: undefined })),
    ).toBeUndefined();
  });
});

describe("retryAfterSince", () => {
  it("returns the header of a 429 sent at or after the bound", () => {
    const latest = { retryAfter: "30", sentAt: NOW };
    expect(retryAfterSince(latest, NOW)).toBe("30");
    expect(retryAfterSince(latest, NOW - 1)).toBe("30");
  });

  it("drops a 429 that predates the request", () => {
    expect(retryAfterSince({ retryAfter: "30", sentAt: NOW }, NOW + 1)).toBe(
      undefined,
    );
  });

  it("returns nothing when no 429 was recorded", () => {
    expect(retryAfterSince(undefined, NOW)).toBeUndefined();
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
    // The right shape, but no real date.
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
    const original = throttled();
    const annotated = annotateRateLimit(original, "tools/call", "30", NOW);

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

  it("prefers a Retry-After the backend relayed on the error", () => {
    const annotated = annotateRateLimit(
      throttled({ retryAfter: "5" }),
      "tools/list",
      "30",
      NOW,
    ) as SdkHttpError;
    expect(annotated.message).toContain("retry after 5s");
    expect((annotated.data as AnnotatedRateLimitData).retryAfter).toBe("5");
  });

  it("ignores a relayed retryAfter that is not a string", () => {
    const annotated = annotateRateLimit(
      throttled({ retryAfter: 5 }),
      "tools/list",
      "30",
      NOW,
    ) as SdkHttpError;
    expect(annotated.message).toContain("retry after 30s");
  });

  it("says when the server sent no Retry-After", () => {
    const annotated = annotateRateLimit(
      throttled(),
      "tools/list",
      undefined,
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
      throttled(),
      "tools/list",
      "soon",
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
      throttled(),
      "tools/list",
      "1",
    ) as SdkHttpError;
    expect(annotated.message).toContain("retry after 1s");
  });

  it("returns anything that is not a 429 untouched", () => {
    const unavailable = throttled({ status: 503 });
    expect(annotateRateLimit(unavailable, "tools/list", "30", NOW)).toBe(
      unavailable,
    );
    const timeout = new SdkError(SdkErrorCode.RequestTimeout, "timed out");
    expect(annotateRateLimit(timeout, "tools/list", "30", NOW)).toBe(timeout);
  });
});
