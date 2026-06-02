import { useState, useEffect } from "react";
import type { InspectorClientProtocol } from "../mcp/inspectorClientProtocol.js";
import type { SamplingCreateMessage } from "../mcp/samplingCreateMessage.js";
import type { ElicitationCreateMessage } from "../mcp/elicitationCreateMessage.js";
import type { TypedEvent } from "../mcp/inspectorClientEventTarget.js";

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
  const [pendingSamples, setPendingSamples] = useState<SamplingCreateMessage[]>(
    inspectorClient?.getPendingSamples() ?? [],
  );
  const [pendingElicitations, setPendingElicitations] = useState<
    ElicitationCreateMessage[]
  >(inspectorClient?.getPendingElicitations() ?? []);

  useEffect(() => {
    if (!inspectorClient) {
      setPendingSamples([]);
      setPendingElicitations([]);
      return;
    }
    setPendingSamples(inspectorClient.getPendingSamples());
    setPendingElicitations(inspectorClient.getPendingElicitations());

    const onSamplesChange = (event: TypedEvent<"pendingSamplesChange">) => {
      setPendingSamples([...event.detail]);
    };
    const onElicitationsChange = (
      event: TypedEvent<"pendingElicitationsChange">,
    ) => {
      setPendingElicitations([...event.detail]);
    };

    inspectorClient.addEventListener("pendingSamplesChange", onSamplesChange);
    inspectorClient.addEventListener(
      "pendingElicitationsChange",
      onElicitationsChange,
    );
    return () => {
      inspectorClient.removeEventListener(
        "pendingSamplesChange",
        onSamplesChange,
      );
      inspectorClient.removeEventListener(
        "pendingElicitationsChange",
        onElicitationsChange,
      );
    };
  }, [inspectorClient]);

  return { pendingSamples, pendingElicitations };
}
