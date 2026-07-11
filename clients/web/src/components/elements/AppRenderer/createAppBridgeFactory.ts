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
import {
  approveCspSources,
  buildSandboxCspPolicy,
  wrapSandboxedHtml,
} from "../../../lib/sandbox-csp";
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
  /**
   * Called when reading or posting the UI resource fails after the sandbox
   * proxy is ready. Without this the user is left staring at a blank-but-live
   * frame; the error is also always console.error'd.
   */
  onResourceError?: (err: Error) => void;
}

/**
 * Resolve the host theme from the DOM at bridge-build time. Mantine writes the
 * resolved color scheme to `<html data-mantine-color-scheme>`. Reading it here
 * (rather than capturing React state in the factory deps) keeps the factory's
 * identity stable across theme toggles — the AppRenderer treats a new factory
 * identity as "rebuild the bridge", which would reload a running app's iframe on
 * every theme flip. The theme is read once per bridge build (the value at open
 * time); pushing live theme updates to an already-open app would need an
 * AppBridge.setHostContext follow-up.
 *
 * The attribute is only ever `"light"` or `"dark"` — Mantine resolves
 * `defaultColorScheme="auto"` to the system value before paint and never writes
 * `"auto"` here, so no `auto` branch is needed. The matchMedia fallback only
 * covers the attribute being absent (e.g. a hydration race).
 */
function currentTheme(): "light" | "dark" {
  if (typeof document !== "undefined") {
    const attr = document.documentElement.getAttribute(
      "data-mantine-color-scheme",
    );
    if (attr === "dark" || attr === "light") return attr;
  }
  if (
    typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-color-scheme: dark)").matches
  ) {
    return "dark";
  }
  return "light";
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
 *     resource and pushes its HTML + sandbox/permissions/CSP into the inner
 *     iframe, echoing the applied sandbox config back via hostCapabilities,
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

    // Per-app copy so the approved-sandbox echo (set on sandboxready below)
    // never mutates the shared HOST_CAPABILITIES constant — each app may
    // declare its own csp/permissions.
    const hostCapabilities: McpUiHostCapabilities = { ...HOST_CAPABILITIES };
    const bridge = new AppBridge(client, HOST_INFO, hostCapabilities, {
      hostContext: { theme: currentTheme() },
    });

    // The double-iframe proxy posts `sandboxready` once it can receive content.
    // Read the tool's UI resource and hand its HTML (plus any sandbox/permission
    // hints from the resource _meta) to the inner sandboxed iframe. A failure
    // here is the case a developer most needs surfaced (their app's resource is
    // erroring or malformed) — log it and report it via deps.onResourceError so
    // the host can show something better than a blank frame. The bridge stays
    // live so a retry path remains possible.
    bridge.addEventListener("sandboxready", () => {
      void (async () => {
        try {
          const uri = getToolUiResourceUri(tool);
          if (!uri) return;
          const result = await deps.readResource(uri);
          const { html, meta } = extractHtmlAndMeta(result);
          // Build the per-app CSP host-side: filter the requested sources to
          // ones the host accepts, render the policy string, and wrap the
          // app's HTML in a fixed shell whose first <head> child is the CSP
          // <meta>. The proxy assigns that document to srcdoc verbatim — it
          // never parses the untrusted bytes — so the policy is guaranteed to
          // apply before any app content loads. The approved (post-filter) csp
          // is what we echo back via hostCapabilities.sandbox so the view sees
          // what was granted, not what it asked for. Set before
          // sendSandboxResourceReady: the view only sends ui/initialize once it
          // has the HTML, so the bridge reflects this in the initialize result.
          const approvedCsp = approveCspSources(meta?.csp);
          // NOTE on the CSP-vs-permissions asymmetry: `csp` is injection-filtered
          // by approveCspSources because its sources are interpolated into the
          // CSP <meta> content string. `permissions` is NOT filtered here — it is
          // a structured object (camera/microphone/geolocation/clipboardWrite
          // booleans), and its only consumer is the sandbox proxy's
          // buildAllowAttribute(), which maps each known key to a fixed
          // Permissions-Policy token and ignores anything else. Untrusted values
          // therefore can't reach the iframe `sandbox`/`allow` attribute as raw
          // text (that layer, and the allow-same-origin strip, is owned by the
          // sandbox-hardening work in #1565), so no source-style allowlist applies.
          hostCapabilities.sandbox = {
            permissions: meta?.permissions,
            csp: approvedCsp,
          };
          await bridge.sendSandboxResourceReady({
            html: wrapSandboxedHtml(html, buildSandboxCspPolicy(approvedCsp)),
            permissions: meta?.permissions,
          });
        } catch (err) {
          const error = err instanceof Error ? err : new Error(String(err));
          console.error(
            "[mcp-app] failed to load UI resource into sandbox:",
            error,
          );
          deps.onResourceError?.(error);
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
