import { useEffect, useMemo, useRef } from "react";

/**
 * Create an object URL for `blob` and revoke it when the blob changes or the
 * component unmounts. Memoize the `Blob` in the caller (e.g. with `useMemo`) so
 * a stable blob identity doesn't re-create the URL on every render.
 *
 * The URL is derived during render (via `useMemo`) so consumers get a live URL
 * on the first paint. Revocation is **deferred to a microtask** and guarded by
 * `liveUrlRef`, which always points at the currently-mounted URL:
 *
 *  - Under React StrictMode (dev) the effect runs setup → cleanup → setup with
 *    no re-render. The cleanup schedules the revoke; the re-setup restores
 *    `liveUrlRef` to the same URL, so when the microtask runs it sees the URL
 *    is still live and skips the revoke — the iframe keeps a valid `src`.
 *  - A real unmount (no re-setup) or a blob change (a new URL takes over) leaves
 *    `liveUrlRef` pointing elsewhere, so the stale URL is released.
 *
 * Revoking synchronously in the cleanup (the obvious shape) would instead kill
 * the committed URL under StrictMode, blanking PDF/HTML previews in dev. This
 * mirrors the deferred-disposal trick in `AppRenderer`.
 */
export function useObjectUrl(blob: Blob): string {
  const url = useMemo(() => URL.createObjectURL(blob), [blob]);
  const liveUrlRef = useRef<string | null>(null);

  useEffect(() => {
    liveUrlRef.current = url;
    return () => {
      liveUrlRef.current = null;
      queueMicrotask(() => {
        if (liveUrlRef.current !== url) {
          URL.revokeObjectURL(url);
        }
      });
    };
  }, [url]);

  return url;
}
