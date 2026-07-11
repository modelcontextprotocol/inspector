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

import {
  createAppBridgeFactory,
  HOST_CAPABILITIES,
} from "./createAppBridgeFactory";

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
      // hostContext is the full snapshot: theme (from the DOM attribute),
      // the inline display mode, and the host's available display modes.
      // styles/containerDimensions are omitted for the bare test iframe.
      expect(bridge.ctorArgs[3]).toMatchObject({
        hostContext: {
          theme: "dark",
          displayMode: "inline",
          availableDisplayModes: ["inline", "fullscreen"],
        },
      });
      expect(bridge.connect).toHaveBeenCalledTimes(1);
    } finally {
      document.documentElement.removeAttribute("data-mantine-color-scheme");
    }
  });

  it("on sandboxready, reads the UI resource, wraps the html with the per-app CSP, and echoes the approved sandbox config", async () => {
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

    expect(readResource).toHaveBeenCalledWith("ui://weather/app.html");
    // The html is wrapped in a host-authored shell whose first <head> child is
    // the CSP <meta>; the untrusted markup lands inside <body>. The per-app
    // connect-src the app requested is baked into the policy.
    const call = bridge.sendSandboxResourceReady.mock.calls[0][0] as {
      html: string;
      permissions: unknown;
      csp?: unknown;
    };
    expect(call.permissions).toEqual({ geolocation: {} });
    // csp is NOT sent inline — it is enforced via the wrapped <meta> and echoed
    // through hostCapabilities.sandbox instead.
    expect(call.csp).toBeUndefined();
    expect(call.html).toContain('http-equiv="Content-Security-Policy"');
    expect(call.html).toContain("connect-src https://api.example.com");
    expect(call.html).toContain("<body><h1>weather</h1></body>");

    // The approved (post-filter) csp + permissions are echoed on the bridge's
    // hostCapabilities so the view sees what was granted.
    const caps = bridge.ctorArgs[2] as {
      sandbox?: { permissions?: unknown; csp?: unknown };
    };
    expect(caps.sandbox).toEqual({
      permissions: { geolocation: {} },
      csp: { connectDomains: ["https://api.example.com"] },
    });
  });

  it("does not mutate the shared HOST_CAPABILITIES when echoing the approved sandbox", async () => {
    // The factory builds a per-app copy ({ ...HOST_CAPABILITIES }) so the
    // sandbox echo never leaks across apps/renders. Lock that in: after a
    // sandboxready run that sets hostCapabilities.sandbox, the shared constant
    // must stay untouched.
    const readResource = vi.fn().mockResolvedValue(
      uiResource("<h1>x</h1>", {
        csp: { connectDomains: ["https://api.example.com"] },
      }),
    );
    const factory = createAppBridgeFactory({
      getClient: () => fakeClient,
      readResource,
    });
    await factory(makeIframe(), tool);
    bridgeInstances[0].emit("sandboxready");
    await flush();
    expect(HOST_CAPABILITIES.sandbox).toBeUndefined();
  });

  it("drops an unsafe app-supplied CSP source before wrapping", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const readResource = vi.fn().mockResolvedValue(
      uiResource("<h1>x</h1>", {
        // The second source injects a directive terminator — it must be dropped.
        csp: {
          connectDomains: ["https://ok.example.com", "evil; script-src *"],
        },
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

    const call = bridge.sendSandboxResourceReady.mock.calls[0][0] as {
      html: string;
    };
    expect(call.html).toContain("connect-src https://ok.example.com;");
    expect(call.html).not.toContain("evil");
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
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

  it("reports a resources/read failure via onResourceError and console.error without rejecting", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const onResourceError = vi.fn();
    const readResource = vi.fn().mockRejectedValue(new Error("read boom"));
    const factory = createAppBridgeFactory({
      getClient: () => fakeClient,
      readResource,
      onResourceError,
    });
    await factory(makeIframe(), tool);
    const bridge = bridgeInstances[0];
    bridge.emit("sandboxready");
    await flush();
    expect(bridge.sendSandboxResourceReady).not.toHaveBeenCalled();
    expect(onResourceError).toHaveBeenCalledWith(
      expect.objectContaining({ message: "read boom" }),
    );
    expect(err).toHaveBeenCalled();
    err.mockRestore();
  });

  it("reports a UI resource that has no text content via onResourceError", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const onResourceError = vi.fn();
    const readResource = vi.fn().mockResolvedValue(uiResource(undefined));
    const factory = createAppBridgeFactory({
      getClient: () => fakeClient,
      readResource,
      onResourceError,
    });
    await factory(makeIframe(), tool);
    const bridge = bridgeInstances[0];
    bridge.emit("sandboxready");
    await flush();
    expect(bridge.sendSandboxResourceReady).not.toHaveBeenCalled();
    expect(onResourceError).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringContaining("no text"),
      }),
    );
    err.mockRestore();
  });

  it("wraps a non-Error rejection into an Error before reporting", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const onResourceError = vi.fn();
    const readResource = vi.fn().mockRejectedValue("plain string boom");
    const factory = createAppBridgeFactory({
      getClient: () => fakeClient,
      readResource,
      onResourceError,
    });
    await factory(makeIframe(), tool);
    const bridge = bridgeInstances[0];
    bridge.emit("sandboxready");
    await flush();
    expect(onResourceError).toHaveBeenCalledWith(
      expect.objectContaining({ message: "plain string boom" }),
    );
    expect(onResourceError.mock.calls[0][0]).toBeInstanceOf(Error);
    err.mockRestore();
  });

  it("does not throw on read failure when onResourceError is omitted", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
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
    expect(err).toHaveBeenCalled();
    err.mockRestore();
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
