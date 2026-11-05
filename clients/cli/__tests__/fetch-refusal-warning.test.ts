import { describe, it, expect, vi, afterEach } from "vitest";
import {
  warnOnFetchRefusals,
  writeFetchRefusalWarning,
} from "@inspector/core/cli/fetchRefusalWarning.js";
import { InspectorClientEventTarget } from "@inspector/core/mcp/inspectorClientEventTarget.js";

const REFUSAL = {
  url: "http://169.254.169.254/.well-known/oauth-authorization-server",
  reason:
    "Refusing to fetch from a link-local or metadata address (169.254.169.254)",
};
const LINE = `Warning: Refused to fetch ${REFUSAL.url}: ${REFUSAL.reason}\n`;

afterEach(() => {
  vi.restoreAllMocks();
});

describe("writeFetchRefusalWarning (#2846)", () => {
  it("writes one Warning line to the sink", () => {
    const sink = vi.fn();
    writeFetchRefusalWarning(REFUSAL, sink);
    expect(sink).toHaveBeenCalledWith(LINE);
  });

  it("writes to stderr by default", () => {
    const write = vi
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);
    writeFetchRefusalWarning(REFUSAL);
    expect(write).toHaveBeenCalledWith(LINE);
  });
});

describe("warnOnFetchRefusals (#2846)", () => {
  it("prints each refusal the client reports, until unsubscribed", () => {
    // The client's own event target: the helper only subscribes to it.
    const target = new InspectorClientEventTarget();
    const sink = vi.fn();
    const stop = warnOnFetchRefusals(target, sink);

    target.dispatchTypedEvent("fetchRefused", REFUSAL);
    expect(sink).toHaveBeenCalledWith(LINE);

    stop();
    target.dispatchTypedEvent("fetchRefused", REFUSAL);
    expect(sink).toHaveBeenCalledTimes(1);
  });
});
