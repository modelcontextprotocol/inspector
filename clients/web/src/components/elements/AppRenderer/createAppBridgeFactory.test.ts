/**
 * Tests for createAppBridgeFactory. The ext-apps AppBridge/PostMessageTransport
 * are mocked so we can assert the host-side wiring (construction args, the
 * sandboxready → resources/read → sendSandboxResourceReady round-trip, openLink
 * handling, connect) without a real iframe/postMessage environment. The real
 * end-to-end iframe round-trip is covered by the AppsScreen Storybook play test.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Tool, ReadResourceResult } from "@modelcontextprotocol/client";
import type { Client } from "@modelcontextprotocol/client";

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
    contents: (
      | { type: "resource"; resource: Record<string, unknown> }
      | { type: "resource_link"; uri: string }
    )[];
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

/**
 * A UI resource read result. `meta` is the MCP Apps sandbox metadata, which the
 * spec nests under the `_meta` bag's `ui` key — the helper wraps it so every
 * test drives the real wire shape. `opts.at` places the bag on the result
 * envelope (`McpUiReadResourceResult`) instead of the content item, and
 * `opts.flat` writes it unnested (the non-conforming shape the host ignores).
 */
function uiResource(
  text: string | undefined,
  meta?: Record<string, unknown>,
  opts: { at?: "content" | "result"; flat?: boolean } = {},
): ReadResourceResult {
  const bag = meta ? { _meta: opts.flat ? meta : { ui: meta } } : {};
  const onResult = opts.at === "result";
  return {
    ...(onResult ? bag : {}),
    contents: [
      {
        uri: "ui://weather/app.html",
        ...(text === undefined ? {} : { text }),
        ...(onResult ? {} : bag),
      },
    ],
  } as ReadResourceResult;
}

