import { describe, it, expect, vi } from "vitest";
import type { AppBridge } from "@modelcontextprotocol/ext-apps/app-bridge";
import type { ElicitRequest } from "@modelcontextprotocol/client";
import {
  APP_ELICITATION_TIMEOUT_MS,
  requestAppElicitation,
} from "./requestAppElicitation";

const params: ElicitRequest["params"] = {
  message: "Choose an option",
  requestedSchema: {
    type: "object",
    properties: { choice: { type: "string" } },
    required: ["choice"],
  },
};

function makeBridge(options: {
  appCapabilities?: Record<string, unknown>;
  request?: ReturnType<typeof vi.fn>;
}) {
  return {
    getAppCapabilities: () => options.appCapabilities,
    request: options.request ?? vi.fn(),
  } as unknown as AppBridge;
}

describe("requestAppElicitation (#1854)", () => {
  it("sends the standard method and params through the given bridge", async () => {
    const request = vi
      .fn()
      .mockResolvedValue({ action: "accept", content: { choice: "option-a" } });
    const bridge = makeBridge({
      appCapabilities: { elicitation: {} },
      request,
    });

    await expect(requestAppElicitation(bridge, params)).resolves.toEqual({
      action: "accept",
      content: { choice: "option-a" },
    });
    // The method and params must reach the app UNCHANGED — the whole contract
    // is that no custom method or result shape is introduced.
    const [sent, , options] = request.mock.calls[0];
    expect(sent).toEqual({ method: "elicitation/create", params });
    expect(options).toEqual({ timeout: APP_ELICITATION_TIMEOUT_MS });
  });

  it("honors a caller-supplied timeout", async () => {
    const request = vi.fn().mockResolvedValue({ action: "cancel" });
    const bridge = makeBridge({
      appCapabilities: { elicitation: {} },
      request,
    });
    await requestAppElicitation(bridge, params, 1234);
    expect(request.mock.calls[0][2]).toEqual({ timeout: 1234 });
  });

  it("fails closed when the app did not advertise elicitation", async () => {
    const request = vi.fn();
    const bridge = makeBridge({ appCapabilities: {}, request });
    await expect(requestAppElicitation(bridge, params)).rejects.toThrow(
      /does not support elicitation/,
    );
    // Not merely "returns an error" — nothing is sent at all, so a wedged app
    // cannot hold the server's request open for the full timeout.
    expect(request).not.toHaveBeenCalled();
  });

  it("fails closed when the app advertised nothing at all", async () => {
    await expect(requestAppElicitation(makeBridge({}), params)).rejects.toThrow(
      /does not support elicitation/,
    );
  });

  it("propagates a bridge failure so the caller can fall back", async () => {
    const bridge = makeBridge({
      appCapabilities: { elicitation: {} },
      request: vi.fn().mockRejectedValue(new Error("transport closed")),
    });
    await expect(requestAppElicitation(bridge, params)).rejects.toThrow(
      /transport closed/,
    );
  });

  it("keeps the answer timeout far above the SDK's request default", () => {
    // The thing being waited on is a person, not a server. 60s (the SDK
    // default) would abandon a user who paused to think.
    expect(APP_ELICITATION_TIMEOUT_MS).toBeGreaterThan(60_000);
  });
});
