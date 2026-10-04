/**
 * Routes `notifications/progress` to the task-backed tool calls that own them.
 *
 * ext-tasks has no progress handling: once `tools/call` returns a task, the
 * SDK's per-request progress handler is gone, so the Inspector watches the
 * transport itself and needs to know which progress tokens belong to an
 * in-flight task call and which task ids each token has been seen on. That
 * bookkeeping lives here; `InspectorClient` only feeds it and dispatches the
 * events it names.
 */
import type { ProgressToken } from "@modelcontextprotocol/client";

export class TaskProgressRouter {
  /**
   * Correlates task-call progress tokens to task ids after the first snapshot.
   * A Set per token because concurrent calls may reuse a caller-supplied
   * token; collapsing them to one task id would cross-wire progress between
   * the calls.
   */
  private readonly taskIds = new Map<ProgressToken, Set<string>>();
  /** Active task-call owners per progress token, before task correlation. */
  private readonly owners = new Map<ProgressToken, number>();

  /** A task call carrying `token` has started. */
  acquire(token: ProgressToken): void {
    this.owners.set(token, (this.owners.get(token) ?? 0) + 1);
  }

  /** The call carrying `token` has observed task `taskId`. */
  correlate(token: ProgressToken, taskId: string): void {
    const ids = this.taskIds.get(token) ?? new Set();
    ids.add(taskId);
    this.taskIds.set(token, ids);
  }

  /**
   * A task call carrying `token` has settled. Releases only that call's own
   * correlation; a concurrent call sharing the token keeps its entry.
   */
  release(token: ProgressToken, taskId?: string): void {
    const owners = this.owners.get(token) ?? 0;
    if (owners <= 1) this.owners.delete(token);
    else this.owners.set(token, owners - 1);
    if (taskId === undefined) return;
    const ids = this.taskIds.get(token);
    ids?.delete(taskId);
    if (ids?.size === 0) this.taskIds.delete(token);
  }

  /**
   * Who a progress notification for `token` belongs to: `undefined` when no
   * task call owns it (the SDK's own handlers deliver it), otherwise every
   * correlated task id — the wire cannot say which owner a shared token's
   * progress is for, so each receives it.
   */
  route(token: ProgressToken): readonly string[] | undefined {
    const ids = this.taskIds.get(token);
    if (!ids?.size && !this.owners.has(token)) return undefined;
    return [...(ids ?? [])];
  }

  /** Forget every correlation (session reset). */
  clear(): void {
    this.taskIds.clear();
    this.owners.clear();
  }
}
