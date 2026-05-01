import { getToolUiResourceUri } from "@modelcontextprotocol/ext-apps/app-bridge";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";

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
