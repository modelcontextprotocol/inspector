import type {
  ClientCapabilities,
  ElicitRequest,
  ElicitResult,
  JsonSchemaType,
  jsonSchemaValidator,
  ServerCapabilities,
} from "@modelcontextprotocol/client";
import { MCP_APP_MIME_TYPE, UI_EXTENSION_KEY } from "./extensions.js";

/**
 * App-rendered form elicitations (#1854).
 *
 * A server may attach an MCP App resource to a standard `elicitation/create`
 * request; a host that can run MCP Apps renders that app and returns the app's
 * ordinary `ElicitResult` to the server. No second extension, no custom method,
 * and no custom result shape are introduced — the only new wire surface is a
 * nested `elicitation` flag on the existing `io.modelcontextprotocol/ui`
 * extension on each side, plus `_meta.ui.resourceUri` on the request.
 *
 * The helpers here mirror the ext-apps draft (modelcontextprotocol/ext-apps#733,
 * SEP-3118) so the Inspector speaks exactly the proposed protocol. They are
 * declared locally only because the released `@modelcontextprotocol/ext-apps`
 * (1.7.5) predates that PR and exports none of them; replace
 * {@link supportsAppElicitation} / {@link getElicitationUiResourceUri} with the
 * package's `/server` exports once a release containing #733 ships.
 */

/**
 * MCP Apps extension settings advertised by a client, as far as app-rendered
 * elicitation cares. Mirrors ext-apps' `McpUiClientCapabilities`.
 */
export interface UiClientCapabilities {
  mimeTypes?: string[];
  elicitation?: object;
}

/**
 * MCP Apps extension settings advertised by a server. Mirrors ext-apps'
 * `McpUiServerCapabilities` (introduced by #733): a server sets `elicitation`
 * to declare it may attach an App resource to a form elicitation.
 */
export interface UiServerCapabilities {
  elicitation?: object;
}

/** Reads the `io.modelcontextprotocol/ui` block out of either side's capabilities. */
function uiExtension(
  capabilities: { extensions?: Record<string, unknown> } | null | undefined,
): Record<string, unknown> | undefined {
  const ext = capabilities?.extensions?.[UI_EXTENSION_KEY];
  return typeof ext === "object" && ext !== null
    ? (ext as Record<string, unknown>)
    : undefined;
}

/** The MCP Apps settings a client advertised, or `undefined`. */
export function getUiClientCapability(
  capabilities: ClientCapabilities | null | undefined,
): UiClientCapabilities | undefined {
  return uiExtension(capabilities) as UiClientCapabilities | undefined;
}

/** The MCP Apps settings a server advertised, or `undefined`. */
export function getUiServerCapability(
  capabilities: ServerCapabilities | null | undefined,
): UiServerCapabilities | undefined {
  return uiExtension(capabilities) as UiServerCapabilities | undefined;
}

/**
 * Whether both peers negotiated app-rendered form elicitation. All of the
 * protocol's conditions except the per-request `_meta` are checked here:
 *
 * 1. the client advertised core form elicitation (`elicitation.form`);
 * 2. the client advertised the MCP Apps MIME type;
 * 3. the client advertised the nested MCP Apps `elicitation` setting;
 * 4. the server advertised the nested MCP Apps `elicitation` setting.
 *
 * A MIME-type match alone is deliberately not sufficient — a client that can
 * render App *tools* cannot necessarily resolve an elicitation through a bridge.
 */
export function supportsAppElicitation(
  clientCapabilities: ClientCapabilities | null | undefined,
  serverCapabilities: ServerCapabilities | null | undefined,
): boolean {
  const clientUi = getUiClientCapability(clientCapabilities);
  const serverUi = getUiServerCapability(serverCapabilities);
  return Boolean(
    clientCapabilities?.elicitation?.form &&
    clientUi?.mimeTypes?.includes(MCP_APP_MIME_TYPE) &&
    clientUi.elicitation &&
    serverUi?.elicitation,
  );
}

const ELICITATION_UI_URI_ERROR =
  "Elicitation UI resourceUri must be an absolute ui:// URI";

/**
 * Rejects anything that is not an absolute `ui://host/...` URI. Matches the
 * ext-apps#733 validator: a bare scheme, a relative reference, or a non-`ui`
 * scheme are all unusable and must not reach the renderer.
 */
function validateElicitationUiResourceUri(resourceUri: string): void {
  let parsed: URL;
  try {
    parsed = new URL(resourceUri);
  } catch {
    throw new Error(ELICITATION_UI_URI_ERROR);
  }
  if (
    parsed.protocol !== "ui:" ||
    !/^ui:\/\//i.test(resourceUri) ||
    parsed.host.length === 0
  ) {
    throw new Error(ELICITATION_UI_URI_ERROR);
  }
}

