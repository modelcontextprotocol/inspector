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
 * Per-client bridge registry. Concurrent RPCs on the same connection would
 * otherwise each install their own `newPendingElicitation` listener, so one
 * server elicitation would be delivered to every active caller — duplicate
 * prompts and multiple `respond()` calls. One listener per client dispatches
 * each event to exactly one active subscriber. Core cannot attribute an
 * elicitation to a specific in-flight call, so the oldest active subscriber
 * is chosen (with core's one-pending-at-a-time guarantee the sets coincide
 * for the common single-RPC case).
 */
type BridgeSubscriber = { channel: ElicitationChannel; requestId: string };

type BridgeRegistry = {
  subscribers: BridgeSubscriber[];
  queue: Promise<void>;
  listener: (
    event: TypedEventGeneric<InspectorClientEventMap, "newPendingElicitation">,
  ) => void;
};

const bridgeRegistries = new WeakMap<InspectorClient, BridgeRegistry>();

/**
 * Wires `client`'s pending-elicitation events to `channel` for the duration
 * of one in-flight call. Returns a cleanup function that must be called
 * (typically in a `finally`) once the call settles, so the subscription
 * doesn't outlive the request.
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
  let registry = bridgeRegistries.get(client);
  if (!registry) {
    const created: BridgeRegistry = {
      subscribers: [],
      queue: Promise.resolve(),
      listener: (event) => {
        const message = event.detail;
        if (message.origin === "task-input-required") {
          // Task-augmented — the originating call already returned; nothing
          // here is awaiting this elicitation, so leave it pending for a
          // future tasks/-based command to answer.
          return;
        }
        created.queue = created.queue.then(() => {
          const subscriber = created.subscribers[0];
          if (!subscriber) {
            // Every subscribing call settled before this event was
            // dispatched — nothing is awaiting it, settle it like a channel
            // failure would.
            message.cancel();
            return;
          }
          return handleOne(subscriber.channel, subscriber.requestId, message);
        });
      },
    };
    client.addEventListener("newPendingElicitation", created.listener);
    bridgeRegistries.set(client, created);
    registry = created;
  }
  const subscriber: BridgeSubscriber = { channel, requestId };
  registry.subscribers.push(subscriber);

  return () => {
    const index = registry.subscribers.indexOf(subscriber);
    if (index >= 0) registry.subscribers.splice(index, 1);
    if (registry.subscribers.length === 0) {
      client.removeEventListener("newPendingElicitation", registry.listener);
      bridgeRegistries.delete(client);
    }
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
