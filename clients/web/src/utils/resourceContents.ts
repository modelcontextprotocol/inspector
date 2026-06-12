import type {
  BlobResourceContents,
  ContentBlock,
  TextResourceContents,
} from "@modelcontextprotocol/sdk/types.js";

/**
 * A single item from a `resources/read` result — either inline text or a
 * base64-encoded blob.
 */
export type ResourceContentsItem = TextResourceContents | BlobResourceContents;

/**
 * Convert a resource-contents item (as returned by `resources/read`) into a
 * `ContentBlock` that {@link ContentViewer} knows how to render. Text items
 * become text blocks; image/audio blobs become their respective media blocks;
 * any other blob falls back to a human-readable placeholder since the viewer
 * cannot preview arbitrary binary data.
 */
export function resourceContentsToBlock(
  item: ResourceContentsItem,
): ContentBlock {
  if ("text" in item) {
    return { type: "text", text: item.text };
  }
  const mimeType = item.mimeType ?? "application/octet-stream";
  if (mimeType.startsWith("image/")) {
    return { type: "image", data: item.blob, mimeType };
  }
  if (mimeType.startsWith("audio/")) {
    return { type: "audio", data: item.blob, mimeType };
  }
  return {
    type: "text",
    text: `[Binary content (${mimeType}) — preview not supported]`,
  };
}
