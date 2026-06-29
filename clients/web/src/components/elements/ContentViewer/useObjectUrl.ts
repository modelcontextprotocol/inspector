import { useEffect, useMemo } from "react";

/**
 * Create an object URL for `blob` and revoke it when the blob changes or the
 * component unmounts. Memoize the `Blob` in the caller (e.g. with `useMemo`) so
 * a stable blob identity doesn't re-create the URL on every render.
 *
 * The URL is derived during render (via `useMemo`) rather than set from an
 * effect, so consumers get a live URL on the first paint and we avoid a
 * cascading state update. Revocation is handled by a cleanup effect keyed on the
 * URL, so the previous URL is released when the blob changes or the component
 * unmounts.
 */
export function useObjectUrl(blob: Blob): string {
  const url = useMemo(() => URL.createObjectURL(blob), [blob]);

  useEffect(() => {
    return () => {
      URL.revokeObjectURL(url);
    };
  }, [url]);

  return url;
}
