import { describe, it, expect } from "vitest";
import {
  SdkError,
  SdkErrorCode,
  SdkHttpError,
} from "@modelcontextprotocol/client";
import {
  annotateRequestTimeout,
  describeConnectionDiagnostics,
  describeSendFailure,
  describeStreamEndpoint,
  formatDuration,
  isRequestTimeoutError,
  MAX_LISTED_OUTSTANDING_REQUESTS,
  type AnnotatedRequestTimeoutData,
  type ConnectionDiagnostics,
} from "@inspector/core/mcp/connectionDiagnostics.js";

// A fixed clock so every duration in these assertions is exact.
const NOW = 1_000_000;
const seconds = (n: number) => n * 1000;

/** The SDK's own per-request timeout, exactly as `Protocol.request` throws it. */
function sdkTimeout(timeout = 60_000): SdkError {
  return new SdkError(SdkErrorCode.RequestTimeout, "Request timed out", {
    timeout,
  });
}

describe("formatDuration", () => {
  it("renders sub-second values in milliseconds", () => {
    expect(formatDuration(0)).toBe("0ms");
    expect(formatDuration(850)).toBe("850ms");
    expect(formatDuration(999.6)).toBe("1000ms");
  });

  it("renders seconds, minutes and hours at increasing granularity", () => {
    expect(formatDuration(seconds(1))).toBe("1s");
    expect(formatDuration(seconds(59))).toBe("59s");
    expect(formatDuration(seconds(60))).toBe("1m00s");
    expect(formatDuration(seconds(252))).toBe("4m12s");
    expect(formatDuration(seconds(3600))).toBe("1h00m");
    expect(formatDuration(seconds(3600 + 120 + 5))).toBe("1h02m");
  });

  it("clamps a negative value to zero rather than rendering nonsense", () => {
    // A clock skew between two timestamps must not print `-3s`.
    expect(formatDuration(-3000)).toBe("0ms");
  });
});

describe("describeStreamEndpoint", () => {
  it("reduces a stream URL to its method and path", () => {
    expect(describeStreamEndpoint("https://host.example:8443/mcp?x=1")).toBe(
      "GET /mcp",
    );
  });

  it("falls back to the raw string for an unparseable URL", () => {
    expect(describeStreamEndpoint("not a url")).toBe("GET not a url");
  });
});

