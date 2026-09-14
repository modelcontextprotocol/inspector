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

function initializeFrame(
  appCapabilities: unknown,
  overrides: Record<string, unknown> = {},
): JSONRPCMessage {
  return {
    jsonrpc: "2.0",
    id: 1,
    method: "ui/initialize",
    params: {
      protocolVersion: "2026-01-26",
      appInfo: { name: "test-app", version: "1.0.0" },
      appCapabilities,
      ...overrides,
    },
  } as unknown as JSONRPCMessage;
}

describe("appCapabilities (#1854)", () => {
  it("records the raw ui/initialize capabilities the bridge's schema strips", () => {
    // The whole reason this module exists: ext-apps 2.0.0 parses away the
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

  it("is false when the bridge advertises nothing at all", () => {
    expect(appAdvertisesElicitation(makeBridge(undefined))).toBe(false);
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

  it("ignores frames that are not shaped like ui/initialize at all", () => {
    // The frame comes from sandboxed view code, so nothing about its shape is
    // guaranteed — a non-object, or an initialize with no params, must not
    // throw on the way through to the bridge's own handler.
    const bridge = makeBridge({});
    const { transport, inner } = makeTransport();
    observeAppCapabilities(bridge, transport);
    transport.onmessage?.("not-a-frame" as unknown as JSONRPCMessage);
    transport.onmessage?.(null as unknown as JSONRPCMessage);
    transport.onmessage?.({
      jsonrpc: "2.0",
      id: 1,
      method: "ui/initialize",
    } as unknown as JSONRPCMessage);
    transport.onmessage?.({
      jsonrpc: "2.0",
      id: 2,
      method: "ui/initialize",
      params: null,
    } as unknown as JSONRPCMessage);
    expect(appAdvertisesElicitation(bridge)).toBe(false);
    expect(inner).toHaveBeenCalledTimes(4);
  });

  it("ignores a malformed initialize the bridge would reject", () => {
    // Fail-closed: accepting one would let a view flip `elicitation` on with a
    // frame that never negotiated anything, and the host would then forward a
    // request the bridge does not consider negotiated.
    const bridge = makeBridge({});
    const { transport } = makeTransport();
    observeAppCapabilities(bridge, transport);

    // No protocolVersion.
    transport.onmessage?.({
      jsonrpc: "2.0",
      id: 1,
      method: "ui/initialize",
      params: { appInfo: { name: "a" }, appCapabilities: { elicitation: {} } },
    } as unknown as JSONRPCMessage);
    // No appInfo.
    transport.onmessage?.({
      jsonrpc: "2.0",
      id: 2,
      method: "ui/initialize",
      params: {
        protocolVersion: "2026-01-26",
        appCapabilities: { elicitation: {} },
      },
    } as unknown as JSONRPCMessage);
    // A notification, not the handshake request.
    transport.onmessage?.({
      jsonrpc: "2.0",
      method: "ui/initialize",
      params: {
        protocolVersion: "2026-01-26",
        appInfo: { name: "a" },
        appCapabilities: { elicitation: {} },
      },
    } as unknown as JSONRPCMessage);

    expect(appAdvertisesElicitation(bridge)).toBe(false);
  });

  it("takes the latest accepted handshake, in both directions", () => {
    // Verified against ext-apps 2.0.0: a second `ui/initialize` is accepted —
    // the bridge warns about the double-mount and the latest appInfo and
    // capabilities REPLACE the previous ones. Freezing this at the first frame
    // would leave the gate reporting capabilities the bridge no longer holds.
    const bridge = makeBridge({});
    const { transport } = makeTransport();
    observeAppCapabilities(bridge, transport);

    transport.onmessage?.(initializeFrame({ availableDisplayModes: [] }));
    expect(appAdvertisesElicitation(bridge)).toBe(false);
    transport.onmessage?.(initializeFrame({ elicitation: {} }));
    expect(appAdvertisesElicitation(bridge)).toBe(true);
    // …and a re-handshake that drops the capability turns it back off.
    transport.onmessage?.(initializeFrame({}));
    expect(appAdvertisesElicitation(bridge)).toBe(false);
  });

  it("leaves a recorded capability alone when a later frame is malformed", () => {
    // A rejected frame is not a route to changing the gate — in either
    // direction: it cannot set `elicitation`, and it cannot clear one the
    // bridge still holds.
    const bridge = makeBridge({});
    const { transport } = makeTransport();
    observeAppCapabilities(bridge, transport);
    transport.onmessage?.(initializeFrame({ elicitation: {} }));
    transport.onmessage?.({
      jsonrpc: "2.0",
      id: 9,
      method: "ui/initialize",
      params: { appCapabilities: {} },
    } as unknown as JSONRPCMessage);
    expect(appAdvertisesElicitation(bridge)).toBe(true);
  });

  it("rejects a frame the bridge's own schema rejects", () => {
    // `appInfo: {}` is missing the implementation name/version that
    // `McpUiInitializeRequestSchema` requires, so the bridge answers an error
    // and stores nothing — this gate must not be the laxer of the two.
    const bridge = makeBridge({});
    const { transport } = makeTransport();
    observeAppCapabilities(bridge, transport);
    transport.onmessage?.({
      jsonrpc: "2.0",
      id: 1,
      method: "ui/initialize",
      params: {
        protocolVersion: "2026-01-26",
        appInfo: {},
        appCapabilities: { elicitation: {} },
      },
    } as unknown as JSONRPCMessage);
    expect(appAdvertisesElicitation(bridge)).toBe(false);
  });

  it("does not treat a non-object elicitation value as an advertisement", () => {
    // The draft declares `elicitation` as an object; `true` is a value it does
    // not define, and truthiness would accept it.
    const bridge = makeBridge({});
    const { transport } = makeTransport();
    observeAppCapabilities(bridge, transport);
    transport.onmessage?.(initializeFrame({ elicitation: true }));
    expect(appAdvertisesElicitation(bridge)).toBe(false);
    transport.onmessage?.(initializeFrame({ elicitation: [] }));
    expect(appAdvertisesElicitation(bridge)).toBe(false);
    transport.onmessage?.(initializeFrame({ elicitation: {} }));
    expect(appAdvertisesElicitation(bridge)).toBe(true);
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
