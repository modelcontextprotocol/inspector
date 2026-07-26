import { CallbackNavigation } from "@inspector/core/auth/index.js";
import { openUrl } from "./open-url.js";
import { createStyle, resolveAnsiEnabled } from "./style.js";

/**
 * Arms URL print + browser auto-open only for the CLI-owned interactive OAuth
 * flow (the one with a listening callback server). Left disarmed during
 * `inspectorClient.connect()` so an SDK-internal `auth()` cannot print a
 * doomed authorize URL (or open a second browser tab) before CLI gates run.
 */
export type CliOAuthAutoOpenControl = {
  armed: boolean;
};

export type CliOAuthNavigationOptions = {
  /**
   * Override stderr TTY detection (tests / programmatic callers). Defaults to
   * `process.stderr.isTTY`. Browser auto-open and OSC 8 stay stderr-only on
   * purpose — `2>&1 | tee` still prints a plain URL into the tee stream;
   * admit-to-flow gating (`stdin || stderr`) lives in
   * `assertInteractiveOAuthAllowed`, not here.
   */
  isTTY?: boolean;
  /** Override NO_COLOR (tests). */
  noColorEnv?: string | undefined;
  /** Write the prompt line (defaults to stderr). */
  write?: (line: string) => void;
  /** Open the browser (defaults to {@link openUrl}). */
  openBrowser?: (url: string) => Promise<void>;
  /**
   * When set, print + browser open are allowed only while
   * {@link CliOAuthAutoOpenControl.armed} is true. When omitted, navigation is
   * a no-op (SDK-during-connect default).
   */
  autoOpenControl?: CliOAuthAutoOpenControl;
  /**
   * Suppress print + browser open entirely (e.g. `--stored-auth-only`). A
   * disarmed/disabled navigation is never actionable — no callback server is
   * listening for that authorize URL.
   */
  disableAutoOpen?: boolean;
  /**
   * Override {@link resolveCliAutoOpenEnabled} (tests). When omitted, uses
   * `MCP_AUTO_OPEN_ENABLED` / `VITEST` the same way the web server does.
   */
  autoOpenEnabled?: boolean;
  /**
   * When true, open even if stderr is not a TTY. Independent of
   * {@link autoOpenEnabled}. Defaults to {@link isCliAutoOpenForced}
   * (`MCP_AUTO_OPEN_ENABLED=true`).
   */
  forceAutoOpen?: boolean;
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

/** True when `MCP_AUTO_OPEN_ENABLED=true` (explicit force, including non-TTY). */
export function isCliAutoOpenForced(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return env.MCP_AUTO_OPEN_ENABLED === "true";
}

/**
 * CLI OAuth navigation: print the authorization URL (OSC 8 when TTY allows
 * ANSI) and optionally open the browser — but only when armed for the
 * CLI-owned interactive flow. Disarmed / `--stored-auth-only` navigations are
 * silent no-ops so SDK-internal `auth()` during connect cannot emit an
 * uncompletable "Please navigate to:" line.
 *
 * Browser open: off when env disables it; on a **stderr** TTY when enabled;
 * forced open (TTY optional) when `MCP_AUTO_OPEN_ENABLED=true` /
 * {@link forceAutoOpen}. Stderr-only (not `stdin || stderr`): piping stderr
 * still gets a clickable plain URL; launching a browser from a redirected
 * stderr session would be surprising.
 */
export function createCliOAuthNavigation(
  options: CliOAuthNavigationOptions = {},
): CallbackNavigation {
  return new CallbackNavigation(async (url) => {
    const armed = options.autoOpenControl?.armed === true;
    if (options.disableAutoOpen || !armed) return;

    const href = url.href;
    // stderr-only — do not widen to stdin; see file-level note above.
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
    if (!envAllows) return;

    const forced = options.forceAutoOpen ?? isCliAutoOpenForced();
    if (!forced && !tty) return;

    try {
      await (options.openBrowser ?? openUrl)(href);
    } catch {
      // URL already printed; browser open is best-effort.
    }
  });
}
