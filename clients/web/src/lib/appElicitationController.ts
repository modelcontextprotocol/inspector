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
  /** The session (one InspectorClient) this request belongs to. */
  sessionId: number;
  /** Hands the app's standard `ElicitResult` back to the server. */
  resolve: (result: ElicitResult) => void;
  /** Asks `InspectorClient` to fall back to the native elicitation UI. */
  reject: (error: Error) => void;
}

/**
 * One client's window onto the controller.
 *
 * Requests are bound to the connection that made them. A closed session
 * rejects immediately, which is what a one-shot sweep cannot do: an
 * `InspectorClient` being replaced disconnects asynchronously and can still
 * enqueue during its own teardown, and that late entry would otherwise be
 * rendered by a factory bound to the *replacement* client — reading its
 * resource, and answering, through a different server.
 */
export interface AppElicitationSession {
  /** The renderer handed to this client's `InspectorClient`. */
  render: AppElicitationRenderer;
  /** Reject everything from this session and refuse anything later. */
  close: (error: Error) => void;
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
  private nextSessionId = 0;
  /** Sessions still accepting requests. A closed one is removed. */
  private openSessions = new Set<number>();

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
   * Open a window for one `InspectorClient`. Its `render` is what that client
   * is constructed with; `close` ends it when the client is replaced.
   */
  openSession(): AppElicitationSession {
    const sessionId = this.nextSessionId++;
    this.openSessions.add(sessionId);
    return {
      render: (request) => this.render(sessionId, request),
      close: (error) => this.closeSession(sessionId, error),
    };
  }

  /**
   * Queue a request for the UI and resolve when {@link settle} or {@link fail}
   * is called for it.
   *
   * An abort of the originating request (cancelled tool call, disconnect) drops
   * the entry and rejects, so a modal can never outlive the request behind it.
   * A request from a closed session is rejected without ever being queued.
   */
  private render = (sessionId: number, request: AppElicitationRequest) =>
    new Promise<ElicitResult>((resolve, reject) => {
      if (!this.openSessions.has(sessionId)) {
        reject(new Error("App elicitation session is closed"));
        return;
      }
      const entry: AppElicitationEntry = {
        ...request,
        sessionId,
        resolve,
        reject,
      };
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

  /**
   * End a session: reject everything it queued, and refuse anything it queues
   * later. The refusal is the half a one-shot sweep cannot provide — see
   * {@link AppElicitationSession}.
   */
  private closeSession(sessionId: number, error: Error): void {
    this.openSessions.delete(sessionId);
    const dropped = this.entries.filter((e) => e.sessionId === sessionId);
    if (dropped.length === 0) return;
    this.entries = this.entries.filter((e) => e.sessionId !== sessionId);
    this.emit();
    for (const entry of dropped) entry.reject(error);
  }
}
