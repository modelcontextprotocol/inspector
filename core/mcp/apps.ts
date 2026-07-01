import { getToolUiResourceUri } from "@modelcontextprotocol/ext-apps/app-bridge";
import type {
  ReadResourceResult,
  Tool,
} from "@modelcontextprotocol/sdk/types.js";

/**
 * Returns the UI resource URI advertised by an MCP App tool, or `undefined`
 * for non-App tools.
 *
 * Reads from `tool._meta.ui.resourceUri` (preferred nested format) and falls
 * back to the deprecated flat `tool._meta["ui/resourceUri"]` key. The nested
 * format wins when both are present.
 *
 * Throws when `_meta` advertises a UI resource URI that is not a string
 * starting with `ui://`. We surface the underlying ext-apps error rather than
 * silently dropping the tool, because a malformed URI is a server bug worth
 * making visible.
 *
 * Wraps `getToolUiResourceUri` from `@modelcontextprotocol/ext-apps/app-bridge`
 * so that web, CLI, and TUI all consume the same implementation through
 * `@inspector/core`.
 */
export function getAppResourceUri(tool: Tool): string | undefined {
  return getToolUiResourceUri(tool);
}

/**
 * Single source of truth for App-tool detection across all Inspector clients.
 * Wraps {@link getAppResourceUri}; throws on a malformed `_meta.ui.resourceUri`
 * for the same reason.
 *
 * Note: because this throws on malformed URIs, callers using
 * `tools.filter(isAppTool)` will halt iteration on the first bad tool. Wrap in
 * a try/catch (or a safe-predicate helper) at the call site if you need to
 * tolerate mixed-validity tool lists.
 */
export function isAppTool(tool: Tool): boolean {
  return getAppResourceUri(tool) !== undefined;
}

/**
 * Machine-readable summary of an MCP App's UI metadata, combining what the
 * tool advertises (`resourceUri`, `visibility`) with what the UI resource
 * itself declares (`csp`, `permissions`, `domain`, `prefersBorder`). Emitted by
 * the CLI's `--app-info` mode and reusable by any client that needs to surface
 * an app's security posture without rendering it.
 */
export interface AppInfo {
  hasApp: boolean;
  toolName: string;
  resourceUri?: string;
  visibility?: readonly string[];
  /** From the UI resource's `_meta.ui` (per spec, csp/permissions/domain live on the resource, not the tool). Absent when the resource was not read. */
  csp?: Readonly<Record<string, unknown>>;
  permissions?: Readonly<Record<string, unknown>>;
  domain?: string;
  prefersBorder?: boolean;
  resourceMimeType?: string;
}

type WithUiMeta = { _meta?: { ui?: unknown } };

/**
 * Structural shape for `_meta.ui` carriers — the ext-apps package's named
 * types (`McpUiToolMeta`, `McpUiResourceMeta`) are not importable under
 * NodeNext module resolution because of an extensionless re-export in the
 * package's `.d.ts`, so we read the fields structurally instead. The values
 * pass through verbatim into {@link AppInfo}; callers can narrow them against
 * the published Zod schemas if they need strict typing.
 *
 * TODO: switch to the named `McpUiToolMeta` / `McpUiResourceMeta` types once
 * upstream fixes the extensionless re-export so they resolve under NodeNext.
 */
interface UiMetaShape {
  visibility?: readonly string[];
  csp?: Record<string, unknown>;
  permissions?: Record<string, unknown>;
  domain?: string;
  prefersBorder?: boolean;
}

/**
 * Reads a carrier's `_meta.ui` structurally, narrowing from `unknown` so call
 * sites don't need their own casts. Returns `undefined` unless both the carrier
 * and its `_meta.ui` are non-null objects.
 */
function readUiMeta(carrier: unknown): UiMetaShape | undefined {
  const ui =
    carrier !== null && typeof carrier === "object"
      ? (carrier as WithUiMeta)._meta?.ui
      : undefined;
  return ui !== null && typeof ui === "object"
    ? (ui as UiMetaShape)
    : undefined;
}

/**
 * Normalizes a `ui://…` URI for comparison so trivial server-side differences
 * (case, trailing slash) don't cause us to miss the resource block and silently
 * drop its `_meta.ui` (csp/permissions/domain). `ui://` is a non-special scheme
 * so the WHATWG URL parser preserves case and trailing slashes verbatim — we
 * apply a targeted lowercase + single trailing-slash strip instead.
 */
function normalizeResourceUri(uri: string): string {
  const lowered = uri.toLowerCase();
  return lowered.endsWith("/") ? lowered.slice(0, -1) : lowered;
}

/**
 * Locates the content block in a `resources/read` result that corresponds to
 * the requested UI resource. Tries exact match, then normalized-URI match, then
 * falls back to the sole content block when there is only one — `resources/read`
 * by definition returns the content for the URI we asked for, so a single-block
 * response is the right block even when the server echoes the URI back in a
 * slightly different form.
 */
function findResourceContent(
  resource: ReadResourceResult,
  requestedUri: string,
): ReadResourceResult["contents"][number] | undefined {
  const exact = resource.contents.find((c) => c.uri === requestedUri);
  if (exact) return exact;
  const norm = normalizeResourceUri(requestedUri);
  const normalized = resource.contents.find(
    (c) => normalizeResourceUri(c.uri) === norm,
  );
  if (normalized) return normalized;
  return resource.contents.length === 1 ? resource.contents[0] : undefined;
}

/**
 * Build an {@link AppInfo} from a tool definition and (optionally) the
 * `resources/read` result for its UI resource. Per the spec, `csp` /
 * `permissions` / `domain` belong on the resource — not the tool — so a caller
 * that wants the security posture must read the resource and pass it here.
 *
 * Returns `{ hasApp: false, toolName }` for non-App tools. Throws on a
 * malformed `resourceUri` for the same reason {@link getAppResourceUri} does.
 */
export function extractAppInfo(
  tool: Tool,
  resource?: ReadResourceResult,
): AppInfo {
  const resourceUri = getAppResourceUri(tool);
  if (resourceUri === undefined) {
    return { hasApp: false, toolName: tool.name };
  }
  const toolUi = readUiMeta(tool);
  const content = resource && findResourceContent(resource, resourceUri);
  // Precedence is intentional: prefer the matched content block's `_meta.ui`,
  // falling back to the result-level `_meta.ui`. Per the current spec the
  // security posture (csp/permissions/domain) lives on the content block, so we
  // don't shallow-merge the two carriers — a content block that declares any
  // `ui` is treated as authoritative for all of its fields.
  const resourceUi = readUiMeta(content) ?? readUiMeta(resource);
  return {
    hasApp: true,
    toolName: tool.name,
    resourceUri,
    ...(toolUi?.visibility ? { visibility: toolUi.visibility } : {}),
    ...(resourceUi?.csp ? { csp: resourceUi.csp } : {}),
    ...(resourceUi?.permissions ? { permissions: resourceUi.permissions } : {}),
    ...(resourceUi?.domain ? { domain: resourceUi.domain } : {}),
    ...(resourceUi?.prefersBorder !== undefined
      ? { prefersBorder: resourceUi.prefersBorder }
      : {}),
    ...(typeof content?.mimeType === "string"
      ? { resourceMimeType: content.mimeType }
      : {}),
  };
}
