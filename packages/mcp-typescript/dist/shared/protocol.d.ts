import { AnyZodObject, ZodLiteral, ZodObject, z } from "zod";
import { JSONRPCRequest, Notification, Progress, Request, Result } from "../types.js";
import { Transport } from "./transport.js";
/**
 * Callback for progress notifications.
 */
export type ProgressCallback = (progress: Progress) => void;
/**
 * Implements MCP protocol framing on top of a pluggable transport, including
 * features like request/response linking, notifications, and progress.
 */
export declare class Protocol<SendRequestT extends Request, SendNotificationT extends Notification, SendResultT extends Result> {
    private _transport?;
    private _requestMessageId;
    protected _requestHandlers: Map<string, (request: JSONRPCRequest) => Promise<SendResultT>>;
    private _notificationHandlers;
    private _responseHandlers;
    private _progressHandlers;
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
    constructor();
    /**
     * Attaches to the given transport, starts it, and starts listening for messages.
     *
     * The Protocol object assumes ownership of the Transport, replacing any callbacks that have already been set, and expects that it is the only user of the Transport instance going forward.
     */
    connect(transport: Transport): Promise<void>;
    private _onclose;
    private _onerror;
    private _onnotification;
    private _onrequest;
    private _onprogress;
    private _onresponse;
    get transport(): Transport | undefined;
    /**
     * Closes the connection.
     */
    close(): Promise<void>;
    /**
     * Sends a request and wait for a response, with optional progress notifications in the meantime (if supported by the server).
     *
     * Do not use this method to emit notifications! Use notification() instead.
     */
    request<T extends AnyZodObject>(request: SendRequestT, resultSchema: T, onprogress?: ProgressCallback): Promise<z.infer<T>>;
    /**
     * Emits a notification, which is a one-way message that does not expect a response.
     */
    notification(notification: SendNotificationT): Promise<void>;
    /**
     * Registers a handler to invoke when this protocol object receives a request with the given method.
     *
     * Note that this will replace any previous request handler for the same method.
     */
    setRequestHandler<T extends ZodObject<{
        method: ZodLiteral<string>;
    }>>(requestSchema: T, handler: (request: z.infer<T>) => SendResultT | Promise<SendResultT>): void;
    /**
     * Removes the request handler for the given method.
     */
    removeRequestHandler(method: string): void;
    /**
     * Registers a handler to invoke when this protocol object receives a notification with the given method.
     *
     * Note that this will replace any previous notification handler for the same method.
     */
    setNotificationHandler<T extends ZodObject<{
        method: ZodLiteral<string>;
    }>>(notificationSchema: T, handler: (notification: z.infer<T>) => void | Promise<void>): void;
    /**
     * Removes the notification handler for the given method.
     */
    removeNotificationHandler(method: string): void;
}
//# sourceMappingURL=protocol.d.ts.map