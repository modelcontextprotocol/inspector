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
      map[ext.key] = {};
    }
  }
  if (input.enterpriseManaged) {
    map[EMA_EXTENSION_KEY] = {};
  }
  return map;
}
