import { describe, it, expect, vi } from "vitest";
import type { AppBridge } from "@modelcontextprotocol/ext-apps/app-bridge";
import type { JSONRPCMessage, Transport } from "@modelcontextprotocol/client";
import {
  appAdvertisesElicitation,
  observeAppCapabilities,
} from "./appCapabilities";

function makeBridge(parsed?: Record<string, unknown>): AppBridge {
  return { getAppCapabilities: () => parsed } as unknown as AppBridge;
}

function makeTransport(): {
  transport: Transport;
  inner: ReturnType<typeof vi.fn>;
} {
  const inner = vi.fn();
  const transport = { onmessage: inner } as unknown as Transport;
  return { transport, inner };
}

function initializeFrame(appCapabilities: unknown): JSONRPCMessage {
  return {
    jsonrpc: "2.0",
    id: 1,
    method: "ui/initialize",
    params: { appCapabilities },
  } as unknown as JSONRPCMessage;
}

describe("appCapabilities (#1854)", () => {
  it("records the raw ui/initialize capabilities the bridge's schema strips", () => {
    // The whole reason this module exists: ext-apps 1.7.5 parses away the
    // `elicitation` key, so an app that DID advertise it reads as one that did
    // not — and every negotiated elicitation silently becomes a fallback.
    const bridge = makeBridge({});
    const { transport, inner } = makeTransport();
    observeAppCapabilities(bridge, transport);

    expect(appAdvertisesElicitation(bridge)).toBe(false);
    transport.onmessage?.(initializeFrame({ elicitation: {} }));
    expect(appAdvertisesElicitation(bridge)).toBe(true);
    // The bridge's own handler still runs — observing must not swallow.
    expect(inner).toHaveBeenCalledTimes(1);
  });

  it("prefers the bridge's own value once ext-apps carries it", () => {
    const bridge = makeBridge({ elicitation: {} });
    expect(appAdvertisesElicitation(bridge)).toBe(true);
  });

  it("is false for an app that advertised no elicitation", () => {
    const bridge = makeBridge({ availableDisplayModes: ["inline"] });
    const { transport } = makeTransport();
    observeAppCapabilities(bridge, transport);
    transport.onmessage?.(initializeFrame({ availableDisplayModes: [] }));
    expect(appAdvertisesElicitation(bridge)).toBe(false);
  });

  it("ignores other methods and non-object capabilities", () => {
    const bridge = makeBridge(undefined);
    const { transport } = makeTransport();
    observeAppCapabilities(bridge, transport);
    transport.onmessage?.({
      jsonrpc: "2.0",
      method: "ui/notifications/initialized",
    } as JSONRPCMessage);
    transport.onmessage?.(initializeFrame("not-an-object"));
    transport.onmessage?.(initializeFrame(null));
    expect(appAdvertisesElicitation(bridge)).toBe(false);
  });

  it("keeps bridges independent", () => {
    const a = makeBridge({});
    const b = makeBridge({});
    const first = makeTransport();
    const second = makeTransport();
    observeAppCapabilities(a, first.transport);
    observeAppCapabilities(b, second.transport);
    first.transport.onmessage?.(initializeFrame({ elicitation: {} }));
    expect(appAdvertisesElicitation(a)).toBe(true);
    expect(appAdvertisesElicitation(b)).toBe(false);
  });

  it("tolerates a transport with no prior handler", () => {
    const bridge = makeBridge({});
    const transport = {} as unknown as Transport;
    observeAppCapabilities(bridge, transport);
    expect(() =>
      transport.onmessage?.(initializeFrame({ elicitation: {} })),
    ).not.toThrow();
    expect(appAdvertisesElicitation(bridge)).toBe(true);
  });
});
