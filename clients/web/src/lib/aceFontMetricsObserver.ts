/**
 * Moves Ace's character-size re-measurement out of a `ResizeObserver`
 * callback and into the next animation frame (#3002).
 *
 * Ace watches a hidden measuring node so it notices when the size of a
 * character changes: a font finishing loading, a zoom, or the editor going from
 * `display: none` to visible (a size of zero is "not measurable yet"). Its
 * observer callback re-measures and, when the size changed, re-lays the whole
 * editor out **synchronously, inside the callback** — and an autosizing editor
 * (`maxLines`) sets its own container's height as part of that layout.
 *
 * The measuring node sits deep inside the editor, and the container it resizes
 * is one of its ancestors. A `ResizeObserver` delivers a frame's notifications
 * deepest-last and will not go back up the tree within that frame, so a
 * callback that resizes a shallower *observed* element — the container is
 * observed by Ace's own renderer and by the Mantine `ScrollArea` around it —
 * leaves those observations undelivered until the next frame. The browser
 * reports exactly that as a window `error` event: "ResizeObserver loop
 * completed with undelivered notifications."
 *
 * Nothing is lost when it fires, which is why it went unnoticed in the app. But
 * it reaches `window.onerror`, so the Storybook browser tests logged it as an
 * `[Unhandled error]` on every run — reliably from an editor mounted inside a
 * closed `Collapse` and then expanded, which is the display-none-to-visible
 * case above.
 *
 * Deferring the re-measurement one frame is the fix at the cause rather than a
 * filter on the message: the layout write no longer happens during observer
 * delivery, so there is nothing left undelivered. One frame is also what Ace's
 * renderer and Mantine's `ScrollArea` already wait before acting on a resize.
 *
 * ⚠️ This reaches into Ace internals (`renderer.$fontMetrics`), which its
 * published types do not declare. So the shape is checked at runtime, and an
 * Ace that no longer matches is left exactly as it was — the worst case is the
 * logged error coming back, never a broken editor.
 */

/** The slice of Ace's `FontMetrics` this module reads and replaces. */
interface FontMetricsInternals {
  /** Ace's own observer; absent where it fell back to polling. */
  $observer: ResizeObserver;
  /** The hidden node whose size is one character's. */
  $measureNode: Element;
  checkForSizeChanges: () => void;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isFontMetricsInternals(value: unknown): value is FontMetricsInternals {
  return (
    // Checked first, and by `typeof`: where the global does not exist at all —
    // the environment in which Ace polls instead — a bare `instanceof` against
    // it would throw rather than answer.
    typeof ResizeObserver === "function" &&
    isRecord(value) &&
    value.$observer instanceof ResizeObserver &&
    value.$measureNode instanceof Element &&
    typeof value.checkForSizeChanges === "function"
  );
}

/**
 * Replace the synchronous font-metrics observer on an Ace renderer with one
 * that re-measures on the next animation frame.
 *
 * Takes the renderer as `unknown` because the member it needs is not part of
 * Ace's typed surface. Returns whether the observer was replaced; `false`
 * means Ace's internals were not the expected shape and nothing was touched.
 *
 * No teardown is returned: the replacement is stored where Ace keeps its own,
 * so `FontMetrics.destroy()` disconnects it with the editor. A frame still
 * pending at that point re-measures a detached node, which Ace reads as "not
 * measurable" and ignores.
 */
export function deferAceFontMetricsObserver(renderer: unknown): boolean {
  if (!isRecord(renderer)) return false;
  const fontMetrics = renderer.$fontMetrics;
  if (!isFontMetricsInternals(fontMetrics)) return false;

  let frame = 0;
  const deferred = new ResizeObserver(() => {
    // Coalesce: several notifications in one frame need one re-measurement.
    window.cancelAnimationFrame(frame);
    frame = window.requestAnimationFrame(() => {
      fontMetrics.checkForSizeChanges();
    });
  });

  fontMetrics.$observer.disconnect();
  deferred.observe(fontMetrics.$measureNode);
  fontMetrics.$observer = deferred;
  return true;
}
