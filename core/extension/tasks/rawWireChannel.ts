/**
 * The raw request channel ext-tasks requires as `rawDispatch`.
 *
 * SDK v2's codec rejects the 2026-07-28 Tasks wire shapes — `tasks/*` throws
 * `MethodNotSupportedByProtocolVersion` on the modern era, and a
 * `resultType: "task"` result fails to decode — so ext-tasks deliberately
 * leaves "send a JSON-RPC request below the SDK and hand back the response" to
 * the host (`RawClientDispatch`). This is the Inspector's implementation: it
 * writes the frame straight to the transport (which still logs it for the
 * Protocol and Network tabs) under a string id the SDK's numeric ids cannot
 * collide with, and `MessageTrackingTransport` hands the matching response to
 * {@link RawWireChannel.consume} before the SDK would reject it as unknown.
 *
 * It mirrors what `Protocol.request` gives an ordinary request: a timeout
 * (re-armed by progress when the session asks for that), caller aborts, and
 * the SDK's cancellation fork — stream teardown on a per-request-stream
 * transport, `notifications/cancelled` otherwise (#2140).
 *
 * Host state reaches it only through {@link RawWireChannelHost}, so the
 * channel holds no reference to `InspectorClient`.
 */
import { SdkError, SdkErrorCode } from "@modelcontextprotocol/client";
import type {
  JSONRPCErrorResponse,
  JSONRPCRequest,
  JSONRPCResultResponse,
  ProgressToken,
  Transport,
} from "@modelcontextprotocol/client";
import { DispatchError } from "@modelcontextprotocol/ext-tasks/client";
import type {
  DispatchOptions,
  JsonRpcResponse,
} from "@modelcontextprotocol/ext-tasks/client";
import type { JsonValue as TasksJsonValue } from "@modelcontextprotocol/ext-tasks/core";
import { isSerializableJson, type JsonValue } from "../../json/jsonUtils.js";
import { abortError } from "./errors.js";

/** Every raw request id starts with this, so responses can be told apart. */
export const RAW_WIRE_ID_PREFIX = "inspector-ext-";

/** What the channel reads from its host, each time it needs it. */
export interface RawWireChannelHost {
  /** The connected transport, or null when there is none. */
  transport(): Transport | null;
  /** The request budget when the call names none. */
  defaultTimeoutMs(): number;
  /** Whether progress on a request's token re-arms its timeout. */
  resetTimeoutOnProgress(): boolean;
  /** Decorate a timeout the way an SDK request's timeout is (#2318); any
   * other error is returned untouched. */
  annotateTimeout(error: unknown, method: string): unknown;
}

interface PendingRawRequest {
  resolve: (response: JsonRpcResponse) => void;
  reject: (error: unknown) => void;
  cleanup: () => void;
  // Present when the request carries a progress token and
  // resetTimeoutOnProgress is enabled: re-arms the request's timeout.
  progressToken?: ProgressToken;
  resetTimeout?: () => void;
}

export class RawWireChannel {
  private readonly pending = new Map<string, PendingRawRequest>();
  private counter = 0;
  private readonly host: RawWireChannelHost;

  constructor(host: RawWireChannelHost) {
    this.host = host;
  }

