/**
 * Request methods the Protocol Replay action can re-issue (client→server reads
 * and calls). Server→client requests (roots/list, sampling, elicitation) and
 * side-effectful methods (logging/setLevel, subscribe) are intentionally
 * excluded. Single source of truth: `ProtocolEntry` hides the Replay button for
 * anything not listed here, and `replayProtocolRequest` gates dispatch on the
 * same set.
 *
 * Lives in `utils/` rather than beside the Protocol components because it is a
 * pure predicate over a string set with two consumers on opposite sides of the
 * layering: a component and `lib/protocolReplay.ts`. Keeping it here is what
 * lets the adapter reach it without importing "up" into `components/`.
 */
export const REPLAYABLE_PROTOCOL_METHODS: ReadonlySet<string> = new Set([
  "tools/call",
  "prompts/get",
  "resources/read",
  "tools/list",
  "prompts/list",
  "resources/list",
  "resources/templates/list",
  "tasks/list",
  "ping",
]);

export function isReplayableProtocolMethod(method: string): boolean {
  return REPLAYABLE_PROTOCOL_METHODS.has(method);
}
