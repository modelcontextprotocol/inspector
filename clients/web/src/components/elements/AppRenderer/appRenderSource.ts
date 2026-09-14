import type { Tool } from "@modelcontextprotocol/client";

/**
 * What the renderer loads into the sandbox.
 *
 * An App tool names its UI resource through `_meta.ui.resourceUri`, but an
 * app-rendered elicitation (#1854) has no tool at all — the server names the
 * resource on the `elicitation/create` request itself. The source is therefore
 * a union rather than a `Tool`, so the same renderer, bridge factory and
 * sandbox lifecycle serve both without either faking the other's shape.
 *
 * Lives beside `AppRenderer` rather than in it because a module that exports a
 * component may export nothing else (the react-refresh rule).
 */
export type AppRenderSource =
  | { readonly kind: "tool"; readonly tool: Tool }
  | {
      readonly kind: "resource";
      /** Absolute `ui://` URI of the app to load. */
      readonly resourceUri: string;
      /** Frame title; falls back to the URI. */
      readonly title?: string;
    };

/**
 * Whether two sources name the same app, so the renderer can keep a live bridge
 * instead of rebuilding it.
 *
 * Identity alone is not enough: a caller that writes the source inline produces
 * a fresh object every render, and rebuilding on that double-loads the sandbox
 * and races the app's handshake (the failure AppRenderer's reuse dance exists to
 * avoid). For a tool the comparison stays *identity of the Tool*, exactly as
 * before this union existed, so a re-listed tool still rebuilds.
 */
export function sameAppSource(a: AppRenderSource, b: AppRenderSource): boolean {
  if (a === b) return true;
  if (a.kind === "tool" && b.kind === "tool") return a.tool === b.tool;
  if (a.kind === "resource" && b.kind === "resource") {
    return a.resourceUri === b.resourceUri && a.title === b.title;
  }
  return false;
}

/** The iframe's accessible name for a source. */
export function appSourceTitle(source: AppRenderSource): string {
  return source.kind === "tool"
    ? (source.tool.title ?? source.tool.name)
    : (source.title ?? source.resourceUri);
}