describe("describeConnectionDiagnostics", () => {
  it("says so when nothing is outstanding and nothing has been received", () => {
    expect(
      describeConnectionDiagnostics({
        capturedAt: NOW,
        outstandingRequests: [],
      }),
    ).toBe(
      "No requests are unanswered. No response has been received this session.",
    );
  });

  it("names each unanswered request with how long ago it went out", () => {
    const diagnostics: ConnectionDiagnostics = {
      capturedAt: NOW,
      outstandingRequests: [
        { id: 2, method: "tools/list", sentAt: NOW - seconds(60) },
        { id: 3, method: "ping", sentAt: NOW - seconds(12) },
      ],
      lastResponse: { method: "initialize", receivedAt: NOW - seconds(61) },
    };
    expect(describeConnectionDiagnostics(diagnostics)).toBe(
      "2 requests are unanswered: tools/list (sent 1m00s ago), ping (sent 12s ago). " +
        "Last response received 1m01s ago (initialize).",
    );
  });

  it("uses the singular for exactly one unanswered request", () => {
    const diagnostics: ConnectionDiagnostics = {
      capturedAt: NOW,
      outstandingRequests: [
        { id: 2, method: "tools/list", sentAt: NOW - seconds(60) },
      ],
    };
    expect(describeConnectionDiagnostics(diagnostics)).toContain(
      "1 request is unanswered: tools/list (sent 1m00s ago).",
    );
  });

  it("collapses the tail of a long outstanding list into a count", () => {
    const outstandingRequests = Array.from({ length: 8 }, (_, i) => ({
      id: i,
      method: `m${i}`,
      sentAt: NOW - seconds(i + 1),
    }));
    const text = describeConnectionDiagnostics({
      capturedAt: NOW,
      outstandingRequests,
    });
    expect(text).toContain("8 requests are unanswered: ");
    for (let i = 0; i < MAX_LISTED_OUTSTANDING_REQUESTS; i++) {
      expect(text).toContain(`m${i} (sent`);
    }
    expect(text).not.toContain("m5 (sent");
    expect(text).toContain(
      `, and ${8 - MAX_LISTED_OUTSTANDING_REQUESTS} more.`,
    );
  });

  it("describes an open notification stream by its endpoint, age and event count", () => {
    const diagnostics: ConnectionDiagnostics = {
      capturedAt: NOW,
      outstandingRequests: [],
      notificationStream: {
        url: "http://127.0.0.1:9779/mcp",
        openedAt: NOW - seconds(252),
        eventCount: 0,
      },
    };
    expect(describeConnectionDiagnostics(diagnostics)).toContain(
      "Notification stream (GET /mcp) open for 4m12s, 0 events delivered.",
    );
  });

  it("describes a closed notification stream by when it closed and how long it lasted", () => {
    const diagnostics: ConnectionDiagnostics = {
      capturedAt: NOW,
      outstandingRequests: [],
      notificationStream: {
        url: "http://127.0.0.1:9779/mcp",
        openedAt: NOW - seconds(185),
        eventCount: 1,
        closedAt: NOW - seconds(5),
      },
    };
    expect(describeConnectionDiagnostics(diagnostics)).toContain(
      "Notification stream (GET /mcp) closed 5s ago after 3m00s, 1 event delivered.",
    );
  });

  it("measures every duration against the snapshot's own clock, not the wall clock", () => {
    // A snapshot taken long ago still reads the way it read when it was
    // taken — that is what makes a timeout message and a later render of the
    // same snapshot agree.
    const diagnostics: ConnectionDiagnostics = {
      capturedAt: NOW,
      outstandingRequests: [
        { id: 1, method: "tools/list", sentAt: NOW - seconds(5) },
      ],
    };
    expect(describeConnectionDiagnostics(diagnostics)).toBe(
      "1 request is unanswered: tools/list (sent 5s ago). " +
        "No response has been received this session.",
    );
  });
});

describe("describeSendFailure", () => {
  it("leads with the HTTP status of a bare refusal (#2721)", () => {
    const err = new SdkHttpError(
      SdkErrorCode.ClientHttpNotImplemented,
      "Error POSTing to endpoint: Forbidden",
      { status: 403, statusText: "Forbidden", text: "Forbidden" },
    );
    expect(describeSendFailure(err)).toBe(
      "HTTP 403 Forbidden: Error POSTing to endpoint: Forbidden",
    );
  });

  it("states a status with no status text on its own", () => {
    const err = Object.assign(new Error("Remote send failed (502): bad"), {
      status: 502,
    });
    expect(describeSendFailure(err)).toBe(
      "HTTP 502: Remote send failed (502): bad",
    );
  });

  it("does not repeat a status the message already states", () => {
    const err = Object.assign(
      new Error("Error POSTing to endpoint (HTTP 403): Forbidden"),
      { status: 403, statusText: "Forbidden" },
    );
    expect(describeSendFailure(err)).toBe(
      "Error POSTing to endpoint (HTTP 403): Forbidden",
    );
  });

  it("falls back to the message, or the value itself, with no status", () => {
    expect(describeSendFailure(new Error("Connection closed"))).toBe(
      "Connection closed",
    );
    expect(
      describeSendFailure(
        Object.assign(new Error("odd"), { status: "403", statusText: 1 }),
      ),
    ).toBe("odd");
    expect(describeSendFailure("boom")).toBe("boom");
    expect(describeSendFailure(null)).toBe("null");
  });
});

