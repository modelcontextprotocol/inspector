import type {
  ElicitRequest,
  ElicitResult,
} from "@modelcontextprotocol/sdk/types.js";

export type { ElicitRequest, ElicitResult };

/**
 * Shape of a pending elicitation request tracked by the Inspector client.
 * v1.5 implements this as a class with a resolver/reject closure; v2 will
 * materialize the runtime when the core hook layer lands. For now we keep the
 * interface so screens/groups can type the pending-elicitation queue.
 */
export interface InspectorPendingElicitation {
  id: string;
  timestamp: Date;
  request: ElicitRequest;
  taskId?: string;
}
