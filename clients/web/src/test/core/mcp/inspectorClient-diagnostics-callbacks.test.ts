import { describe, it, expect } from "vitest";
import { SdkError, SdkErrorCode } from "@modelcontextprotocol/client";
import type { JSONRPCRequest } from "@modelcontextprotocol/client";
import { InspectorClient } from "@inspector/core/mcp/inspectorClient.js";
import type { MessageTrackingCallbacks } from "@inspector/core/mcp/messageTrackingTransport.js";

/**
 * The outstanding-request bookkeeping behind the connection diagnostics
 * (#2318), driven through the message-tracking callbacks the client hands its
 * transport — the same seam the transport uses, without a connection.
 */
describe("InspectorClient diagnostics tracking callbacks", () => {
  interface Internals {
    createMessageTrackingCallbacks: () => MessageTrackingCallbacks;
  }

  function makeClient(): {
    client: InspectorClient;
    callbacks: MessageTrackingCallbacks;
  } {
    const client = new InspectorClient(
      { type: "stdio", command: "noop", args: [] },
      // Never connects; the callbacks are exercised directly.
      { environment: { transport: () => ({}) as never } },
    );
    // `createMessageTrackingCallbacks` is private: it is the seam the client
    // hands its transport, and driving it directly is what lets this test
    // exercise the bookkeeping without a connection. The double cast is the
    // documented test-only exception for reaching a private member — the
    // same one `inspectorClient-raw-wire.test.ts` uses — and `Internals`
    // names exactly the one method it reaches.
    const callbacks = (
      client as unknown as Internals
    ).createMessageTrackingCallbacks();
    return { client, callbacks };
  }

  const request = (id: number): JSONRPCRequest => ({
    jsonrpc: "2.0",
    id,
    method: "tools/list",
  });

  const outstandingIds = (client: InspectorClient) =>
    client.getConnectionDiagnostics().outstandingRequests.map((r) => r.id);

  it("rolls a request back when its send failed before reaching the wire", () => {
    const { client, callbacks } = makeClient();
    callbacks.trackRequest!(request(1), "client");
    expect(outstandingIds(client)).toEqual([1]);
    callbacks.trackSendFailure!(request(1), new Error("connection closed"));
    expect(outstandingIds(client)).toEqual([]);
  });

  it("keeps a request whose send failed with a request timeout", () => {
    // The browser's remote transport awaits the response inside `send`, so
    // its relay timeout surfaces as a send failure — the request reached the
    // server and is still unanswered.
    const { client, callbacks } = makeClient();
    callbacks.trackRequest!(request(1), "client");
    callbacks.trackSendFailure!(
      request(1),
      new SdkError(SdkErrorCode.RequestTimeout, "Request timed out", {
        timeout: 60_000,
      }),
    );
    expect(outstandingIds(client)).toEqual([1]);
  });

  it("reports a failed send so the request's log entry resolves (#2721)", () => {
    const { client, callbacks } = makeClient();
    const failed: { id: string | number; reason: string }[] = [];
    client.addEventListener("requestFailed", (e) => failed.push(e.detail));
    callbacks.trackRequest!(request(3), "client");
    callbacks.trackSendFailure!(
      request(3),
      Object.assign(new Error("Error POSTing to endpoint: Forbidden"), {
        status: 403,
        statusText: "Forbidden",
      }),
    );
    expect(failed).toEqual([
      {
        id: 3,
        reason: "HTTP 403 Forbidden: Error POSTing to endpoint: Forbidden",
      },
    ]);
  });

  it("does not report a request timeout as a failed send", () => {
    const { client, callbacks } = makeClient();
    let failed = 0;
    client.addEventListener("requestFailed", () => {
      failed += 1;
    });
    callbacks.trackRequest!(request(4), "client");
    callbacks.trackSendFailure!(
      request(4),
      new SdkError(SdkErrorCode.RequestTimeout, "Request timed out", {
        timeout: 60_000,
      }),
    );
    expect(failed).toBe(0);
  });

  it("only tracks client-originated requests, and ignores a rollback for an unknown id", () => {
    const { client, callbacks } = makeClient();
    callbacks.trackRequest!(request(7), "server");
    expect(outstandingIds(client)).toEqual([]);
    let changes = 0;
    client.addEventListener("connectionDiagnosticsChange", () => {
      changes += 1;
    });
    callbacks.trackSendFailure!(request(7), new Error("nope"));
    expect(changes).toBe(0);
  });
});