  /** Send one request and resolve with its JSON-RPC response. */
  async dispatch(
    request: TasksJsonValue,
    options: DispatchOptions = {},
    timeoutOverride?: number,
  ): Promise<JsonRpcResponse> {
    const transport = this.host.transport();
    if (!transport)
      throw new DispatchError("MCP client is not connected", true);
    if (
      request === null ||
      Array.isArray(request) ||
      typeof request !== "object"
    ) {
      throw new DispatchError("Raw MCP request must be a JSON object");
    }
    const record = request as Readonly<Record<string, JsonValue>>;
    if (typeof record.method !== "string") {
      throw new DispatchError("Raw MCP request method must be a string");
    }
    const params = record.params;
    if (
      params !== undefined &&
      (params === null || Array.isArray(params) || typeof params !== "object")
    ) {
      throw new DispatchError("Raw MCP request params must be a JSON object");
    }
    const signal = options.signal;
    if (signal?.aborted) throw abortError(signal);

    const id = `${RAW_WIRE_ID_PREFIX}${(this.counter += 1)}`;
    const message: JSONRPCRequest = {
      jsonrpc: "2.0",
      id,
      method: record.method,
      ...(params === undefined ? {} : { params }),
    };
    const timeoutMs =
      timeoutOverride ??
      options.context?.requestTimeoutMs ??
      this.host.defaultTimeoutMs();

    // Extract the request's progress token (if any) because
    // notifications/progress uses it to re-arm this request's timeout,
    // matching the SDK path's resetTimeoutOnProgress.
    const meta = (params as Readonly<Record<string, JsonValue>> | undefined)?.[
      "_meta"
    ];
    const progressToken =
      meta !== null && typeof meta === "object" && !Array.isArray(meta)
        ? (meta as { progressToken?: ProgressToken }).progressToken
        : undefined;

    return await new Promise<JsonRpcResponse>((resolve, reject) => {
      let onAbort: (() => void) | undefined;
      // The transport sees this controller's signal, not the caller's,
      // because a timeout must also reach the wire: aborting it tears down a
      // per-request stream (the 2026-era cancellation signal), which the
      // caller's untouched signal cannot do. Caller aborts forward into it.
      const wireController = new AbortController();
      const forwardAbort = () => {
        wireController.abort(signal?.reason);
      };
      signal?.addEventListener("abort", forwardAbort, { once: true });
      const cleanup = () => {
        clearTimeout(timer);
        if (signal && onAbort) signal.removeEventListener("abort", onAbort);
        signal?.removeEventListener("abort", forwardAbort);
        this.pending.delete(id);
      };
      // Mirror the SDK's cancellation fork (#2140) for both local endings of
      // a raw request: a per-request-stream transport (2026-era Streamable
      // HTTP) treats the forwarded requestSignal abort as the wire
      // cancellation, but stdio/SSE ignore requestSignal — and this path
      // bypasses Client.request, so nothing else sends the
      // notifications/cancelled frame they need. Without it a timed-out or
      // aborted tools/call keeps running server-side (orphaning any task) and
      // its late response is no longer consumed by this raw channel.
      const sendWireCancellation = (reason?: string) => {
        if (transport.hasPerRequestStream === true) return;
        void transport
          .send({
            jsonrpc: "2.0",
            method: "notifications/cancelled",
            params: {
              requestId: id,
              ...(reason === undefined ? {} : { reason }),
            },
          })
          .catch(() => {
            // Best effort: the local rejection is authoritative.
          });
      };
      const onTimeout = () => {
        cleanup();
        const timeoutReason = `Request timed out after ${String(timeoutMs)} ms`;
        // Both wire paths, matching the abort fork: stream teardown for
        // per-request-stream transports, notifications/cancelled otherwise.
        wireController.abort(new DispatchError(timeoutReason));
        sendWireCancellation(timeoutReason);
        // The same error, with the same annotation, as an SDK request that
        // times out: this path bypasses `Protocol.request`, so it builds the
        // SDK's own timeout shape and runs it through the decorator's
        // annotation by hand — a raw-wire caller sees one kind of timeout,
        // not two (#2318). It rides as the DispatchError's cause, which
        // `unwrapTaskDispatchError` restores once ext-tasks hands it back.
        reject(
          new DispatchError(
            `Raw MCP request "${message.method}" timed out after ${timeoutMs} ms`,
            false,
            {
              cause: this.host.annotateTimeout(
                new SdkError(SdkErrorCode.RequestTimeout, "Request timed out", {
                  timeout: timeoutMs,
                }),
                message.method,
              ),
            },
          ),
        );
      };
      let timer = setTimeout(onTimeout, timeoutMs);
      const resetTimeout =
        progressToken !== undefined && this.host.resetTimeoutOnProgress()
          ? () => {
              clearTimeout(timer);
              timer = setTimeout(onTimeout, timeoutMs);
            }
          : undefined;

      this.pending.set(id, {
        resolve,
        reject,
        cleanup,
        progressToken,
        resetTimeout,
      });
      if (signal) {
        onAbort = () => {
          const pending = this.pending.get(id);
          if (!pending) return;
          pending.cleanup();
          const reason = signal.reason;
          sendWireCancellation(typeof reason === "string" ? reason : undefined);
          reject(abortError(signal));
        };
        signal.addEventListener("abort", onAbort, { once: true });
      }
      transport
        .send(message, {
          ...(options.context?.headers === undefined
            ? {}
            : { headers: options.context.headers }),
          requestSignal: wireController.signal,
        })
        .catch((error: unknown) => {
          const pending = this.pending.get(id);
          if (!pending) return;
          pending.cleanup();
          // The browser's remote transport awaits the response inside `send`,
          // so its relay wait can expire here first, as the SDK's timeout
          // shape; annotate it exactly as the local timer above does (a
          // non-timeout error passes through untouched).
          reject(
            this.host.annotateTimeout(
              error instanceof Error ? error : new Error(String(error)),
              message.method,
            ),
          );
        });
    });
  }

  /**
   * Settle the raw request a response answers. Returns false — leaving the
   * frame to the SDK — for any id this channel did not issue or no longer
   * holds.
   */
  consume(message: JSONRPCResultResponse | JSONRPCErrorResponse): boolean {
    const { id } = message;
    if (typeof id !== "string" || !id.startsWith(RAW_WIRE_ID_PREFIX)) {
      return false;
    }
    const pending = this.pending.get(id);
    if (!pending) return false;

    pending.cleanup();
    if ("error" in message) {
      const { error } = message;
      pending.resolve({
        kind: "error",
        error: {
          code: error.code,
          message: error.message,
          ...(isSerializableJson(error.data) ? { data: error.data } : {}),
        },
      });
    } else if (!isSerializableJson(message.result)) {
      pending.reject(
        new DispatchError(`Raw MCP request ${id} returned a non-JSON result`),
      );
    } else {
      pending.resolve({ kind: "result", result: message.result });
    }
    return true;
  }

  /** Re-arm the timeout of every pending request carrying `token`. */
  noteProgress(token: ProgressToken): void {
    for (const pending of this.pending.values()) {
      if (pending.progressToken === token) pending.resetTimeout?.();
    }
  }

  /** Reject everything in flight (connection ended or disconnected). */
  rejectAll(reason: string): void {
    const pendingRequests = [...this.pending.values()];
    this.pending.clear();
    for (const pending of pendingRequests) {
      pending.cleanup();
      pending.reject(new DispatchError(reason));
    }
  }
}
