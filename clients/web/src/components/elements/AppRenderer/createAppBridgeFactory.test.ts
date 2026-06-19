/**
 * Tests for createAppBridgeFactory. The ext-apps AppBridge/PostMessageTransport
 * are mocked so we can assert the host-side wiring (construction args, the
 * sandboxready → resources/read → sendSandboxResourceReady round-trip, openLink
 * handling, connect) without a real iframe/postMessage environment. The real
 * end-to-end iframe round-trip is covered by the AppsScreen Storybook play test.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type {
  Tool,
  ReadResourceResult,
} from "@modelcontextprotocol/sdk/types.js";
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";

// --- ext-apps mock -------------------------------------------------------
const bridgeInstances: MockBridge[] = [];

interface MockBridge {
  ctorArgs: unknown[];
  listeners: Record<string, ((p: unknown) => void)[]>;
  addEventListener: ReturnType<typeof vi.fn>;
  sendSandboxResourceReady: ReturnType<typeof vi.fn>;
  connect: ReturnType<typeof vi.fn>;
  onopenlink?: (params: { url: string }) => Promise<{ isError?: boolean }>;
  emit: (event: string, payload?: unknown) => void;
}

vi.mock("@modelcontextprotocol/ext-apps/app-bridge", () => {
  class AppBridge {
    ctorArgs: unknown[];
    listeners: Record<string, ((p: unknown) => void)[]> = {};
    addEventListener = vi.fn((event: string, handler: (p: unknown) => void) => {
      (this.listeners[event] ??= []).push(handler);
    });
    sendSandboxResourceReady = vi.fn().mockResolvedValue(undefined);
    connect = vi.fn().mockResolvedValue(undefined);
    onopenlink?: (params: { url: string }) => Promise<{ isError?: boolean }>;
    emit = (event: string, payload?: unknown) => {
      (this.listeners[event] ?? []).forEach((h) => h(payload));
    };
    constructor(...args: unknown[]) {
      this.ctorArgs = args;
      bridgeInstances.push(this as unknown as MockBridge);
    }
  }
  class PostMessageTransport {
    target: unknown;
    source: unknown;
    constructor(target: unknown, source: unknown) {
      this.target = target;
      this.source = source;
    }
  }
  return {
    AppBridge,
    PostMessageTransport,
    getToolUiResourceUri: (tool: Partial<Tool>) =>
      (tool._meta as { ui?: { resourceUri?: string } } | undefined)?.ui
        ?.resourceUri,
  };
});

import { createAppBridgeFactory } from "./createAppBridgeFactory";

const tool: Tool = {
  name: "weather_app",
  inputSchema: { type: "object" },
  _meta: { ui: { resourceUri: "ui://weather/app.html" } },
};

function makeIframe(hasWindow = true): HTMLIFrameElement {
  return {
    contentWindow: hasWindow ? ({} as Window) : null,
  } as unknown as HTMLIFrameElement;
}

const fakeClient = { name: "sdk-client" } as unknown as Client;

function uiResource(
  text: string | undefined,
  meta?: Record<string, unknown>,
): ReadResourceResult {
  return {
    contents: [
      {
        uri: "ui://weather/app.html",
        ...(text === undefined ? {} : { text }),
        ...(meta ? { _meta: meta } : {}),
      },
    ],
  } as ReadResourceResult;
}

async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe("createAppBridgeFactory", () => {
  beforeEach(() => {
    bridgeInstances.length = 0;
  });

  it("throws when no client is connected", async () => {
    const factory = createAppBridgeFactory({
      getClient: () => null,
      readResource: vi.fn(),
    });
    await expect(factory(makeIframe(), tool)).rejects.toThrow(
      /no connected MCP client/,
    );
  });

  it("throws when the iframe has no contentWindow", async () => {
    const factory = createAppBridgeFactory({
      getClient: () => fakeClient,
      readResource: vi.fn(),
    });
    await expect(factory(makeIframe(false), tool)).rejects.toThrow(/no window/);
  });

  it("constructs the bridge with the client, host info, capabilities and theme, then connects", async () => {
    // Theme is read from the DOM (Mantine's resolved color-scheme attribute).
    document.documentElement.setAttribute("data-mantine-color-scheme", "dark");
    try {
      const factory = createAppBridgeFactory({
        getClient: () => fakeClient,
        readResource: vi.fn().mockResolvedValue(uiResource("<h1>hi</h1>")),
      });
      await factory(makeIframe(), tool);
      expect(bridgeInstances).toHaveLength(1);
      const bridge = bridgeInstances[0];
      expect(bridge.ctorArgs[0]).toBe(fakeClient);
      expect(bridge.ctorArgs[1]).toMatchObject({ name: "MCP Inspector" });
      expect(bridge.ctorArgs[2]).toMatchObject({ serverTools: {} });
      expect(bridge.ctorArgs[3]).toEqual({ hostContext: { theme: "dark" } });
      expect(bridge.connect).toHaveBeenCalledTimes(1);
    } finally {
      document.documentElement.removeAttribute("data-mantine-color-scheme");
    }
  });

  it("on sandboxready, reads the UI resource and pushes html + meta to the sandbox", async () => {
    const readResource = vi.fn().mockResolvedValue(
      uiResource("<h1>weather</h1>", {
        permissions: { geolocation: {} },
        csp: { connectSrc: ["https://api.example.com"] },
      }),
    );
    const factory = createAppBridgeFactory({
      getClient: () => fakeClient,
      readResource,
    });
    await factory(makeIframe(), tool);
    const bridge = bridgeInstances[0];

    bridge.emit("sandboxready");
    await flush();

    expect(readResource).toHaveBeenCalledWith("ui://weather/app.html");
    expect(bridge.sendSandboxResourceReady).toHaveBeenCalledWith({
      html: "<h1>weather</h1>",
      permissions: { geolocation: {} },
      csp: { connectSrc: ["https://api.example.com"] },
    });
  });

  it("echoes the approved csp + permissions in hostCapabilities after sandboxready", async () => {
    const readResource = vi.fn().mockResolvedValue(
      uiResource("<h1>weather</h1>", {
        permissions: { geolocation: {} },
        csp: { connectDomains: ["https://api.example.com"] },
      }),
    );
    const factory = createAppBridgeFactory({
      getClient: () => fakeClient,
      readResource,
    });
    await factory(makeIframe(), tool);
    const bridge = bridgeInstances[0];

    bridge.emit("sandboxready");
    await flush();

    // The capabilities object passed to the bridge constructor is mutated in
    // place, so the ui/initialize handshake (which reads it lazily) echoes the
    // approved sandbox config back to the view.
    expect(bridge.ctorArgs[2]).toMatchObject({
      sandbox: {
        permissions: { geolocation: {} },
        csp: { connectDomains: ["https://api.example.com"] },
      },
    });
  });

  it("advertises an empty csp object when the resource declares no csp", async () => {
    const factory = createAppBridgeFactory({
      getClient: () => fakeClient,
      readResource: vi.fn().mockResolvedValue(uiResource("<h1>hi</h1>")),
    });
    await factory(makeIframe(), tool);
    const bridge = bridgeInstances[0];

    bridge.emit("sandboxready");
    await flush();

    const sandbox = (
      bridge.ctorArgs[2] as {
        sandbox?: { csp?: unknown; permissions?: unknown };
      }
    ).sandbox;
    expect(sandbox?.csp).toEqual({});
    expect(sandbox?.permissions).toBeUndefined();
  });

  it("does not echo a sandbox capability before sandboxready or on read failure", async () => {
    const factory = createAppBridgeFactory({
      getClient: () => fakeClient,
      readResource: vi.fn().mockRejectedValue(new Error("read boom")),
    });
    await factory(makeIframe(), tool);
    const bridge = bridgeInstances[0];

    // Nothing read yet → no sandbox echo.
    expect(
      (bridge.ctorArgs[2] as { sandbox?: unknown }).sandbox,
    ).toBeUndefined();

    bridge.emit("sandboxready");
    await flush();

    // Read failed → still no sandbox echo.
    expect(
      (bridge.ctorArgs[2] as { sandbox?: unknown }).sandbox,
    ).toBeUndefined();
  });

  it("does not push when the tool has no UI resource uri", async () => {
    const readResource = vi.fn();
    const factory = createAppBridgeFactory({
      getClient: () => fakeClient,
      readResource,
    });
    await factory(makeIframe(), {
      name: "plain",
      inputSchema: { type: "object" },
    });
    bridgeInstances[0].emit("sandboxready");
    await flush();
    expect(readResource).not.toHaveBeenCalled();
    expect(bridgeInstances[0].sendSandboxResourceReady).not.toHaveBeenCalled();
  });

  it("swallows a resources/read failure without rejecting", async () => {
    const readResource = vi.fn().mockRejectedValue(new Error("read boom"));
    const factory = createAppBridgeFactory({
      getClient: () => fakeClient,
      readResource,
    });
    await factory(makeIframe(), tool);
    const bridge = bridgeInstances[0];
    bridge.emit("sandboxready");
    await flush();
    expect(bridge.sendSandboxResourceReady).not.toHaveBeenCalled();
  });

  it("swallows a UI resource that has no text content", async () => {
    const readResource = vi.fn().mockResolvedValue(uiResource(undefined));
    const factory = createAppBridgeFactory({
      getClient: () => fakeClient,
      readResource,
    });
    await factory(makeIframe(), tool);
    const bridge = bridgeInstances[0];
    bridge.emit("sandboxready");
    await flush();
    expect(bridge.sendSandboxResourceReady).not.toHaveBeenCalled();
  });

  it("opens http(s) links in a new tab and reports non-http as error", async () => {
    const open = vi
      .spyOn(window, "open")
      .mockImplementation(() => null as unknown as Window);
    const factory = createAppBridgeFactory({
      getClient: () => fakeClient,
      readResource: vi.fn().mockResolvedValue(uiResource("<h1>x</h1>")),
    });
    await factory(makeIframe(), tool);
    const bridge = bridgeInstances[0];

    await expect(
      bridge.onopenlink!({ url: "https://example.com" }),
    ).resolves.toEqual({ isError: false });
    expect(open).toHaveBeenCalledWith(
      "https://example.com",
      "_blank",
      "noopener,noreferrer",
    );

    await expect(
      bridge.onopenlink!({ url: "javascript:alert(1)" }),
    ).resolves.toEqual({ isError: true });

    open.mockRestore();
  });
});
