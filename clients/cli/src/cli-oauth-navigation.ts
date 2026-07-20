import { CallbackNavigation } from "@inspector/core/auth/index.js";
import { openUrl } from "./open-url.js";
import { createStyle, resolveAnsiEnabled } from "./session/style.js";

export type CliOAuthNavigationOptions = {
  /** Override TTY detection (tests). Defaults to stderr.isTTY. */
  isTTY?: boolean;
  /** Override NO_COLOR (tests). */
  noColorEnv?: string | undefined;
  /** Write the prompt line (defaults to stderr). */
  write?: (line: string) => void;
  /** Open the browser (defaults to {@link openUrl}). */
  openBrowser?: (url: string) => Promise<void>;
};

/**
 * CLI OAuth navigation: print the authorization URL (OSC 8 when TTY allows
 * ANSI) and auto-open the default browser on a TTY. Non-TTY / CI: plain URL
 * only — never launches a browser.
 */
export function createCliOAuthNavigation(
  options: CliOAuthNavigationOptions = {},
): CallbackNavigation {
  return new CallbackNavigation(async (url) => {
    const href = url.href;
    const tty =
      options.isTTY !== undefined
        ? options.isTTY
        : process.stderr.isTTY === true;
    const style = createStyle(
      resolveAnsiEnabled({
        isTTY: tty,
        noColorEnv: options.noColorEnv,
      }),
    );
    const write =
      options.write ?? ((line: string) => process.stderr.write(line));
    write(`Please navigate to: ${style.link(href)}\n`);
    if (!tty) return;
    try {
      await (options.openBrowser ?? openUrl)(href);
    } catch {
      // URL already printed; browser open is best-effort.
    }
  });
}
