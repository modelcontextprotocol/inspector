/**
 * Bridges `InspectorClient`'s `newPendingElicitation` events to a mid-`rpc`
 * duplex exchange with the CLI, for legacy and modern non-task MRTR
 * elicitations (dual-era support, phase 1). Task-augmented MRTR elicitation
 * (SEP-2663 `origin: "task-input-required"`) is out of scope here — those
 * calls already return immediately, so they never need this bridge to keep a
 * blocking `rpc` call alive; they'll get their own `tasks/get`-driven
 * discoverability + answer commands in a follow-up phase.
 */
import type { InspectorClient } from "@inspector/core/mcp/inspectorClient.js";
import type { ElicitationCreateMessage } from "@inspector/core/mcp/elicitationCreateMessage.js";
import type { TypedEventGeneric } from "@inspector/core/mcp/typedEventTarget.js";
import type { InspectorClientEventMap } from "@inspector/core/mcp/inspectorClientEventTarget.js";
import type { ElicitationChannel } from "./ipc-glue.js";
import type { ElicitationRequestFrame } from "./protocol.js";

/**
 * Wires `client`'s pending-elicitation events to `channel` for the duration
 * of one in-flight call. Returns a cleanup function that must be called
 * (typically in a `finally`) once the call settles, so the listener doesn't
 * outlive the request.
 *
 * Core resolves elicitations sequentially — never more than one pending at a
 * time (see `inspectorClient.ts`'s `fulfilInputRequests` and
 * `requestWithInputRequired`'s retry loop) — but a single call can pause and
 * resume through several of these in turn across MRTR rounds. The `queue`
 * here is a defensive belt-and-suspenders in case that guarantee ever
 * changes; each event is still handled one at a time, in arrival order.
 */
export function wireElicitationBridge(
  client: InspectorClient,
  channel: ElicitationChannel,
  requestId: string,
): () => void {
  let queue: Promise<void> = Promise.resolve();

  const onNewPendingElicitation = (
    event: TypedEventGeneric<InspectorClientEventMap, "newPendingElicitation">,
  ) => {
    const message = event.detail;
    if (message.origin === "task-input-required") {
      // Task-augmented — the originating call already returned; nothing here
      // is awaiting this elicitation, so leave it pending for a future
      // tasks/-based command to answer.
      return;
    }
    queue = queue.then(() => handleOne(channel, requestId, message));
  };

  client.addEventListener("newPendingElicitation", onNewPendingElicitation);

  return () => {
    client.removeEventListener(
      "newPendingElicitation",
      onNewPendingElicitation,
    );
  };
}

async function handleOne(
  channel: ElicitationChannel,
  requestId: string,
  message: ElicitationCreateMessage,
): Promise<void> {
  const params = message.request.params;
  const isUrlMode = params != null && "url" in params;
  const frame: ElicitationRequestFrame = {
    id: requestId,
    kind: "elicitation-request",
    elicitationId: message.id,
    mode: isUrlMode ? "url" : "form",
    message: params?.message ?? "",
    requestedSchema: isUrlMode
      ? undefined
      : (params as { requestedSchema?: Record<string, unknown> })
          .requestedSchema,
    url: isUrlMode ? (params as { url?: string }).url : undefined,
    origin: message.origin,
  };

  try {
    const answer = await channel.request(frame);
    // Defensive: if the answer's elicitationId somehow doesn't match what we
    // asked for, proceed with it anyway (single connection, single pending
    // exchange at a time — this should never happen in practice) rather than
    // hang the call.
    await message.respond({
      action: answer.action,
      content: answer.content as
        | { [x: string]: string | number | boolean | string[] }
        | undefined,
    });
  } catch {
    // Channel failure (e.g. CLI disconnected mid-prompt). `cancel()` settles
    // the pending elicitation regardless of origin/mode — some construction
    // sites (notably legacy URL-mode's `awaitUrlElicitation`) never wire a
    // reject callback, so `reject()` alone would leave the call hanging.
    message.cancel();
  }
}
