import {
  AppBridge,
  PostMessageTransport,
  getToolUiResourceUri,
} from "@modelcontextprotocol/ext-apps/app-bridge";
import type {
  McpUiDisplayMode,
  McpUiHostCapabilities,
  McpUiResourceMeta,
} from "@modelcontextprotocol/ext-apps/app-bridge";
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import type {
  EmbeddedResource,
  Implementation,
  ReadResourceResult,
  ResourceLink,
} from "@modelcontextprotocol/sdk/types.js";
import {
  approveCspSources,
  buildSandboxCspPolicy,
  wrapSandboxedHtml,
} from "../../../lib/sandbox-csp";
import {
  downloadBlob,
  fileNameFromUri,
  isHttpUrl,
} from "../../../lib/downloadFile";
import { snapshotHostContext } from "./hostContext";
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
 * we actually back: external links and file downloads (both handled below),
 * tool/resource list-change forwarding, and logging passthrough.
 */
export const HOST_CAPABILITIES: McpUiHostCapabilities = {
  openLinks: {},
  downloadFile: {},
  serverTools: { listChanged: true },
  serverResources: { listChanged: true },
  logging: {},
};

/**
 * Display modes the inspector host supports, advertised in the handshake
 * hostContext (`availableDisplayModes`). AppsScreen renders an app either
 * inline within its layout card or maximized to fill the screen, so only those
 * two are offered.
 */
export const HOST_AVAILABLE_DISPLAY_MODES: readonly McpUiDisplayMode[] = [
  "inline",
  "fullscreen",
];

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
 * Decode a base64-encoded blob resource into bytes for download. Allocates the
 * backing store explicitly so the return type is `Uint8Array<ArrayBuffer>`
 * (Blob accepts `ArrayBufferView<ArrayBuffer>`, not the wider
 * `ArrayBufferLike`).
 */
function base64ToBytes(b64: string): Uint8Array<ArrayBuffer> {
  const binary = atob(b64);
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/**
 * Upper bound on items honored from a single `ui/download-file` request. One
 * user approval must not fan out into an unbounded number of saves / new tabs.
 */
const MAX_DOWNLOAD_ITEMS = 20;

/**
 * Strip control characters and clamp length so a server-supplied filename or
 * URI cannot forge additional lines in the confirmation prompt or push the
 * real summary off-screen.
 */
function sanitizeDownloadLabel(label: string): string {
  // Cc = control chars (newlines, escape, etc.); Cf = format chars (bidi
  // overrides, zero-width joiners, BOM) — both can spoof or reflow the prompt.
  const cleaned = label.replace(/[\p{Cc}\p{Cf}]+/gu, " ").trim();
  // Keep the START of an over-long label: for a link that preserves the
  // scheme+host, which is what the user needs to make a trust decision.
  return cleaned.length > 80 ? cleaned.slice(0, 77) + "..." : cleaned;
}

/**
 * Human-readable label for a download item, shown in the confirmation prompt.
 * `forPrompt` marks a resource_link with a leading "↗" so the user can tell a
 * link that will *open in a tab* apart from an embedded file that will *save to
 * disk* — the two item kinds share this "download" confirmation.
 */
function describeDownloadItem(
  item: EmbeddedResource | ResourceLink,
  forPrompt = false,
): string {
  if (item.type === "resource_link") {
    return forPrompt ? `↗ ${item.uri}` : item.uri;
  }
  return fileNameFromUri(item.resource.uri);
}

/**
 * Trigger a browser download for a single MCP resource item. Inline
 * {@link EmbeddedResource}s (text or base64 blob) are written via
 * {@link downloadBlob}. A {@link ResourceLink} is *opened* in a new tab —
 * the inspector does not fetch the URL to disk itself, since the link may
 * require auth or content negotiation the browser can supply but we cannot.
 * Returns false when the item carries nothing downloadable or its URI is
 * rejected by the http(s)-only allowlist.
 */
function downloadResourceItem(item: EmbeddedResource | ResourceLink): boolean {
  if (item.type === "resource_link") {
    const parsed = isHttpUrl(item.uri);
    if (!parsed) return false;
    window.open(parsed.href, "_blank", "noopener,noreferrer");
    return true;
  }
  const resource = item.resource;
  // The types forbid it, but the payload is untrusted: a resource with neither
  // `blob` nor a string `text` has nothing to save. Skip it (like a rejected
  // link) rather than writing a file containing the literal text "undefined".
  if (!("blob" in resource) && typeof resource.text !== "string") return false;
  const blob =
    "blob" in resource
      ? new Blob([base64ToBytes(resource.blob)], {
          type: resource.mimeType ?? "application/octet-stream",
        })
      : new Blob([resource.text], { type: resource.mimeType ?? "text/plain" });
  downloadBlob(fileNameFromUri(resource.uri), blob);
  return true;
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
 *  4. handles `downloadFile` by confirming with the user, then writing each
 *     embedded resource to disk via an object-URL anchor (resource links are
 *     opened in a new tab),
 *  5. connects a {@link PostMessageTransport} to the iframe and returns the
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
      hostContext: snapshotHostContext(iframe, HOST_AVAILABLE_DISPLAY_MODES),
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

    // The view asks the host to save MCP resource contents to disk (sandboxed
    // iframes can't download directly). Confirm with the user first — the spec
    // requires a host-mediated confirmation — then write each item out. A
    // declined prompt, an empty/oversized payload, or a thrown error all
    // return isError.
    bridge.ondownloadfile = async ({ contents }) => {
      if (!Array.isArray(contents) || contents.length === 0) {
        return { isError: true };
      }
      // Sanity cap: one approval must not fan out into an unbounded number of
      // downloads / new tabs. A buggy or hostile app requesting hundreds of
      // items is rejected outright rather than acted on.
      if (contents.length > MAX_DOWNLOAD_ITEMS) {
        console.warn(
          `[mcp-app] refusing download batch of ${contents.length} items (max ${MAX_DOWNLOAD_ITEMS})`,
        );
        return { isError: true };
      }
      const summary = contents
        .map((item) => sanitizeDownloadLabel(describeDownloadItem(item, true)))
        .join("\n");
      const approved = window.confirm(
        `This MCP App wants to download or open ${contents.length} item(s):\n\n${summary}`,
      );
      if (!approved) return { isError: true };
      let succeeded = 0;
      const skipped: string[] = [];
      for (const item of contents) {
        try {
          if (downloadResourceItem(item)) {
            succeeded++;
          } else {
            skipped.push(describeDownloadItem(item));
          }
        } catch (err) {
          skipped.push(describeDownloadItem(item));
          console.error("[mcp-app] download item failed:", err);
        }
      }
      if (skipped.length > 0) {
        console.warn(
          `[mcp-app] ${skipped.length} of ${contents.length} download item(s) skipped:`,
          skipped,
        );
      }
      return { isError: succeeded === 0 };
    };

    const transport = new PostMessageTransport(targetWindow, targetWindow);
    await bridge.connect(transport);
    return bridge;
  };
}
