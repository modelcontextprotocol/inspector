import { CallbackNavigation } from "@inspector/core/auth/index.js";
import { openUrl } from "./open-url.js";
import { createStyle, resolveAnsiEnabled } from "./style.js";

/**
 * Arms browser auto-open only for the CLI-owned interactive OAuth flow (the
 * one with a listening callback server). Left disarmed during
 * `inspectorClient.connect()` so an SDK-internal `auth()` cannot open a
 * browser (or a second doomed tab) before CLI gates run.
 */
export type CliOAuthAutoOpenControl = {
  armed: boolean;
};

export type CliOAuthNavigationOptions = {
  /** Override TTY detection (tests). Defaults to stderr.isTTY. */
  isTTY?: boolean;
  /** Override NO_COLOR (tests). */
  noColorEnv?: string | undefined;
  /** Write the prompt line (defaults to stderr). */
  write?: (line: string) => void;
  /** Open the browser (defaults to {@link openUrl}). */
  openBrowser?: (url: string) => Promise<void>;
  /**
   * When set, browser open is allowed only while {@link CliOAuthAutoOpenControl.armed}
   * is true. When omitted, auto-open is never armed (print URL only).
   */
  autoOpenControl?: CliOAuthAutoOpenControl;
  /** Hard-disable browser open (e.g. `--stored-auth-only`). */
  disableAutoOpen?: boolean;
  /**
   * Override {@link resolveCliAutoOpenEnabled} (tests). When omitted, uses
   * `MCP_AUTO_OPEN_ENABLED` / `VITEST` the same way the web server does.
   */
  autoOpenEnabled?: boolean;
};

/**
 * Mirror of web `resolveAutoOpen` (`clients/web/server/web-server-config.ts`):
 *   - `MCP_AUTO_OPEN_ENABLED=true`  → always open
 *   - `MCP_AUTO_OPEN_ENABLED=false` → never open
 *   - otherwise → open unless `VITEST` is set
 */
export function resolveCliAutoOpenEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const flag = env.MCP_AUTO_OPEN_ENABLED;
  if (flag === "true") return true;
  if (flag === "false") return false;
  return !env.VITEST;
}

/**
 * CLI OAuth navigation: always print the authorization URL (OSC 8 when TTY
 * allows ANSI). Browser open is gated by {@link CliOAuthAutoOpenControl}
 * (armed only for the CLI interactive flow), `--stored-auth-only`, TTY,
 * and {@link resolveCliAutoOpenEnabled}.
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

    const envAllows =
      options.autoOpenEnabled !== undefined
        ? options.autoOpenEnabled
        : resolveCliAutoOpenEnabled();
    const armed = options.autoOpenControl?.armed === true;
    if (options.disableAutoOpen || !armed || !envAllows || !tty) return;

    try {
      await (options.openBrowser ?? openUrl)(href);
    } catch {
      // URL already printed; browser open is best-effort.
    }
  });
}
