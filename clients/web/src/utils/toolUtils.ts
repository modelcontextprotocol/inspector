/**
 * Returns the display label for an MCP entity that follows the BaseMetadata
 * shape (Tool, Prompt, Resource): the optional `title` if provided, else the
 * machine `name`. Centralized so list items, detail panels, and screens stay
 * consistent.
 */
export function resolveDisplayLabel(name: string, title?: string): string {
  return title ?? name;
}
