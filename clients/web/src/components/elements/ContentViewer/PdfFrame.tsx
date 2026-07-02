import { Box } from "@mantine/core";
import { useMemo } from "react";
import { BinaryNotice } from "./BinaryNotice";
import { tryDecodeBase64ToBytes } from "./contentViewerUtils";
import { useObjectUrl } from "./useObjectUrl";

/**
 * Render a base64-encoded PDF in an in-page viewer. The bytes are wrapped in a
 * `Blob` and served via an object URL (revoked on unmount / when the data
 * changes) rather than a multi-megabyte `data:` URI. `#view=FitH` asks the
 * browser's built-in viewer to fit the page width.
 *
 * The `blob` comes from an external MCP server; if its base64 fails to decode
 * we degrade to the binary-content notice instead of throwing during render.
 */
export interface PdfFrameProps {
  /** Base64-encoded PDF bytes (the `blob` field of a `BlobResourceContents`). */
  data: string;
}

export function PdfFrame({ data }: PdfFrameProps) {
  const bytes = useMemo(() => tryDecodeBase64ToBytes(data), [data]);
  const blob = useMemo(
    () =>
      bytes ? new Blob([bytes], { type: "application/pdf" }) : new Blob([]),
    [bytes],
  );
  const url = useObjectUrl(blob);
  if (!bytes) {
    return <BinaryNotice mimeType="application/pdf" />;
  }
  return (
    <Box
      component="iframe"
      title="PDF preview"
      src={`${url}#view=FitH`}
      w="100%"
      h={600}
      bd={0}
      display="block"
    />
  );
}
