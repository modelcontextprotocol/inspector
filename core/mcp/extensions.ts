import type { ClientCapabilities } from "@modelcontextprotocol/client";
import { RESOURCE_MIME_TYPE } from "@modelcontextprotocol/ext-apps/app-bridge";
import { TASKS_EXTENSION_KEY } from "./modernTaskSchemas.js";
import { SKILLS_EXTENSION_KEY } from "./skillsSchemas.js";

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
 * imported: as of ext-apps 2.0.0 that constant is still exported only from the
 * package's `/server` subpath, which would pull server-only code (and the
 * optional `@modelcontextprotocol/server` peer) into the browser bundle. The
 * node integration test `extensions-mimetype.test.ts` pins the two together.
 * Advertised by default only by a client that can render MCP Apps (the web
 * client) — see {@link BuildClientExtensionsInput.rendersApps} (#1740, #2403).
 */
export const UI_EXTENSION_KEY = "io.modelcontextprotocol/ui";

/**
 * The MCP Apps UI resource MIME type the Inspector renders. A server checks for
 * it in the client's advertised `io.modelcontextprotocol/ui` `mimeTypes` to
 * decide whether to serve an App. Re-exported from ext-apps' `/app-bridge`
 * subpath — the one the Inspector already imports everywhere — rather than
 * restated: the extensionless re-export that once kept this a hardcoded copy
 * was fixed upstream (ext-apps#705) and shipped in 2.0.0 (#1745).
 */
export const MCP_APP_MIME_TYPE = RESOURCE_MIME_TYPE;

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
  /**
   * True when advertising this extension claims the client can render MCP
   * Apps. Its `defaultAdvertised` then applies only to a client that sets
   * {@link BuildClientExtensionsInput.rendersApps}; any other client leaves it
   * off unless the user explicitly overrides it on. A server uses the
   * advertisement to decide whether to return an App, so a client that cannot
   * render one must not claim it by default (#2403).
   */
  requiresAppRenderer?: boolean;
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
    // The MCP Apps UI extension, advertised with the App resource MIME type the
    // Inspector renders — a conforming server checks the `mimeTypes` before
    // serving a UI resource. Default-on only where Apps can actually be
    // rendered (the web client); the CLI and TUI cannot, so they leave it off
    // unless explicitly overridden (#2403).
    defaultAdvertised: true,
    requiresAppRenderer: true,
    advertisement: { mimeTypes: [MCP_APP_MIME_TYPE] },
  },
  {
    key: SKILLS_EXTENSION_KEY,
    label: "Skills (io.modelcontextprotocol/skills)",
    // The Skills extension (SEP-2640). SEP-2133 negotiates an extension from
    // both sides, so a server may refuse `skills/list`, `skills/get` and
    // `resources/directory/read` to a client that did not declare it — and the
    // Inspector calls all three once the server declares its half. Advertised
    // by default for that reason; turning it off is how to check a server's
    // refusal path. Declared with no settings: SEP-2640 defines none for the
    // client side. (#2373)
    defaultAdvertised: true,
  },
];

/**
 * Whether `ext` is advertised when the user has set no override for it: its
 * registry `defaultAdvertised`, except that an entry marked
 * `requiresAppRenderer` defaults off on a client that cannot render Apps
 * (#2403). Shared by {@link buildClientExtensions} and the Server Settings
 * form, so the toggle shows exactly what the client will declare.
 */
export function isAdvertisedByDefault(
  ext: AdvertisableExtension,
  rendersApps: boolean,
): boolean {
  return ext.defaultAdvertised && (!ext.requiresAppRenderer || rendersApps);
}

export interface BuildClientExtensionsInput {
  /** True when the connection routes through the enterprise IdP (EMA). */
  enterpriseManaged: boolean;
  /**
   * Per-extension advertise overrides keyed by extension id, from
   * {@link InspectorClientOptions.advertisedExtensions}. A key present here wins
   * over the registry's `defaultAdvertised`; an absent key falls back to it.
   */
  advertised?: Record<string, boolean>;
  /**
   * True when this client can render MCP Apps. Gates the registry default of
   * every entry marked `requiresAppRenderer` (today the UI extension): without
   * it such an entry is advertised only on an explicit override. Defaults to
   * false, so the CLI and TUI — which share `InspectorClient` but have no
   * renderer — do not misrepresent themselves to servers (#2403).
   */
  rendersApps?: boolean;
  /**
   * True when this client can render an MCP App and resolve an
   * `elicitation/create` request through its bridge (#1854). Adds the nested
   * `elicitation` setting to the UI extension's advertisement, which is half of
   * the negotiation a server checks before attaching an App to an elicitation.
   *
   * Deliberately an input rather than a registry default: the shared
   * `InspectorClient` knowing the MCP Apps MIME type says nothing about whether
   * the *client* has a sandbox renderer, so CLI and TUI must never advertise it.
   * Ignored when the UI extension itself is not advertised — a nested setting on
   * an extension we did not declare would be meaningless.
   */
  appElicitation?: boolean;
}

/**
 * Assemble the `capabilities.extensions` map advertised at construction — the
 * single source of truth that replaces the previously ad-hoc, per-extension
 * spreads. Registry entries resolve to advertised/not via the user override with
 * a registry-default fallback; EMA is layered on top as an auth-mode-driven
 * built-in.
 *
 * An entry marked `requiresAppRenderer` defaults to advertised only when
 * `rendersApps` is set (#2403).
 *
 * With the Tasks entry defaulting to advertised, the map is non-empty for a
 * default config, so `capabilities.extensions` is always attached.
 */
export function buildClientExtensions(
  input: BuildClientExtensionsInput,
): Record<string, ExtensionAdvertisement> {
  const map: Record<string, ExtensionAdvertisement> = {};
  for (const ext of ADVERTISABLE_EXTENSIONS) {
    const advertised =
      input.advertised?.[ext.key] ??
      isAdvertisedByDefault(ext, input.rendersApps === true);
    if (advertised) {
      // Clone the registry advertisement so the returned map never aliases the
      // shared `ADVERTISABLE_EXTENSIONS` entry — a later in-place mutation of a
      // stamped value (e.g. `extensions[ui].mimeTypes`) can't corrupt the
      // registry for subsequent connections. `{}` entries are fresh literals.
      map[ext.key] = ext.advertisement
        ? structuredClone(ext.advertisement)
        : {};
    }
  }
  // Nested app-rendered-elicitation opt-in (#1854), layered onto the UI
  // extension's own advertisement rather than added as a second extension.
  // Guarded on the UI entry actually being present so turning the Apps
  // extension off in Server Settings also turns this off.
  const uiAdvertisement = map[UI_EXTENSION_KEY];
  if (input.appElicitation && uiAdvertisement) {
    map[UI_EXTENSION_KEY] = { ...uiAdvertisement, elicitation: {} };
  }
  if (input.enterpriseManaged) {
    map[EMA_EXTENSION_KEY] = {};
  }
  return map;
}