describe("isRequestTimeoutError", () => {
  it("recognises the SDK's per-request timeout", () => {
    expect(isRequestTimeoutError(sdkTimeout())).toBe(true);
  });

  it("rejects the other RequestTimeout-coded rejections, which are not timeouts", () => {
    // An abort through `options.signal` with a non-SdkError reason: the SDK
    // wraps it in the same code with no `{ timeout }` data.
    expect(
      isRequestTimeoutError(
        new SdkError(SdkErrorCode.RequestTimeout, "AbortError: cancelled"),
      ),
    ).toBe(false);
    // The max-total-timeout variant carries different data.
    expect(
      isRequestTimeoutError(
        new SdkError(
          SdkErrorCode.RequestTimeout,
          "Maximum total timeout exceeded",
          { maxTotalTimeout: 1000, totalElapsed: 1200 },
        ),
      ),
    ).toBe(false);
    // A non-numeric `timeout` is not the SDK's shape either.
    expect(
      isRequestTimeoutError(
        new SdkError(SdkErrorCode.RequestTimeout, "Request timed out", {
          timeout: "60s",
        }),
      ),
    ).toBe(false);
  });

  it("rejects other SdkErrors, plain errors and non-errors", () => {
    expect(
      isRequestTimeoutError(
        new SdkError(SdkErrorCode.InvalidResult, "bad", { timeout: 1 }),
      ),
    ).toBe(false);
    expect(isRequestTimeoutError(new Error("Request timed out"))).toBe(false);
    expect(isRequestTimeoutError("Request timed out")).toBe(false);
    expect(isRequestTimeoutError(null)).toBe(false);
  });
});

describe("annotateRequestTimeout", () => {
  const diagnostics: ConnectionDiagnostics = {
    capturedAt: NOW,
    outstandingRequests: [
      { id: 2, method: "tools/list", sentAt: NOW - seconds(60) },
    ],
    lastResponse: { method: "initialize", receivedAt: NOW - seconds(61) },
    notificationStream: {
      url: "http://127.0.0.1:9779/mcp",
      openedAt: NOW - seconds(62),
      eventCount: 0,
    },
  };

  it("rewrites the message to name the request, its budget and the connection state", () => {
    const annotated = annotateRequestTimeout(
      sdkTimeout(60_000),
      "tools/list",
      diagnostics,
    );
    expect(SdkError.isInstance(annotated)).toBe(true);
    expect((annotated as SdkError).message).toBe(
      "Request timed out after 1m00s (tools/list). " +
        "1 request is unanswered: tools/list (sent 1m00s ago). " +
        "Last response received 1m01s ago (initialize). " +
        "Notification stream (GET /mcp) open for 1m02s, 0 events delivered.",
    );
  });

  it("keeps the code, carries the method and snapshot in data, and links the original as cause", () => {
    const original = sdkTimeout(300);
    const annotated = annotateRequestTimeout(
      original,
      "ping",
      diagnostics,
    ) as SdkError;
    expect(annotated).not.toBe(original);
    expect(annotated.code).toBe(SdkErrorCode.RequestTimeout);
    expect(annotated.cause).toBe(original);
    const data = annotated.data as AnnotatedRequestTimeoutData;
    expect(data.timeout).toBe(300);
    expect(data.method).toBe("ping");
    expect(data.diagnostics).toBe(diagnostics);
    // The rebuilt error still satisfies the predicate, so a consumer that
    // checks before and after this runs sees the same answer.
    expect(isRequestTimeoutError(annotated)).toBe(true);
  });

  it("returns anything that is not the per-request timeout untouched", () => {
    const plain = new Error("boom");
    expect(annotateRequestTimeout(plain, "ping", diagnostics)).toBe(plain);
    const abort = new SdkError(SdkErrorCode.RequestTimeout, "cancelled");
    expect(annotateRequestTimeout(abort, "ping", diagnostics)).toBe(abort);
    expect(annotateRequestTimeout(undefined, "ping", diagnostics)).toBe(
      undefined,
    );
  });

  it("reads cleanly when nothing else is known about the connection", () => {
    const annotated = annotateRequestTimeout(sdkTimeout(1000), "ping", {
      capturedAt: NOW,
      outstandingRequests: [],
    }) as SdkError;
    expect(annotated.message).toBe(
      "Request timed out after 1s (ping). No requests are unanswered. " +
        "No response has been received this session.",
    );
  });
});
