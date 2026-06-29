import { Box } from "@mantine/core";
import { useMemo } from "react";
import { decodeBase64ToBytes } from "./contentViewerUtils";
import { useObjectUrl } from "./useObjectUrl";

/**
 * Render a base64-encoded PDF in an in-page viewer. The bytes are wrapped in a
 * `Blob` and served via an object URL (revoked on unmount / when the data
 * changes) rather than a multi-megabyte `data:` URI. `#view=FitH` asks the
 * browser's built-in viewer to fit the page width.
 */
export interface PdfFrameProps {
  /** Base64-encoded PDF bytes (the `blob` field of a `BlobResourceContents`). */
  data: string;
}

export function PdfFrame({ data }: PdfFrameProps) {
  const blob = useMemo(
    () => new Blob([decodeBase64ToBytes(data)], { type: "application/pdf" }),
    [data],
  );
  const url = useObjectUrl(blob);
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
