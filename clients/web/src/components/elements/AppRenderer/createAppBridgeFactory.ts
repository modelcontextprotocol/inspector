import {
  AppBridge,
  PostMessageTransport,
  getToolUiResourceUri,
} from "@modelcontextprotocol/ext-apps/app-bridge";
import type {
  McpUiDisplayMode,
  McpUiHostCapabilities,
  McpUiResourceMeta,
  McpUiSandboxResourceReadyNotification,
} from "@modelcontextprotocol/ext-apps/app-bridge";
import type { Client } from "@modelcontextprotocol/client";
import type {
  EmbeddedResource,
  Implementation,
  ReadResourceResult,
  ResourceLink,
} from "@modelcontextprotocol/client";
import {
  approveCspSources,
  approveSandboxPermissions,
  buildSandboxCspPolicy,
  wrapSandboxedHtml,
} from "../../../utils/sandbox-csp";
import {
  downloadBlob,
  fileNameFromUri,
  isHttpUrl,
} from "../../../lib/downloadFile";
import { snapshotHostContext } from "./hostContext";
import { observeAppCapabilities } from "./appCapabilities";
import type { AppRenderSource, BridgeFactory } from "./AppRenderer";

/**
 * The `ui://` resource a render source loads, or `undefined` for an App tool
 * whose `_meta` names none (in which case there is nothing to push into the
 * sandbox and the frame stays empty).
 */
function resolveSourceUri(source: AppRenderSource): string | undefined {
  return source.kind === "resource"
    ? source.resourceUri
    : getToolUiResourceUri(source.tool);
}

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
  /**
   * The `_meta` of the `resources/list` entry for `uri`, when the host has that
   * listing. ext-apps treats the listing-level `_meta.ui` as the static default
   * for a UI resource, so an app that declares its CSP only there must still
   * get it honored; a read content item's own `_meta.ui` wins over it. Omitted
   * (or returning undefined) simply means no default — the host that has no
   * resource listing, or whose listing does not include this URI, is unaffected.
   */
  getListedResourceMeta?: (uri: string) => object | undefined;
  /**
   * Advertise `hostCapabilities.elicitation` — "this host can forward a
   * form-mode `elicitation/create` to the app and return its result to the
   * server" (#1854).
   *
   * Off by default, and deliberately per-factory rather than global: an App
   * *tool* frame is never handed an elicitation, so claiming the capability
   * there would tell the app something untrue about what its host will do.
   */
  advertiseElicitation?: boolean;
  /**
   * Publish a wrapped app document to the backend's dedicated app-origin
   * listener and resolve with the URL to load it from, or `null` when the
   * backend can't host one (#2056).
   *
   * Only consulted for a UI resource that declares `_meta.ui.domain` — the
   * spec field by which a server asks its host for a stable, dedicated origin
   * so its requests carry a real `Origin` instead of `null`. Optional: a
   * factory without it (and a `null` result from one with it) renders every
   * app the default way, under an opaque origin.
   */
  publishAppDocument?: (doc: {
    html: string;
    csp?: string;
  }) => Promise<string | null>;
}

/**
 * The MCP Apps sandbox hints (`csp`, `permissions`, …) a single `_meta` bag
 * declares under its `ui` key, or undefined when that bag declares none.
 *
 * The two "no hints" cases are deliberately distinguished by the return type:
 * a bag with no `ui` key at all returns undefined (this carrier is silent —
 * keep looking), while a bag whose `ui` is malformed returns `{ meta:
 * undefined }` (this carrier spoke, and what it said is unusable — stop). Were
 * they conflated, a content item declaring `ui: null` would fall through to a
 * broader carrier and be granted whatever *that* one asked for, which is both
 * the wrong precedence and the wrong direction to fail in.
 *
 * `McpUiResourceMeta` describes the value of `_meta.ui`, NOT `_meta` itself —
 * reading `_meta` directly leaves every field undefined, so a spec-conforming
 * app's declared `connectDomains` never reach the generated CSP and it renders
 * under `connect-src 'none'` (#2055). This mirrors the tool side, where
 * `getToolUiResourceUri` already reads `_meta.ui.resourceUri`.
 */
function uiMeta(
  bag: object | undefined,
): { meta: McpUiResourceMeta | undefined } | undefined {
  if (bag === undefined || !("ui" in bag)) return undefined;
  const ui: unknown = (bag as { ui: unknown }).ui;
  const wellFormed =
    ui !== null && typeof ui === "object" && !Array.isArray(ui);
  return { meta: wellFormed ? (ui as McpUiResourceMeta) : undefined };
}

/**
 * First text content block of a UI resource, plus its `_meta.ui` sandbox hints.
 *
 * ext-apps exposes three carriers, and they are consulted most-specific first:
 *
 * 1. the **read content item**'s own `_meta.ui`;
 * 2. the **read result envelope**'s — `McpUiReadResourceResult` (what a
 *    `registerAppResource` callback returns) types `_meta.ui` at that level;
 * 3. the matching **`resources/list` entry**'s, which `McpUiAppResourceConfig`
 *    documents as the static default a host reviews at connection time, and
 *    which a read content item explicitly takes precedence over.
 *
 * The first carrier that *declares* a `ui` key decides, and its value is used
 * outright — the levels are not merged, since a server that restates only
 * `csp` at the more specific level means that to be the whole grant, not a
 * patch over the broader one. A carrier declaring a malformed `ui` decides
 * too, for "no hints"; see {@link uiMeta}.
 */
