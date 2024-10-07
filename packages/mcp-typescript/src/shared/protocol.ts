import { AnyZodObject, ZodLiteral, ZodObject, z } from "zod";
import {
  ErrorCode,
  JSONRPCError,
  JSONRPCNotification,
  JSONRPCRequest,
  JSONRPCResponse,
  McpError,
  Notification,
  PingRequestSchema,
  Progress,
  ProgressNotification,
  ProgressNotificationSchema,
  Request,
  Result,
} from "../types.js";
import { Transport } from "./transport.js";

/**
 * Callback for progress notifications.
 */
export type ProgressCallback = (progress: Progress) => void;

/**
 * Implements MCP protocol framing on top of a pluggable transport, including
 * features like request/response linking, notifications, and progress.
 */
export class Protocol<
  SendRequestT extends Request,
  SendNotificationT extends Notification,
  SendResultT extends Result,
> {
  private _transport?: Transport;
  private _requestMessageId = 0;
  private _requestHandlers: Map<
    string,
    (request: JSONRPCRequest) => Promise<SendResultT>
  > = new Map();
  private _notificationHandlers: Map<
    string,
    (notification: JSONRPCNotification) => Promise<void>
  > = new Map();
  private _responseHandlers: Map<
    number,
    (response: JSONRPCResponse | Error) => void
  > = new Map();
  private _progressHandlers: Map<number, ProgressCallback> = new Map();

  /**
   * Callback for when the connection is closed for any reason.
   *
   * This is invoked when close() is called as well.
   */
  onclose?: () => void;

  /**
   * Callback for when an error occurs.
   *
   * Note that errors are not necessarily fatal; they are used for reporting any kind of exceptional condition out of band.
   */
  onerror?: (error: Error) => void;

  /**
   * A handler to invoke for any request types that do not have their own handler installed.
   */
  fallbackRequestHandler?: (request: Request) => Promise<SendResultT>;

  /**
   * A handler to invoke for any notification types that do not have their own handler installed.
   */
  fallbackNotificationHandler?: (notification: Notification) => Promise<void>;

  constructor() {
    this.setNotificationHandler(ProgressNotificationSchema, (notification) => {
      this._onprogress(notification as unknown as ProgressNotification);
    });

    this.setRequestHandler(
      PingRequestSchema,
      // Automatic pong by default.
      (_request) => ({}) as SendResultT,
    );
  }

  /**
   * Attaches to the given transport and starts listening for messages.
   *
   * The Protocol object assumes ownership of the Transport, replacing any callbacks that have already been set, and expects that it is the only user of the Transport instance going forward.
   */
  async connect(transport: Transport): Promise<void> {
    this._transport = transport;
    this._transport.onclose = () => {
      this._onclose();
    };

    this._transport.onerror = (error: Error) => {
      this._onerror(error);
    };

    this._transport.onmessage = (message) => {
      if (!("method" in message)) {
        this._onresponse(message);
      } else if ("id" in message) {
        this._onrequest(message);
      } else {
        this._onnotification(message);
      }
    };
  }

  private _onclose(): void {
    const responseHandlers = this._responseHandlers;
    this._responseHandlers = new Map();
    this._progressHandlers.clear();
    this._transport = undefined;
    this.onclose?.();

    const error = new McpError(ErrorCode.ConnectionClosed, "Connection closed");
    for (const handler of responseHandlers.values()) {
      handler(error);
    }
  }

  private _onerror(error: Error): void {
    this.onerror?.(error);
  }

  private _onnotification(notification: JSONRPCNotification): void {
    const handler =
      this._notificationHandlers.get(notification.method) ??
      this.fallbackNotificationHandler;

    // Ignore notifications not being subscribed to.
    if (handler === undefined) {
      return;
    }

    handler(notification).catch((error) =>
      this._onerror(
        new Error(`Uncaught error in notification handler: ${error}`),
      ),
    );
  }

  private _onrequest(request: JSONRPCRequest): void {
    const handler =
      this._requestHandlers.get(request.method) ?? this.fallbackRequestHandler;

    if (handler === undefined) {
      this._transport
        ?.send({
          jsonrpc: "2.0",
          id: request.id,
          error: {
            code: ErrorCode.MethodNotFound,
            message: "Method not found",
          },
        })
        .catch((error) =>
          this._onerror(
            new Error(`Failed to send an error response: ${error}`),
          ),
        );
      return;
    }

    handler(request)
      .then(
        (result) => {
          this._transport?.send({
            result,
            jsonrpc: "2.0",
            id: request.id,
          });
        },
        (error) => {
          return this._transport?.send({
            jsonrpc: "2.0",
            id: request.id,
            error: {
              code: error["code"]
                ? Math.floor(Number(error["code"]))
                : ErrorCode.InternalError,
              message: error.message ?? "Internal error",
            },
          });
        },
      )
      .catch((error) =>
        this._onerror(new Error(`Failed to send response: ${error}`)),
      );
  }

  private _onprogress(notification: ProgressNotification): void {
    const { progress, total, progressToken } = notification.params;
    const handler = this._progressHandlers.get(Number(progressToken));
    if (handler === undefined) {
      this._onerror(
        new Error(
          `Received a progress notification for an unknown token: ${JSON.stringify(notification)}`,
        ),
      );
      return;
    }

    handler({ progress, total });
  }

  private _onresponse(response: JSONRPCResponse | JSONRPCError): void {
    const messageId = response.id;
    const handler = this._responseHandlers.get(Number(messageId));
    if (handler === undefined) {
      this._onerror(
        new Error(
          `Received a response for an unknown message ID: ${JSON.stringify(response)}`,
        ),
      );
      return;
    }

    this._responseHandlers.delete(Number(messageId));
    this._progressHandlers.delete(Number(messageId));
    if ("result" in response) {
      handler(response);
    } else {
      const error = new McpError(
        response.error.code,
        response.error.message,
        response.error.data,
      );
      handler(error);
    }
  }

  get transport(): Transport | undefined {
    return this._transport;
  }

  /**
   * Closes the connection.
   */
  async close(): Promise<void> {
    await this._transport?.close();
  }

  /**
   * Sends a request and wait for a response, with optional progress notifications in the meantime (if supported by the server).
   *
   * Do not use this method to emit notifications! Use notification() instead.
   */
  request<T extends AnyZodObject>(
    request: SendRequestT,
    resultSchema: T,
    onprogress?: ProgressCallback,
  ): Promise<z.infer<T>> {
    return new Promise((resolve, reject) => {
      if (!this._transport) {
        reject(new Error("Not connected"));
        return;
      }

      const messageId = this._requestMessageId++;
      const jsonrpcRequest: JSONRPCRequest = {
        ...request,
        jsonrpc: "2.0",
        id: messageId,
      };

      if (onprogress) {
        this._progressHandlers.set(messageId, onprogress);
        jsonrpcRequest.params = {
          ...request.params,
          _meta: { progressToken: messageId },
        };
      }

      this._responseHandlers.set(messageId, (response) => {
        if (response instanceof Error) {
          return reject(response);
        }

        try {
          const result = resultSchema.parse(response.result);
          resolve(result);
        } catch (error) {
          reject(error);
        }
      });

      this._transport.send(jsonrpcRequest).catch(reject);
    });
  }

  /**
   * Emits a notification, which is a one-way message that does not expect a response.
   */
  async notification(notification: SendNotificationT): Promise<void> {
    if (!this._transport) {
      throw new Error("Not connected");
    }

    const jsonrpcNotification: JSONRPCNotification = {
      ...notification,
      jsonrpc: "2.0",
    };

    await this._transport.send(jsonrpcNotification);
  }

  /**
   * Registers a handler to invoke when this protocol object receives a request with the given method.
   *
   * Note that this will replace any previous request handler for the same method.
   */
  setRequestHandler<
    T extends ZodObject<{
      method: ZodLiteral<string>;
    }>,
  >(
    requestSchema: T,
    handler: (request: z.infer<T>) => SendResultT | Promise<SendResultT>,
  ): void {
    this._requestHandlers.set(requestSchema.shape.method.value, (request) =>
      Promise.resolve(handler(requestSchema.parse(request))),
    );
  }

  /**
   * Removes the request handler for the given method.
   */
  removeRequestHandler(method: string): void {
    this._requestHandlers.delete(method);
  }

  /**
   * Registers a handler to invoke when this protocol object receives a notification with the given method.
   *
   * Note that this will replace any previous notification handler for the same method.
   */
  setNotificationHandler<
    T extends ZodObject<{
      method: ZodLiteral<string>;
    }>,
  >(
    notificationSchema: T,
    handler: (notification: z.infer<T>) => void | Promise<void>,
  ): void {
    this._notificationHandlers.set(
      notificationSchema.shape.method.value,
      (notification) =>
        Promise.resolve(handler(notificationSchema.parse(notification))),
    );
  }

  /**
   * Removes the notification handler for the given method.
   */
  removeNotificationHandler(method: string): void {
    this._notificationHandlers.delete(method);
  }
}
