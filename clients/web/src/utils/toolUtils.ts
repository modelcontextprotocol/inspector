import type { Tool } from "@modelcontextprotocol/sdk/types.js";

/**
 * Returns the display label for an MCP entity that follows the BaseMetadata
 * shape (Tool, Prompt, Resource): the optional `title` if provided, else the
 * machine `name`. Centralized so list items, detail panels, and screens stay
 * consistent.
 */
export function resolveDisplayLabel(name: string, title?: string): string {
  return title ?? name;
}

/**
 * True when the tool's input schema declares at least one property — used by
 * App-flow callers to decide whether to render a form or auto-launch. Kept in
 * one place so the definition of "has fields" stays consistent if it ever
 * grows to consider `additionalProperties`, `anyOf`, etc.
 */
export function hasInputFields(tool: Tool): boolean {
  return Object.keys(tool.inputSchema.properties ?? {}).length > 0;
}
