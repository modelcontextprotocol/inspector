/**
 * The one browser-opener wrapper every Node client uses: the CLI's OAuth
 * navigation, the TUI's OAuth navigation, and the web backend's `autoOpen`
 * (#2533). It started life in the CLI (#2410, #2531); the TUI and the web
 * launcher had their own bare `open(...)` calls with the same spawn-failure
 * crash, so it lives here to keep three copies from drifting apart again.
 *
 * **Node-only** — `open` spawns a child process; never import it from browser
 * code.
 */

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
 * The only schemes {@link openUrl} hands to the platform opener.
 *
 * The URL is not always ours: the CLI and TUI open an OAuth authorization URL
 * built from the `authorization_endpoint` a remote MCP server advertises, so
 * whatever that server returns reaches this function. `open` passes its target
 * to `open` / `xdg-open` / PowerShell's `Start`, all of which also launch
 * files, `file:` paths and custom protocol handlers, and its README is explicit
 * that it does not sanitize untrusted input. Nothing this function is for
 * needs anything but a web page, so anything else is refused before `open` is
 * reached and the caller falls back to printing the URL.
 */
const OPENABLE_PROTOCOLS: ReadonlySet<string> = new Set(["http:", "https:"]);

/**
 * Return the serialized form of `href`, or throw unless it parses as an
 * `http:` or `https:` URL.
 *
 * The caller opens the **returned** string, never the input. The WHATWG parser
 * is lenient — it accepts `" https:/a"`, `"HTTPS:\\a\\b"` or
 * `"https:/../x"` as https — and the platform opener is not: on WSL, `open`
 * treats a target as a URL only when it literally starts with `scheme://`, and
 * otherwise converts it as a file path. Checking one string and opening
 * another would let such an input pass as https and still reach the opener as
 * a path. The serialization of an http(s) URL always starts with `http://` or
 * `https://`, so what is checked is exactly what is opened.
 */
function toOpenableHref(href: string): string {
  let parsed: URL;
  try {
    parsed = new URL(href);
  } catch {
    throw new Error("refusing to open an invalid URL");
  }
  if (!OPENABLE_PROTOCOLS.has(parsed.protocol)) {
    throw new Error(`refusing to open a non-http(s) URL (${parsed.protocol})`);
  }
  return parsed.href;
}

/**
 * Keep absorbing the opener's `'error'` events once it has launched.
 *
 * Since v11, `open` itself waits for the child's `'spawn'` event (on Windows,
 * for PowerShell to exit) before resolving, and rejects when the opener cannot
 * be spawned (the binary missing from `PATH`: `ENOENT`) — so the spawn failure
 * that used to crash the process (#2531) now arrives as a rejection the caller
 * sees. What it no longer does is listen afterwards: it removes its own
 * `'error'` listener on launch, so a later `'error'` on the child would be
 * unlistened and crash the process. A no-op listener keeps that failure where
 * it belongs, in a best-effort open nobody is waiting on.
 */
function absorbLateErrors(child: ChildProcess): void {
  child.on("error", () => {});
}

/**
 * Open a URL in the user's default browser (best-effort). Rejects when the URL
 * is not `http:`/`https:`, when the opener fails or cannot be spawned, or when
 * it does not launch within `timeoutMs`; callers print the URL themselves and
 * decide what to tell the user.
 */
export async function openUrl(
  url: string | URL,
  timeoutMs: number = OPEN_URL_TIMEOUT_MS,
): Promise<void> {
  const href = toOpenableHref(typeof url === "string" ? url : url.href);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () =>
        reject(new Error(`browser did not open within ${timeoutMs / 1000}s`)),
      timeoutMs,
    );
  });
  try {
    await Promise.race([open(href).then(absorbLateErrors), timeout]);
  } finally {
    clearTimeout(timer);
  }
}
