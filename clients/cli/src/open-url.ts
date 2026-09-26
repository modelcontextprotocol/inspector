import open from "open";

/**
 * How long {@link openUrl} waits for the opener before giving up. `open`
 * resolves once it has launched the platform opener, but before that it may
 * probe the environment (WSL's default browser, the PowerShell path), and on a
 * headless box or a container any of those can stall. The OAuth flow awaits
 * this call, so an unbounded wait would hang it with the URL already printed
 * and nothing telling the user to act (#2410).
 */
export const OPEN_URL_TIMEOUT_MS = 5_000;

/**
 * Open a URL in the user's default browser (best-effort). Rejects when the
 * opener fails or does not launch within `timeoutMs`; callers print the URL
 * themselves and decide what to tell the user.
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
    await Promise.race([open(href), timeout]);
  } finally {
    clearTimeout(timer);
  }
}
