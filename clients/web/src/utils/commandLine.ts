/**
 * Render a command and its argv as one copy-pasteable, POSIX-shell-quoted line,
 * so a review surface can show exactly what will be spawned. The quoting is
 * what makes the display honest: an argument containing a space or a shell
 * metacharacter is shown single-quoted, so it can't read as two arguments (or
 * as one harmless one) when it is really something else. An argument made only
 * of characters no shell treats specially is shown bare, which keeps ordinary
 * command lines (`npx -y @scope/pkg@1.0.0`) readable.
 *
 * Pure — the display is a rendering of the argv, never a parse of it; the
 * config that gets saved and spawned is the argv array itself.
 */

/** Characters that never need quoting in a POSIX shell word. */
const SHELL_SAFE = /^[A-Za-z0-9_@%+=:,./-]+$/;

/** Quote one argv token for display in a POSIX shell command line. */
export function quoteShellArg(arg: string): string {
  if (SHELL_SAFE.test(arg)) return arg;
  // Single quotes suppress every expansion; an embedded `'` is closed, escaped
  // and reopened (`'\''`), the standard POSIX idiom.
  return `'${arg.replace(/'/g, `'\\''`)}'`;
}

/** Join a command and its arguments into one display line, each token quoted. */
export function formatCommandLine(
  command: string,
  args: readonly string[] = [],
): string {
  return [command, ...args].map(quoteShellArg).join(" ");
}
