/**
 * The stderr warning the one-shot CLI and mcpdo print for a destination-guard
 * refusal (#2846).
 *
 * OAuth discovery recovers from a refused candidate by trying the next one, so
 * the refusal never reaches the error the user eventually sees. These print it
 * as it happens — on stderr, so a command's stdout result stays parseable —
 * in the same `Warning: …` form the CLI already uses for a failed revocation.
 */

import { formatFetchRefusal, type FetchRefusal } from "../auth/fetchRefusal.js";
import type {
  InspectorClientEventTarget,
  TypedEvent,
} from "../mcp/inspectorClientEventTarget.js";

/** Where a warning line goes. stderr outside tests. */
export type WarningSink = (line: string) => void;

const writeToStderr: WarningSink = (line) => {
  process.stderr.write(line);
};

/** Writes one refusal as a `Warning: Refused to fetch <url>: <reason>` line. */
export function writeFetchRefusalWarning(
  refusal: FetchRefusal,
  sink: WarningSink = writeToStderr,
): void {
  sink(`Warning: ${formatFetchRefusal(refusal)}\n`);
}

/**
 * Prints every refusal `client` reports from now on. The client already fires
 * once per distinct URL and reason, so a retried discovery warns once. Returns
 * the unsubscribe.
 */
export function warnOnFetchRefusals(
  client: InspectorClientEventTarget,
  sink: WarningSink = writeToStderr,
): () => void {
  const listener = (event: TypedEvent<"fetchRefused">) =>
    writeFetchRefusalWarning(event.detail, sink);
  client.addEventListener("fetchRefused", listener);
  return () => client.removeEventListener("fetchRefused", listener);
}