/**
 * Reads `_meta.ui.resourceUri` off an `elicitation/create` request.
 *
 * Returns `undefined` when the server attached no App (the ordinary case — the
 * native elicitation UI handles it). Throws when the metadata is present but
 * unusable, so the caller can log the server bug and still fall back rather
 * than rendering something arbitrary.
 */
export function getElicitationUiResourceUri(
  params: ElicitRequest["params"],
): string | undefined {
  const ui = (params._meta as { ui?: unknown } | undefined)?.ui;
  if (typeof ui !== "object" || ui === null) return undefined;
  const resourceUri = (ui as Record<string, unknown>).resourceUri;
  if (resourceUri === undefined) return undefined;
  if (typeof resourceUri !== "string") {
    throw new Error("Elicitation UI resourceUri must be a string");
  }
  validateElicitationUiResourceUri(resourceUri);
  return resourceUri;
}

/**
 * Only `form` mode is app-renderable; an omitted mode IS form (the mode field
 * post-dates form elicitation). `url` mode keeps its existing path.
 */
export function isFormElicitation(params: ElicitRequest["params"]): boolean {
  const mode = (params as { mode?: unknown }).mode;
  return mode === undefined || mode === "form";
}

/** The three actions a completed elicitation may report. */
const ELICIT_ACTIONS = ["accept", "decline", "cancel"] as const;

/**
 * Validates what an app returned before it is handed back to the server.
 *
 * Returns a human-readable reason when the value is not a usable
 * `ElicitResult` — an unknown action, an `accept` with no content object, or
 * content that fails the request's own `requestedSchema` — and `undefined` when
 * it is fine. The value is untrusted (it came from sandboxed app code), so the
 * runtime checks stand regardless of the declared type.
 *
 * A failure here is a fallback trigger, not a protocol error: the host drops to
 * the native elicitation UI rather than sending the server something that does
 * not match what it asked for.
 */
export function validateAppElicitResult(
  provider: jsonSchemaValidator,
  params: ElicitRequest["params"],
  result: ElicitResult,
): string | undefined {
  if (typeof result !== "object" || result === null) {
    return "App returned a non-object elicitation result";
  }
  const action = (result as { action?: unknown }).action;
  if (!ELICIT_ACTIONS.includes(action as (typeof ELICIT_ACTIONS)[number])) {
    return `App returned an unknown elicitation action: ${JSON.stringify(action)}`;
  }
  // decline / cancel carry no content — they are complete as they stand.
  if (action !== "accept") return undefined;
  const content = (result as { content?: unknown }).content;
  if (
    typeof content !== "object" ||
    content === null ||
    Array.isArray(content)
  ) {
    return "App accepted the elicitation without a content object";
  }
  const schema = (params as { requestedSchema?: unknown }).requestedSchema;
  if (typeof schema !== "object" || schema === null) return undefined;
  try {
    // `requestedSchema` is the SDK's own object-schema shape and `JsonSchemaType`
    // the validator provider's third-party JSON Schema interface — structurally
    // compatible, nominally unrelated, exactly as in `validateToolOutput`.
    const validate = provider.getValidator(schema as JsonSchemaType);
    const validation = validate(content);
    return validation.valid
      ? undefined
      : `App content does not match the requested schema: ${validation.errorMessage}`;
  } catch {
    // A schema the validator cannot compile is the server's problem, not the
    // app's; don't reject a result over it (mirrors `validateToolOutput`).
    return undefined;
  }
}

/**
 * One app-rendered elicitation, scoped to the originating request.
 *
 * `requestId` is what makes the association request-scoped: the host keys its
 * renderer/bridge by it, so two concurrent elicitations for different resource
 * URIs can never resolve through each other's bridges.
 */
export interface AppElicitationRequest {
  /** Unique per originating `elicitation/create` request. */
  requestId: string;
  /** The validated absolute `ui://` URI the app is loaded from. */
  resourceUri: string;
  /** The original request params, forwarded through the bridge unchanged. */
  params: ElicitRequest["params"];
  /** Aborts when the originating request is cancelled or the client disconnects. */
  signal: AbortSignal;
}

/**
 * Host-supplied renderer for {@link AppElicitationRequest}s. Only a client that
 * can actually host MCP Apps (today: the web client, when its sandbox renderer
 * is available) provides one — providing it is what opts the client into
 * advertising the nested MCP Apps `elicitation` capability.
 *
 * Resolves with the app's standard `ElicitResult`. Rejecting is a request to
 * fall back to the native elicitation UI; it must not be used to signal a user
 * decision, since `decline` and `cancel` are themselves completed elicitations.
 */
export type AppElicitationRenderer = (
  request: AppElicitationRequest,
) => Promise<ElicitResult>;