function extractHtmlAndMeta(
  result: ReadResourceResult,
  listedMeta?: object,
): {
  html: string;
  meta: McpUiResourceMeta | undefined;
} {
  for (const content of result.contents) {
    const text = (content as { text?: unknown }).text;
    if (typeof text === "string") {
      const carried =
        uiMeta(content._meta) ?? uiMeta(result._meta) ?? uiMeta(listedMeta);
      return { html: text, meta: carried?.meta };
    }
  }
  throw new Error("UI resource has no text (HTML) content");
}

/**
 * Whether a UI resource asked for a dedicated origin (#2056).
 *
 * Any non-empty `domain` string counts. The spec is explicit that the field's
 * format is host-dependent — hosts publish their own rules, and the examples it
 * gives (`{hash}.claudemcpcontent.com`, `www-example-com.oaiusercontent.com`)
 * are each one host's convention. The Inspector's convention is that the value
 * is a *request*, not an address: it grants a real loopback origin and does not
 * try to honor the specific name, which it could not serve anyway.
 */
function wantsDedicatedOrigin(meta: McpUiResourceMeta | undefined): boolean {
  return typeof meta?.domain === "string" && meta.domain.trim() !== "";
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
  return async (iframe, source) => {
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
    const hostCapabilities: McpUiHostCapabilities = {
      ...HOST_CAPABILITIES,
      // `elicitation` is not part of ext-apps 2.0.0's `McpUiHostCapabilities`
      // (ext-apps#733 adds it), so it is spread in as an extra key. The bridge
      // forwards the capabilities object verbatim in its `ui/initialize`
      // response, which is exactly what the app reads. TODO: drop the cast when
      // a release containing #733 ships.
      ...(deps.advertiseElicitation
        ? ({ elicitation: {} } as Partial<McpUiHostCapabilities>)
        : {}),
    };
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
          const uri = resolveSourceUri(source);
          if (!uri) return;
          const result = await deps.readResource(uri);
          const { html, meta } = extractHtmlAndMeta(
            result,
            deps.getListedResourceMeta?.(uri),
          );
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
          // Both halves of the app-supplied sandbox config are screened, for
          // different reasons. `csp` is injection-filtered by approveCspSources
          // because its sources are interpolated into the CSP <meta> content
          // string. `permissions` can't reach the `sandbox`/`allow` attribute as
          // raw text — the proxy maps each known key to a fixed Permissions-Policy
          // token — but it tests those keys for TRUTHINESS, so a non-boolean
          // (`camera: "false"`) would read as a grant; approveSandboxPermissions
          // reduces the bag to the keys actually requested. The `allow-same-origin`
          // strip and the rest of that layer stay owned by #1565.
          const approvedPermissions = approveSandboxPermissions(
            meta?.permissions,
          );
          hostCapabilities.sandbox = {
            permissions: approvedPermissions,
            csp: approvedCsp,
          };
          const policy = buildSandboxCspPolicy(approvedCsp);
          const wrapped = wrapSandboxedHtml(html, policy);
          // `_meta.ui.domain` (#2056): the resource is asking to be served
          // from a stable, dedicated origin rather than rendered into the
          // default opaque-origin srcdoc frame, because an opaque origin sends
          // `Origin: null` and no CORS / OAuth-callback / API-key allowlist can
          // admit that. The spec makes the field's format host-dependent and
          // the Inspector owns no domain infrastructure, so what it honors the
          // request WITH is a real loopback origin — any non-empty domain opts
          // in, and the string itself is not interpreted (see the app-origin
          // controller for the host-specific contract).
          //
          // A `null` back means the backend has no such listener (an older
          // backend, or one whose port never bound). Fall back to srcdoc: the
          // app loses its real origin, which is a degradation the developer
          // can see and act on — losing the app entirely is not.
          const dedicated = wantsDedicatedOrigin(meta);
          const src = dedicated
            ? await deps.publishAppDocument?.({ html: wrapped, csp: policy })
            : undefined;
          if (dedicated && !src) {
            console.warn(
              "[mcp-app] resource declares _meta.ui.domain but no dedicated app origin is available; rendering under an opaque origin (requests will send `Origin: null`).",
            );
          }
          // `src` is an Inspector-specific extension to the (internal)
          // sandbox-resource-ready params, which ext-apps types but does not
          // validate — the bridge forwards the params object verbatim. Declared
          // as an intersection rather than cast so the extra key stays typed.
          const readyParams: McpUiSandboxResourceReadyNotification["params"] & {
            src?: string;
          } = {
            html: wrapped,
            permissions: approvedPermissions,
            ...(src ? { src } : {}),
          };
          await bridge.sendSandboxResourceReady(readyParams);
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
    // Record the view's raw `ui/initialize` capabilities before the bridge's
    // own schema strips the keys it predates (#1854). Must follow `connect`,
    // which is what installs the handler this wraps.
    observeAppCapabilities(bridge, transport);
    return bridge;
  };
}
