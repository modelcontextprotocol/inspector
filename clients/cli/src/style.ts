import type { OutputFormat } from "../handlers/format-output.js";

export type Style = {
  /** Whether ANSI styling is enabled. */
  readonly ansi: boolean;
  bold: (s: string) => string;
  dim: (s: string) => string;
  red: (s: string) => string;
  yellow: (s: string) => string;
  green: (s: string) => string;
  cyan: (s: string) => string;
  /** OSC 8 hyperlink when ansi; otherwise plain label (defaulting to uri). */
  link: (uri: string, label?: string) => string;
};

const identity = (s: string): string => s;

function sgr(enabled: boolean, open: number, close: number) {
  if (!enabled) return identity;
  return (s: string): string => `\u001b[${open}m${s}\u001b[${close}m`;
}

/**
 * Build a style helper. When `ansi` is false, all methods are identity
 * (and `link` returns the label only — no OSC 8).
 */
export function createStyle(ansi: boolean): Style {
  return {
    ansi,
    bold: sgr(ansi, 1, 22),
    dim: sgr(ansi, 2, 22),
    red: sgr(ansi, 31, 39),
    yellow: sgr(ansi, 33, 39),
    green: sgr(ansi, 32, 39),
    cyan: sgr(ansi, 36, 39),
    link: (uri: string, label?: string): string => {
      const text = label ?? uri;
      if (!ansi || !uri) return text;
      // OSC 8 hyperlink: ESC ] 8 ; ; URI BEL text ESC ] 8 ; ; BEL
      return `\u001b]8;;${uri}\u0007${text}\u001b]8;;\u0007`;
    },
  };
}

/** Plain (no ANSI) style — default for tests and `--plain`. */
export const PLAIN: Style = createStyle(false);

export type ResolveAnsiOptions = {
  /** `--plain` — force no ANSI. */
  plain?: boolean;
  /** `--format`; json never uses ANSI for the payload path. */
  format?: OutputFormat;
  /** Override TTY detection (tests). */
  isTTY?: boolean;
  /** Override `NO_COLOR` (tests). */
  noColorEnv?: string | undefined;
};

/**
 * Decide whether session human output should use ANSI.
 * Off when: `--plain`, `NO_COLOR` set, `--format json`, or stdout is not a TTY.
 */
export function resolveAnsiEnabled(opts: ResolveAnsiOptions = {}): boolean {
  if (opts.plain) return false;
  if (opts.format === "json") return false;
  const noColor =
    opts.noColorEnv !== undefined ? opts.noColorEnv : process.env.NO_COLOR;
  if (noColor !== undefined && noColor !== "") return false;
  const tty =
    opts.isTTY !== undefined ? opts.isTTY : process.stdout.isTTY === true;
  return tty;
}

export function styleFromOpts(opts: ResolveAnsiOptions = {}): Style {
  return createStyle(resolveAnsiEnabled(opts));
}
