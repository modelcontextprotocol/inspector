/**
 * The `--prompt-args key=value` parser shared by the one-shot CLI and mcpdo.
 *
 * Prompt arguments are `Record<string, string>` in the MCP schema, so the
 * value is kept exactly as typed — never `JSON.parse`d (#2859). The generic
 * `key=value` parser both clients use for `--tool-arg` and `--metadata` does
 * parse JSON (correctly, for those flags), and routing prompt arguments
 * through it normalised anything that happened to look like JSON before
 * `convertPromptArguments` stringified it back: `1.50` reached the server as
 * `"1.5"`, `1e3` as `"1000"`, and `9007199254740993` as
 * `"9007199254740992"` — the last an IEEE-754 rounding no consumer can undo.
 *
 * Two deliberate differences from that generic parser:
 * - the value is never parsed, so `true`, `null` and `{"a":1}` arrive as those
 *   literal strings;
 * - an empty value (`q=`) is accepted, since an empty string is a legal
 *   prompt argument. Only a missing `=` or an empty key is rejected.
 */
export function parsePromptArgPair(
  pair: string,
  previous: Record<string, string> = {},
): Record<string, string> {
  const eq = pair.indexOf("=");
  if (eq <= 0) {
    throw new Error(`Invalid parameter format: ${pair}. Use key=value format.`);
  }
  return { ...previous, [pair.slice(0, eq)]: pair.slice(eq + 1) };
}
