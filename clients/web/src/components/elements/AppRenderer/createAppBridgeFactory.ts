import {
  AppBridge,
  PostMessageTransport,
  getToolUiResourceUri,
} from "@modelcontextprotocol/ext-apps/app-bridge";
import type {
  McpUiDisplayMode,
  McpUiHostCapabilities,
  McpUiHostContext,
  McpUiHostStyles,
  McpUiResourceMeta,
  McpUiStyles,
  McpUiStyleVariableKey,
} from "@modelcontextprotocol/ext-apps/app-bridge";
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import type {
  EmbeddedResource,
  Implementation,
  LoggingMessageNotification,
  ReadResourceResult,
  ResourceLink,
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
 * we actually back: external links and file downloads (both handled below),
 * tool/resource list-change forwarding, logging passthrough, and accepting
 * view-originated messages.
 */
export const HOST_CAPABILITIES: McpUiHostCapabilities = {
  openLinks: {},
  downloadFile: {},
  serverTools: { listChanged: true },
  serverResources: { listChanged: true },
  logging: {},
  // Accept view-originated user messages (ui/message). The inspector has no
  // chat loop to continue, so it surfaces each submission in a log rather than
  // adding it to a conversation — enough to verify a widget's send path. The
  // handler and display live in AppsScreen (which owns the running-app UI);
  // here we only advertise the content modalities the inspector can render.
  message: {
    text: {},
    image: {},
    audio: {},
    resource: {},
    resourceLink: {},
  },
};

/**
 * Display modes the inspector host supports. AppsScreen renders an app either
 * inline within its layout card or maximized to fill the screen, so only those
 * two are advertised — `pip` is declined (the spec lets a host return its
 * current mode for an unsupported request).
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

/**
 * Resolve the host theme from the DOM at bridge-build time. Mantine writes the
 * resolved color scheme to `<html data-mantine-color-scheme>`. Reading it here
 * (rather than capturing React state in the factory deps) keeps the factory's
 * identity stable across theme toggles — the AppRenderer treats a new factory
 * identity as "rebuild the bridge", which would reload a running app's iframe on
 * every theme flip. The theme is read once per bridge build to seed the initial
 * hostContext; AppRenderer watches the same attribute and pushes live theme
 * changes to an already-open app via AppBridge.setHostContext, so it is exported
 * here to keep a single source of truth for "what theme is the host showing".
 *
 * The attribute is only ever `"light"` or `"dark"` — Mantine resolves
 * `defaultColorScheme="auto"` to the system value before paint and never writes
 * `"auto"` here, so no `auto` branch is needed. The matchMedia fallback only
 * covers the attribute being absent (e.g. a hydration race).
 */
export function currentTheme(): "light" | "dark" {
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

/**
 * Maps the spec's host-style variable keys ({@link McpUiStyleVariableKey}) to
 * the inspector's underlying CSS custom properties. The inspector themes itself
 * with Mantine, so each spec token resolves to the matching Mantine design-token
 * variable (or an `--inspector-*` token layered on top of one). Only a curated
 * subset of the ~90 spec keys is mapped — the ones the inspector has a
 * meaningful equivalent for; the rest are omitted, which the spec allows (hosts
 * may provide any subset).
 */
const STYLE_VARIABLE_SOURCES: Partial<Record<McpUiStyleVariableKey, string>> = {
  "--color-background-primary": "--mantine-color-body",
  "--color-background-secondary": "--inspector-surface-card",
  "--color-background-tertiary": "--inspector-surface-subtle",
  "--color-text-primary": "--mantine-color-text",
  "--color-text-secondary": "--inspector-text-secondary",
  "--color-text-inverse": "--inspector-text-inverse",
  "--color-text-info": "--inspector-log-info",
  "--color-text-danger": "--inspector-log-error",
  "--color-text-success": "--inspector-status-connected",
  "--color-text-warning": "--inspector-log-warning",
  "--color-border-primary": "--inspector-border-default",
  "--color-border-secondary": "--inspector-border-subtle",
  "--font-sans": "--mantine-font-family",
  "--font-mono": "--mantine-font-family-monospace",
  "--font-text-xs-size": "--mantine-font-size-xs",
  "--font-text-sm-size": "--mantine-font-size-sm",
  "--font-text-md-size": "--mantine-font-size-md",
  "--font-text-lg-size": "--mantine-font-size-lg",
  "--border-radius-xs": "--mantine-radius-xs",
  "--border-radius-sm": "--mantine-radius-sm",
  "--border-radius-md": "--mantine-radius-md",
  "--border-radius-lg": "--mantine-radius-lg",
  "--border-radius-xl": "--mantine-radius-xl",
  "--shadow-sm": "--mantine-shadow-sm",
  "--shadow-md": "--mantine-shadow-md",
  "--shadow-lg": "--mantine-shadow-lg",
};

/**
 * Resolve the inspector's design tokens into a {@link McpUiHostStyles} for
 * hostContext, so style-aware apps can theme themselves from the host instead of
 * falling back to their own defaults. Reads the computed value of each mapped
 * CSS variable from the document root — which reflects the active Mantine color
 * scheme — and keeps only the ones that resolve to a non-empty value. Returns
 * undefined when nothing resolves (e.g. a non-DOM/test environment) so we never
 * advertise an empty styles object.
 *
 * Like {@link currentTheme}, this is read at bridge-build time to seed the
 * initial hostContext. Pushing the refreshed styles to an already-open app on a
 * theme flip rides the same AppBridge.setHostContext follow-up the theme does;
 * the function is exported so that wiring can reuse a single source of truth.
 */
export function currentStyles(): McpUiHostStyles | undefined {
  if (typeof document === "undefined" || typeof window === "undefined") {
    return undefined;
  }
  const computed = window.getComputedStyle(document.documentElement);
  const variables: McpUiStyles = {} as McpUiStyles;
  let resolved = false;
  for (const [specKey, sourceVar] of Object.entries(STYLE_VARIABLE_SOURCES)) {
    const value = computed.getPropertyValue(sourceVar).trim();
    if (value) {
      variables[specKey as McpUiStyleVariableKey] = value;
      resolved = true;
    }
  }
  return resolved ? { variables } : undefined;
}

/**
 * Spec shape for `hostContext.containerDimensions`. Derived from
 * {@link McpUiHostContext} so the seed and live-push paths share one source of
 * truth and stay in lockstep with the spec types.
 */
export type ContainerDimensions = NonNullable<
  McpUiHostContext["containerDimensions"]
>;

/**
 * Measure the host container an app renders into and return it as the spec's
 * fixed `{ width, height }` shape (whole pixels). Returns undefined when the
 * element has no layout box yet (0×0 — e.g. before the iframe is attached, or
 * in a non-DOM/test environment) so a meaningless size is never seeded into
 * hostContext.
 *
 * Exported so AppRenderer's ResizeObserver can reuse the same measurement for
 * live `host-context-changed` pushes.
 */
export function measureContainerDimensions(
  element: HTMLElement,
): ContainerDimensions | undefined {
  if (typeof element.getBoundingClientRect !== "function") return undefined;
  const rect = element.getBoundingClientRect();
  const width = Math.round(rect.width);
  const height = Math.round(rect.height);
  if (width <= 0 || height <= 0) return undefined;
  return { width, height };
}

/**
 * One MCP `notifications/message` log entry from a running app, stamped with a
 * host-side `id` (stable React key) and `timestamp` so the UI can render a
 * keyed, time-ordered log without re-processing on every push.
 */
export interface AppLogEntry {
  id: number;
  timestamp: number;
  level: LoggingMessageNotification["params"]["level"];
  logger?: string;
  data: unknown;
}

/**
 * Subscribe to a bridge's `loggingmessage` events and forward each one to
 * `onLog` as a stamped {@link AppLogEntry}. The inspector advertises the
 * `logging` host capability in {@link HOST_CAPABILITIES}, so a running app may
 * emit standard MCP log notifications — without a listener the bridge receives
 * them and silently drops them. Colocated with the other bridge-event wiring so
 * the SDK event surface stays in one file. Returns an unsubscribe function.
 */
export function subscribeAppLogs(
  bridge: AppBridge,
  onLog: (entry: AppLogEntry) => void,
): () => void {
  let nextId = 0;
  const handler = (params: LoggingMessageNotification["params"]) => {
    onLog({
      id: nextId++,
      timestamp: Date.now(),
      level: params.level,
      logger: params.logger,
      data: params.data,
    });
  };
  bridge.addEventListener("loggingmessage", handler);
  return () => bridge.removeEventListener("loggingmessage", handler);
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
 * Derive a safe suggested filename from a resource URI: the last path segment,
 * stripped of control/format characters, path separators, and characters
 * disallowed in filenames on common platforms. Falls back to `"download"` when
 * nothing usable remains.
 */
function fileNameFromUri(uri: string): string {
  const tail = uri.split(/[\\/]/).pop() ?? "";
  const safe = tail
    .replace(/[\p{Cc}\p{Cf}]+/gu, "")
    .replace(/[\\/:*?"<>|]+/g, "_")
    .trim();
  return safe.length > 0 ? safe.slice(0, 255) : "download";
}

/**
 * Strip control characters and clamp length so a server-supplied filename or
 * URI cannot forge additional lines in the confirmation prompt or push the
 * real summary off-screen.
 */
function sanitizeDownloadLabel(label: string): string {
  // Cc = control chars (newlines, escape, etc.); Cf = format chars (bidi
  // overrides, zero-width joiners, BOM) — both can spoof or reflow the prompt.
  const cleaned = label.replace(/[\p{Cc}\p{Cf}]+/gu, " ").trim();
  return cleaned.length > 80 ? cleaned.slice(0, 77) + "..." : cleaned;
}

/** Human-readable label for a download item, shown in the confirmation prompt. */
function describeDownloadItem(item: EmbeddedResource | ResourceLink): string {
  if (item.type === "resource_link") return item.uri;
  return fileNameFromUri(item.resource.uri);
}

/**
 * Trigger a browser download for a single MCP resource item. Inline
 * {@link EmbeddedResource}s (text or base64 blob) are written via an
 * object-URL anchor click. A {@link ResourceLink} is *opened* in a new tab —
 * the inspector does not fetch the URL to disk itself, since the link may
 * require auth or content negotiation the browser can supply but we cannot.
 * Returns false when the item carries nothing downloadable or its URI is
 * rejected by the http(s)-only allowlist.
 */
function downloadResourceItem(item: EmbeddedResource | ResourceLink): boolean {
  if (item.type === "resource_link") {
    let parsed: URL;
    try {
      parsed = new URL(item.uri);
    } catch {
      return false;
    }
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      return false;
    }
    window.open(parsed.href, "_blank", "noopener,noreferrer");
    return true;
  }
  const resource = item.resource;
  const blob =
    "blob" in resource
      ? new Blob([base64ToBytes(resource.blob)], {
          type: resource.mimeType ?? "application/octet-stream",
        })
      : new Blob([resource.text], { type: resource.mimeType ?? "text/plain" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileNameFromUri(resource.uri);
  // Some browsers ignore programmatic clicks on detached anchors.
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  // Defer the revoke: link.click() only schedules the download, and revoking
  // the object URL synchronously can abort it before the browser reads the
  // blob (Firefox/Safari, intermittently Chrome for larger blobs).
  setTimeout(() => URL.revokeObjectURL(url), 0);
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

    // Per-app copy so the approved-sandbox echo (set on sandboxready below) never
    // mutates the shared HOST_CAPABILITIES constant — each app may declare its own
    // csp/permissions.
    const hostCapabilities: McpUiHostCapabilities = { ...HOST_CAPABILITIES };
    const styles = currentStyles();
    const containerDimensions = measureContainerDimensions(iframe);
    const bridge = new AppBridge(client, HOST_INFO, hostCapabilities, {
      hostContext: {
        theme: currentTheme(),
        displayMode: "inline",
        availableDisplayModes: [...HOST_AVAILABLE_DISPLAY_MODES],
        ...(styles ? { styles } : {}),
        ...(containerDimensions ? { containerDimensions } : {}),
      },
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
          // <meta>. The proxy writes that document verbatim — it never parses
          // the untrusted bytes — so the policy is guaranteed to apply before
          // any app content loads. The approved (post-filter) csp is what we
          // echo back via hostCapabilities.sandbox so the view sees what was
          // granted, not what it asked for. Set before sendSandboxResourceReady:
          // the view only sends ui/initialize once it has the HTML, so the
          // bridge reflects this in the initialize result.
          const approvedCsp = approveCspSources(meta?.csp);
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
    // declined prompt, an empty payload, or a thrown error all return isError.
    bridge.ondownloadfile = async ({ contents }) => {
      if (!Array.isArray(contents) || contents.length === 0) {
        return { isError: true };
      }
      const summary = contents
        .map((item) => sanitizeDownloadLabel(describeDownloadItem(item)))
        .join("\n");
      const approved = window.confirm(
        `This MCP App wants to download ${contents.length} file(s):\n\n${summary}`,
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
