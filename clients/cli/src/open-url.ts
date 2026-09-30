import type { ChildProcess } from "node:child_process";
import open from "open";

/**
 * How long {@link openUrl} waits for the opener before giving up. `open`
 * resolves once it has launched the platform opener, but before that it may
 * probe the environment (WSL's default browser, the PowerShell path), and on a
 * headless box or a container any of those can stall. The OAuth flow itself
 * does not wait on this (`CallbackNavigation` fires its callback and discards
 * the promise); the timeout exists so a stalled open settles as a failure and
 * the caller's "open the URL manually" line is actually printed (#2410).
 */
export const OPEN_URL_TIMEOUT_MS = 5_000;

/**
 * Settle once the opener process has actually launched. `open` resolves with
 * the `ChildProcess` as soon as it has called `spawn()`, and a spawn failure
 * (the opener binary missing from `PATH`: `ENOENT`) arrives afterwards as an
 * `'error'` event on that child. `open` only listens for it when called with
 * `{ wait: true }`, which is unusable here: on macOS it adds `open -W`, which
 * waits for the browser to quit. Unlistened, the event crashes the process
 * instead of reaching the caller's fallback (#2531).
 *
 * Chained directly onto `open`'s promise, this runs as a microtask, ahead of
 * the `process.nextTick` that emits `'error'` or `'spawn'`. The listener stays
 * attached (`on`, not `once`) so an error after settling is still absorbed.
 */
function launched(child: ChildProcess): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    child.on("error", reject);
    child.once("spawn", () => resolve());
  });
}

/**
 * Open a URL in the user's default browser (best-effort). Rejects when the
 * opener fails, cannot be spawned, or does not launch within `timeoutMs`;
 * callers print the URL themselves and decide what to tell the user.
 */
export async function openUrl(
  url: string | URL,
  timeoutMs: number = OPEN_URL_TIMEOUT_MS,
): Promise<void> {
  const href = typeof url === "string" ? url : url.href;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () =>
        reject(new Error(`browser did not open within ${timeoutMs / 1000}s`)),
      timeoutMs,
    );
  });
  try {
    await Promise.race([open(href).then(launched), timeout]);
  } finally {
    clearTimeout(timer);
  }
}
