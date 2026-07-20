import { randomBytes } from "node:crypto";
import {
  createPrivateDaemonDir,
  DAEMON_DIR_ENV,
  DAEMON_TOKEN_ENV,
} from "../daemon/paths.js";

export type PrivateEnvBinding = {
  dir: string;
  token: string;
};

/**
 * Allocate a private daemon directory and mint an IPC token.
 * Does not start the daemon (lazy on first `ensureDaemon`).
 */
export function createPrivateBinding(): PrivateEnvBinding {
  const dir = createPrivateDaemonDir();
  const token = randomBytes(32).toString("base64url");
  return { dir, token };
}

/**
 * Shell exports for `eval "$(mcp private)"` (POSIX sh / bash / zsh).
 */
export function formatPrivateEnvExports(binding: PrivateEnvBinding): string {
  return [
    `export ${DAEMON_DIR_ENV}=${shellSingleQuote(binding.dir)}`,
    `export ${DAEMON_TOKEN_ENV}=${shellSingleQuote(binding.token)}`,
    "",
  ].join("\n");
}

function shellSingleQuote(value: string): string {
  // POSIX-safe: 'foo'\''bar' for embedded quotes.
  return `'${value.replace(/'/g, `'\\''`)}'`;
}
