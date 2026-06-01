import {
  AppBridge,
  PostMessageTransport,
  getToolUiResourceUri,
} from "@modelcontextprotocol/ext-apps/app-bridge";
import type {
  McpUiHostCapabilities,
  McpUiResourceMeta,
} from "@modelcontextprotocol/ext-apps/app-bridge";
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import type {
  Implementation,
  ReadResourceResult,
} from "@modelcontextprotocol/sdk/types.js";
import type { BridgeFactory } from "./AppRenderer";

/**
 * Host identity advertised to MCP Apps during the bridge handshake. Static —
 * the value is informational (shown by some apps), not a protocol version.
 */
export const HOST_INFO: Implementation = {
  name: "MCP Inspector",
  version: "2.0.0",
};

/**
 * Capabilities the inspector host offers a running MCP App. Constructed WITH an
 * MCP client (see {@link createAppBridgeFactory}), so the bridge auto-forwards
 * tools/resources/prompts to the view; we only declare the host-side features
 * we actually back: external links (handled below), tool/resource list-change
 * forwarding, and logging passthrough.
 */
export const HOST_CAPABILITIES: McpUiHostCapabilities = {
  openLinks: {},
  serverTools: { listChanged: true },
  serverResources: { listChanged: true },
  logging: {},
};

export interface AppBridgeFactoryDeps {
  /** The connected SDK client to back the bridge, or null when disconnected. */
  getClient: () => Client | null;
  /** Reads a UI resource (resources/read) and returns the SDK result. */
  readResource: (uri: string) => Promise<ReadResourceResult>;
  /** Initial host theme passed to the app via hostContext. */
  theme: "light" | "dark";
}

/** First text content block of a UI resource, plus its `_meta` (sandbox hints). */
function extractHtmlAndMeta(result: ReadResourceResult): {
  html: string;
  meta: McpUiResourceMeta | undefined;
} {
  for (const content of result.contents) {
    const text = (content as { text?: unknown }).text;
    if (typeof text === "string") {
      return {
        html: text,
        meta: content._meta as McpUiResourceMeta | undefined,
      };
    }
  }
  throw new Error("UI resource has no text (HTML) content");
}

/**
 * Builds the {@link BridgeFactory} the AppRenderer uses to bring a sandbox
 * iframe to life. For each mounted iframe + tool it:
 *
 *  1. constructs a host-side {@link AppBridge} over the SDK client (so the view
 *     can call tools/resources/prompts directly),
 *  2. on the sandbox proxy's `sandboxready` signal, reads the tool's UI
 *     resource and pushes its HTML + sandbox/permissions into the inner iframe,
 *  3. handles `openLinks` by opening http(s) URLs in a new tab,
 *  4. connects a {@link PostMessageTransport} to the iframe and returns the
 *     live bridge.
 *
 * Host-initiated tool input/result are pushed separately through the renderer's
 * imperative handle (see `AppRenderer`), gated on the view's `initialized`
 * event. The factory throws when no client is connected; AppRenderer routes
 * that to its `onError` so the user sees a clear failure instead of a blank
 * frame.
 */
export function createAppBridgeFactory(
  deps: AppBridgeFactoryDeps,
): BridgeFactory {
  return async (iframe, tool) => {
    const client = deps.getClient();
    if (!client) {
      throw new Error("Cannot render MCP App: no connected MCP client.");
    }
    const targetWindow = iframe.contentWindow;
    if (!targetWindow) {
      throw new Error("Cannot render MCP App: sandbox iframe has no window.");
    }

    const bridge = new AppBridge(client, HOST_INFO, HOST_CAPABILITIES, {
      hostContext: { theme: deps.theme },
    });

    // The double-iframe proxy posts `sandboxready` once it can receive content.
    // Read the tool's UI resource and hand its HTML (plus any sandbox/permission
    // hints from the resource _meta) to the inner sandboxed iframe. Swallow
    // failures: a read error leaves an empty (but live) app frame rather than
    // tearing down the bridge mid-handshake.
    bridge.addEventListener("sandboxready", () => {
      void (async () => {
        try {
          const uri = getToolUiResourceUri(tool);
          if (!uri) return;
          const result = await deps.readResource(uri);
          const { html, meta } = extractHtmlAndMeta(result);
          await bridge.sendSandboxResourceReady({
            html,
            permissions: meta?.permissions,
            csp: meta?.csp,
          });
        } catch {
          /* read/post failed (or bridge closed) — leave the frame empty */
        }
      })();
    });

    bridge.onopenlink = async ({ url }) => {
      if (/^https?:\/\//i.test(url)) {
        window.open(url, "_blank", "noopener,noreferrer");
        return { isError: false };
      }
      return { isError: true };
    };

    const transport = new PostMessageTransport(targetWindow, targetWindow);
    await bridge.connect(transport);
    return bridge;
  };
}
