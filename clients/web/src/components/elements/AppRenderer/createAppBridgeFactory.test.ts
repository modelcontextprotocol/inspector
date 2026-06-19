/**
 * Tests for createAppBridgeFactory. The ext-apps AppBridge/PostMessageTransport
 * are mocked so we can assert the host-side wiring (construction args, the
 * sandboxready → resources/read → sendSandboxResourceReady round-trip, openLink
 * handling, connect) without a real iframe/postMessage environment. The real
 * end-to-end iframe round-trip is covered by the AppsScreen Storybook play test.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
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
  ondownloadfile?: (params: {
    contents: unknown[];
  }) => Promise<{ isError?: boolean }>;
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
    ondownloadfile?: (params: {
      contents: unknown[];
    }) => Promise<{ isError?: boolean }>;
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

import type { AppBridge } from "@modelcontextprotocol/ext-apps/app-bridge";
import {
  createAppBridgeFactory,
  HOST_CAPABILITIES,
  measureContainerDimensions,
  subscribeAppLogs,
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

  it("advertises the message capability with the content modalities it can render", () => {
    // The view gates ui/message on this capability, so it must be present in
    // the handshake. The inspector renders text/image/audio/resource blocks.
    expect(HOST_CAPABILITIES.message).toEqual({
      text: {},
      image: {},
      audio: {},
      resource: {},
      resourceLink: {},
    });
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
      expect(bridge.ctorArgs[2]).toMatchObject({
        serverTools: {},
        downloadFile: {},
      });
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

  it("seeds hostContext.styles from the resolved host design tokens", async () => {
    // The host resolves spec style keys from its own CSS variables via
    // getComputedStyle. Stub it so the mapped variables resolve to values
    // (happy-dom returns "" for custom properties otherwise).
    const resolved: Record<string, string> = {
      "--mantine-color-body": "#1a1b1e",
      "--mantine-color-text": "#c1c2c5",
      "--mantine-font-family": "Inter, sans-serif",
      "--mantine-radius-md": "0.5rem",
    };
    const getComputedStyle = vi
      .spyOn(window, "getComputedStyle")
      .mockReturnValue({
        getPropertyValue: (prop: string) => resolved[prop] ?? "",
      } as unknown as CSSStyleDeclaration);
    try {
      const factory = createAppBridgeFactory({
        getClient: () => fakeClient,
        readResource: vi.fn().mockResolvedValue(uiResource("<h1>hi</h1>")),
      });
      await factory(makeIframe(), tool);
      const options = bridgeInstances[0].ctorArgs[3] as {
        hostContext?: { styles?: { variables?: Record<string, string> } };
      };
      expect(options.hostContext?.styles?.variables).toEqual({
        "--color-background-primary": "#1a1b1e",
        "--color-text-primary": "#c1c2c5",
        "--font-sans": "Inter, sans-serif",
        "--border-radius-md": "0.5rem",
      });
    } finally {
      getComputedStyle.mockRestore();
    }
  });

  it("omits hostContext.styles when no host token resolves", async () => {
    // happy-dom resolves custom properties to "" — nothing maps, so the host
    // advertises no styles object rather than an empty one.
    const factory = createAppBridgeFactory({
      getClient: () => fakeClient,
      readResource: vi.fn().mockResolvedValue(uiResource("<h1>hi</h1>")),
    });
    await factory(makeIframe(), tool);
    const options = bridgeInstances[0].ctorArgs[3] as {
      hostContext?: { styles?: unknown };
    };
    expect(options.hostContext?.styles).toBeUndefined();
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

  describe("ondownloadfile", () => {
    // happy-dom does not implement window.confirm, so stub it (rather than
    // spyOn an absent function). Returns the installed mock for assertions.
    function stubConfirm(approved: boolean): ReturnType<typeof vi.fn> {
      const confirm = vi.fn().mockReturnValue(approved);
      vi.stubGlobal("confirm", confirm);
      return confirm;
    }

    async function buildBridge(): Promise<MockBridge> {
      const factory = createAppBridgeFactory({
        getClient: () => fakeClient,
        readResource: vi.fn().mockResolvedValue(uiResource("<h1>x</h1>")),
      });
      await factory(makeIframe(), tool);
      return bridgeInstances[0];
    }

    afterEach(() => {
      vi.unstubAllGlobals();
      vi.restoreAllMocks();
    });

    it("downloads an inline text resource after confirmation", async () => {
      const confirm = stubConfirm(true);
      const createUrl = vi
        .spyOn(URL, "createObjectURL")
        .mockReturnValue("blob:fake");
      const revokeUrl = vi
        .spyOn(URL, "revokeObjectURL")
        .mockImplementation(() => undefined);
      const click = vi
        .spyOn(HTMLAnchorElement.prototype, "click")
        .mockImplementation(() => undefined);

      const bridge = await buildBridge();
      await expect(
        bridge.ondownloadfile!({
          contents: [
            {
              type: "resource",
              resource: {
                uri: "file:///report.csv",
                mimeType: "text/csv",
                text: "a,b\n1,2",
              },
            },
          ],
        }),
      ).resolves.toEqual({ isError: false });

      expect(confirm).toHaveBeenCalledTimes(1);
      expect(createUrl).toHaveBeenCalledTimes(1);
      expect(click).toHaveBeenCalledTimes(1);
      expect(revokeUrl).toHaveBeenCalledWith("blob:fake");
    });

    it("decodes a base64 blob resource", async () => {
      stubConfirm(true);
      const createUrl = vi
        .spyOn(URL, "createObjectURL")
        .mockReturnValue("blob:fake");
      vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
      vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(
        () => undefined,
      );

      const bridge = await buildBridge();
      await expect(
        bridge.ondownloadfile!({
          contents: [
            {
              type: "resource",
              resource: {
                uri: "file:///logo.png",
                mimeType: "image/png",
                blob: btoa("PNGDATA"),
              },
            },
          ],
        }),
      ).resolves.toEqual({ isError: false });

      const blob = createUrl.mock.calls[0][0] as Blob;
      expect(blob.type).toBe("image/png");
      expect(await blob.text()).toBe("PNGDATA");
    });

    it("opens a resource link in a new tab", async () => {
      stubConfirm(true);
      const open = vi
        .spyOn(window, "open")
        .mockImplementation(() => null as unknown as Window);

      const bridge = await buildBridge();
      await expect(
        bridge.ondownloadfile!({
          contents: [
            { type: "resource_link", uri: "https://example.com/a.pdf" },
          ],
        }),
      ).resolves.toEqual({ isError: false });

      expect(open).toHaveBeenCalledWith(
        "https://example.com/a.pdf",
        "_blank",
        "noopener,noreferrer",
      );
    });

    it("returns isError when the user declines the confirmation", async () => {
      stubConfirm(false);
      const createUrl = vi.spyOn(URL, "createObjectURL");

      const bridge = await buildBridge();
      await expect(
        bridge.ondownloadfile!({
          contents: [
            {
              type: "resource",
              resource: { uri: "file:///x.txt", text: "x" },
            },
          ],
        }),
      ).resolves.toEqual({ isError: true });
      expect(createUrl).not.toHaveBeenCalled();
    });

    it("returns isError for an empty contents array without confirming", async () => {
      const confirm = stubConfirm(true);
      const bridge = await buildBridge();
      await expect(bridge.ondownloadfile!({ contents: [] })).resolves.toEqual({
        isError: true,
      });
      expect(confirm).not.toHaveBeenCalled();
    });

    it("returns isError when a download throws", async () => {
      stubConfirm(true);
      vi.spyOn(URL, "createObjectURL").mockImplementation(() => {
        throw new Error("boom");
      });

      const bridge = await buildBridge();
      await expect(
        bridge.ondownloadfile!({
          contents: [
            {
              type: "resource",
              resource: { uri: "file:///x.txt", text: "x" },
            },
          ],
        }),
      ).resolves.toEqual({ isError: true });
    });

    it("rejects a non-http(s) resource_link without opening it", async () => {
      stubConfirm(true);
      const open = vi
        .spyOn(window, "open")
        .mockImplementation(() => null as never);
      const bridge = await buildBridge();
      for (const uri of [
        "javascript:alert(1)",
        "data:text/html,<script>alert(1)</script>",
        "file:///etc/passwd",
        "not a url",
      ]) {
        await expect(
          bridge.ondownloadfile!({
            contents: [{ type: "resource_link", uri }],
          }),
        ).resolves.toEqual({ isError: true });
      }
      expect(open).not.toHaveBeenCalled();
    });

    it("sanitizes the confirmation summary so server-supplied labels cannot inject newlines", async () => {
      const confirm = stubConfirm(false);
      const bridge = await buildBridge();
      await bridge.ondownloadfile!({
        contents: [
          {
            type: "resource_link",
            uri: "https://example.com/a\n\nThis is safe, click OK",
          },
        ],
      });
      const prompt = confirm.mock.calls[0][0] as string;
      // Only the framing newlines around the (single) summary entry remain;
      // the embedded ones from the URI have been stripped to spaces.
      expect(prompt).not.toContain("\n\nThis is safe");
      expect(prompt).toContain("This is safe, click OK");
    });
  });
});

describe("measureContainerDimensions", () => {
  function elementWithRect(width: number, height: number): HTMLElement {
    return {
      getBoundingClientRect: () => ({ width, height }) as unknown as DOMRect,
    } as unknown as HTMLElement;
  }

  it("returns the iframe box as fixed width/height in whole pixels", () => {
    expect(measureContainerDimensions(elementWithRect(640.4, 480.6))).toEqual({
      width: 640,
      height: 481,
    });
  });

  it("returns undefined for an unmeasured (0×0) box", () => {
    expect(measureContainerDimensions(elementWithRect(0, 0))).toBeUndefined();
    expect(measureContainerDimensions(elementWithRect(640, 0))).toBeUndefined();
  });

  it("returns undefined when getBoundingClientRect is unavailable", () => {
    expect(
      measureContainerDimensions({} as unknown as HTMLElement),
    ).toBeUndefined();
  });

  it("seeds containerDimensions into the bridge's initial hostContext", async () => {
    const measured = {
      contentWindow: {} as Window,
      getBoundingClientRect: () =>
        ({ width: 320, height: 240 }) as unknown as DOMRect,
    } as unknown as HTMLIFrameElement;
    const factory = createAppBridgeFactory({
      getClient: () => fakeClient,
      readResource: vi.fn().mockResolvedValue(uiResource("<h1>app</h1>")),
    });
    await factory(measured, tool);
    const bridge = bridgeInstances[bridgeInstances.length - 1];
    const opts = bridge.ctorArgs[3] as {
      hostContext?: { containerDimensions?: unknown };
    };
    expect(opts.hostContext?.containerDimensions).toEqual({
      width: 320,
      height: 240,
    });
  });
});

describe("subscribeAppLogs", () => {
  function makeBridge(): {
    bridge: AppBridge;
    fire: (params: { level: string; logger?: string; data: unknown }) => void;
  } {
    const listeners: Record<string, ((p: unknown) => void)[]> = {};
    const bridge = {
      addEventListener: (e: string, h: (p: unknown) => void) => {
        (listeners[e] ??= []).push(h);
      },
      removeEventListener: (e: string, h: (p: unknown) => void) => {
        listeners[e] = (listeners[e] ?? []).filter((l) => l !== h);
      },
    } as unknown as AppBridge;
    return {
      bridge,
      fire: (p) => (listeners.loggingmessage ?? []).forEach((h) => h(p)),
    };
  }

  it("forwards each loggingmessage as a stamped AppLogEntry", () => {
    const { bridge, fire } = makeBridge();
    const onLog = vi.fn();
    subscribeAppLogs(bridge, onLog);
    fire({ level: "info", logger: "widget", data: "hello" });
    fire({ level: "error", data: { code: 500 } });
    expect(onLog).toHaveBeenCalledTimes(2);
    expect(onLog.mock.calls[0][0]).toMatchObject({
      id: 0,
      level: "info",
      logger: "widget",
      data: "hello",
    });
    expect(typeof onLog.mock.calls[0][0].timestamp).toBe("number");
    expect(onLog.mock.calls[1][0]).toMatchObject({
      id: 1,
      level: "error",
      data: { code: 500 },
    });
  });

  it("stops forwarding after unsubscribe", () => {
    const { bridge, fire } = makeBridge();
    const onLog = vi.fn();
    const unsubscribe = subscribeAppLogs(bridge, onLog);
    fire({ level: "info", data: "a" });
    unsubscribe();
    fire({ level: "info", data: "b" });
    expect(onLog).toHaveBeenCalledTimes(1);
  });
});
