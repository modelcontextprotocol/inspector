import { Box } from "@mantine/core";
import { useMemo } from "react";
import { wrapHtmlWithCsp } from "./contentViewerUtils";
import { useObjectUrl } from "./useObjectUrl";

/**
 * Render an HTML resource inside a hardened iframe. Defense is layered:
 *
 *  - `sandbox=""` — explicitly empty: no `allow-scripts`, `allow-forms`, or
 *    `allow-same-origin`, so scripts can't run and the frame is origin-isolated.
 *  - A `Content-Security-Policy` `<meta>` is injected (see {@link wrapHtmlWithCsp})
 *    as defense-in-depth — correct even if the sandbox is later loosened.
 *  - The document is served from a `Blob` object URL (revoked on unmount) rather
 *    than `srcdoc`, keeping it off the parent's origin.
 */
export interface HtmlFrameProps {
  /** The raw HTML document or fragment to preview. */
  html: string;
}

export function HtmlFrame({ html }: HtmlFrameProps) {
  const blob = useMemo(
    () => new Blob([wrapHtmlWithCsp(html)], { type: "text/html" }),
    [html],
  );
  const url = useObjectUrl(blob);
  return (
    <Box
      component="iframe"
      title="HTML preview"
      src={url}
      sandbox=""
      w="100%"
      h={400}
      bd={0}
      display="block"
    />
  );
}
