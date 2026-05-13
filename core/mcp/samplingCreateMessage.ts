import type {
  CreateMessageRequest,
  CreateMessageResult,
} from "@modelcontextprotocol/sdk/types.js";

export type { CreateMessageRequest, CreateMessageResult };

/**
 * Shape of a pending sampling request tracked by the Inspector client.
 * v1.5 implements this as a class with a resolver/reject closure; v2 will
 * materialize the runtime when the core hook layer is wired to the
 * (yet-to-be-ported) InspectorClient class. For now we keep the interface so
 * screens/groups can type the pending-sampling queue.
 */
export interface InspectorPendingSampling {
  id: string;
  timestamp: Date;
  request: CreateMessageRequest;
  taskId?: string;
}
