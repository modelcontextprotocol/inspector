import type { ElicitResult } from "@modelcontextprotocol/client";
import type {
  AppElicitationRenderer,
  AppElicitationRequest,
} from "@inspector/core/mcp/appElicitation.js";

/**
 * One app-rendered elicitation awaiting an answer, plus the settle functions
 * for the `InspectorClient` promise it belongs to (#1854).
 *
 * The entry — not a "currently active app" — is what owns the renderer, so two
 * concurrent elicitations each drive their own iframe and bridge and cannot
 * resolve through each other's.
 */
export interface AppElicitationEntry extends AppElicitationRequest {
  /** Hands the app's standard `ElicitResult` back to the server. */
  resolve: (result: ElicitResult) => void;
  /** Asks `InspectorClient` to fall back to the native elicitation UI. */
  reject: (error: Error) => void;
}

/**
 * Bridges `InspectorClient`'s renderer callback — supplied at construction,
 * long before any React tree exists — to the React component that actually
 * mounts the app.
 *
 * The client is given {@link render} once and for all; the UI subscribes and
 * re-renders as entries come and go. Without this indirection the renderer
 * would have to be rebuilt (and the client reconstructed) whenever the host
 * component remounted.
 */
export class AppElicitationController {
  private entries: AppElicitationEntry[] = [];
  private listeners = new Set<() => void>();

  /** Current queue. Stable identity between changes, for `useSyncExternalStore`. */
  getEntries = (): AppElicitationEntry[] => this.entries;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  private emit(): void {
    for (const listener of this.listeners) listener();
  }

  /**
   * The {@link AppElicitationRenderer} handed to `InspectorClient`. Queues the
   * request for the UI and resolves when {@link settle} or {@link fail} is
   * called for it.
   *
   * An abort of the originating request (cancelled tool call, disconnect) drops
   * the entry and rejects, so a modal can never outlive the request behind it.
   */
  render: AppElicitationRenderer = (request: AppElicitationRequest) =>
    new Promise<ElicitResult>((resolve, reject) => {
      const entry: AppElicitationEntry = { ...request, resolve, reject };
      const onAbort = () => {
        this.remove(entry.requestId);
        reject(new Error("App-rendered elicitation aborted"));
      };
      if (request.signal.aborted) {
        onAbort();
        return;
      }
      request.signal.addEventListener("abort", onAbort, { once: true });
      this.entries = [...this.entries, entry];
      this.emit();
    });

  private take(requestId: string): AppElicitationEntry | undefined {
    const entry = this.entries.find((e) => e.requestId === requestId);
    if (entry) this.remove(requestId);
    return entry;
  }

  private remove(requestId: string): void {
    const next = this.entries.filter((e) => e.requestId !== requestId);
    if (next.length === this.entries.length) return;
    this.entries = next;
    this.emit();
  }

  /**
   * Complete an elicitation with the app's result. `decline` and `cancel` are
   * completions too — they are returned to the server, not fallen back on.
   */
  settle(requestId: string, result: ElicitResult): void {
    this.take(requestId)?.resolve(result);
  }

  /** Give up on the app and let the native elicitation UI take the request. */
  fail(requestId: string, error: Error): void {
    this.take(requestId)?.reject(error);
  }
}
