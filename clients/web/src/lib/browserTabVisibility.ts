/** True when this browser tab is the foreground tab (Page Visibility API). */
export function isBrowserTabVisible(): boolean {
  return (
    typeof document !== "undefined" && document.visibilityState === "visible"
  );
}

/** Subscribe to this browser tab becoming visible. Returns an unsubscribe function. */
export function onBrowserTabVisible(callback: () => void): () => void {
  if (typeof document === "undefined") {
    return () => {};
  }
  const handler = (): void => {
    if (document.visibilityState === "visible") {
      callback();
    }
  };
  document.addEventListener("visibilitychange", handler);
  return () => document.removeEventListener("visibilitychange", handler);
}