/** The `_meta` of a `resources/list` entry, as `getListedResourceMeta` returns it. */
function listedMeta(meta: Record<string, unknown>): { ui: unknown } {
  return { ui: meta };
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
    await expect(factory(makeIframe(), { kind: "tool", tool })).rejects.toThrow(
      /no connected MCP client/,
    );
  });

  it("throws when the iframe has no contentWindow", async () => {
    const factory = createAppBridgeFactory({
      getClient: () => fakeClient,
      readResource: vi.fn(),
    });
    await expect(
      factory(makeIframe(false), { kind: "tool", tool }),
    ).rejects.toThrow(/no window/);
  });

  it("constructs the bridge with the client, host info, capabilities and theme, then connects", async () => {
    // Theme is read from the DOM (Mantine's resolved color-scheme attribute).
    document.documentElement.setAttribute("data-mantine-color-scheme", "dark");
    try {
      const factory = createAppBridgeFactory({
        getClient: () => fakeClient,
        readResource: vi.fn().mockResolvedValue(uiResource("<h1>hi</h1>")),
      });
      await factory(makeIframe(), { kind: "tool", tool });
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

  it("does not advertise hostCapabilities.elicitation by default (#1854)", async () => {
    // An App-tool frame is never handed an elicitation, so claiming the host
    // capability there would tell those apps something untrue about the host.
    const factory = createAppBridgeFactory({
      getClient: () => fakeClient,
      readResource: vi.fn(),
    });
    await factory(makeIframe(), { kind: "tool", tool });
    expect(bridgeInstances[0].ctorArgs[2]).not.toHaveProperty("elicitation");
  });

  it("advertises hostCapabilities.elicitation when opted in (#1854)", async () => {
    // The value reaches the AppBridge CONSTRUCTOR, which is what the bridge
    // echoes in its `ui/initialize` response — an app reads it there to decide
    // whether this host will forward an elicitation to it at all.
    const factory = createAppBridgeFactory({
      advertiseElicitation: true,
      getClient: () => fakeClient,
      readResource: vi.fn(),
    });
    await factory(makeIframe(), {
      kind: "resource",
      resourceUri: "ui://demo/pick.html",
    });
    expect(bridgeInstances[0].ctorArgs[2]).toMatchObject({ elicitation: {} });
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
    await factory(makeIframe(), { kind: "tool", tool });
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

  it("falls back to the read result's _meta.ui when the content item carries none", async () => {
    // `McpUiReadResourceResult` — what a registerAppResource callback returns —
    // types `_meta.ui` at the envelope level, so a server stamping it there
    // must have it honored.
    const readResource = vi.fn().mockResolvedValue(
      uiResource(
        "<h1>x</h1>",
        {
          permissions: { microphone: {} },
          csp: { connectDomains: ["https://envelope.example.com"] },
        },
        { at: "result" },
      ),
    );
    const factory = createAppBridgeFactory({
      getClient: () => fakeClient,
      readResource,
    });
    await factory(makeIframe(), { kind: "tool", tool });
    const bridge = bridgeInstances[0];
    bridge.emit("sandboxready");
    await flush();

    const call = bridge.sendSandboxResourceReady.mock.calls[0][0] as {
      html: string;
      permissions: unknown;
    };
    expect(call.permissions).toEqual({ microphone: {} });
    expect(call.html).toContain("connect-src https://envelope.example.com");
  });

  it("prefers the read result's _meta.ui over the listing entry's", async () => {
    // Precedence runs most-specific first: content item, then the result
    // envelope, then the listing default.
    const readResource = vi
      .fn()
      .mockResolvedValue(
        uiResource(
          "<h1>x</h1>",
          { csp: { connectDomains: ["https://envelope.example.com"] } },
          { at: "result" },
        ),
      );
    const factory = createAppBridgeFactory({
      getClient: () => fakeClient,
      readResource,
      getListedResourceMeta: () =>
        listedMeta({ csp: { connectDomains: ["https://listed.example.com"] } }),
    });
    await factory(makeIframe(), { kind: "tool", tool });
    const bridge = bridgeInstances[0];
    bridge.emit("sandboxready");
    await flush();

    const call = bridge.sendSandboxResourceReady.mock.calls[0][0] as {
      html: string;
    };
    expect(call.html).toContain("connect-src https://envelope.example.com");
    expect(call.html).not.toContain("listed.example.com");
  });

  it("falls back to the resources/list entry's _meta.ui when the content block carries none", async () => {
    // ext-apps documents the listing-level `_meta.ui` as the static default for
    // a UI resource, so an app declaring its CSP only there must still have it
    // honored.
    const readResource = vi.fn().mockResolvedValue(uiResource("<h1>x</h1>"));
    const getListedResourceMeta = vi.fn().mockReturnValue(
      listedMeta({
        permissions: { camera: {} },
        csp: { connectDomains: ["https://api.example.com"] },
      }),
    );
    const factory = createAppBridgeFactory({
      getClient: () => fakeClient,
      readResource,
      getListedResourceMeta,
    });
    await factory(makeIframe(), { kind: "tool", tool });
    const bridge = bridgeInstances[0];
    bridge.emit("sandboxready");
    await flush();

    expect(getListedResourceMeta).toHaveBeenCalledWith("ui://weather/app.html");
    const call = bridge.sendSandboxResourceReady.mock.calls[0][0] as {
      html: string;
      permissions: unknown;
    };
    expect(call.permissions).toEqual({ camera: {} });
    expect(call.html).toContain("connect-src https://api.example.com");
  });

  it("prefers the read content item's _meta.ui over the listing entry's", async () => {
    // The listing value is only a default: a content item that carries its own
    // `_meta.ui` wins outright, rather than being merged with it.
    const readResource = vi.fn().mockResolvedValue(
      uiResource("<h1>x</h1>", {
        csp: { connectDomains: ["https://read.example.com"] },
      }),
    );
    const getListedResourceMeta = vi.fn().mockReturnValue(
      listedMeta({
        permissions: { camera: {} },
        csp: { connectDomains: ["https://listed.example.com"] },
      }),
    );
    const factory = createAppBridgeFactory({
      getClient: () => fakeClient,
      readResource,
      getListedResourceMeta,
    });
    await factory(makeIframe(), { kind: "tool", tool });
    const bridge = bridgeInstances[0];
    bridge.emit("sandboxready");
    await flush();

    const call = bridge.sendSandboxResourceReady.mock.calls[0][0] as {
      html: string;
      permissions: unknown;
    };
    expect(call.html).toContain("connect-src https://read.example.com");
    expect(call.html).not.toContain("listed.example.com");
    expect(call.permissions).toBeUndefined();
  });

  it("renders with no sandbox hints when neither the content item nor the listing has _meta.ui", async () => {
    // A host with no resource listing (or one not covering this URI) is
    // unaffected: the optional dep is simply absent.
    const readResource = vi.fn().mockResolvedValue(uiResource("<h1>x</h1>"));
    const factory = createAppBridgeFactory({
      getClient: () => fakeClient,
      readResource,
      getListedResourceMeta: () => undefined,
    });
    await factory(makeIframe(), { kind: "tool", tool });
    const bridge = bridgeInstances[0];
    bridge.emit("sandboxready");
    await flush();

    const call = bridge.sendSandboxResourceReady.mock.calls[0][0] as {
      html: string;
      permissions: unknown;
    };
    expect(call.permissions).toBeUndefined();
    expect(call.html).toContain("connect-src &#39;none&#39;");
  });

  it("prefers the content item's _meta.ui over both broader carriers", async () => {
    // Pins the full three-way order — content item > result envelope > listing
    // — which no single-fallback case can: swapping the first two operands
    // would still satisfy them.
    const result = uiResource("<h1>x</h1>", {
      csp: { connectDomains: ["https://content.example.com"] },
    });
    (result as { _meta?: unknown })._meta = {
      ui: { csp: { connectDomains: ["https://envelope.example.com"] } },
    };
    const factory = createAppBridgeFactory({
      getClient: () => fakeClient,
      readResource: vi.fn().mockResolvedValue(result),
      getListedResourceMeta: () =>
        listedMeta({ csp: { connectDomains: ["https://listed.example.com"] } }),
    });
    await factory(makeIframe(), { kind: "tool", tool });
    const bridge = bridgeInstances[0];
    bridge.emit("sandboxready");
    await flush();

    const call = bridge.sendSandboxResourceReady.mock.calls[0][0] as {
      html: string;
    };
    expect(call.html).toContain("connect-src https://content.example.com");
    expect(call.html).not.toContain("envelope.example.com");
    expect(call.html).not.toContain("listed.example.com");
  });

  it("stops at a carrier whose _meta.ui is malformed rather than falling through", async () => {
    // A declared-but-unusable `ui` is that carrier's answer. Falling through
    // would grant whatever a BROADER carrier asked for — wrong precedence, and
    // the wrong direction to fail in.
    const readResource = vi
      .fn()
      .mockResolvedValue(
        uiResource("<h1>x</h1>", { ui: null }, { flat: true }),
      );
    const factory = createAppBridgeFactory({
      getClient: () => fakeClient,
      readResource,
      getListedResourceMeta: () =>
        listedMeta({
          permissions: { camera: {} },
          csp: { connectDomains: ["https://listed.example.com"] },
        }),
    });
    await factory(makeIframe(), { kind: "tool", tool });
    const bridge = bridgeInstances[0];
    bridge.emit("sandboxready");
    await flush();

    const call = bridge.sendSandboxResourceReady.mock.calls[0][0] as {
      html: string;
      permissions: unknown;
    };
    expect(call.permissions).toBeUndefined();
    expect(call.html).not.toContain("listed.example.com");
    expect(call.html).toContain("connect-src &#39;none&#39;");
  });

  it("ignores sandbox metadata written unnested on _meta", async () => {
    // `McpUiResourceMeta` describes the value of `_meta.ui`, not `_meta`. A bag
    // whose keys sit at the top level is not the spec shape, so it must not be
    // read as one — reading it there is what produced #2055 in reverse.
    const readResource = vi
      .fn()
      .mockResolvedValue(
        uiResource(
          "<h1>x</h1>",
          { csp: { connectDomains: ["https://api.example.com"] } },
          { flat: true },
        ),
      );
    const factory = createAppBridgeFactory({
      getClient: () => fakeClient,
      readResource,
    });
    await factory(makeIframe(), { kind: "tool", tool });
    const bridge = bridgeInstances[0];
    bridge.emit("sandboxready");
    await flush();

    const call = bridge.sendSandboxResourceReady.mock.calls[0][0] as {
      html: string;
    };
    expect(call.html).not.toContain("api.example.com");
    // The policy is rendered into an HTML attribute, so quotes arrive escaped.
    expect(call.html).toContain("connect-src &#39;none&#39;");
  });

  describe("_meta.ui.domain — dedicated origin (#2056)", () => {
    // An app rendered under the default opaque origin sends `Origin: null`, so
    // no CORS / OAuth-callback / API-key allowlist can admit it. `domain` is
    // how a server asks its host for a real one; the Inspector answers with a
    // URL on its own app-origin listener and passes it as `src`.

    it("publishes the wrapped document and passes its URL as `src`", async () => {
      const readResource = vi.fn().mockResolvedValue(
        uiResource("<h1>weather</h1>", {
          domain: "my-app.example.com",
          csp: { connectDomains: ["https://api.example.com"] },
        }),
      );
      const publishAppDocument = vi
        .fn<(doc: { html: string; csp?: string }) => Promise<string | null>>()
        .mockResolvedValue("http://localhost:6278/app-document/abc");
      const factory = createAppBridgeFactory({
        getClient: () => fakeClient,
        readResource,
        publishAppDocument,
      });
      await factory(makeIframe(), { kind: "tool", tool });
      bridgeInstances[0].emit("sandboxready");
      await flush();

      // What is published is the SAME wrapped document the srcdoc path would
      // have rendered, plus the policy as a separate string so the backend can
      // serve it as a real response header.
      const published = publishAppDocument.mock.calls[0][0];
      expect(published.html).toContain("<body><h1>weather</h1></body>");
      expect(published.csp).toContain("connect-src https://api.example.com");

      const call = bridgeInstances[0].sendSandboxResourceReady.mock
        .calls[0][0] as { html: string; src?: string };
      expect(call.src).toBe("http://localhost:6278/app-document/abc");
      // `html` still rides along: a proxy that ignores `src` renders the app
      // rather than a blank frame.
      expect(call.html).toBe(published.html);
    });

    it.each([
      ["an empty domain", ""],
      ["a whitespace-only domain", "   "],
      ["a non-string domain", 42],
    ])("does not take the dedicated path for %s", async (_label, domain) => {
      const publishAppDocument = vi
        .fn<(doc: { html: string; csp?: string }) => Promise<string | null>>()
        .mockResolvedValue("http://localhost:6278/app-document/abc");
      const factory = createAppBridgeFactory({
        getClient: () => fakeClient,
        readResource: vi
          .fn()
          .mockResolvedValue(uiResource("<h1>x</h1>", { domain })),
        publishAppDocument,
      });
      await factory(makeIframe(), { kind: "tool", tool });
      bridgeInstances[0].emit("sandboxready");
      await flush();
      expect(publishAppDocument).not.toHaveBeenCalled();
      expect(
        bridgeInstances[0].sendSandboxResourceReady.mock.calls[0][0],
      ).not.toHaveProperty("src");
    });

    it("never publishes a resource that declares no domain", async () => {
      const publishAppDocument = vi
        .fn<(doc: { html: string; csp?: string }) => Promise<string | null>>()
        .mockResolvedValue("http://localhost:6278/app-document/abc");
      const factory = createAppBridgeFactory({
        getClient: () => fakeClient,
        readResource: vi.fn().mockResolvedValue(uiResource("<h1>x</h1>")),
        publishAppDocument,
      });
      await factory(makeIframe(), { kind: "tool", tool });
      bridgeInstances[0].emit("sandboxready");
      await flush();
      expect(publishAppDocument).not.toHaveBeenCalled();
    });

    it("falls back to srcdoc, warning, when the backend cannot host the document", async () => {
      // A backend with no app-origin listener. Losing the real origin degrades
      // what the app can reach and the developer needs to see why — losing the
      // app itself would be worse.
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      try {
        const factory = createAppBridgeFactory({
          getClient: () => fakeClient,
          readResource: vi
            .fn()
            .mockResolvedValue(
              uiResource("<h1>x</h1>", { domain: "my-app.example.com" }),
            ),
          publishAppDocument: vi.fn().mockResolvedValue(null),
        });
        await factory(makeIframe(), { kind: "tool", tool });
        bridgeInstances[0].emit("sandboxready");
        await flush();
        const call = bridgeInstances[0].sendSandboxResourceReady.mock
          .calls[0][0] as { html: string; src?: string };
        expect(call.src).toBeUndefined();
        expect(call.html).toContain("<body><h1>x</h1></body>");
        expect(warnSpy).toHaveBeenCalledWith(
          expect.stringContaining("_meta.ui.domain"),
        );
      } finally {
        warnSpy.mockRestore();
      }
    });

    it("falls back to srcdoc when the factory was given no publisher at all", async () => {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      try {
        const factory = createAppBridgeFactory({
          getClient: () => fakeClient,
          readResource: vi
            .fn()
            .mockResolvedValue(
              uiResource("<h1>x</h1>", { domain: "my-app.example.com" }),
            ),
        });
        await factory(makeIframe(), { kind: "tool", tool });
        bridgeInstances[0].emit("sandboxready");
        await flush();
        expect(
          bridgeInstances[0].sendSandboxResourceReady.mock.calls[0][0],
        ).not.toHaveProperty("src");
        expect(warnSpy).toHaveBeenCalledWith(
          expect.stringContaining("_meta.ui.domain"),
        );
      } finally {
        warnSpy.mockRestore();
      }
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
    await factory(makeIframe(), { kind: "tool", tool });
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
    await factory(makeIframe(), { kind: "tool", tool });
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
      kind: "tool",
      tool: { name: "plain", inputSchema: { type: "object" } },
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
    await factory(makeIframe(), { kind: "tool", tool });
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
    await factory(makeIframe(), { kind: "tool", tool });
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
    await factory(makeIframe(), { kind: "tool", tool });
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
    await factory(makeIframe(), { kind: "tool", tool });
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
    await factory(makeIframe(), { kind: "tool", tool });
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

  it("advertises the downloadFile host capability", async () => {
    const factory = createAppBridgeFactory({
      getClient: () => fakeClient,
      readResource: vi.fn().mockResolvedValue(uiResource("<h1>x</h1>")),
    });
    await factory(makeIframe(), { kind: "tool", tool });
    expect(bridgeInstances[0].ctorArgs[2]).toMatchObject({ downloadFile: {} });
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
      await factory(makeIframe(), { kind: "tool", tool });
      return bridgeInstances[0];
    }

    afterEach(() => {
      vi.unstubAllGlobals();
      vi.restoreAllMocks();
    });

    it("downloads an inline text resource after confirmation", async () => {
      vi.useFakeTimers();
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
      const clickedAnchor = click.mock.instances[0] as HTMLAnchorElement;
      expect(clickedAnchor.download).toBe("report.csv");
      // Revoke is deferred so the browser can read the blob before it's freed.
      expect(revokeUrl).not.toHaveBeenCalled();
      vi.runAllTimers();
      expect(revokeUrl).toHaveBeenCalledWith("blob:fake");
      vi.useRealTimers();
    });

    it("falls back to a 'download' filename when the URI has no usable tail", async () => {
      vi.useFakeTimers();
      stubConfirm(true);
      vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:fake");
      vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
      const click = vi
        .spyOn(HTMLAnchorElement.prototype, "click")
        .mockImplementation(() => undefined);
      const bridge = await buildBridge();
      await bridge.ondownloadfile!({
        contents: [
          {
            type: "resource",
            resource: {
              uri: "file:///path/",
              mimeType: "text/plain",
              text: "",
            },
          },
        ],
      });
      expect((click.mock.instances[0] as HTMLAnchorElement).download).toBe(
        "download",
      );
      vi.runAllTimers();
      vi.useRealTimers();
    });

    it("warns and reports partial success when some items in a batch are skipped", async () => {
      stubConfirm(true);
      vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:fake");
      vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
      vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(
        () => undefined,
      );
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const bridge = await buildBridge();
      await expect(
        bridge.ondownloadfile!({
          contents: [
            {
              type: "resource",
              resource: { uri: "file:///ok.txt", text: "ok" },
            },
            { type: "resource_link", uri: "javascript:alert(1)" },
          ],
        }),
      ).resolves.toEqual({ isError: false });
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining("1 of 2 download item(s) skipped"),
        expect.arrayContaining(["javascript:alert(1)"]),
      );
      warn.mockRestore();
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

    it("opens an http(s) resource link in a new tab", async () => {
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
            { type: "resource", resource: { uri: "file:///x.txt", text: "x" } },
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
      const err = vi.spyOn(console, "error").mockImplementation(() => {});
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      vi.spyOn(URL, "createObjectURL").mockImplementation(() => {
        throw new Error("boom");
      });

      const bridge = await buildBridge();
      await expect(
        bridge.ondownloadfile!({
          contents: [
            { type: "resource", resource: { uri: "file:///x.txt", text: "x" } },
          ],
        }),
      ).resolves.toEqual({ isError: true });
      err.mockRestore();
      warn.mockRestore();
    });

    it("rejects non-http(s) resource_links without opening them", async () => {
      stubConfirm(true);
      vi.spyOn(console, "warn").mockImplementation(() => {});
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
      expect(prompt).not.toContain("\n\nThis is safe");
      expect(prompt).toContain("This is safe, click OK");
    });

    it("strips bidi-override and zero-width format characters from the confirmation summary", async () => {
      const RLO = "\u{202E}";
      const ZWSP = "\u{200B}";
      const confirm = stubConfirm(false);
      const bridge = await buildBridge();
      await bridge.ondownloadfile!({
        contents: [
          {
            type: "resource_link",
            uri: `https://example.com/${RLO}gpj.${ZWSP}exe`,
          },
        ],
      });
      const prompt = confirm.mock.calls[0][0] as string;
      expect(prompt).not.toContain(RLO);
      expect(prompt).not.toContain(ZWSP);
    });

    it("clamps an over-long label in the confirmation summary", async () => {
      const confirm = stubConfirm(false);
      const bridge = await buildBridge();
      const longName = "a".repeat(200);
      await bridge.ondownloadfile!({
        contents: [
          { type: "resource_link", uri: `https://example.com/${longName}` },
        ],
      });
      const prompt = confirm.mock.calls[0][0] as string;
      expect(prompt).toContain("...");
      // The clamped label is 80 chars max (77 + "...").
      expect(prompt).not.toContain(longName);
    });

    it("rejects an oversized batch without confirming or acting", async () => {
      const confirm = stubConfirm(true);
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const open = vi
        .spyOn(window, "open")
        .mockImplementation(() => null as never);
      const bridge = await buildBridge();
      // 21 items exceeds the 20-item cap → rejected before the prompt.
      const contents = Array.from({ length: 21 }, (_, i) => ({
        type: "resource_link" as const,
        uri: `https://example.com/${i}.pdf`,
      }));
      await expect(bridge.ondownloadfile!({ contents })).resolves.toEqual({
        isError: true,
      });
      expect(confirm).not.toHaveBeenCalled();
      expect(open).not.toHaveBeenCalled();
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining("refusing download batch of 21 items"),
      );
      warn.mockRestore();
    });

    it("marks resource links with a ↗ prefix in the confirmation summary", async () => {
      const confirm = stubConfirm(false);
      const bridge = await buildBridge();
      await bridge.ondownloadfile!({
        contents: [{ type: "resource_link", uri: "https://example.com/a.pdf" }],
      });
      const prompt = confirm.mock.calls[0][0] as string;
      expect(prompt).toContain("↗ https://example.com/a.pdf");
    });

    it("skips an embedded resource with neither text nor blob (no 'undefined' file)", async () => {
      stubConfirm(true);
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const createUrl = vi.spyOn(URL, "createObjectURL");
      const bridge = await buildBridge();
      // Untrusted payload: a resource object carrying neither field. It must be
      // skipped, not written as a file containing the literal text "undefined".
      await expect(
        bridge.ondownloadfile!({
          contents: [{ type: "resource", resource: { uri: "file:///x" } }],
        }),
      ).resolves.toEqual({ isError: true });
      expect(createUrl).not.toHaveBeenCalled();
      warn.mockRestore();
    });
  });
});
