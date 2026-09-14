import type { InspectorClientProtocol } from "../mcp/inspectorClientProtocol.js";
import type { SamplingCreateMessage } from "../mcp/samplingCreateMessage.js";
import type { ElicitationCreateMessage } from "../mcp/elicitationCreateMessage.js";
import { useStoreSnapshot } from "./useStoreSnapshot.js";

/**
 * Shared stable empty lists for the no-client case. Module scope so the
 * snapshot doesn't change identity every render — see `useStoreSnapshot`.
 * Read-only by contract: nothing mutates a list this hook returns.
 */
const NO_SAMPLES: SamplingCreateMessage[] = [];
const NO_ELICITATIONS: ElicitationCreateMessage[] = [];

// Both getters already hand back a defensive copy of a queue the client
// mutates in place (`push`/`splice`), which is what makes them safe to read as
// a snapshot: the returned array can't change underneath React afterwards.
const readPendingSamples = (
  client: InspectorClientProtocol,
): SamplingCreateMessage[] => client.getPendingSamples();
const readPendingElicitations = (
  client: InspectorClientProtocol,
): ElicitationCreateMessage[] => client.getPendingElicitations();

export interface UsePendingClientRequestsResult {
  pendingSamples: SamplingCreateMessage[];
  pendingElicitations: ElicitationCreateMessage[];
}

/**
 * React hook that subscribes to the InspectorClient's server-initiated request
 * queues and returns the live pending sampling / elicitation arrays.
 *
 * Each entry exposes `respond()` / `reject()`, which resolve the handler Promise
 * the client returned for the originating call (e.g. a tool execution that
 * triggered the request). Rendering these and wiring those callbacks is what
 * lets a tool call that spawned a sampling/elicitation request complete.
 */
export function usePendingClientRequests(
  inspectorClient: InspectorClientProtocol | null,
): UsePendingClientRequestsResult {
  const pendingSamples = useStoreSnapshot(
    inspectorClient,
    "pendingSamplesChange",
    readPendingSamples,
    NO_SAMPLES,
  );
  const pendingElicitations = useStoreSnapshot(
    inspectorClient,
    "pendingElicitationsChange",
    readPendingElicitations,
    NO_ELICITATIONS,
  );

  return { pendingSamples, pendingElicitations };
}
