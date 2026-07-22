import type { ClientCapabilities } from "@modelcontextprotocol/client";
import { TASKS_EXTENSION_KEY } from "./modernTaskSchemas.js";

/**
 * Extension identifier for SEP-2350 enterprise-managed authorization. Advertised
 * when the connection routes through the enterprise IdP (EMA), which is a
 * property of the auth mode rather than a free debugging toggle — so it is a
 * conditional built-in in {@link buildClientExtensions}, not a registry entry.
 */
export const EMA_EXTENSION_KEY =
  "io.modelcontextprotocol/enterprise-managed-authorization";

/**
 * Extension identifier for the MCP Apps UI extension (SEP-ext-apps). Mirrors
 * `EXTENSION_ID` from `@modelcontextprotocol/ext-apps`. Hardcoded rather than
 * imported: that constant lives on the package's `/server` subpath, which would
 * pull server-only code into the browser bundle. The Inspector always renders
 * MCP Apps, so this is advertised by default (#1740).
 */
export const UI_EXTENSION_KEY = "io.modelcontextprotocol/ui";

/**
 * The MCP Apps UI resource MIME type the Inspector renders. Mirrors
 * `RESOURCE_MIME_TYPE` from `@modelcontextprotocol/ext-apps`; a server checks
 * for it in the client's advertised `io.modelcontextprotocol/ui` `mimeTypes` to
 * decide whether to serve an App. Hardcoded (stable spec string) because
 * ext-apps re-exports it through an extensionless path that doesn't resolve
 * cleanly under NodeNext — see the same note in `core/mcp/apps.ts`.
 */
export const MCP_APP_MIME_TYPE = "text/html;profile=mcp-app";

/**
 * The value the client stamps for each advertised extension. The wire shape is
 * `{ [extensionId]: object }` (per `ClientCapabilities.extensions`); an empty
 * object is the standard "declared, no sub-options" advertisement.
 */
export type ExtensionAdvertisement = NonNullable<
  ClientCapabilities["extensions"]
>[string];

/**
 * A single Inspector-advertisable extension. The registry of these is the shared
 * source of truth for both the capability builder here and the Server Settings
 * toggle UI (#1739), so the two never drift on which extensions exist or what
 * they are called.
 */
export interface AdvertisableExtension {
  /** Extension identifier stamped into `capabilities.extensions`. */
  key: string;
  /** Human-readable label for the Server Settings toggle. */
  label: string;
  /**
   * Whether the Inspector advertises this extension when the user has expressed
   * no explicit preference (the toggle's default position).
   */
  defaultAdvertised: boolean;
  /**
   * The object value stamped into `capabilities.extensions[key]` when
   * advertised. Defaults to `{}` (declared, no sub-options); an extension that
   * carries settings — e.g. the UI extension's `mimeTypes` — sets its own shape.
   */
  advertisement?: ExtensionAdvertisement;
}

/**
 * Catalog of extensions the Inspector can advertise and the user can toggle.
 * EMA is deliberately absent — it is driven by the auth mode (see
 * {@link EMA_EXTENSION_KEY}), not a standalone toggle. The `io.modelcontextprotocol/ui`
 * Apps extension is added here in Phase 3 (#1740).
 */
export const ADVERTISABLE_EXTENSIONS: readonly AdvertisableExtension[] = [
  {
    key: TASKS_EXTENSION_KEY,
    label: "Tasks (io.modelcontextprotocol/tasks)",
    // The modern Tasks extension (SEP-2663). Advertised by default so the SDK
    // stamps it into every modern request envelope — the per-request
    // declaration a server requires before it may return a `CreateTaskResult`
    // (server-directed task creation). Harmless on legacy (extensions ignored).
    defaultAdvertised: true,
  },
  {
    key: UI_EXTENSION_KEY,
    label: "MCP Apps UI (io.modelcontextprotocol/ui)",
    // The MCP Apps UI extension. The Inspector always renders App tools, so it
    // advertises this by default with the App resource MIME type it supports —
    // a conforming server checks the `mimeTypes` before serving a UI resource.
    defaultAdvertised: true,
    advertisement: { mimeTypes: [MCP_APP_MIME_TYPE] },
  },
];

export interface BuildClientExtensionsInput {
  /** True when the connection routes through the enterprise IdP (EMA). */
  enterpriseManaged: boolean;
  /**
   * Per-extension advertise overrides keyed by extension id, from
   * {@link InspectorClientOptions.advertisedExtensions}. A key present here wins
   * over the registry's `defaultAdvertised`; an absent key falls back to it.
   */
  advertised?: Record<string, boolean>;
}

/**
 * Assemble the `capabilities.extensions` map advertised at construction — the
 * single source of truth that replaces the previously ad-hoc, per-extension
 * spreads. Registry entries resolve to advertised/not via the user override with
 * a registry-default fallback; EMA is layered on top as an auth-mode-driven
 * built-in.
 *
 * With the Tasks entry defaulting to advertised, the map is non-empty for a
 * default config, so `capabilities.extensions` is always attached.
 */
export function buildClientExtensions(
  input: BuildClientExtensionsInput,
): Record<string, ExtensionAdvertisement> {
  const map: Record<string, ExtensionAdvertisement> = {};
  for (const ext of ADVERTISABLE_EXTENSIONS) {
    const advertised = input.advertised?.[ext.key] ?? ext.defaultAdvertised;
    if (advertised) {
      map[ext.key] = ext.advertisement ?? {};
    }
  }
  if (input.enterpriseManaged) {
    map[EMA_EXTENSION_KEY] = {};
  }
  return map;
}
