import { z } from "zod";
export declare const PROTOCOL_VERSION = "2024-10-07";
export declare const JSONRPC_VERSION = "2.0";
/**
 * A progress token, used to associate progress notifications with the original request.
 */
export declare const ProgressTokenSchema: z.ZodUnion<[z.ZodString, z.ZodNumber]>;
/**
 * An opaque token used to represent a cursor for pagination.
 */
export declare const CursorSchema: z.ZodString;
export declare const RequestSchema: z.ZodObject<{
    method: z.ZodString;
    params: z.ZodOptional<z.ZodObject<{
        _meta: z.ZodOptional<z.ZodObject<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough">>>;
    }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
        _meta: z.ZodOptional<z.ZodObject<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough">>>;
    }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
        _meta: z.ZodOptional<z.ZodObject<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough">>>;
    }, z.ZodTypeAny, "passthrough">>>;
}, "strip", z.ZodTypeAny, {
    method: string;
    params?: z.objectOutputType<{
        _meta: z.ZodOptional<z.ZodObject<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough">>>;
    }, z.ZodTypeAny, "passthrough"> | undefined;
}, {
    method: string;
    params?: z.objectInputType<{
        _meta: z.ZodOptional<z.ZodObject<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough">>>;
    }, z.ZodTypeAny, "passthrough"> | undefined;
}>;
export declare const NotificationSchema: z.ZodObject<{
    method: z.ZodString;
    params: z.ZodOptional<z.ZodObject<{
        /**
         * This parameter name is reserved by MCP to allow clients and servers to attach additional metadata to their notifications.
         */
        _meta: z.ZodOptional<z.ZodObject<{}, "passthrough", z.ZodTypeAny, z.objectOutputType<{}, z.ZodTypeAny, "passthrough">, z.objectInputType<{}, z.ZodTypeAny, "passthrough">>>;
    }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
        /**
         * This parameter name is reserved by MCP to allow clients and servers to attach additional metadata to their notifications.
         */
        _meta: z.ZodOptional<z.ZodObject<{}, "passthrough", z.ZodTypeAny, z.objectOutputType<{}, z.ZodTypeAny, "passthrough">, z.objectInputType<{}, z.ZodTypeAny, "passthrough">>>;
    }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
        /**
         * This parameter name is reserved by MCP to allow clients and servers to attach additional metadata to their notifications.
         */
        _meta: z.ZodOptional<z.ZodObject<{}, "passthrough", z.ZodTypeAny, z.objectOutputType<{}, z.ZodTypeAny, "passthrough">, z.objectInputType<{}, z.ZodTypeAny, "passthrough">>>;
    }, z.ZodTypeAny, "passthrough">>>;
}, "strip", z.ZodTypeAny, {
    method: string;
    params?: z.objectOutputType<{
        /**
         * This parameter name is reserved by MCP to allow clients and servers to attach additional metadata to their notifications.
         */
        _meta: z.ZodOptional<z.ZodObject<{}, "passthrough", z.ZodTypeAny, z.objectOutputType<{}, z.ZodTypeAny, "passthrough">, z.objectInputType<{}, z.ZodTypeAny, "passthrough">>>;
    }, z.ZodTypeAny, "passthrough"> | undefined;
}, {
    method: string;
    params?: z.objectInputType<{
        /**
         * This parameter name is reserved by MCP to allow clients and servers to attach additional metadata to their notifications.
         */
        _meta: z.ZodOptional<z.ZodObject<{}, "passthrough", z.ZodTypeAny, z.objectOutputType<{}, z.ZodTypeAny, "passthrough">, z.objectInputType<{}, z.ZodTypeAny, "passthrough">>>;
    }, z.ZodTypeAny, "passthrough"> | undefined;
}>;
export declare const ResultSchema: z.ZodObject<{
    /**
     * This result property is reserved by the protocol to allow clients and servers to attach additional metadata to their responses.
     */
    _meta: z.ZodOptional<z.ZodObject<{}, "passthrough", z.ZodTypeAny, z.objectOutputType<{}, z.ZodTypeAny, "passthrough">, z.objectInputType<{}, z.ZodTypeAny, "passthrough">>>;
}, "passthrough", z.ZodTypeAny, z.objectOutputType<{
    /**
     * This result property is reserved by the protocol to allow clients and servers to attach additional metadata to their responses.
     */
    _meta: z.ZodOptional<z.ZodObject<{}, "passthrough", z.ZodTypeAny, z.objectOutputType<{}, z.ZodTypeAny, "passthrough">, z.objectInputType<{}, z.ZodTypeAny, "passthrough">>>;
}, z.ZodTypeAny, "passthrough">, z.objectInputType<{
    /**
     * This result property is reserved by the protocol to allow clients and servers to attach additional metadata to their responses.
     */
    _meta: z.ZodOptional<z.ZodObject<{}, "passthrough", z.ZodTypeAny, z.objectOutputType<{}, z.ZodTypeAny, "passthrough">, z.objectInputType<{}, z.ZodTypeAny, "passthrough">>>;
}, z.ZodTypeAny, "passthrough">>;
/**
 * A uniquely identifying ID for a request in JSON-RPC.
 */
export declare const RequestIdSchema: z.ZodUnion<[z.ZodString, z.ZodNumber]>;
/**
 * A request that expects a response.
 */
export declare const JSONRPCRequestSchema: z.ZodObject<z.objectUtil.extendShape<{
    jsonrpc: z.ZodLiteral<"2.0">;
    id: z.ZodUnion<[z.ZodString, z.ZodNumber]>;
}, {
    method: z.ZodString;
    params: z.ZodOptional<z.ZodObject<{
        _meta: z.ZodOptional<z.ZodObject<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough">>>;
    }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
        _meta: z.ZodOptional<z.ZodObject<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough">>>;
    }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
        _meta: z.ZodOptional<z.ZodObject<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough">>>;
    }, z.ZodTypeAny, "passthrough">>>;
}>, "strict", z.ZodTypeAny, {
    method: string;
    jsonrpc: "2.0";
    id: string | number;
    params?: z.objectOutputType<{
        _meta: z.ZodOptional<z.ZodObject<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough">>>;
    }, z.ZodTypeAny, "passthrough"> | undefined;
}, {
    method: string;
    jsonrpc: "2.0";
    id: string | number;
    params?: z.objectInputType<{
        _meta: z.ZodOptional<z.ZodObject<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough">>>;
    }, z.ZodTypeAny, "passthrough"> | undefined;
}>;
/**
 * A notification which does not expect a response.
 */
export declare const JSONRPCNotificationSchema: z.ZodObject<z.objectUtil.extendShape<{
    jsonrpc: z.ZodLiteral<"2.0">;
}, {
    method: z.ZodString;
    params: z.ZodOptional<z.ZodObject<{
        /**
         * This parameter name is reserved by MCP to allow clients and servers to attach additional metadata to their notifications.
         */
        _meta: z.ZodOptional<z.ZodObject<{}, "passthrough", z.ZodTypeAny, z.objectOutputType<{}, z.ZodTypeAny, "passthrough">, z.objectInputType<{}, z.ZodTypeAny, "passthrough">>>;
    }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
        /**
         * This parameter name is reserved by MCP to allow clients and servers to attach additional metadata to their notifications.
         */
        _meta: z.ZodOptional<z.ZodObject<{}, "passthrough", z.ZodTypeAny, z.objectOutputType<{}, z.ZodTypeAny, "passthrough">, z.objectInputType<{}, z.ZodTypeAny, "passthrough">>>;
    }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
        /**
         * This parameter name is reserved by MCP to allow clients and servers to attach additional metadata to their notifications.
         */
        _meta: z.ZodOptional<z.ZodObject<{}, "passthrough", z.ZodTypeAny, z.objectOutputType<{}, z.ZodTypeAny, "passthrough">, z.objectInputType<{}, z.ZodTypeAny, "passthrough">>>;
    }, z.ZodTypeAny, "passthrough">>>;
}>, "strict", z.ZodTypeAny, {
    method: string;
    jsonrpc: "2.0";
    params?: z.objectOutputType<{
        /**
         * This parameter name is reserved by MCP to allow clients and servers to attach additional metadata to their notifications.
         */
        _meta: z.ZodOptional<z.ZodObject<{}, "passthrough", z.ZodTypeAny, z.objectOutputType<{}, z.ZodTypeAny, "passthrough">, z.objectInputType<{}, z.ZodTypeAny, "passthrough">>>;
    }, z.ZodTypeAny, "passthrough"> | undefined;
}, {
    method: string;
    jsonrpc: "2.0";
    params?: z.objectInputType<{
        /**
         * This parameter name is reserved by MCP to allow clients and servers to attach additional metadata to their notifications.
         */
        _meta: z.ZodOptional<z.ZodObject<{}, "passthrough", z.ZodTypeAny, z.objectOutputType<{}, z.ZodTypeAny, "passthrough">, z.objectInputType<{}, z.ZodTypeAny, "passthrough">>>;
    }, z.ZodTypeAny, "passthrough"> | undefined;
}>;
/**
 * A successful (non-error) response to a request.
 */
export declare const JSONRPCResponseSchema: z.ZodObject<{
    jsonrpc: z.ZodLiteral<"2.0">;
    id: z.ZodUnion<[z.ZodString, z.ZodNumber]>;
    result: z.ZodObject<{
        /**
         * This result property is reserved by the protocol to allow clients and servers to attach additional metadata to their responses.
         */
        _meta: z.ZodOptional<z.ZodObject<{}, "passthrough", z.ZodTypeAny, z.objectOutputType<{}, z.ZodTypeAny, "passthrough">, z.objectInputType<{}, z.ZodTypeAny, "passthrough">>>;
    }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
        /**
         * This result property is reserved by the protocol to allow clients and servers to attach additional metadata to their responses.
         */
        _meta: z.ZodOptional<z.ZodObject<{}, "passthrough", z.ZodTypeAny, z.objectOutputType<{}, z.ZodTypeAny, "passthrough">, z.objectInputType<{}, z.ZodTypeAny, "passthrough">>>;
    }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
        /**
         * This result property is reserved by the protocol to allow clients and servers to attach additional metadata to their responses.
         */
        _meta: z.ZodOptional<z.ZodObject<{}, "passthrough", z.ZodTypeAny, z.objectOutputType<{}, z.ZodTypeAny, "passthrough">, z.objectInputType<{}, z.ZodTypeAny, "passthrough">>>;
    }, z.ZodTypeAny, "passthrough">>;
}, "strict", z.ZodTypeAny, {
    jsonrpc: "2.0";
    id: string | number;
    result: {
        _meta?: z.objectOutputType<{}, z.ZodTypeAny, "passthrough"> | undefined;
    } & {
        [k: string]: unknown;
    };
}, {
    jsonrpc: "2.0";
    id: string | number;
    result: {
        _meta?: z.objectInputType<{}, z.ZodTypeAny, "passthrough"> | undefined;
    } & {
        [k: string]: unknown;
    };
}>;
/**
 * An incomplete set of error codes that may appear in JSON-RPC responses.
 */
export declare enum ErrorCode {
    ConnectionClosed = -1,
    ParseError = -32700,
    InvalidRequest = -32600,
    MethodNotFound = -32601,
    InvalidParams = -32602,
    InternalError = -32603
}
/**
 * A response to a request that indicates an error occurred.
 */
export declare const JSONRPCErrorSchema: z.ZodObject<{
    jsonrpc: z.ZodLiteral<"2.0">;
    id: z.ZodUnion<[z.ZodString, z.ZodNumber]>;
    error: z.ZodObject<{
        /**
         * The error type that occurred.
         */
        code: z.ZodNumber;
        /**
         * A short description of the error. The message SHOULD be limited to a concise single sentence.
         */
        message: z.ZodString;
        /**
         * Additional information about the error. The value of this member is defined by the sender (e.g. detailed error information, nested errors etc.).
         */
        data: z.ZodOptional<z.ZodUnknown>;
    }, "strip", z.ZodTypeAny, {
        code: number;
        message: string;
        data?: unknown;
    }, {
        code: number;
        message: string;
        data?: unknown;
    }>;
}, "strict", z.ZodTypeAny, {
    jsonrpc: "2.0";
    id: string | number;
    error: {
        code: number;
        message: string;
        data?: unknown;
    };
}, {
    jsonrpc: "2.0";
    id: string | number;
    error: {
        code: number;
        message: string;
        data?: unknown;
    };
}>;
export declare const JSONRPCMessageSchema: z.ZodUnion<[z.ZodObject<z.objectUtil.extendShape<{
    jsonrpc: z.ZodLiteral<"2.0">;
    id: z.ZodUnion<[z.ZodString, z.ZodNumber]>;
}, {
    method: z.ZodString;
    params: z.ZodOptional<z.ZodObject<{
        _meta: z.ZodOptional<z.ZodObject<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough">>>;
    }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
        _meta: z.ZodOptional<z.ZodObject<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough">>>;
    }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
        _meta: z.ZodOptional<z.ZodObject<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough">>>;
    }, z.ZodTypeAny, "passthrough">>>;
}>, "strict", z.ZodTypeAny, {
    method: string;
    jsonrpc: "2.0";
    id: string | number;
    params?: z.objectOutputType<{
        _meta: z.ZodOptional<z.ZodObject<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough">>>;
    }, z.ZodTypeAny, "passthrough"> | undefined;
}, {
    method: string;
    jsonrpc: "2.0";
    id: string | number;
    params?: z.objectInputType<{
        _meta: z.ZodOptional<z.ZodObject<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough">>>;
    }, z.ZodTypeAny, "passthrough"> | undefined;
}>, z.ZodObject<z.objectUtil.extendShape<{
    jsonrpc: z.ZodLiteral<"2.0">;
}, {
    method: z.ZodString;
    params: z.ZodOptional<z.ZodObject<{
        /**
         * This parameter name is reserved by MCP to allow clients and servers to attach additional metadata to their notifications.
         */
        _meta: z.ZodOptional<z.ZodObject<{}, "passthrough", z.ZodTypeAny, z.objectOutputType<{}, z.ZodTypeAny, "passthrough">, z.objectInputType<{}, z.ZodTypeAny, "passthrough">>>;
    }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
        /**
         * This parameter name is reserved by MCP to allow clients and servers to attach additional metadata to their notifications.
         */
        _meta: z.ZodOptional<z.ZodObject<{}, "passthrough", z.ZodTypeAny, z.objectOutputType<{}, z.ZodTypeAny, "passthrough">, z.objectInputType<{}, z.ZodTypeAny, "passthrough">>>;
    }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
        /**
         * This parameter name is reserved by MCP to allow clients and servers to attach additional metadata to their notifications.
         */
        _meta: z.ZodOptional<z.ZodObject<{}, "passthrough", z.ZodTypeAny, z.objectOutputType<{}, z.ZodTypeAny, "passthrough">, z.objectInputType<{}, z.ZodTypeAny, "passthrough">>>;
    }, z.ZodTypeAny, "passthrough">>>;
}>, "strict", z.ZodTypeAny, {
    method: string;
    jsonrpc: "2.0";
    params?: z.objectOutputType<{
        /**
         * This parameter name is reserved by MCP to allow clients and servers to attach additional metadata to their notifications.
         */
        _meta: z.ZodOptional<z.ZodObject<{}, "passthrough", z.ZodTypeAny, z.objectOutputType<{}, z.ZodTypeAny, "passthrough">, z.objectInputType<{}, z.ZodTypeAny, "passthrough">>>;
    }, z.ZodTypeAny, "passthrough"> | undefined;
}, {
    method: string;
    jsonrpc: "2.0";
    params?: z.objectInputType<{
        /**
         * This parameter name is reserved by MCP to allow clients and servers to attach additional metadata to their notifications.
         */
        _meta: z.ZodOptional<z.ZodObject<{}, "passthrough", z.ZodTypeAny, z.objectOutputType<{}, z.ZodTypeAny, "passthrough">, z.objectInputType<{}, z.ZodTypeAny, "passthrough">>>;
    }, z.ZodTypeAny, "passthrough"> | undefined;
}>, z.ZodObject<{
    jsonrpc: z.ZodLiteral<"2.0">;
    id: z.ZodUnion<[z.ZodString, z.ZodNumber]>;
    result: z.ZodObject<{
        /**
         * This result property is reserved by the protocol to allow clients and servers to attach additional metadata to their responses.
         */
        _meta: z.ZodOptional<z.ZodObject<{}, "passthrough", z.ZodTypeAny, z.objectOutputType<{}, z.ZodTypeAny, "passthrough">, z.objectInputType<{}, z.ZodTypeAny, "passthrough">>>;
    }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
        /**
         * This result property is reserved by the protocol to allow clients and servers to attach additional metadata to their responses.
         */
        _meta: z.ZodOptional<z.ZodObject<{}, "passthrough", z.ZodTypeAny, z.objectOutputType<{}, z.ZodTypeAny, "passthrough">, z.objectInputType<{}, z.ZodTypeAny, "passthrough">>>;
    }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
        /**
         * This result property is reserved by the protocol to allow clients and servers to attach additional metadata to their responses.
         */
        _meta: z.ZodOptional<z.ZodObject<{}, "passthrough", z.ZodTypeAny, z.objectOutputType<{}, z.ZodTypeAny, "passthrough">, z.objectInputType<{}, z.ZodTypeAny, "passthrough">>>;
    }, z.ZodTypeAny, "passthrough">>;
}, "strict", z.ZodTypeAny, {
    jsonrpc: "2.0";
    id: string | number;
    result: {
        _meta?: z.objectOutputType<{}, z.ZodTypeAny, "passthrough"> | undefined;
    } & {
        [k: string]: unknown;
    };
}, {
    jsonrpc: "2.0";
    id: string | number;
    result: {
        _meta?: z.objectInputType<{}, z.ZodTypeAny, "passthrough"> | undefined;
    } & {
        [k: string]: unknown;
    };
}>, z.ZodObject<{
    jsonrpc: z.ZodLiteral<"2.0">;
    id: z.ZodUnion<[z.ZodString, z.ZodNumber]>;
    error: z.ZodObject<{
        /**
         * The error type that occurred.
         */
        code: z.ZodNumber;
        /**
         * A short description of the error. The message SHOULD be limited to a concise single sentence.
         */
        message: z.ZodString;
        /**
         * Additional information about the error. The value of this member is defined by the sender (e.g. detailed error information, nested errors etc.).
         */
        data: z.ZodOptional<z.ZodUnknown>;
    }, "strip", z.ZodTypeAny, {
        code: number;
        message: string;
        data?: unknown;
    }, {
        code: number;
        message: string;
        data?: unknown;
    }>;
}, "strict", z.ZodTypeAny, {
    jsonrpc: "2.0";
    id: string | number;
    error: {
        code: number;
        message: string;
        data?: unknown;
    };
}, {
    jsonrpc: "2.0";
    id: string | number;
    error: {
        code: number;
        message: string;
        data?: unknown;
    };
}>]>;
/**
 * A response that indicates success but carries no data.
 */
export declare const EmptyResultSchema: z.ZodObject<{
    /**
     * This result property is reserved by the protocol to allow clients and servers to attach additional metadata to their responses.
     */
    _meta: z.ZodOptional<z.ZodObject<{}, "passthrough", z.ZodTypeAny, z.objectOutputType<{}, z.ZodTypeAny, "passthrough">, z.objectInputType<{}, z.ZodTypeAny, "passthrough">>>;
}, "strict", z.ZodTypeAny, {
    _meta?: z.objectOutputType<{}, z.ZodTypeAny, "passthrough"> | undefined;
}, {
    _meta?: z.objectInputType<{}, z.ZodTypeAny, "passthrough"> | undefined;
}>;
/**
 * Text provided to or from an LLM.
 */
export declare const TextContentSchema: z.ZodObject<{
    type: z.ZodLiteral<"text">;
    /**
     * The text content of the message.
     */
    text: z.ZodString;
}, "strip", z.ZodTypeAny, {
    type: "text";
    text: string;
}, {
    type: "text";
    text: string;
}>;
/**
 * An image provided to or from an LLM.
 */
export declare const ImageContentSchema: z.ZodObject<{
    type: z.ZodLiteral<"image">;
    /**
     * The base64-encoded image data.
     */
    data: z.ZodString;
    /**
     * The MIME type of the image. Different providers may support different image types.
     */
    mimeType: z.ZodString;
}, "strip", z.ZodTypeAny, {
    type: "image";
    data: string;
    mimeType: string;
}, {
    type: "image";
    data: string;
    mimeType: string;
}>;
/**
 * Describes a message issued to or received from an LLM API.
 */
export declare const SamplingMessageSchema: z.ZodObject<{
    role: z.ZodEnum<["user", "assistant"]>;
    content: z.ZodUnion<[z.ZodObject<{
        type: z.ZodLiteral<"text">;
        /**
         * The text content of the message.
         */
        text: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        type: "text";
        text: string;
    }, {
        type: "text";
        text: string;
    }>, z.ZodObject<{
        type: z.ZodLiteral<"image">;
        /**
         * The base64-encoded image data.
         */
        data: z.ZodString;
        /**
         * The MIME type of the image. Different providers may support different image types.
         */
        mimeType: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        type: "image";
        data: string;
        mimeType: string;
    }, {
        type: "image";
        data: string;
        mimeType: string;
    }>]>;
}, "strip", z.ZodTypeAny, {
    role: "user" | "assistant";
    content: {
        type: "text";
        text: string;
    } | {
        type: "image";
        data: string;
        mimeType: string;
    };
}, {
    role: "user" | "assistant";
    content: {
        type: "text";
        text: string;
    } | {
        type: "image";
        data: string;
        mimeType: string;
    };
}>;
/**
 * Describes the name and version of an MCP implementation.
 */
export declare const ImplementationSchema: z.ZodObject<{
    name: z.ZodString;
    version: z.ZodString;
}, "strip", z.ZodTypeAny, {
    name: string;
    version: string;
}, {
    name: string;
    version: string;
}>;
/**
 * Capabilities a client may support. Known capabilities are defined here, in this schema, but this is not a closed set: any client can define its own, additional capabilities.
 */
export declare const ClientCapabilitiesSchema: z.ZodObject<{
    /**
     * Experimental, non-standard capabilities that the client supports.
     */
    experimental: z.ZodOptional<z.ZodObject<{}, "passthrough", z.ZodTypeAny, z.objectOutputType<{}, z.ZodTypeAny, "passthrough">, z.objectInputType<{}, z.ZodTypeAny, "passthrough">>>;
    /**
     * Present if the client supports sampling from an LLM.
     */
    sampling: z.ZodOptional<z.ZodObject<{}, "passthrough", z.ZodTypeAny, z.objectOutputType<{}, z.ZodTypeAny, "passthrough">, z.objectInputType<{}, z.ZodTypeAny, "passthrough">>>;
}, "strip", z.ZodTypeAny, {
    experimental?: z.objectOutputType<{}, z.ZodTypeAny, "passthrough"> | undefined;
    sampling?: z.objectOutputType<{}, z.ZodTypeAny, "passthrough"> | undefined;
}, {
    experimental?: z.objectInputType<{}, z.ZodTypeAny, "passthrough"> | undefined;
    sampling?: z.objectInputType<{}, z.ZodTypeAny, "passthrough"> | undefined;
}>;
/**
 * This request is sent from the client to the server when it first connects, asking it to begin initialization.
 */
export declare const InitializeRequestSchema: z.ZodObject<z.objectUtil.extendShape<{
    method: z.ZodString;
    params: z.ZodOptional<z.ZodObject<{
        _meta: z.ZodOptional<z.ZodObject<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough">>>;
    }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
        _meta: z.ZodOptional<z.ZodObject<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough">>>;
    }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
        _meta: z.ZodOptional<z.ZodObject<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough">>>;
    }, z.ZodTypeAny, "passthrough">>>;
}, {
    method: z.ZodLiteral<"initialize">;
    params: z.ZodObject<z.objectUtil.extendShape<{
        _meta: z.ZodOptional<z.ZodObject<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough">>>;
    }, {
        /**
         * The latest version of the Model Context Protocol that the client supports. The client MAY decide to support older versions as well.
         */
        protocolVersion: z.ZodUnion<[z.ZodString, z.ZodNumber]>;
        capabilities: z.ZodObject<{
            /**
             * Experimental, non-standard capabilities that the client supports.
             */
            experimental: z.ZodOptional<z.ZodObject<{}, "passthrough", z.ZodTypeAny, z.objectOutputType<{}, z.ZodTypeAny, "passthrough">, z.objectInputType<{}, z.ZodTypeAny, "passthrough">>>;
            /**
             * Present if the client supports sampling from an LLM.
             */
            sampling: z.ZodOptional<z.ZodObject<{}, "passthrough", z.ZodTypeAny, z.objectOutputType<{}, z.ZodTypeAny, "passthrough">, z.objectInputType<{}, z.ZodTypeAny, "passthrough">>>;
        }, "strip", z.ZodTypeAny, {
            experimental?: z.objectOutputType<{}, z.ZodTypeAny, "passthrough"> | undefined;
            sampling?: z.objectOutputType<{}, z.ZodTypeAny, "passthrough"> | undefined;
        }, {
            experimental?: z.objectInputType<{}, z.ZodTypeAny, "passthrough"> | undefined;
            sampling?: z.objectInputType<{}, z.ZodTypeAny, "passthrough"> | undefined;
        }>;
        clientInfo: z.ZodObject<{
            name: z.ZodString;
            version: z.ZodString;
        }, "strip", z.ZodTypeAny, {
            name: string;
            version: string;
        }, {
            name: string;
            version: string;
        }>;
    }>, "passthrough", z.ZodTypeAny, z.objectOutputType<z.objectUtil.extendShape<{
        _meta: z.ZodOptional<z.ZodObject<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough">>>;
    }, {
        /**
         * The latest version of the Model Context Protocol that the client supports. The client MAY decide to support older versions as well.
         */
        protocolVersion: z.ZodUnion<[z.ZodString, z.ZodNumber]>;
        capabilities: z.ZodObject<{
            /**
             * Experimental, non-standard capabilities that the client supports.
             */
            experimental: z.ZodOptional<z.ZodObject<{}, "passthrough", z.ZodTypeAny, z.objectOutputType<{}, z.ZodTypeAny, "passthrough">, z.objectInputType<{}, z.ZodTypeAny, "passthrough">>>;
            /**
             * Present if the client supports sampling from an LLM.
             */
            sampling: z.ZodOptional<z.ZodObject<{}, "passthrough", z.ZodTypeAny, z.objectOutputType<{}, z.ZodTypeAny, "passthrough">, z.objectInputType<{}, z.ZodTypeAny, "passthrough">>>;
        }, "strip", z.ZodTypeAny, {
            experimental?: z.objectOutputType<{}, z.ZodTypeAny, "passthrough"> | undefined;
            sampling?: z.objectOutputType<{}, z.ZodTypeAny, "passthrough"> | undefined;
        }, {
            experimental?: z.objectInputType<{}, z.ZodTypeAny, "passthrough"> | undefined;
            sampling?: z.objectInputType<{}, z.ZodTypeAny, "passthrough"> | undefined;
        }>;
        clientInfo: z.ZodObject<{
            name: z.ZodString;
            version: z.ZodString;
        }, "strip", z.ZodTypeAny, {
            name: string;
            version: string;
        }, {
            name: string;
            version: string;
        }>;
    }>, z.ZodTypeAny, "passthrough">, z.objectInputType<z.objectUtil.extendShape<{
        _meta: z.ZodOptional<z.ZodObject<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough">>>;
    }, {
        /**
         * The latest version of the Model Context Protocol that the client supports. The client MAY decide to support older versions as well.
         */
        protocolVersion: z.ZodUnion<[z.ZodString, z.ZodNumber]>;
        capabilities: z.ZodObject<{
            /**
             * Experimental, non-standard capabilities that the client supports.
             */
            experimental: z.ZodOptional<z.ZodObject<{}, "passthrough", z.ZodTypeAny, z.objectOutputType<{}, z.ZodTypeAny, "passthrough">, z.objectInputType<{}, z.ZodTypeAny, "passthrough">>>;
            /**
             * Present if the client supports sampling from an LLM.
             */
            sampling: z.ZodOptional<z.ZodObject<{}, "passthrough", z.ZodTypeAny, z.objectOutputType<{}, z.ZodTypeAny, "passthrough">, z.objectInputType<{}, z.ZodTypeAny, "passthrough">>>;
        }, "strip", z.ZodTypeAny, {
            experimental?: z.objectOutputType<{}, z.ZodTypeAny, "passthrough"> | undefined;
            sampling?: z.objectOutputType<{}, z.ZodTypeAny, "passthrough"> | undefined;
        }, {
            experimental?: z.objectInputType<{}, z.ZodTypeAny, "passthrough"> | undefined;
            sampling?: z.objectInputType<{}, z.ZodTypeAny, "passthrough"> | undefined;
        }>;
        clientInfo: z.ZodObject<{
            name: z.ZodString;
            version: z.ZodString;
        }, "strip", z.ZodTypeAny, {
            name: string;
            version: string;
        }, {
            name: string;
            version: string;
        }>;
    }>, z.ZodTypeAny, "passthrough">>;
}>, "strip", z.ZodTypeAny, {
    params: {
        protocolVersion: string | number;
        capabilities: {
            experimental?: z.objectOutputType<{}, z.ZodTypeAny, "passthrough"> | undefined;
            sampling?: z.objectOutputType<{}, z.ZodTypeAny, "passthrough"> | undefined;
        };
        clientInfo: {
            name: string;
            version: string;
        };
        _meta?: z.objectOutputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough"> | undefined;
    } & {
        [k: string]: unknown;
    };
    method: "initialize";
}, {
    params: {
        protocolVersion: string | number;
        capabilities: {
            experimental?: z.objectInputType<{}, z.ZodTypeAny, "passthrough"> | undefined;
            sampling?: z.objectInputType<{}, z.ZodTypeAny, "passthrough"> | undefined;
        };
        clientInfo: {
            name: string;
            version: string;
        };
        _meta?: z.objectInputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough"> | undefined;
    } & {
        [k: string]: unknown;
    };
    method: "initialize";
}>;
/**
 * Capabilities that a server may support. Known capabilities are defined here, in this schema, but this is not a closed set: any server can define its own, additional capabilities.
 */
export declare const ServerCapabilitiesSchema: z.ZodObject<{
    /**
     * Experimental, non-standard capabilities that the server supports.
     */
    experimental: z.ZodOptional<z.ZodObject<{}, "passthrough", z.ZodTypeAny, z.objectOutputType<{}, z.ZodTypeAny, "passthrough">, z.objectInputType<{}, z.ZodTypeAny, "passthrough">>>;
    /**
     * Present if the server supports sending log messages to the client.
     */
    logging: z.ZodOptional<z.ZodObject<{}, "passthrough", z.ZodTypeAny, z.objectOutputType<{}, z.ZodTypeAny, "passthrough">, z.objectInputType<{}, z.ZodTypeAny, "passthrough">>>;
    /**
     * Present if the server offers any prompt templates.
     */
    prompts: z.ZodOptional<z.ZodObject<{
        /**
         * Whether this server supports notifications for changes to the prompt list.
         */
        listChanged: z.ZodOptional<z.ZodBoolean>;
    }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
        /**
         * Whether this server supports notifications for changes to the prompt list.
         */
        listChanged: z.ZodOptional<z.ZodBoolean>;
    }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
        /**
         * Whether this server supports notifications for changes to the prompt list.
         */
        listChanged: z.ZodOptional<z.ZodBoolean>;
    }, z.ZodTypeAny, "passthrough">>>;
    /**
     * Present if the server offers any resources to read.
     */
    resources: z.ZodOptional<z.ZodObject<{
        /**
         * Whether this server supports subscribing to resource updates.
         */
        subscribe: z.ZodOptional<z.ZodBoolean>;
        /**
         * Whether this server supports notifications for changes to the resource list.
         */
        listChanged: z.ZodOptional<z.ZodBoolean>;
    }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
        /**
         * Whether this server supports subscribing to resource updates.
         */
        subscribe: z.ZodOptional<z.ZodBoolean>;
        /**
         * Whether this server supports notifications for changes to the resource list.
         */
        listChanged: z.ZodOptional<z.ZodBoolean>;
    }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
        /**
         * Whether this server supports subscribing to resource updates.
         */
        subscribe: z.ZodOptional<z.ZodBoolean>;
        /**
         * Whether this server supports notifications for changes to the resource list.
         */
        listChanged: z.ZodOptional<z.ZodBoolean>;
    }, z.ZodTypeAny, "passthrough">>>;
    /**
     * Present if the server offers any tools to call.
     */
    tools: z.ZodOptional<z.ZodObject<{
        /**
         * Whether this server supports notifications for changes to the tool list.
         */
        listChanged: z.ZodOptional<z.ZodBoolean>;
    }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
        /**
         * Whether this server supports notifications for changes to the tool list.
         */
        listChanged: z.ZodOptional<z.ZodBoolean>;
    }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
        /**
         * Whether this server supports notifications for changes to the tool list.
         */
        listChanged: z.ZodOptional<z.ZodBoolean>;
    }, z.ZodTypeAny, "passthrough">>>;
}, "strip", z.ZodTypeAny, {
    experimental?: z.objectOutputType<{}, z.ZodTypeAny, "passthrough"> | undefined;
    logging?: z.objectOutputType<{}, z.ZodTypeAny, "passthrough"> | undefined;
    prompts?: z.objectOutputType<{
        /**
         * Whether this server supports notifications for changes to the prompt list.
         */
        listChanged: z.ZodOptional<z.ZodBoolean>;
    }, z.ZodTypeAny, "passthrough"> | undefined;
    resources?: z.objectOutputType<{
        /**
         * Whether this server supports subscribing to resource updates.
         */
        subscribe: z.ZodOptional<z.ZodBoolean>;
        /**
         * Whether this server supports notifications for changes to the resource list.
         */
        listChanged: z.ZodOptional<z.ZodBoolean>;
    }, z.ZodTypeAny, "passthrough"> | undefined;
    tools?: z.objectOutputType<{
        /**
         * Whether this server supports notifications for changes to the tool list.
         */
        listChanged: z.ZodOptional<z.ZodBoolean>;
    }, z.ZodTypeAny, "passthrough"> | undefined;
}, {
    experimental?: z.objectInputType<{}, z.ZodTypeAny, "passthrough"> | undefined;
    logging?: z.objectInputType<{}, z.ZodTypeAny, "passthrough"> | undefined;
    prompts?: z.objectInputType<{
        /**
         * Whether this server supports notifications for changes to the prompt list.
         */
        listChanged: z.ZodOptional<z.ZodBoolean>;
    }, z.ZodTypeAny, "passthrough"> | undefined;
    resources?: z.objectInputType<{
        /**
         * Whether this server supports subscribing to resource updates.
         */
        subscribe: z.ZodOptional<z.ZodBoolean>;
        /**
         * Whether this server supports notifications for changes to the resource list.
         */
        listChanged: z.ZodOptional<z.ZodBoolean>;
    }, z.ZodTypeAny, "passthrough"> | undefined;
    tools?: z.objectInputType<{
        /**
         * Whether this server supports notifications for changes to the tool list.
         */
        listChanged: z.ZodOptional<z.ZodBoolean>;
    }, z.ZodTypeAny, "passthrough"> | undefined;
}>;
/**
 * After receiving an initialize request from the client, the server sends this response.
 */
export declare const InitializeResultSchema: z.ZodObject<z.objectUtil.extendShape<{
    /**
     * This result property is reserved by the protocol to allow clients and servers to attach additional metadata to their responses.
     */
    _meta: z.ZodOptional<z.ZodObject<{}, "passthrough", z.ZodTypeAny, z.objectOutputType<{}, z.ZodTypeAny, "passthrough">, z.objectInputType<{}, z.ZodTypeAny, "passthrough">>>;
}, {
    /**
     * The version of the Model Context Protocol that the server wants to use. This may not match the version that the client requested. If the client cannot support this version, it MUST disconnect.
     */
    protocolVersion: z.ZodUnion<[z.ZodString, z.ZodNumber]>;
    capabilities: z.ZodObject<{
        /**
         * Experimental, non-standard capabilities that the server supports.
         */
        experimental: z.ZodOptional<z.ZodObject<{}, "passthrough", z.ZodTypeAny, z.objectOutputType<{}, z.ZodTypeAny, "passthrough">, z.objectInputType<{}, z.ZodTypeAny, "passthrough">>>;
        /**
         * Present if the server supports sending log messages to the client.
         */
        logging: z.ZodOptional<z.ZodObject<{}, "passthrough", z.ZodTypeAny, z.objectOutputType<{}, z.ZodTypeAny, "passthrough">, z.objectInputType<{}, z.ZodTypeAny, "passthrough">>>;
        /**
         * Present if the server offers any prompt templates.
         */
        prompts: z.ZodOptional<z.ZodObject<{
            /**
             * Whether this server supports notifications for changes to the prompt list.
             */
            listChanged: z.ZodOptional<z.ZodBoolean>;
        }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
            /**
             * Whether this server supports notifications for changes to the prompt list.
             */
            listChanged: z.ZodOptional<z.ZodBoolean>;
        }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
            /**
             * Whether this server supports notifications for changes to the prompt list.
             */
            listChanged: z.ZodOptional<z.ZodBoolean>;
        }, z.ZodTypeAny, "passthrough">>>;
        /**
         * Present if the server offers any resources to read.
         */
        resources: z.ZodOptional<z.ZodObject<{
            /**
             * Whether this server supports subscribing to resource updates.
             */
            subscribe: z.ZodOptional<z.ZodBoolean>;
            /**
             * Whether this server supports notifications for changes to the resource list.
             */
            listChanged: z.ZodOptional<z.ZodBoolean>;
        }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
            /**
             * Whether this server supports subscribing to resource updates.
             */
            subscribe: z.ZodOptional<z.ZodBoolean>;
            /**
             * Whether this server supports notifications for changes to the resource list.
             */
            listChanged: z.ZodOptional<z.ZodBoolean>;
        }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
            /**
             * Whether this server supports subscribing to resource updates.
             */
            subscribe: z.ZodOptional<z.ZodBoolean>;
            /**
             * Whether this server supports notifications for changes to the resource list.
             */
            listChanged: z.ZodOptional<z.ZodBoolean>;
        }, z.ZodTypeAny, "passthrough">>>;
        /**
         * Present if the server offers any tools to call.
         */
        tools: z.ZodOptional<z.ZodObject<{
            /**
             * Whether this server supports notifications for changes to the tool list.
             */
            listChanged: z.ZodOptional<z.ZodBoolean>;
        }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
            /**
             * Whether this server supports notifications for changes to the tool list.
             */
            listChanged: z.ZodOptional<z.ZodBoolean>;
        }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
            /**
             * Whether this server supports notifications for changes to the tool list.
             */
            listChanged: z.ZodOptional<z.ZodBoolean>;
        }, z.ZodTypeAny, "passthrough">>>;
    }, "strip", z.ZodTypeAny, {
        experimental?: z.objectOutputType<{}, z.ZodTypeAny, "passthrough"> | undefined;
        logging?: z.objectOutputType<{}, z.ZodTypeAny, "passthrough"> | undefined;
        prompts?: z.objectOutputType<{
            /**
             * Whether this server supports notifications for changes to the prompt list.
             */
            listChanged: z.ZodOptional<z.ZodBoolean>;
        }, z.ZodTypeAny, "passthrough"> | undefined;
        resources?: z.objectOutputType<{
            /**
             * Whether this server supports subscribing to resource updates.
             */
            subscribe: z.ZodOptional<z.ZodBoolean>;
            /**
             * Whether this server supports notifications for changes to the resource list.
             */
            listChanged: z.ZodOptional<z.ZodBoolean>;
        }, z.ZodTypeAny, "passthrough"> | undefined;
        tools?: z.objectOutputType<{
            /**
             * Whether this server supports notifications for changes to the tool list.
             */
            listChanged: z.ZodOptional<z.ZodBoolean>;
        }, z.ZodTypeAny, "passthrough"> | undefined;
    }, {
        experimental?: z.objectInputType<{}, z.ZodTypeAny, "passthrough"> | undefined;
        logging?: z.objectInputType<{}, z.ZodTypeAny, "passthrough"> | undefined;
        prompts?: z.objectInputType<{
            /**
             * Whether this server supports notifications for changes to the prompt list.
             */
            listChanged: z.ZodOptional<z.ZodBoolean>;
        }, z.ZodTypeAny, "passthrough"> | undefined;
        resources?: z.objectInputType<{
            /**
             * Whether this server supports subscribing to resource updates.
             */
            subscribe: z.ZodOptional<z.ZodBoolean>;
            /**
             * Whether this server supports notifications for changes to the resource list.
             */
            listChanged: z.ZodOptional<z.ZodBoolean>;
        }, z.ZodTypeAny, "passthrough"> | undefined;
        tools?: z.objectInputType<{
            /**
             * Whether this server supports notifications for changes to the tool list.
             */
            listChanged: z.ZodOptional<z.ZodBoolean>;
        }, z.ZodTypeAny, "passthrough"> | undefined;
    }>;
    serverInfo: z.ZodObject<{
        name: z.ZodString;
        version: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        name: string;
        version: string;
    }, {
        name: string;
        version: string;
    }>;
}>, "passthrough", z.ZodTypeAny, z.objectOutputType<z.objectUtil.extendShape<{
    /**
     * This result property is reserved by the protocol to allow clients and servers to attach additional metadata to their responses.
     */
    _meta: z.ZodOptional<z.ZodObject<{}, "passthrough", z.ZodTypeAny, z.objectOutputType<{}, z.ZodTypeAny, "passthrough">, z.objectInputType<{}, z.ZodTypeAny, "passthrough">>>;
}, {
    /**
     * The version of the Model Context Protocol that the server wants to use. This may not match the version that the client requested. If the client cannot support this version, it MUST disconnect.
     */
    protocolVersion: z.ZodUnion<[z.ZodString, z.ZodNumber]>;
    capabilities: z.ZodObject<{
        /**
         * Experimental, non-standard capabilities that the server supports.
         */
        experimental: z.ZodOptional<z.ZodObject<{}, "passthrough", z.ZodTypeAny, z.objectOutputType<{}, z.ZodTypeAny, "passthrough">, z.objectInputType<{}, z.ZodTypeAny, "passthrough">>>;
        /**
         * Present if the server supports sending log messages to the client.
         */
        logging: z.ZodOptional<z.ZodObject<{}, "passthrough", z.ZodTypeAny, z.objectOutputType<{}, z.ZodTypeAny, "passthrough">, z.objectInputType<{}, z.ZodTypeAny, "passthrough">>>;
        /**
         * Present if the server offers any prompt templates.
         */
        prompts: z.ZodOptional<z.ZodObject<{
            /**
             * Whether this server supports notifications for changes to the prompt list.
             */
            listChanged: z.ZodOptional<z.ZodBoolean>;
        }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
            /**
             * Whether this server supports notifications for changes to the prompt list.
             */
            listChanged: z.ZodOptional<z.ZodBoolean>;
        }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
            /**
             * Whether this server supports notifications for changes to the prompt list.
             */
            listChanged: z.ZodOptional<z.ZodBoolean>;
        }, z.ZodTypeAny, "passthrough">>>;
        /**
         * Present if the server offers any resources to read.
         */
        resources: z.ZodOptional<z.ZodObject<{
            /**
             * Whether this server supports subscribing to resource updates.
             */
            subscribe: z.ZodOptional<z.ZodBoolean>;
            /**
             * Whether this server supports notifications for changes to the resource list.
             */
            listChanged: z.ZodOptional<z.ZodBoolean>;
        }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
            /**
             * Whether this server supports subscribing to resource updates.
             */
            subscribe: z.ZodOptional<z.ZodBoolean>;
            /**
             * Whether this server supports notifications for changes to the resource list.
             */
            listChanged: z.ZodOptional<z.ZodBoolean>;
        }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
            /**
             * Whether this server supports subscribing to resource updates.
             */
            subscribe: z.ZodOptional<z.ZodBoolean>;
            /**
             * Whether this server supports notifications for changes to the resource list.
             */
            listChanged: z.ZodOptional<z.ZodBoolean>;
        }, z.ZodTypeAny, "passthrough">>>;
        /**
         * Present if the server offers any tools to call.
         */
        tools: z.ZodOptional<z.ZodObject<{
            /**
             * Whether this server supports notifications for changes to the tool list.
             */
            listChanged: z.ZodOptional<z.ZodBoolean>;
        }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
            /**
             * Whether this server supports notifications for changes to the tool list.
             */
            listChanged: z.ZodOptional<z.ZodBoolean>;
        }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
            /**
             * Whether this server supports notifications for changes to the tool list.
             */
            listChanged: z.ZodOptional<z.ZodBoolean>;
        }, z.ZodTypeAny, "passthrough">>>;
    }, "strip", z.ZodTypeAny, {
        experimental?: z.objectOutputType<{}, z.ZodTypeAny, "passthrough"> | undefined;
        logging?: z.objectOutputType<{}, z.ZodTypeAny, "passthrough"> | undefined;
        prompts?: z.objectOutputType<{
            /**
             * Whether this server supports notifications for changes to the prompt list.
             */
            listChanged: z.ZodOptional<z.ZodBoolean>;
        }, z.ZodTypeAny, "passthrough"> | undefined;
        resources?: z.objectOutputType<{
            /**
             * Whether this server supports subscribing to resource updates.
             */
            subscribe: z.ZodOptional<z.ZodBoolean>;
            /**
             * Whether this server supports notifications for changes to the resource list.
             */
            listChanged: z.ZodOptional<z.ZodBoolean>;
        }, z.ZodTypeAny, "passthrough"> | undefined;
        tools?: z.objectOutputType<{
            /**
             * Whether this server supports notifications for changes to the tool list.
             */
            listChanged: z.ZodOptional<z.ZodBoolean>;
        }, z.ZodTypeAny, "passthrough"> | undefined;
    }, {
        experimental?: z.objectInputType<{}, z.ZodTypeAny, "passthrough"> | undefined;
        logging?: z.objectInputType<{}, z.ZodTypeAny, "passthrough"> | undefined;
        prompts?: z.objectInputType<{
            /**
             * Whether this server supports notifications for changes to the prompt list.
             */
            listChanged: z.ZodOptional<z.ZodBoolean>;
        }, z.ZodTypeAny, "passthrough"> | undefined;
        resources?: z.objectInputType<{
            /**
             * Whether this server supports subscribing to resource updates.
             */
            subscribe: z.ZodOptional<z.ZodBoolean>;
            /**
             * Whether this server supports notifications for changes to the resource list.
             */
            listChanged: z.ZodOptional<z.ZodBoolean>;
        }, z.ZodTypeAny, "passthrough"> | undefined;
        tools?: z.objectInputType<{
            /**
             * Whether this server supports notifications for changes to the tool list.
             */
            listChanged: z.ZodOptional<z.ZodBoolean>;
        }, z.ZodTypeAny, "passthrough"> | undefined;
    }>;
    serverInfo: z.ZodObject<{
        name: z.ZodString;
        version: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        name: string;
        version: string;
    }, {
        name: string;
        version: string;
    }>;
}>, z.ZodTypeAny, "passthrough">, z.objectInputType<z.objectUtil.extendShape<{
    /**
     * This result property is reserved by the protocol to allow clients and servers to attach additional metadata to their responses.
     */
    _meta: z.ZodOptional<z.ZodObject<{}, "passthrough", z.ZodTypeAny, z.objectOutputType<{}, z.ZodTypeAny, "passthrough">, z.objectInputType<{}, z.ZodTypeAny, "passthrough">>>;
}, {
    /**
     * The version of the Model Context Protocol that the server wants to use. This may not match the version that the client requested. If the client cannot support this version, it MUST disconnect.
     */
    protocolVersion: z.ZodUnion<[z.ZodString, z.ZodNumber]>;
    capabilities: z.ZodObject<{
        /**
         * Experimental, non-standard capabilities that the server supports.
         */
        experimental: z.ZodOptional<z.ZodObject<{}, "passthrough", z.ZodTypeAny, z.objectOutputType<{}, z.ZodTypeAny, "passthrough">, z.objectInputType<{}, z.ZodTypeAny, "passthrough">>>;
        /**
         * Present if the server supports sending log messages to the client.
         */
        logging: z.ZodOptional<z.ZodObject<{}, "passthrough", z.ZodTypeAny, z.objectOutputType<{}, z.ZodTypeAny, "passthrough">, z.objectInputType<{}, z.ZodTypeAny, "passthrough">>>;
        /**
         * Present if the server offers any prompt templates.
         */
        prompts: z.ZodOptional<z.ZodObject<{
            /**
             * Whether this server supports notifications for changes to the prompt list.
             */
            listChanged: z.ZodOptional<z.ZodBoolean>;
        }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
            /**
             * Whether this server supports notifications for changes to the prompt list.
             */
            listChanged: z.ZodOptional<z.ZodBoolean>;
        }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
            /**
             * Whether this server supports notifications for changes to the prompt list.
             */
            listChanged: z.ZodOptional<z.ZodBoolean>;
        }, z.ZodTypeAny, "passthrough">>>;
        /**
         * Present if the server offers any resources to read.
         */
        resources: z.ZodOptional<z.ZodObject<{
            /**
             * Whether this server supports subscribing to resource updates.
             */
            subscribe: z.ZodOptional<z.ZodBoolean>;
            /**
             * Whether this server supports notifications for changes to the resource list.
             */
            listChanged: z.ZodOptional<z.ZodBoolean>;
        }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
            /**
             * Whether this server supports subscribing to resource updates.
             */
            subscribe: z.ZodOptional<z.ZodBoolean>;
            /**
             * Whether this server supports notifications for changes to the resource list.
             */
            listChanged: z.ZodOptional<z.ZodBoolean>;
        }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
            /**
             * Whether this server supports subscribing to resource updates.
             */
            subscribe: z.ZodOptional<z.ZodBoolean>;
            /**
             * Whether this server supports notifications for changes to the resource list.
             */
            listChanged: z.ZodOptional<z.ZodBoolean>;
        }, z.ZodTypeAny, "passthrough">>>;
        /**
         * Present if the server offers any tools to call.
         */
        tools: z.ZodOptional<z.ZodObject<{
            /**
             * Whether this server supports notifications for changes to the tool list.
             */
            listChanged: z.ZodOptional<z.ZodBoolean>;
        }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
            /**
             * Whether this server supports notifications for changes to the tool list.
             */
            listChanged: z.ZodOptional<z.ZodBoolean>;
        }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
            /**
             * Whether this server supports notifications for changes to the tool list.
             */
            listChanged: z.ZodOptional<z.ZodBoolean>;
        }, z.ZodTypeAny, "passthrough">>>;
    }, "strip", z.ZodTypeAny, {
        experimental?: z.objectOutputType<{}, z.ZodTypeAny, "passthrough"> | undefined;
        logging?: z.objectOutputType<{}, z.ZodTypeAny, "passthrough"> | undefined;
        prompts?: z.objectOutputType<{
            /**
             * Whether this server supports notifications for changes to the prompt list.
             */
            listChanged: z.ZodOptional<z.ZodBoolean>;
        }, z.ZodTypeAny, "passthrough"> | undefined;
        resources?: z.objectOutputType<{
            /**
             * Whether this server supports subscribing to resource updates.
             */
            subscribe: z.ZodOptional<z.ZodBoolean>;
            /**
             * Whether this server supports notifications for changes to the resource list.
             */
            listChanged: z.ZodOptional<z.ZodBoolean>;
        }, z.ZodTypeAny, "passthrough"> | undefined;
        tools?: z.objectOutputType<{
            /**
             * Whether this server supports notifications for changes to the tool list.
             */
            listChanged: z.ZodOptional<z.ZodBoolean>;
        }, z.ZodTypeAny, "passthrough"> | undefined;
    }, {
        experimental?: z.objectInputType<{}, z.ZodTypeAny, "passthrough"> | undefined;
        logging?: z.objectInputType<{}, z.ZodTypeAny, "passthrough"> | undefined;
        prompts?: z.objectInputType<{
            /**
             * Whether this server supports notifications for changes to the prompt list.
             */
            listChanged: z.ZodOptional<z.ZodBoolean>;
        }, z.ZodTypeAny, "passthrough"> | undefined;
        resources?: z.objectInputType<{
            /**
             * Whether this server supports subscribing to resource updates.
             */
            subscribe: z.ZodOptional<z.ZodBoolean>;
            /**
             * Whether this server supports notifications for changes to the resource list.
             */
            listChanged: z.ZodOptional<z.ZodBoolean>;
        }, z.ZodTypeAny, "passthrough"> | undefined;
        tools?: z.objectInputType<{
            /**
             * Whether this server supports notifications for changes to the tool list.
             */
            listChanged: z.ZodOptional<z.ZodBoolean>;
        }, z.ZodTypeAny, "passthrough"> | undefined;
    }>;
    serverInfo: z.ZodObject<{
        name: z.ZodString;
        version: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        name: string;
        version: string;
    }, {
        name: string;
        version: string;
    }>;
}>, z.ZodTypeAny, "passthrough">>;
/**
 * This notification is sent from the client to the server after initialization has finished.
 */
export declare const InitializedNotificationSchema: z.ZodObject<z.objectUtil.extendShape<{
    method: z.ZodString;
    params: z.ZodOptional<z.ZodObject<{
        /**
         * This parameter name is reserved by MCP to allow clients and servers to attach additional metadata to their notifications.
         */
        _meta: z.ZodOptional<z.ZodObject<{}, "passthrough", z.ZodTypeAny, z.objectOutputType<{}, z.ZodTypeAny, "passthrough">, z.objectInputType<{}, z.ZodTypeAny, "passthrough">>>;
    }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
        /**
         * This parameter name is reserved by MCP to allow clients and servers to attach additional metadata to their notifications.
         */
        _meta: z.ZodOptional<z.ZodObject<{}, "passthrough", z.ZodTypeAny, z.objectOutputType<{}, z.ZodTypeAny, "passthrough">, z.objectInputType<{}, z.ZodTypeAny, "passthrough">>>;
    }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
        /**
         * This parameter name is reserved by MCP to allow clients and servers to attach additional metadata to their notifications.
         */
        _meta: z.ZodOptional<z.ZodObject<{}, "passthrough", z.ZodTypeAny, z.objectOutputType<{}, z.ZodTypeAny, "passthrough">, z.objectInputType<{}, z.ZodTypeAny, "passthrough">>>;
    }, z.ZodTypeAny, "passthrough">>>;
}, {
    method: z.ZodLiteral<"notifications/initialized">;
}>, "strip", z.ZodTypeAny, {
    method: "notifications/initialized";
    params?: z.objectOutputType<{
        /**
         * This parameter name is reserved by MCP to allow clients and servers to attach additional metadata to their notifications.
         */
        _meta: z.ZodOptional<z.ZodObject<{}, "passthrough", z.ZodTypeAny, z.objectOutputType<{}, z.ZodTypeAny, "passthrough">, z.objectInputType<{}, z.ZodTypeAny, "passthrough">>>;
    }, z.ZodTypeAny, "passthrough"> | undefined;
}, {
    method: "notifications/initialized";
    params?: z.objectInputType<{
        /**
         * This parameter name is reserved by MCP to allow clients and servers to attach additional metadata to their notifications.
         */
        _meta: z.ZodOptional<z.ZodObject<{}, "passthrough", z.ZodTypeAny, z.objectOutputType<{}, z.ZodTypeAny, "passthrough">, z.objectInputType<{}, z.ZodTypeAny, "passthrough">>>;
    }, z.ZodTypeAny, "passthrough"> | undefined;
}>;
/**
 * A ping, issued by either the server or the client, to check that the other party is still alive. The receiver must promptly respond, or else may be disconnected.
 */
export declare const PingRequestSchema: z.ZodObject<z.objectUtil.extendShape<{
    method: z.ZodString;
    params: z.ZodOptional<z.ZodObject<{
        _meta: z.ZodOptional<z.ZodObject<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough">>>;
    }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
        _meta: z.ZodOptional<z.ZodObject<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough">>>;
    }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
        _meta: z.ZodOptional<z.ZodObject<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough">>>;
    }, z.ZodTypeAny, "passthrough">>>;
}, {
    method: z.ZodLiteral<"ping">;
}>, "strip", z.ZodTypeAny, {
    method: "ping";
    params?: z.objectOutputType<{
        _meta: z.ZodOptional<z.ZodObject<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough">>>;
    }, z.ZodTypeAny, "passthrough"> | undefined;
}, {
    method: "ping";
    params?: z.objectInputType<{
        _meta: z.ZodOptional<z.ZodObject<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough">>>;
    }, z.ZodTypeAny, "passthrough"> | undefined;
}>;
export declare const ProgressSchema: z.ZodObject<{
    /**
     * The progress thus far. This should increase every time progress is made, even if the total is unknown.
     */
    progress: z.ZodNumber;
    /**
     * Total number of items to process (or total progress required), if known.
     */
    total: z.ZodOptional<z.ZodNumber>;
}, "strip", z.ZodTypeAny, {
    progress: number;
    total?: number | undefined;
}, {
    progress: number;
    total?: number | undefined;
}>;
/**
 * An out-of-band notification used to inform the receiver of a progress update for a long-running request.
 */
export declare const ProgressNotificationSchema: z.ZodObject<z.objectUtil.extendShape<{
    method: z.ZodString;
    params: z.ZodOptional<z.ZodObject<{
        /**
         * This parameter name is reserved by MCP to allow clients and servers to attach additional metadata to their notifications.
         */
        _meta: z.ZodOptional<z.ZodObject<{}, "passthrough", z.ZodTypeAny, z.objectOutputType<{}, z.ZodTypeAny, "passthrough">, z.objectInputType<{}, z.ZodTypeAny, "passthrough">>>;
    }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
        /**
         * This parameter name is reserved by MCP to allow clients and servers to attach additional metadata to their notifications.
         */
        _meta: z.ZodOptional<z.ZodObject<{}, "passthrough", z.ZodTypeAny, z.objectOutputType<{}, z.ZodTypeAny, "passthrough">, z.objectInputType<{}, z.ZodTypeAny, "passthrough">>>;
    }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
        /**
         * This parameter name is reserved by MCP to allow clients and servers to attach additional metadata to their notifications.
         */
        _meta: z.ZodOptional<z.ZodObject<{}, "passthrough", z.ZodTypeAny, z.objectOutputType<{}, z.ZodTypeAny, "passthrough">, z.objectInputType<{}, z.ZodTypeAny, "passthrough">>>;
    }, z.ZodTypeAny, "passthrough">>>;
}, {
    method: z.ZodLiteral<"notifications/progress">;
    params: z.ZodObject<z.objectUtil.extendShape<{
        /**
         * The progress thus far. This should increase every time progress is made, even if the total is unknown.
         */
        progress: z.ZodNumber;
        /**
         * Total number of items to process (or total progress required), if known.
         */
        total: z.ZodOptional<z.ZodNumber>;
    }, {
        /**
         * The progress token which was given in the initial request, used to associate this notification with the request that is proceeding.
         */
        progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
    }>, "strip", z.ZodTypeAny, {
        progress: number;
        progressToken?: string | number | undefined;
        total?: number | undefined;
    }, {
        progress: number;
        progressToken?: string | number | undefined;
        total?: number | undefined;
    }>;
}>, "strip", z.ZodTypeAny, {
    params: {
        progress: number;
        progressToken?: string | number | undefined;
        total?: number | undefined;
    };
    method: "notifications/progress";
}, {
    params: {
        progress: number;
        progressToken?: string | number | undefined;
        total?: number | undefined;
    };
    method: "notifications/progress";
}>;
export declare const PaginatedRequestSchema: z.ZodObject<z.objectUtil.extendShape<{
    method: z.ZodString;
    params: z.ZodOptional<z.ZodObject<{
        _meta: z.ZodOptional<z.ZodObject<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough">>>;
    }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
        _meta: z.ZodOptional<z.ZodObject<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough">>>;
    }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
        _meta: z.ZodOptional<z.ZodObject<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough">>>;
    }, z.ZodTypeAny, "passthrough">>>;
}, {
    params: z.ZodObject<z.objectUtil.extendShape<{
        _meta: z.ZodOptional<z.ZodObject<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough">>>;
    }, {
        /**
         * An opaque token representing the current pagination position.
         * If provided, the server should return results starting after this cursor.
         */
        cursor: z.ZodOptional<z.ZodString>;
    }>, "passthrough", z.ZodTypeAny, z.objectOutputType<z.objectUtil.extendShape<{
        _meta: z.ZodOptional<z.ZodObject<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough">>>;
    }, {
        /**
         * An opaque token representing the current pagination position.
         * If provided, the server should return results starting after this cursor.
         */
        cursor: z.ZodOptional<z.ZodString>;
    }>, z.ZodTypeAny, "passthrough">, z.objectInputType<z.objectUtil.extendShape<{
        _meta: z.ZodOptional<z.ZodObject<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough">>>;
    }, {
        /**
         * An opaque token representing the current pagination position.
         * If provided, the server should return results starting after this cursor.
         */
        cursor: z.ZodOptional<z.ZodString>;
    }>, z.ZodTypeAny, "passthrough">>;
}>, "strip", z.ZodTypeAny, {
    params: {
        _meta?: z.objectOutputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough"> | undefined;
        cursor?: string | undefined;
    } & {
        [k: string]: unknown;
    };
    method: string;
}, {
    params: {
        _meta?: z.objectInputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough"> | undefined;
        cursor?: string | undefined;
    } & {
        [k: string]: unknown;
    };
    method: string;
}>;
export declare const PaginatedResultSchema: z.ZodObject<z.objectUtil.extendShape<{
    /**
     * This result property is reserved by the protocol to allow clients and servers to attach additional metadata to their responses.
     */
    _meta: z.ZodOptional<z.ZodObject<{}, "passthrough", z.ZodTypeAny, z.objectOutputType<{}, z.ZodTypeAny, "passthrough">, z.objectInputType<{}, z.ZodTypeAny, "passthrough">>>;
}, {
    /**
     * An opaque token representing the pagination position after the last returned result.
     * If present, there may be more results available.
     */
    nextCursor: z.ZodOptional<z.ZodString>;
}>, "passthrough", z.ZodTypeAny, z.objectOutputType<z.objectUtil.extendShape<{
    /**
     * This result property is reserved by the protocol to allow clients and servers to attach additional metadata to their responses.
     */
    _meta: z.ZodOptional<z.ZodObject<{}, "passthrough", z.ZodTypeAny, z.objectOutputType<{}, z.ZodTypeAny, "passthrough">, z.objectInputType<{}, z.ZodTypeAny, "passthrough">>>;
}, {
    /**
     * An opaque token representing the pagination position after the last returned result.
     * If present, there may be more results available.
     */
    nextCursor: z.ZodOptional<z.ZodString>;
}>, z.ZodTypeAny, "passthrough">, z.objectInputType<z.objectUtil.extendShape<{
    /**
     * This result property is reserved by the protocol to allow clients and servers to attach additional metadata to their responses.
     */
    _meta: z.ZodOptional<z.ZodObject<{}, "passthrough", z.ZodTypeAny, z.objectOutputType<{}, z.ZodTypeAny, "passthrough">, z.objectInputType<{}, z.ZodTypeAny, "passthrough">>>;
}, {
    /**
     * An opaque token representing the pagination position after the last returned result.
     * If present, there may be more results available.
     */
    nextCursor: z.ZodOptional<z.ZodString>;
}>, z.ZodTypeAny, "passthrough">>;
/**
 * The contents of a specific resource or sub-resource.
 */
export declare const ResourceContentsSchema: z.ZodObject<{
    /**
     * The URI of this resource.
     */
    uri: z.ZodEffects<z.ZodString, URL, string>;
    /**
     * The MIME type of this resource, if known.
     */
    mimeType: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    uri: URL;
    mimeType?: string | undefined;
}, {
    uri: string;
    mimeType?: string | undefined;
}>;
export declare const TextResourceContentsSchema: z.ZodObject<z.objectUtil.extendShape<{
    /**
     * The URI of this resource.
     */
    uri: z.ZodEffects<z.ZodString, URL, string>;
    /**
     * The MIME type of this resource, if known.
     */
    mimeType: z.ZodOptional<z.ZodString>;
}, {
    /**
     * The text of the item. This must only be set if the item can actually be represented as text (not binary data).
     */
    text: z.ZodString;
}>, "strip", z.ZodTypeAny, {
    text: string;
    uri: URL;
    mimeType?: string | undefined;
}, {
    text: string;
    uri: string;
    mimeType?: string | undefined;
}>;
export declare const BlobResourceContentsSchema: z.ZodObject<z.objectUtil.extendShape<{
    /**
     * The URI of this resource.
     */
    uri: z.ZodEffects<z.ZodString, URL, string>;
    /**
     * The MIME type of this resource, if known.
     */
    mimeType: z.ZodOptional<z.ZodString>;
}, {
    /**
     * A base64-encoded string representing the binary data of the item.
     */
    blob: z.ZodString;
}>, "strip", z.ZodTypeAny, {
    uri: URL;
    blob: string;
    mimeType?: string | undefined;
}, {
    uri: string;
    blob: string;
    mimeType?: string | undefined;
}>;
/**
 * A known resource that the server is capable of reading.
 */
export declare const ResourceSchema: z.ZodObject<{
    /**
     * The URI of this resource.
     */
    uri: z.ZodEffects<z.ZodString, URL, string>;
    /**
     * A human-readable name for this resource.
     *
     * This can be used by clients to populate UI elements.
     */
    name: z.ZodString;
    /**
     * A description of what this resource represents.
     *
     * This can be used by clients to improve the LLM's understanding of available resources. It can be thought of like a "hint" to the model.
     */
    description: z.ZodOptional<z.ZodString>;
    /**
     * The MIME type of this resource, if known.
     */
    mimeType: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    name: string;
    uri: URL;
    mimeType?: string | undefined;
    description?: string | undefined;
}, {
    name: string;
    uri: string;
    mimeType?: string | undefined;
    description?: string | undefined;
}>;
/**
 * A template description for resources available on the server.
 */
export declare const ResourceTemplateSchema: z.ZodObject<{
    /**
     * A URI template (according to RFC 6570) that can be used to construct resource URIs.
     */
    uriTemplate: z.ZodString;
    /**
     * A human-readable name for the type of resource this template refers to.
     *
     * This can be used by clients to populate UI elements.
     */
    name: z.ZodString;
    /**
     * A description of what this template is for.
     *
     * This can be used by clients to improve the LLM's understanding of available resources. It can be thought of like a "hint" to the model.
     */
    description: z.ZodOptional<z.ZodString>;
    /**
     * The MIME type for all resources that match this template. This should only be included if all resources matching this template have the same type.
     */
    mimeType: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    name: string;
    uriTemplate: string;
    mimeType?: string | undefined;
    description?: string | undefined;
}, {
    name: string;
    uriTemplate: string;
    mimeType?: string | undefined;
    description?: string | undefined;
}>;
/**
 * Sent from the client to request a list of resources the server has.
 */
export declare const ListResourcesRequestSchema: z.ZodObject<z.objectUtil.extendShape<z.objectUtil.extendShape<{
    method: z.ZodString;
    params: z.ZodOptional<z.ZodObject<{
        _meta: z.ZodOptional<z.ZodObject<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough">>>;
    }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
        _meta: z.ZodOptional<z.ZodObject<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough">>>;
    }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
        _meta: z.ZodOptional<z.ZodObject<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough">>>;
    }, z.ZodTypeAny, "passthrough">>>;
}, {
    params: z.ZodObject<z.objectUtil.extendShape<{
        _meta: z.ZodOptional<z.ZodObject<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough">>>;
    }, {
        /**
         * An opaque token representing the current pagination position.
         * If provided, the server should return results starting after this cursor.
         */
        cursor: z.ZodOptional<z.ZodString>;
    }>, "passthrough", z.ZodTypeAny, z.objectOutputType<z.objectUtil.extendShape<{
        _meta: z.ZodOptional<z.ZodObject<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough">>>;
    }, {
        /**
         * An opaque token representing the current pagination position.
         * If provided, the server should return results starting after this cursor.
         */
        cursor: z.ZodOptional<z.ZodString>;
    }>, z.ZodTypeAny, "passthrough">, z.objectInputType<z.objectUtil.extendShape<{
        _meta: z.ZodOptional<z.ZodObject<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough">>>;
    }, {
        /**
         * An opaque token representing the current pagination position.
         * If provided, the server should return results starting after this cursor.
         */
        cursor: z.ZodOptional<z.ZodString>;
    }>, z.ZodTypeAny, "passthrough">>;
}>, {
    method: z.ZodLiteral<"resources/list">;
}>, "strip", z.ZodTypeAny, {
    params: {
        _meta?: z.objectOutputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough"> | undefined;
        cursor?: string | undefined;
    } & {
        [k: string]: unknown;
    };
    method: "resources/list";
}, {
    params: {
        _meta?: z.objectInputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough"> | undefined;
        cursor?: string | undefined;
    } & {
        [k: string]: unknown;
    };
    method: "resources/list";
}>;
/**
 * The server's response to a resources/list request from the client.
 */
export declare const ListResourcesResultSchema: z.ZodObject<z.objectUtil.extendShape<z.objectUtil.extendShape<{
    /**
     * This result property is reserved by the protocol to allow clients and servers to attach additional metadata to their responses.
     */
    _meta: z.ZodOptional<z.ZodObject<{}, "passthrough", z.ZodTypeAny, z.objectOutputType<{}, z.ZodTypeAny, "passthrough">, z.objectInputType<{}, z.ZodTypeAny, "passthrough">>>;
}, {
    /**
     * An opaque token representing the pagination position after the last returned result.
     * If present, there may be more results available.
     */
    nextCursor: z.ZodOptional<z.ZodString>;
}>, {
    resources: z.ZodArray<z.ZodObject<{
        /**
         * The URI of this resource.
         */
        uri: z.ZodEffects<z.ZodString, URL, string>;
        /**
         * A human-readable name for this resource.
         *
         * This can be used by clients to populate UI elements.
         */
        name: z.ZodString;
        /**
         * A description of what this resource represents.
         *
         * This can be used by clients to improve the LLM's understanding of available resources. It can be thought of like a "hint" to the model.
         */
        description: z.ZodOptional<z.ZodString>;
        /**
         * The MIME type of this resource, if known.
         */
        mimeType: z.ZodOptional<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        name: string;
        uri: URL;
        mimeType?: string | undefined;
        description?: string | undefined;
    }, {
        name: string;
        uri: string;
        mimeType?: string | undefined;
        description?: string | undefined;
    }>, "many">;
}>, "passthrough", z.ZodTypeAny, z.objectOutputType<z.objectUtil.extendShape<z.objectUtil.extendShape<{
    /**
     * This result property is reserved by the protocol to allow clients and servers to attach additional metadata to their responses.
     */
    _meta: z.ZodOptional<z.ZodObject<{}, "passthrough", z.ZodTypeAny, z.objectOutputType<{}, z.ZodTypeAny, "passthrough">, z.objectInputType<{}, z.ZodTypeAny, "passthrough">>>;
}, {
    /**
     * An opaque token representing the pagination position after the last returned result.
     * If present, there may be more results available.
     */
    nextCursor: z.ZodOptional<z.ZodString>;
}>, {
    resources: z.ZodArray<z.ZodObject<{
        /**
         * The URI of this resource.
         */
        uri: z.ZodEffects<z.ZodString, URL, string>;
        /**
         * A human-readable name for this resource.
         *
         * This can be used by clients to populate UI elements.
         */
        name: z.ZodString;
        /**
         * A description of what this resource represents.
         *
         * This can be used by clients to improve the LLM's understanding of available resources. It can be thought of like a "hint" to the model.
         */
        description: z.ZodOptional<z.ZodString>;
        /**
         * The MIME type of this resource, if known.
         */
        mimeType: z.ZodOptional<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        name: string;
        uri: URL;
        mimeType?: string | undefined;
        description?: string | undefined;
    }, {
        name: string;
        uri: string;
        mimeType?: string | undefined;
        description?: string | undefined;
    }>, "many">;
}>, z.ZodTypeAny, "passthrough">, z.objectInputType<z.objectUtil.extendShape<z.objectUtil.extendShape<{
    /**
     * This result property is reserved by the protocol to allow clients and servers to attach additional metadata to their responses.
     */
    _meta: z.ZodOptional<z.ZodObject<{}, "passthrough", z.ZodTypeAny, z.objectOutputType<{}, z.ZodTypeAny, "passthrough">, z.objectInputType<{}, z.ZodTypeAny, "passthrough">>>;
}, {
    /**
     * An opaque token representing the pagination position after the last returned result.
     * If present, there may be more results available.
     */
    nextCursor: z.ZodOptional<z.ZodString>;
}>, {
    resources: z.ZodArray<z.ZodObject<{
        /**
         * The URI of this resource.
         */
        uri: z.ZodEffects<z.ZodString, URL, string>;
        /**
         * A human-readable name for this resource.
         *
         * This can be used by clients to populate UI elements.
         */
        name: z.ZodString;
        /**
         * A description of what this resource represents.
         *
         * This can be used by clients to improve the LLM's understanding of available resources. It can be thought of like a "hint" to the model.
         */
        description: z.ZodOptional<z.ZodString>;
        /**
         * The MIME type of this resource, if known.
         */
        mimeType: z.ZodOptional<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        name: string;
        uri: URL;
        mimeType?: string | undefined;
        description?: string | undefined;
    }, {
        name: string;
        uri: string;
        mimeType?: string | undefined;
        description?: string | undefined;
    }>, "many">;
}>, z.ZodTypeAny, "passthrough">>;
/**
 * Sent from the client to request a list of resource templates the server has.
 */
export declare const ListResourceTemplatesRequestSchema: z.ZodObject<z.objectUtil.extendShape<z.objectUtil.extendShape<{
    method: z.ZodString;
    params: z.ZodOptional<z.ZodObject<{
        _meta: z.ZodOptional<z.ZodObject<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough">>>;
    }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
        _meta: z.ZodOptional<z.ZodObject<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough">>>;
    }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
        _meta: z.ZodOptional<z.ZodObject<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough">>>;
    }, z.ZodTypeAny, "passthrough">>>;
}, {
    params: z.ZodObject<z.objectUtil.extendShape<{
        _meta: z.ZodOptional<z.ZodObject<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough">>>;
    }, {
        /**
         * An opaque token representing the current pagination position.
         * If provided, the server should return results starting after this cursor.
         */
        cursor: z.ZodOptional<z.ZodString>;
    }>, "passthrough", z.ZodTypeAny, z.objectOutputType<z.objectUtil.extendShape<{
        _meta: z.ZodOptional<z.ZodObject<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough">>>;
    }, {
        /**
         * An opaque token representing the current pagination position.
         * If provided, the server should return results starting after this cursor.
         */
        cursor: z.ZodOptional<z.ZodString>;
    }>, z.ZodTypeAny, "passthrough">, z.objectInputType<z.objectUtil.extendShape<{
        _meta: z.ZodOptional<z.ZodObject<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough">>>;
    }, {
        /**
         * An opaque token representing the current pagination position.
         * If provided, the server should return results starting after this cursor.
         */
        cursor: z.ZodOptional<z.ZodString>;
    }>, z.ZodTypeAny, "passthrough">>;
}>, {
    method: z.ZodLiteral<"resources/templates/list">;
}>, "strip", z.ZodTypeAny, {
    params: {
        _meta?: z.objectOutputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough"> | undefined;
        cursor?: string | undefined;
    } & {
        [k: string]: unknown;
    };
    method: "resources/templates/list";
}, {
    params: {
        _meta?: z.objectInputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough"> | undefined;
        cursor?: string | undefined;
    } & {
        [k: string]: unknown;
    };
    method: "resources/templates/list";
}>;
/**
 * The server's response to a resources/templates/list request from the client.
 */
export declare const ListResourceTemplatesResultSchema: z.ZodObject<z.objectUtil.extendShape<z.objectUtil.extendShape<{
    /**
     * This result property is reserved by the protocol to allow clients and servers to attach additional metadata to their responses.
     */
    _meta: z.ZodOptional<z.ZodObject<{}, "passthrough", z.ZodTypeAny, z.objectOutputType<{}, z.ZodTypeAny, "passthrough">, z.objectInputType<{}, z.ZodTypeAny, "passthrough">>>;
}, {
    /**
     * An opaque token representing the pagination position after the last returned result.
     * If present, there may be more results available.
     */
    nextCursor: z.ZodOptional<z.ZodString>;
}>, {
    resourceTemplates: z.ZodArray<z.ZodObject<{
        /**
         * A URI template (according to RFC 6570) that can be used to construct resource URIs.
         */
        uriTemplate: z.ZodString;
        /**
         * A human-readable name for the type of resource this template refers to.
         *
         * This can be used by clients to populate UI elements.
         */
        name: z.ZodString;
        /**
         * A description of what this template is for.
         *
         * This can be used by clients to improve the LLM's understanding of available resources. It can be thought of like a "hint" to the model.
         */
        description: z.ZodOptional<z.ZodString>;
        /**
         * The MIME type for all resources that match this template. This should only be included if all resources matching this template have the same type.
         */
        mimeType: z.ZodOptional<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        name: string;
        uriTemplate: string;
        mimeType?: string | undefined;
        description?: string | undefined;
    }, {
        name: string;
        uriTemplate: string;
        mimeType?: string | undefined;
        description?: string | undefined;
    }>, "many">;
}>, "passthrough", z.ZodTypeAny, z.objectOutputType<z.objectUtil.extendShape<z.objectUtil.extendShape<{
    /**
     * This result property is reserved by the protocol to allow clients and servers to attach additional metadata to their responses.
     */
    _meta: z.ZodOptional<z.ZodObject<{}, "passthrough", z.ZodTypeAny, z.objectOutputType<{}, z.ZodTypeAny, "passthrough">, z.objectInputType<{}, z.ZodTypeAny, "passthrough">>>;
}, {
    /**
     * An opaque token representing the pagination position after the last returned result.
     * If present, there may be more results available.
     */
    nextCursor: z.ZodOptional<z.ZodString>;
}>, {
    resourceTemplates: z.ZodArray<z.ZodObject<{
        /**
         * A URI template (according to RFC 6570) that can be used to construct resource URIs.
         */
        uriTemplate: z.ZodString;
        /**
         * A human-readable name for the type of resource this template refers to.
         *
         * This can be used by clients to populate UI elements.
         */
        name: z.ZodString;
        /**
         * A description of what this template is for.
         *
         * This can be used by clients to improve the LLM's understanding of available resources. It can be thought of like a "hint" to the model.
         */
        description: z.ZodOptional<z.ZodString>;
        /**
         * The MIME type for all resources that match this template. This should only be included if all resources matching this template have the same type.
         */
        mimeType: z.ZodOptional<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        name: string;
        uriTemplate: string;
        mimeType?: string | undefined;
        description?: string | undefined;
    }, {
        name: string;
        uriTemplate: string;
        mimeType?: string | undefined;
        description?: string | undefined;
    }>, "many">;
}>, z.ZodTypeAny, "passthrough">, z.objectInputType<z.objectUtil.extendShape<z.objectUtil.extendShape<{
    /**
     * This result property is reserved by the protocol to allow clients and servers to attach additional metadata to their responses.
     */
    _meta: z.ZodOptional<z.ZodObject<{}, "passthrough", z.ZodTypeAny, z.objectOutputType<{}, z.ZodTypeAny, "passthrough">, z.objectInputType<{}, z.ZodTypeAny, "passthrough">>>;
}, {
    /**
     * An opaque token representing the pagination position after the last returned result.
     * If present, there may be more results available.
     */
    nextCursor: z.ZodOptional<z.ZodString>;
}>, {
    resourceTemplates: z.ZodArray<z.ZodObject<{
        /**
         * A URI template (according to RFC 6570) that can be used to construct resource URIs.
         */
        uriTemplate: z.ZodString;
        /**
         * A human-readable name for the type of resource this template refers to.
         *
         * This can be used by clients to populate UI elements.
         */
        name: z.ZodString;
        /**
         * A description of what this template is for.
         *
         * This can be used by clients to improve the LLM's understanding of available resources. It can be thought of like a "hint" to the model.
         */
        description: z.ZodOptional<z.ZodString>;
        /**
         * The MIME type for all resources that match this template. This should only be included if all resources matching this template have the same type.
         */
        mimeType: z.ZodOptional<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        name: string;
        uriTemplate: string;
        mimeType?: string | undefined;
        description?: string | undefined;
    }, {
        name: string;
        uriTemplate: string;
        mimeType?: string | undefined;
        description?: string | undefined;
    }>, "many">;
}>, z.ZodTypeAny, "passthrough">>;
/**
 * Sent from the client to the server, to read a specific resource URI.
 */
export declare const ReadResourceRequestSchema: z.ZodObject<z.objectUtil.extendShape<{
    method: z.ZodString;
    params: z.ZodOptional<z.ZodObject<{
        _meta: z.ZodOptional<z.ZodObject<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough">>>;
    }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
        _meta: z.ZodOptional<z.ZodObject<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough">>>;
    }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
        _meta: z.ZodOptional<z.ZodObject<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough">>>;
    }, z.ZodTypeAny, "passthrough">>>;
}, {
    method: z.ZodLiteral<"resources/read">;
    params: z.ZodObject<z.objectUtil.extendShape<{
        _meta: z.ZodOptional<z.ZodObject<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough">>>;
    }, {
        /**
         * The URI of the resource to read. The URI can use any protocol; it is up to the server how to interpret it.
         */
        uri: z.ZodEffects<z.ZodString, URL, string>;
    }>, "passthrough", z.ZodTypeAny, z.objectOutputType<z.objectUtil.extendShape<{
        _meta: z.ZodOptional<z.ZodObject<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough">>>;
    }, {
        /**
         * The URI of the resource to read. The URI can use any protocol; it is up to the server how to interpret it.
         */
        uri: z.ZodEffects<z.ZodString, URL, string>;
    }>, z.ZodTypeAny, "passthrough">, z.objectInputType<z.objectUtil.extendShape<{
        _meta: z.ZodOptional<z.ZodObject<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough">>>;
    }, {
        /**
         * The URI of the resource to read. The URI can use any protocol; it is up to the server how to interpret it.
         */
        uri: z.ZodEffects<z.ZodString, URL, string>;
    }>, z.ZodTypeAny, "passthrough">>;
}>, "strip", z.ZodTypeAny, {
    params: {
        uri: URL;
        _meta?: z.objectOutputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough"> | undefined;
    } & {
        [k: string]: unknown;
    };
    method: "resources/read";
}, {
    params: {
        uri: string;
        _meta?: z.objectInputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough"> | undefined;
    } & {
        [k: string]: unknown;
    };
    method: "resources/read";
}>;
/**
 * The server's response to a resources/read request from the client.
 */
export declare const ReadResourceResultSchema: z.ZodObject<z.objectUtil.extendShape<{
    /**
     * This result property is reserved by the protocol to allow clients and servers to attach additional metadata to their responses.
     */
    _meta: z.ZodOptional<z.ZodObject<{}, "passthrough", z.ZodTypeAny, z.objectOutputType<{}, z.ZodTypeAny, "passthrough">, z.objectInputType<{}, z.ZodTypeAny, "passthrough">>>;
}, {
    contents: z.ZodArray<z.ZodUnion<[z.ZodObject<z.objectUtil.extendShape<{
        /**
         * The URI of this resource.
         */
        uri: z.ZodEffects<z.ZodString, URL, string>;
        /**
         * The MIME type of this resource, if known.
         */
        mimeType: z.ZodOptional<z.ZodString>;
    }, {
        /**
         * The text of the item. This must only be set if the item can actually be represented as text (not binary data).
         */
        text: z.ZodString;
    }>, "strip", z.ZodTypeAny, {
        text: string;
        uri: URL;
        mimeType?: string | undefined;
    }, {
        text: string;
        uri: string;
        mimeType?: string | undefined;
    }>, z.ZodObject<z.objectUtil.extendShape<{
        /**
         * The URI of this resource.
         */
        uri: z.ZodEffects<z.ZodString, URL, string>;
        /**
         * The MIME type of this resource, if known.
         */
        mimeType: z.ZodOptional<z.ZodString>;
    }, {
        /**
         * A base64-encoded string representing the binary data of the item.
         */
        blob: z.ZodString;
    }>, "strip", z.ZodTypeAny, {
        uri: URL;
        blob: string;
        mimeType?: string | undefined;
    }, {
        uri: string;
        blob: string;
        mimeType?: string | undefined;
    }>]>, "many">;
}>, "passthrough", z.ZodTypeAny, z.objectOutputType<z.objectUtil.extendShape<{
    /**
     * This result property is reserved by the protocol to allow clients and servers to attach additional metadata to their responses.
     */
    _meta: z.ZodOptional<z.ZodObject<{}, "passthrough", z.ZodTypeAny, z.objectOutputType<{}, z.ZodTypeAny, "passthrough">, z.objectInputType<{}, z.ZodTypeAny, "passthrough">>>;
}, {
    contents: z.ZodArray<z.ZodUnion<[z.ZodObject<z.objectUtil.extendShape<{
        /**
         * The URI of this resource.
         */
        uri: z.ZodEffects<z.ZodString, URL, string>;
        /**
         * The MIME type of this resource, if known.
         */
        mimeType: z.ZodOptional<z.ZodString>;
    }, {
        /**
         * The text of the item. This must only be set if the item can actually be represented as text (not binary data).
         */
        text: z.ZodString;
    }>, "strip", z.ZodTypeAny, {
        text: string;
        uri: URL;
        mimeType?: string | undefined;
    }, {
        text: string;
        uri: string;
        mimeType?: string | undefined;
    }>, z.ZodObject<z.objectUtil.extendShape<{
        /**
         * The URI of this resource.
         */
        uri: z.ZodEffects<z.ZodString, URL, string>;
        /**
         * The MIME type of this resource, if known.
         */
        mimeType: z.ZodOptional<z.ZodString>;
    }, {
        /**
         * A base64-encoded string representing the binary data of the item.
         */
        blob: z.ZodString;
    }>, "strip", z.ZodTypeAny, {
        uri: URL;
        blob: string;
        mimeType?: string | undefined;
    }, {
        uri: string;
        blob: string;
        mimeType?: string | undefined;
    }>]>, "many">;
}>, z.ZodTypeAny, "passthrough">, z.objectInputType<z.objectUtil.extendShape<{
    /**
     * This result property is reserved by the protocol to allow clients and servers to attach additional metadata to their responses.
     */
    _meta: z.ZodOptional<z.ZodObject<{}, "passthrough", z.ZodTypeAny, z.objectOutputType<{}, z.ZodTypeAny, "passthrough">, z.objectInputType<{}, z.ZodTypeAny, "passthrough">>>;
}, {
    contents: z.ZodArray<z.ZodUnion<[z.ZodObject<z.objectUtil.extendShape<{
        /**
         * The URI of this resource.
         */
        uri: z.ZodEffects<z.ZodString, URL, string>;
        /**
         * The MIME type of this resource, if known.
         */
        mimeType: z.ZodOptional<z.ZodString>;
    }, {
        /**
         * The text of the item. This must only be set if the item can actually be represented as text (not binary data).
         */
        text: z.ZodString;
    }>, "strip", z.ZodTypeAny, {
        text: string;
        uri: URL;
        mimeType?: string | undefined;
    }, {
        text: string;
        uri: string;
        mimeType?: string | undefined;
    }>, z.ZodObject<z.objectUtil.extendShape<{
        /**
         * The URI of this resource.
         */
        uri: z.ZodEffects<z.ZodString, URL, string>;
        /**
         * The MIME type of this resource, if known.
         */
        mimeType: z.ZodOptional<z.ZodString>;
    }, {
        /**
         * A base64-encoded string representing the binary data of the item.
         */
        blob: z.ZodString;
    }>, "strip", z.ZodTypeAny, {
        uri: URL;
        blob: string;
        mimeType?: string | undefined;
    }, {
        uri: string;
        blob: string;
        mimeType?: string | undefined;
    }>]>, "many">;
}>, z.ZodTypeAny, "passthrough">>;
/**
 * An optional notification from the server to the client, informing it that the list of resources it can read from has changed. This may be issued by servers without any previous subscription from the client.
 */
export declare const ResourceListChangedNotificationSchema: z.ZodObject<z.objectUtil.extendShape<{
    method: z.ZodString;
    params: z.ZodOptional<z.ZodObject<{
        /**
         * This parameter name is reserved by MCP to allow clients and servers to attach additional metadata to their notifications.
         */
        _meta: z.ZodOptional<z.ZodObject<{}, "passthrough", z.ZodTypeAny, z.objectOutputType<{}, z.ZodTypeAny, "passthrough">, z.objectInputType<{}, z.ZodTypeAny, "passthrough">>>;
    }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
        /**
         * This parameter name is reserved by MCP to allow clients and servers to attach additional metadata to their notifications.
         */
        _meta: z.ZodOptional<z.ZodObject<{}, "passthrough", z.ZodTypeAny, z.objectOutputType<{}, z.ZodTypeAny, "passthrough">, z.objectInputType<{}, z.ZodTypeAny, "passthrough">>>;
    }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
        /**
         * This parameter name is reserved by MCP to allow clients and servers to attach additional metadata to their notifications.
         */
        _meta: z.ZodOptional<z.ZodObject<{}, "passthrough", z.ZodTypeAny, z.objectOutputType<{}, z.ZodTypeAny, "passthrough">, z.objectInputType<{}, z.ZodTypeAny, "passthrough">>>;
    }, z.ZodTypeAny, "passthrough">>>;
}, {
    method: z.ZodLiteral<"notifications/resources/list_changed">;
}>, "strip", z.ZodTypeAny, {
    method: "notifications/resources/list_changed";
    params?: z.objectOutputType<{
        /**
         * This parameter name is reserved by MCP to allow clients and servers to attach additional metadata to their notifications.
         */
        _meta: z.ZodOptional<z.ZodObject<{}, "passthrough", z.ZodTypeAny, z.objectOutputType<{}, z.ZodTypeAny, "passthrough">, z.objectInputType<{}, z.ZodTypeAny, "passthrough">>>;
    }, z.ZodTypeAny, "passthrough"> | undefined;
}, {
    method: "notifications/resources/list_changed";
    params?: z.objectInputType<{
        /**
         * This parameter name is reserved by MCP to allow clients and servers to attach additional metadata to their notifications.
         */
        _meta: z.ZodOptional<z.ZodObject<{}, "passthrough", z.ZodTypeAny, z.objectOutputType<{}, z.ZodTypeAny, "passthrough">, z.objectInputType<{}, z.ZodTypeAny, "passthrough">>>;
    }, z.ZodTypeAny, "passthrough"> | undefined;
}>;
/**
 * Sent from the client to request resources/updated notifications from the server whenever a particular resource changes.
 */
export declare const SubscribeRequestSchema: z.ZodObject<z.objectUtil.extendShape<{
    method: z.ZodString;
    params: z.ZodOptional<z.ZodObject<{
        _meta: z.ZodOptional<z.ZodObject<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough">>>;
    }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
        _meta: z.ZodOptional<z.ZodObject<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough">>>;
    }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
        _meta: z.ZodOptional<z.ZodObject<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough">>>;
    }, z.ZodTypeAny, "passthrough">>>;
}, {
    method: z.ZodLiteral<"resources/subscribe">;
    params: z.ZodObject<z.objectUtil.extendShape<{
        _meta: z.ZodOptional<z.ZodObject<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough">>>;
    }, {
        /**
         * The URI of the resource to subscribe to. The URI can use any protocol; it is up to the server how to interpret it.
         */
        uri: z.ZodEffects<z.ZodString, URL, string>;
    }>, "passthrough", z.ZodTypeAny, z.objectOutputType<z.objectUtil.extendShape<{
        _meta: z.ZodOptional<z.ZodObject<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough">>>;
    }, {
        /**
         * The URI of the resource to subscribe to. The URI can use any protocol; it is up to the server how to interpret it.
         */
        uri: z.ZodEffects<z.ZodString, URL, string>;
    }>, z.ZodTypeAny, "passthrough">, z.objectInputType<z.objectUtil.extendShape<{
        _meta: z.ZodOptional<z.ZodObject<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough">>>;
    }, {
        /**
         * The URI of the resource to subscribe to. The URI can use any protocol; it is up to the server how to interpret it.
         */
        uri: z.ZodEffects<z.ZodString, URL, string>;
    }>, z.ZodTypeAny, "passthrough">>;
}>, "strip", z.ZodTypeAny, {
    params: {
        uri: URL;
        _meta?: z.objectOutputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough"> | undefined;
    } & {
        [k: string]: unknown;
    };
    method: "resources/subscribe";
}, {
    params: {
        uri: string;
        _meta?: z.objectInputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough"> | undefined;
    } & {
        [k: string]: unknown;
    };
    method: "resources/subscribe";
}>;
/**
 * Sent from the client to request cancellation of resources/updated notifications from the server. This should follow a previous resources/subscribe request.
 */
export declare const UnsubscribeRequestSchema: z.ZodObject<z.objectUtil.extendShape<{
    method: z.ZodString;
    params: z.ZodOptional<z.ZodObject<{
        _meta: z.ZodOptional<z.ZodObject<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough">>>;
    }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
        _meta: z.ZodOptional<z.ZodObject<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough">>>;
    }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
        _meta: z.ZodOptional<z.ZodObject<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough">>>;
    }, z.ZodTypeAny, "passthrough">>>;
}, {
    method: z.ZodLiteral<"resources/unsubscribe">;
    params: z.ZodObject<z.objectUtil.extendShape<{
        _meta: z.ZodOptional<z.ZodObject<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough">>>;
    }, {
        /**
         * The URI of the resource to unsubscribe from.
         */
        uri: z.ZodEffects<z.ZodString, URL, string>;
    }>, "passthrough", z.ZodTypeAny, z.objectOutputType<z.objectUtil.extendShape<{
        _meta: z.ZodOptional<z.ZodObject<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough">>>;
    }, {
        /**
         * The URI of the resource to unsubscribe from.
         */
        uri: z.ZodEffects<z.ZodString, URL, string>;
    }>, z.ZodTypeAny, "passthrough">, z.objectInputType<z.objectUtil.extendShape<{
        _meta: z.ZodOptional<z.ZodObject<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough">>>;
    }, {
        /**
         * The URI of the resource to unsubscribe from.
         */
        uri: z.ZodEffects<z.ZodString, URL, string>;
    }>, z.ZodTypeAny, "passthrough">>;
}>, "strip", z.ZodTypeAny, {
    params: {
        uri: URL;
        _meta?: z.objectOutputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough"> | undefined;
    } & {
        [k: string]: unknown;
    };
    method: "resources/unsubscribe";
}, {
    params: {
        uri: string;
        _meta?: z.objectInputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough"> | undefined;
    } & {
        [k: string]: unknown;
    };
    method: "resources/unsubscribe";
}>;
/**
 * A notification from the server to the client, informing it that a resource has changed and may need to be read again. This should only be sent if the client previously sent a resources/subscribe request.
 */
export declare const ResourceUpdatedNotificationSchema: z.ZodObject<z.objectUtil.extendShape<{
    method: z.ZodString;
    params: z.ZodOptional<z.ZodObject<{
        /**
         * This parameter name is reserved by MCP to allow clients and servers to attach additional metadata to their notifications.
         */
        _meta: z.ZodOptional<z.ZodObject<{}, "passthrough", z.ZodTypeAny, z.objectOutputType<{}, z.ZodTypeAny, "passthrough">, z.objectInputType<{}, z.ZodTypeAny, "passthrough">>>;
    }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
        /**
         * This parameter name is reserved by MCP to allow clients and servers to attach additional metadata to their notifications.
         */
        _meta: z.ZodOptional<z.ZodObject<{}, "passthrough", z.ZodTypeAny, z.objectOutputType<{}, z.ZodTypeAny, "passthrough">, z.objectInputType<{}, z.ZodTypeAny, "passthrough">>>;
    }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
        /**
         * This parameter name is reserved by MCP to allow clients and servers to attach additional metadata to their notifications.
         */
        _meta: z.ZodOptional<z.ZodObject<{}, "passthrough", z.ZodTypeAny, z.objectOutputType<{}, z.ZodTypeAny, "passthrough">, z.objectInputType<{}, z.ZodTypeAny, "passthrough">>>;
    }, z.ZodTypeAny, "passthrough">>>;
}, {
    method: z.ZodLiteral<"notifications/resources/updated">;
    params: z.ZodObject<{
        /**
         * The URI of the resource that has been updated. This might be a sub-resource of the one that the client actually subscribed to.
         */
        uri: z.ZodEffects<z.ZodString, URL, string>;
    }, "strip", z.ZodTypeAny, {
        uri: URL;
    }, {
        uri: string;
    }>;
}>, "strip", z.ZodTypeAny, {
    params: {
        uri: URL;
    };
    method: "notifications/resources/updated";
}, {
    params: {
        uri: string;
    };
    method: "notifications/resources/updated";
}>;
/**
 * Describes an argument that a prompt can accept.
 */
export declare const PromptArgumentSchema: z.ZodObject<{
    /**
     * The name of the argument.
     */
    name: z.ZodString;
    /**
     * A human-readable description of the argument.
     */
    description: z.ZodOptional<z.ZodString>;
    /**
     * Whether this argument must be provided.
     */
    required: z.ZodOptional<z.ZodBoolean>;
}, "strip", z.ZodTypeAny, {
    name: string;
    description?: string | undefined;
    required?: boolean | undefined;
}, {
    name: string;
    description?: string | undefined;
    required?: boolean | undefined;
}>;
/**
 * A prompt or prompt template that the server offers.
 */
export declare const PromptSchema: z.ZodObject<{
    /**
     * The name of the prompt or prompt template.
     */
    name: z.ZodString;
    /**
     * An optional description of what this prompt provides
     */
    description: z.ZodOptional<z.ZodString>;
    /**
     * A list of arguments to use for templating the prompt.
     */
    arguments: z.ZodOptional<z.ZodArray<z.ZodObject<{
        /**
         * The name of the argument.
         */
        name: z.ZodString;
        /**
         * A human-readable description of the argument.
         */
        description: z.ZodOptional<z.ZodString>;
        /**
         * Whether this argument must be provided.
         */
        required: z.ZodOptional<z.ZodBoolean>;
    }, "strip", z.ZodTypeAny, {
        name: string;
        description?: string | undefined;
        required?: boolean | undefined;
    }, {
        name: string;
        description?: string | undefined;
        required?: boolean | undefined;
    }>, "many">>;
}, "strip", z.ZodTypeAny, {
    name: string;
    description?: string | undefined;
    arguments?: {
        name: string;
        description?: string | undefined;
        required?: boolean | undefined;
    }[] | undefined;
}, {
    name: string;
    description?: string | undefined;
    arguments?: {
        name: string;
        description?: string | undefined;
        required?: boolean | undefined;
    }[] | undefined;
}>;
/**
 * Sent from the client to request a list of prompts and prompt templates the server has.
 */
export declare const ListPromptsRequestSchema: z.ZodObject<z.objectUtil.extendShape<z.objectUtil.extendShape<{
    method: z.ZodString;
    params: z.ZodOptional<z.ZodObject<{
        _meta: z.ZodOptional<z.ZodObject<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough">>>;
    }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
        _meta: z.ZodOptional<z.ZodObject<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough">>>;
    }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
        _meta: z.ZodOptional<z.ZodObject<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough">>>;
    }, z.ZodTypeAny, "passthrough">>>;
}, {
    params: z.ZodObject<z.objectUtil.extendShape<{
        _meta: z.ZodOptional<z.ZodObject<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough">>>;
    }, {
        /**
         * An opaque token representing the current pagination position.
         * If provided, the server should return results starting after this cursor.
         */
        cursor: z.ZodOptional<z.ZodString>;
    }>, "passthrough", z.ZodTypeAny, z.objectOutputType<z.objectUtil.extendShape<{
        _meta: z.ZodOptional<z.ZodObject<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough">>>;
    }, {
        /**
         * An opaque token representing the current pagination position.
         * If provided, the server should return results starting after this cursor.
         */
        cursor: z.ZodOptional<z.ZodString>;
    }>, z.ZodTypeAny, "passthrough">, z.objectInputType<z.objectUtil.extendShape<{
        _meta: z.ZodOptional<z.ZodObject<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough">>>;
    }, {
        /**
         * An opaque token representing the current pagination position.
         * If provided, the server should return results starting after this cursor.
         */
        cursor: z.ZodOptional<z.ZodString>;
    }>, z.ZodTypeAny, "passthrough">>;
}>, {
    method: z.ZodLiteral<"prompts/list">;
}>, "strip", z.ZodTypeAny, {
    params: {
        _meta?: z.objectOutputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough"> | undefined;
        cursor?: string | undefined;
    } & {
        [k: string]: unknown;
    };
    method: "prompts/list";
}, {
    params: {
        _meta?: z.objectInputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough"> | undefined;
        cursor?: string | undefined;
    } & {
        [k: string]: unknown;
    };
    method: "prompts/list";
}>;
/**
 * The server's response to a prompts/list request from the client.
 */
export declare const ListPromptsResultSchema: z.ZodObject<z.objectUtil.extendShape<z.objectUtil.extendShape<{
    /**
     * This result property is reserved by the protocol to allow clients and servers to attach additional metadata to their responses.
     */
    _meta: z.ZodOptional<z.ZodObject<{}, "passthrough", z.ZodTypeAny, z.objectOutputType<{}, z.ZodTypeAny, "passthrough">, z.objectInputType<{}, z.ZodTypeAny, "passthrough">>>;
}, {
    /**
     * An opaque token representing the pagination position after the last returned result.
     * If present, there may be more results available.
     */
    nextCursor: z.ZodOptional<z.ZodString>;
}>, {
    prompts: z.ZodArray<z.ZodObject<{
        /**
         * The name of the prompt or prompt template.
         */
        name: z.ZodString;
        /**
         * An optional description of what this prompt provides
         */
        description: z.ZodOptional<z.ZodString>;
        /**
         * A list of arguments to use for templating the prompt.
         */
        arguments: z.ZodOptional<z.ZodArray<z.ZodObject<{
            /**
             * The name of the argument.
             */
            name: z.ZodString;
            /**
             * A human-readable description of the argument.
             */
            description: z.ZodOptional<z.ZodString>;
            /**
             * Whether this argument must be provided.
             */
            required: z.ZodOptional<z.ZodBoolean>;
        }, "strip", z.ZodTypeAny, {
            name: string;
            description?: string | undefined;
            required?: boolean | undefined;
        }, {
            name: string;
            description?: string | undefined;
            required?: boolean | undefined;
        }>, "many">>;
    }, "strip", z.ZodTypeAny, {
        name: string;
        description?: string | undefined;
        arguments?: {
            name: string;
            description?: string | undefined;
            required?: boolean | undefined;
        }[] | undefined;
    }, {
        name: string;
        description?: string | undefined;
        arguments?: {
            name: string;
            description?: string | undefined;
            required?: boolean | undefined;
        }[] | undefined;
    }>, "many">;
}>, "passthrough", z.ZodTypeAny, z.objectOutputType<z.objectUtil.extendShape<z.objectUtil.extendShape<{
    /**
     * This result property is reserved by the protocol to allow clients and servers to attach additional metadata to their responses.
     */
    _meta: z.ZodOptional<z.ZodObject<{}, "passthrough", z.ZodTypeAny, z.objectOutputType<{}, z.ZodTypeAny, "passthrough">, z.objectInputType<{}, z.ZodTypeAny, "passthrough">>>;
}, {
    /**
     * An opaque token representing the pagination position after the last returned result.
     * If present, there may be more results available.
     */
    nextCursor: z.ZodOptional<z.ZodString>;
}>, {
    prompts: z.ZodArray<z.ZodObject<{
        /**
         * The name of the prompt or prompt template.
         */
        name: z.ZodString;
        /**
         * An optional description of what this prompt provides
         */
        description: z.ZodOptional<z.ZodString>;
        /**
         * A list of arguments to use for templating the prompt.
         */
        arguments: z.ZodOptional<z.ZodArray<z.ZodObject<{
            /**
             * The name of the argument.
             */
            name: z.ZodString;
            /**
             * A human-readable description of the argument.
             */
            description: z.ZodOptional<z.ZodString>;
            /**
             * Whether this argument must be provided.
             */
            required: z.ZodOptional<z.ZodBoolean>;
        }, "strip", z.ZodTypeAny, {
            name: string;
            description?: string | undefined;
            required?: boolean | undefined;
        }, {
            name: string;
            description?: string | undefined;
            required?: boolean | undefined;
        }>, "many">>;
    }, "strip", z.ZodTypeAny, {
        name: string;
        description?: string | undefined;
        arguments?: {
            name: string;
            description?: string | undefined;
            required?: boolean | undefined;
        }[] | undefined;
    }, {
        name: string;
        description?: string | undefined;
        arguments?: {
            name: string;
            description?: string | undefined;
            required?: boolean | undefined;
        }[] | undefined;
    }>, "many">;
}>, z.ZodTypeAny, "passthrough">, z.objectInputType<z.objectUtil.extendShape<z.objectUtil.extendShape<{
    /**
     * This result property is reserved by the protocol to allow clients and servers to attach additional metadata to their responses.
     */
    _meta: z.ZodOptional<z.ZodObject<{}, "passthrough", z.ZodTypeAny, z.objectOutputType<{}, z.ZodTypeAny, "passthrough">, z.objectInputType<{}, z.ZodTypeAny, "passthrough">>>;
}, {
    /**
     * An opaque token representing the pagination position after the last returned result.
     * If present, there may be more results available.
     */
    nextCursor: z.ZodOptional<z.ZodString>;
}>, {
    prompts: z.ZodArray<z.ZodObject<{
        /**
         * The name of the prompt or prompt template.
         */
        name: z.ZodString;
        /**
         * An optional description of what this prompt provides
         */
        description: z.ZodOptional<z.ZodString>;
        /**
         * A list of arguments to use for templating the prompt.
         */
        arguments: z.ZodOptional<z.ZodArray<z.ZodObject<{
            /**
             * The name of the argument.
             */
            name: z.ZodString;
            /**
             * A human-readable description of the argument.
             */
            description: z.ZodOptional<z.ZodString>;
            /**
             * Whether this argument must be provided.
             */
            required: z.ZodOptional<z.ZodBoolean>;
        }, "strip", z.ZodTypeAny, {
            name: string;
            description?: string | undefined;
            required?: boolean | undefined;
        }, {
            name: string;
            description?: string | undefined;
            required?: boolean | undefined;
        }>, "many">>;
    }, "strip", z.ZodTypeAny, {
        name: string;
        description?: string | undefined;
        arguments?: {
            name: string;
            description?: string | undefined;
            required?: boolean | undefined;
        }[] | undefined;
    }, {
        name: string;
        description?: string | undefined;
        arguments?: {
            name: string;
            description?: string | undefined;
            required?: boolean | undefined;
        }[] | undefined;
    }>, "many">;
}>, z.ZodTypeAny, "passthrough">>;
/**
 * Used by the client to get a prompt provided by the server.
 */
export declare const GetPromptRequestSchema: z.ZodObject<z.objectUtil.extendShape<{
    method: z.ZodString;
    params: z.ZodOptional<z.ZodObject<{
        _meta: z.ZodOptional<z.ZodObject<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough">>>;
    }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
        _meta: z.ZodOptional<z.ZodObject<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough">>>;
    }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
        _meta: z.ZodOptional<z.ZodObject<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough">>>;
    }, z.ZodTypeAny, "passthrough">>>;
}, {
    method: z.ZodLiteral<"prompts/get">;
    params: z.ZodObject<z.objectUtil.extendShape<{
        _meta: z.ZodOptional<z.ZodObject<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough">>>;
    }, {
        /**
         * The name of the prompt or prompt template.
         */
        name: z.ZodString;
        /**
         * Arguments to use for templating the prompt.
         */
        arguments: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
    }>, "passthrough", z.ZodTypeAny, z.objectOutputType<z.objectUtil.extendShape<{
        _meta: z.ZodOptional<z.ZodObject<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough">>>;
    }, {
        /**
         * The name of the prompt or prompt template.
         */
        name: z.ZodString;
        /**
         * Arguments to use for templating the prompt.
         */
        arguments: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
    }>, z.ZodTypeAny, "passthrough">, z.objectInputType<z.objectUtil.extendShape<{
        _meta: z.ZodOptional<z.ZodObject<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough">>>;
    }, {
        /**
         * The name of the prompt or prompt template.
         */
        name: z.ZodString;
        /**
         * Arguments to use for templating the prompt.
         */
        arguments: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
    }>, z.ZodTypeAny, "passthrough">>;
}>, "strip", z.ZodTypeAny, {
    params: {
        name: string;
        _meta?: z.objectOutputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough"> | undefined;
        arguments?: Record<string, string> | undefined;
    } & {
        [k: string]: unknown;
    };
    method: "prompts/get";
}, {
    params: {
        name: string;
        _meta?: z.objectInputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough"> | undefined;
        arguments?: Record<string, string> | undefined;
    } & {
        [k: string]: unknown;
    };
    method: "prompts/get";
}>;
/**
 * The server's response to a prompts/get request from the client.
 */
export declare const GetPromptResultSchema: z.ZodObject<z.objectUtil.extendShape<{
    /**
     * This result property is reserved by the protocol to allow clients and servers to attach additional metadata to their responses.
     */
    _meta: z.ZodOptional<z.ZodObject<{}, "passthrough", z.ZodTypeAny, z.objectOutputType<{}, z.ZodTypeAny, "passthrough">, z.objectInputType<{}, z.ZodTypeAny, "passthrough">>>;
}, {
    /**
     * An optional description for the prompt.
     */
    description: z.ZodOptional<z.ZodString>;
    messages: z.ZodArray<z.ZodObject<{
        role: z.ZodEnum<["user", "assistant"]>;
        content: z.ZodUnion<[z.ZodObject<{
            type: z.ZodLiteral<"text">;
            /**
             * The text content of the message.
             */
            text: z.ZodString;
        }, "strip", z.ZodTypeAny, {
            type: "text";
            text: string;
        }, {
            type: "text";
            text: string;
        }>, z.ZodObject<{
            type: z.ZodLiteral<"image">;
            /**
             * The base64-encoded image data.
             */
            data: z.ZodString;
            /**
             * The MIME type of the image. Different providers may support different image types.
             */
            mimeType: z.ZodString;
        }, "strip", z.ZodTypeAny, {
            type: "image";
            data: string;
            mimeType: string;
        }, {
            type: "image";
            data: string;
            mimeType: string;
        }>]>;
    }, "strip", z.ZodTypeAny, {
        role: "user" | "assistant";
        content: {
            type: "text";
            text: string;
        } | {
            type: "image";
            data: string;
            mimeType: string;
        };
    }, {
        role: "user" | "assistant";
        content: {
            type: "text";
            text: string;
        } | {
            type: "image";
            data: string;
            mimeType: string;
        };
    }>, "many">;
}>, "passthrough", z.ZodTypeAny, z.objectOutputType<z.objectUtil.extendShape<{
    /**
     * This result property is reserved by the protocol to allow clients and servers to attach additional metadata to their responses.
     */
    _meta: z.ZodOptional<z.ZodObject<{}, "passthrough", z.ZodTypeAny, z.objectOutputType<{}, z.ZodTypeAny, "passthrough">, z.objectInputType<{}, z.ZodTypeAny, "passthrough">>>;
}, {
    /**
     * An optional description for the prompt.
     */
    description: z.ZodOptional<z.ZodString>;
    messages: z.ZodArray<z.ZodObject<{
        role: z.ZodEnum<["user", "assistant"]>;
        content: z.ZodUnion<[z.ZodObject<{
            type: z.ZodLiteral<"text">;
            /**
             * The text content of the message.
             */
            text: z.ZodString;
        }, "strip", z.ZodTypeAny, {
            type: "text";
            text: string;
        }, {
            type: "text";
            text: string;
        }>, z.ZodObject<{
            type: z.ZodLiteral<"image">;
            /**
             * The base64-encoded image data.
             */
            data: z.ZodString;
            /**
             * The MIME type of the image. Different providers may support different image types.
             */
            mimeType: z.ZodString;
        }, "strip", z.ZodTypeAny, {
            type: "image";
            data: string;
            mimeType: string;
        }, {
            type: "image";
            data: string;
            mimeType: string;
        }>]>;
    }, "strip", z.ZodTypeAny, {
        role: "user" | "assistant";
        content: {
            type: "text";
            text: string;
        } | {
            type: "image";
            data: string;
            mimeType: string;
        };
    }, {
        role: "user" | "assistant";
        content: {
            type: "text";
            text: string;
        } | {
            type: "image";
            data: string;
            mimeType: string;
        };
    }>, "many">;
}>, z.ZodTypeAny, "passthrough">, z.objectInputType<z.objectUtil.extendShape<{
    /**
     * This result property is reserved by the protocol to allow clients and servers to attach additional metadata to their responses.
     */
    _meta: z.ZodOptional<z.ZodObject<{}, "passthrough", z.ZodTypeAny, z.objectOutputType<{}, z.ZodTypeAny, "passthrough">, z.objectInputType<{}, z.ZodTypeAny, "passthrough">>>;
}, {
    /**
     * An optional description for the prompt.
     */
    description: z.ZodOptional<z.ZodString>;
    messages: z.ZodArray<z.ZodObject<{
        role: z.ZodEnum<["user", "assistant"]>;
        content: z.ZodUnion<[z.ZodObject<{
            type: z.ZodLiteral<"text">;
            /**
             * The text content of the message.
             */
            text: z.ZodString;
        }, "strip", z.ZodTypeAny, {
            type: "text";
            text: string;
        }, {
            type: "text";
            text: string;
        }>, z.ZodObject<{
            type: z.ZodLiteral<"image">;
            /**
             * The base64-encoded image data.
             */
            data: z.ZodString;
            /**
             * The MIME type of the image. Different providers may support different image types.
             */
            mimeType: z.ZodString;
        }, "strip", z.ZodTypeAny, {
            type: "image";
            data: string;
            mimeType: string;
        }, {
            type: "image";
            data: string;
            mimeType: string;
        }>]>;
    }, "strip", z.ZodTypeAny, {
        role: "user" | "assistant";
        content: {
            type: "text";
            text: string;
        } | {
            type: "image";
            data: string;
            mimeType: string;
        };
    }, {
        role: "user" | "assistant";
        content: {
            type: "text";
            text: string;
        } | {
            type: "image";
            data: string;
            mimeType: string;
        };
    }>, "many">;
}>, z.ZodTypeAny, "passthrough">>;
/**
 * An optional notification from the server to the client, informing it that the list of prompts it offers has changed. This may be issued by servers without any previous subscription from the client.
 */
export declare const PromptListChangedNotificationSchema: z.ZodObject<z.objectUtil.extendShape<{
    method: z.ZodString;
    params: z.ZodOptional<z.ZodObject<{
        /**
         * This parameter name is reserved by MCP to allow clients and servers to attach additional metadata to their notifications.
         */
        _meta: z.ZodOptional<z.ZodObject<{}, "passthrough", z.ZodTypeAny, z.objectOutputType<{}, z.ZodTypeAny, "passthrough">, z.objectInputType<{}, z.ZodTypeAny, "passthrough">>>;
    }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
        /**
         * This parameter name is reserved by MCP to allow clients and servers to attach additional metadata to their notifications.
         */
        _meta: z.ZodOptional<z.ZodObject<{}, "passthrough", z.ZodTypeAny, z.objectOutputType<{}, z.ZodTypeAny, "passthrough">, z.objectInputType<{}, z.ZodTypeAny, "passthrough">>>;
    }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
        /**
         * This parameter name is reserved by MCP to allow clients and servers to attach additional metadata to their notifications.
         */
        _meta: z.ZodOptional<z.ZodObject<{}, "passthrough", z.ZodTypeAny, z.objectOutputType<{}, z.ZodTypeAny, "passthrough">, z.objectInputType<{}, z.ZodTypeAny, "passthrough">>>;
    }, z.ZodTypeAny, "passthrough">>>;
}, {
    method: z.ZodLiteral<"notifications/prompts/list_changed">;
}>, "strip", z.ZodTypeAny, {
    method: "notifications/prompts/list_changed";
    params?: z.objectOutputType<{
        /**
         * This parameter name is reserved by MCP to allow clients and servers to attach additional metadata to their notifications.
         */
        _meta: z.ZodOptional<z.ZodObject<{}, "passthrough", z.ZodTypeAny, z.objectOutputType<{}, z.ZodTypeAny, "passthrough">, z.objectInputType<{}, z.ZodTypeAny, "passthrough">>>;
    }, z.ZodTypeAny, "passthrough"> | undefined;
}, {
    method: "notifications/prompts/list_changed";
    params?: z.objectInputType<{
        /**
         * This parameter name is reserved by MCP to allow clients and servers to attach additional metadata to their notifications.
         */
        _meta: z.ZodOptional<z.ZodObject<{}, "passthrough", z.ZodTypeAny, z.objectOutputType<{}, z.ZodTypeAny, "passthrough">, z.objectInputType<{}, z.ZodTypeAny, "passthrough">>>;
    }, z.ZodTypeAny, "passthrough"> | undefined;
}>;
/**
 * Definition for a tool the client can call.
 */
export declare const ToolSchema: z.ZodObject<{
    /**
     * The name of the tool.
     */
    name: z.ZodString;
    /**
     * A human-readable description of the tool.
     */
    description: z.ZodOptional<z.ZodString>;
    /**
     * A JSON Schema object defining the expected parameters for the tool.
     */
    inputSchema: z.ZodObject<{
        type: z.ZodLiteral<"object">;
        properties: z.ZodOptional<z.ZodObject<{}, "passthrough", z.ZodTypeAny, z.objectOutputType<{}, z.ZodTypeAny, "passthrough">, z.objectInputType<{}, z.ZodTypeAny, "passthrough">>>;
    }, "strip", z.ZodTypeAny, {
        type: "object";
        properties?: z.objectOutputType<{}, z.ZodTypeAny, "passthrough"> | undefined;
    }, {
        type: "object";
        properties?: z.objectInputType<{}, z.ZodTypeAny, "passthrough"> | undefined;
    }>;
}, "strip", z.ZodTypeAny, {
    name: string;
    inputSchema: {
        type: "object";
        properties?: z.objectOutputType<{}, z.ZodTypeAny, "passthrough"> | undefined;
    };
    description?: string | undefined;
}, {
    name: string;
    inputSchema: {
        type: "object";
        properties?: z.objectInputType<{}, z.ZodTypeAny, "passthrough"> | undefined;
    };
    description?: string | undefined;
}>;
/**
 * Sent from the client to request a list of tools the server has.
 */
export declare const ListToolsRequestSchema: z.ZodObject<z.objectUtil.extendShape<z.objectUtil.extendShape<{
    method: z.ZodString;
    params: z.ZodOptional<z.ZodObject<{
        _meta: z.ZodOptional<z.ZodObject<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough">>>;
    }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
        _meta: z.ZodOptional<z.ZodObject<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough">>>;
    }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
        _meta: z.ZodOptional<z.ZodObject<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough">>>;
    }, z.ZodTypeAny, "passthrough">>>;
}, {
    params: z.ZodObject<z.objectUtil.extendShape<{
        _meta: z.ZodOptional<z.ZodObject<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough">>>;
    }, {
        /**
         * An opaque token representing the current pagination position.
         * If provided, the server should return results starting after this cursor.
         */
        cursor: z.ZodOptional<z.ZodString>;
    }>, "passthrough", z.ZodTypeAny, z.objectOutputType<z.objectUtil.extendShape<{
        _meta: z.ZodOptional<z.ZodObject<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough">>>;
    }, {
        /**
         * An opaque token representing the current pagination position.
         * If provided, the server should return results starting after this cursor.
         */
        cursor: z.ZodOptional<z.ZodString>;
    }>, z.ZodTypeAny, "passthrough">, z.objectInputType<z.objectUtil.extendShape<{
        _meta: z.ZodOptional<z.ZodObject<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough">>>;
    }, {
        /**
         * An opaque token representing the current pagination position.
         * If provided, the server should return results starting after this cursor.
         */
        cursor: z.ZodOptional<z.ZodString>;
    }>, z.ZodTypeAny, "passthrough">>;
}>, {
    method: z.ZodLiteral<"tools/list">;
}>, "strip", z.ZodTypeAny, {
    params: {
        _meta?: z.objectOutputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough"> | undefined;
        cursor?: string | undefined;
    } & {
        [k: string]: unknown;
    };
    method: "tools/list";
}, {
    params: {
        _meta?: z.objectInputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough"> | undefined;
        cursor?: string | undefined;
    } & {
        [k: string]: unknown;
    };
    method: "tools/list";
}>;
/**
 * The server's response to a tools/list request from the client.
 */
export declare const ListToolsResultSchema: z.ZodObject<z.objectUtil.extendShape<z.objectUtil.extendShape<{
    /**
     * This result property is reserved by the protocol to allow clients and servers to attach additional metadata to their responses.
     */
    _meta: z.ZodOptional<z.ZodObject<{}, "passthrough", z.ZodTypeAny, z.objectOutputType<{}, z.ZodTypeAny, "passthrough">, z.objectInputType<{}, z.ZodTypeAny, "passthrough">>>;
}, {
    /**
     * An opaque token representing the pagination position after the last returned result.
     * If present, there may be more results available.
     */
    nextCursor: z.ZodOptional<z.ZodString>;
}>, {
    tools: z.ZodArray<z.ZodObject<{
        /**
         * The name of the tool.
         */
        name: z.ZodString;
        /**
         * A human-readable description of the tool.
         */
        description: z.ZodOptional<z.ZodString>;
        /**
         * A JSON Schema object defining the expected parameters for the tool.
         */
        inputSchema: z.ZodObject<{
            type: z.ZodLiteral<"object">;
            properties: z.ZodOptional<z.ZodObject<{}, "passthrough", z.ZodTypeAny, z.objectOutputType<{}, z.ZodTypeAny, "passthrough">, z.objectInputType<{}, z.ZodTypeAny, "passthrough">>>;
        }, "strip", z.ZodTypeAny, {
            type: "object";
            properties?: z.objectOutputType<{}, z.ZodTypeAny, "passthrough"> | undefined;
        }, {
            type: "object";
            properties?: z.objectInputType<{}, z.ZodTypeAny, "passthrough"> | undefined;
        }>;
    }, "strip", z.ZodTypeAny, {
        name: string;
        inputSchema: {
            type: "object";
            properties?: z.objectOutputType<{}, z.ZodTypeAny, "passthrough"> | undefined;
        };
        description?: string | undefined;
    }, {
        name: string;
        inputSchema: {
            type: "object";
            properties?: z.objectInputType<{}, z.ZodTypeAny, "passthrough"> | undefined;
        };
        description?: string | undefined;
    }>, "many">;
}>, "passthrough", z.ZodTypeAny, z.objectOutputType<z.objectUtil.extendShape<z.objectUtil.extendShape<{
    /**
     * This result property is reserved by the protocol to allow clients and servers to attach additional metadata to their responses.
     */
    _meta: z.ZodOptional<z.ZodObject<{}, "passthrough", z.ZodTypeAny, z.objectOutputType<{}, z.ZodTypeAny, "passthrough">, z.objectInputType<{}, z.ZodTypeAny, "passthrough">>>;
}, {
    /**
     * An opaque token representing the pagination position after the last returned result.
     * If present, there may be more results available.
     */
    nextCursor: z.ZodOptional<z.ZodString>;
}>, {
    tools: z.ZodArray<z.ZodObject<{
        /**
         * The name of the tool.
         */
        name: z.ZodString;
        /**
         * A human-readable description of the tool.
         */
        description: z.ZodOptional<z.ZodString>;
        /**
         * A JSON Schema object defining the expected parameters for the tool.
         */
        inputSchema: z.ZodObject<{
            type: z.ZodLiteral<"object">;
            properties: z.ZodOptional<z.ZodObject<{}, "passthrough", z.ZodTypeAny, z.objectOutputType<{}, z.ZodTypeAny, "passthrough">, z.objectInputType<{}, z.ZodTypeAny, "passthrough">>>;
        }, "strip", z.ZodTypeAny, {
            type: "object";
            properties?: z.objectOutputType<{}, z.ZodTypeAny, "passthrough"> | undefined;
        }, {
            type: "object";
            properties?: z.objectInputType<{}, z.ZodTypeAny, "passthrough"> | undefined;
        }>;
    }, "strip", z.ZodTypeAny, {
        name: string;
        inputSchema: {
            type: "object";
            properties?: z.objectOutputType<{}, z.ZodTypeAny, "passthrough"> | undefined;
        };
        description?: string | undefined;
    }, {
        name: string;
        inputSchema: {
            type: "object";
            properties?: z.objectInputType<{}, z.ZodTypeAny, "passthrough"> | undefined;
        };
        description?: string | undefined;
    }>, "many">;
}>, z.ZodTypeAny, "passthrough">, z.objectInputType<z.objectUtil.extendShape<z.objectUtil.extendShape<{
    /**
     * This result property is reserved by the protocol to allow clients and servers to attach additional metadata to their responses.
     */
    _meta: z.ZodOptional<z.ZodObject<{}, "passthrough", z.ZodTypeAny, z.objectOutputType<{}, z.ZodTypeAny, "passthrough">, z.objectInputType<{}, z.ZodTypeAny, "passthrough">>>;
}, {
    /**
     * An opaque token representing the pagination position after the last returned result.
     * If present, there may be more results available.
     */
    nextCursor: z.ZodOptional<z.ZodString>;
}>, {
    tools: z.ZodArray<z.ZodObject<{
        /**
         * The name of the tool.
         */
        name: z.ZodString;
        /**
         * A human-readable description of the tool.
         */
        description: z.ZodOptional<z.ZodString>;
        /**
         * A JSON Schema object defining the expected parameters for the tool.
         */
        inputSchema: z.ZodObject<{
            type: z.ZodLiteral<"object">;
            properties: z.ZodOptional<z.ZodObject<{}, "passthrough", z.ZodTypeAny, z.objectOutputType<{}, z.ZodTypeAny, "passthrough">, z.objectInputType<{}, z.ZodTypeAny, "passthrough">>>;
        }, "strip", z.ZodTypeAny, {
            type: "object";
            properties?: z.objectOutputType<{}, z.ZodTypeAny, "passthrough"> | undefined;
        }, {
            type: "object";
            properties?: z.objectInputType<{}, z.ZodTypeAny, "passthrough"> | undefined;
        }>;
    }, "strip", z.ZodTypeAny, {
        name: string;
        inputSchema: {
            type: "object";
            properties?: z.objectOutputType<{}, z.ZodTypeAny, "passthrough"> | undefined;
        };
        description?: string | undefined;
    }, {
        name: string;
        inputSchema: {
            type: "object";
            properties?: z.objectInputType<{}, z.ZodTypeAny, "passthrough"> | undefined;
        };
        description?: string | undefined;
    }>, "many">;
}>, z.ZodTypeAny, "passthrough">>;
/**
 * The server's response to a tool call.
 */
export declare const CallToolResultSchema: z.ZodObject<z.objectUtil.extendShape<{
    /**
     * This result property is reserved by the protocol to allow clients and servers to attach additional metadata to their responses.
     */
    _meta: z.ZodOptional<z.ZodObject<{}, "passthrough", z.ZodTypeAny, z.objectOutputType<{}, z.ZodTypeAny, "passthrough">, z.objectInputType<{}, z.ZodTypeAny, "passthrough">>>;
}, {
    toolResult: z.ZodUnknown;
}>, "passthrough", z.ZodTypeAny, z.objectOutputType<z.objectUtil.extendShape<{
    /**
     * This result property is reserved by the protocol to allow clients and servers to attach additional metadata to their responses.
     */
    _meta: z.ZodOptional<z.ZodObject<{}, "passthrough", z.ZodTypeAny, z.objectOutputType<{}, z.ZodTypeAny, "passthrough">, z.objectInputType<{}, z.ZodTypeAny, "passthrough">>>;
}, {
    toolResult: z.ZodUnknown;
}>, z.ZodTypeAny, "passthrough">, z.objectInputType<z.objectUtil.extendShape<{
    /**
     * This result property is reserved by the protocol to allow clients and servers to attach additional metadata to their responses.
     */
    _meta: z.ZodOptional<z.ZodObject<{}, "passthrough", z.ZodTypeAny, z.objectOutputType<{}, z.ZodTypeAny, "passthrough">, z.objectInputType<{}, z.ZodTypeAny, "passthrough">>>;
}, {
    toolResult: z.ZodUnknown;
}>, z.ZodTypeAny, "passthrough">>;
/**
 * Used by the client to invoke a tool provided by the server.
 */
export declare const CallToolRequestSchema: z.ZodObject<z.objectUtil.extendShape<{
    method: z.ZodString;
    params: z.ZodOptional<z.ZodObject<{
        _meta: z.ZodOptional<z.ZodObject<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough">>>;
    }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
        _meta: z.ZodOptional<z.ZodObject<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough">>>;
    }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
        _meta: z.ZodOptional<z.ZodObject<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough">>>;
    }, z.ZodTypeAny, "passthrough">>>;
}, {
    method: z.ZodLiteral<"tools/call">;
    params: z.ZodObject<z.objectUtil.extendShape<{
        _meta: z.ZodOptional<z.ZodObject<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough">>>;
    }, {
        name: z.ZodString;
        arguments: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
    }>, "passthrough", z.ZodTypeAny, z.objectOutputType<z.objectUtil.extendShape<{
        _meta: z.ZodOptional<z.ZodObject<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough">>>;
    }, {
        name: z.ZodString;
        arguments: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
    }>, z.ZodTypeAny, "passthrough">, z.objectInputType<z.objectUtil.extendShape<{
        _meta: z.ZodOptional<z.ZodObject<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough">>>;
    }, {
        name: z.ZodString;
        arguments: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
    }>, z.ZodTypeAny, "passthrough">>;
}>, "strip", z.ZodTypeAny, {
    params: {
        name: string;
        _meta?: z.objectOutputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough"> | undefined;
        arguments?: Record<string, unknown> | undefined;
    } & {
        [k: string]: unknown;
    };
    method: "tools/call";
}, {
    params: {
        name: string;
        _meta?: z.objectInputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough"> | undefined;
        arguments?: Record<string, unknown> | undefined;
    } & {
        [k: string]: unknown;
    };
    method: "tools/call";
}>;
/**
 * An optional notification from the server to the client, informing it that the list of tools it offers has changed. This may be issued by servers without any previous subscription from the client.
 */
export declare const ToolListChangedNotificationSchema: z.ZodObject<z.objectUtil.extendShape<{
    method: z.ZodString;
    params: z.ZodOptional<z.ZodObject<{
        /**
         * This parameter name is reserved by MCP to allow clients and servers to attach additional metadata to their notifications.
         */
        _meta: z.ZodOptional<z.ZodObject<{}, "passthrough", z.ZodTypeAny, z.objectOutputType<{}, z.ZodTypeAny, "passthrough">, z.objectInputType<{}, z.ZodTypeAny, "passthrough">>>;
    }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
        /**
         * This parameter name is reserved by MCP to allow clients and servers to attach additional metadata to their notifications.
         */
        _meta: z.ZodOptional<z.ZodObject<{}, "passthrough", z.ZodTypeAny, z.objectOutputType<{}, z.ZodTypeAny, "passthrough">, z.objectInputType<{}, z.ZodTypeAny, "passthrough">>>;
    }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
        /**
         * This parameter name is reserved by MCP to allow clients and servers to attach additional metadata to their notifications.
         */
        _meta: z.ZodOptional<z.ZodObject<{}, "passthrough", z.ZodTypeAny, z.objectOutputType<{}, z.ZodTypeAny, "passthrough">, z.objectInputType<{}, z.ZodTypeAny, "passthrough">>>;
    }, z.ZodTypeAny, "passthrough">>>;
}, {
    method: z.ZodLiteral<"notifications/tools/list_changed">;
}>, "strip", z.ZodTypeAny, {
    method: "notifications/tools/list_changed";
    params?: z.objectOutputType<{
        /**
         * This parameter name is reserved by MCP to allow clients and servers to attach additional metadata to their notifications.
         */
        _meta: z.ZodOptional<z.ZodObject<{}, "passthrough", z.ZodTypeAny, z.objectOutputType<{}, z.ZodTypeAny, "passthrough">, z.objectInputType<{}, z.ZodTypeAny, "passthrough">>>;
    }, z.ZodTypeAny, "passthrough"> | undefined;
}, {
    method: "notifications/tools/list_changed";
    params?: z.objectInputType<{
        /**
         * This parameter name is reserved by MCP to allow clients and servers to attach additional metadata to their notifications.
         */
        _meta: z.ZodOptional<z.ZodObject<{}, "passthrough", z.ZodTypeAny, z.objectOutputType<{}, z.ZodTypeAny, "passthrough">, z.objectInputType<{}, z.ZodTypeAny, "passthrough">>>;
    }, z.ZodTypeAny, "passthrough"> | undefined;
}>;
/**
 * The severity of a log message.
 */
export declare const LoggingLevelSchema: z.ZodEnum<["debug", "info", "warning", "error"]>;
/**
 * A request from the client to the server, to enable or adjust logging.
 */
export declare const SetLevelRequestSchema: z.ZodObject<z.objectUtil.extendShape<{
    method: z.ZodString;
    params: z.ZodOptional<z.ZodObject<{
        _meta: z.ZodOptional<z.ZodObject<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough">>>;
    }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
        _meta: z.ZodOptional<z.ZodObject<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough">>>;
    }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
        _meta: z.ZodOptional<z.ZodObject<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough">>>;
    }, z.ZodTypeAny, "passthrough">>>;
}, {
    method: z.ZodLiteral<"logging/setLevel">;
    params: z.ZodObject<z.objectUtil.extendShape<{
        _meta: z.ZodOptional<z.ZodObject<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough">>>;
    }, {
        /**
         * The level of logging that the client wants to receive from the server. The server should send all logs at this level and higher (i.e., more severe) to the client as notifications/logging/message.
         */
        level: z.ZodEnum<["debug", "info", "warning", "error"]>;
    }>, "passthrough", z.ZodTypeAny, z.objectOutputType<z.objectUtil.extendShape<{
        _meta: z.ZodOptional<z.ZodObject<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough">>>;
    }, {
        /**
         * The level of logging that the client wants to receive from the server. The server should send all logs at this level and higher (i.e., more severe) to the client as notifications/logging/message.
         */
        level: z.ZodEnum<["debug", "info", "warning", "error"]>;
    }>, z.ZodTypeAny, "passthrough">, z.objectInputType<z.objectUtil.extendShape<{
        _meta: z.ZodOptional<z.ZodObject<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough">>>;
    }, {
        /**
         * The level of logging that the client wants to receive from the server. The server should send all logs at this level and higher (i.e., more severe) to the client as notifications/logging/message.
         */
        level: z.ZodEnum<["debug", "info", "warning", "error"]>;
    }>, z.ZodTypeAny, "passthrough">>;
}>, "strip", z.ZodTypeAny, {
    params: {
        level: "error" | "debug" | "info" | "warning";
        _meta?: z.objectOutputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough"> | undefined;
    } & {
        [k: string]: unknown;
    };
    method: "logging/setLevel";
}, {
    params: {
        level: "error" | "debug" | "info" | "warning";
        _meta?: z.objectInputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough"> | undefined;
    } & {
        [k: string]: unknown;
    };
    method: "logging/setLevel";
}>;
/**
 * Notification of a log message passed from server to client. If no logging/setLevel request has been sent from the client, the server MAY decide which messages to send automatically.
 */
export declare const LoggingMessageNotificationSchema: z.ZodObject<z.objectUtil.extendShape<{
    method: z.ZodString;
    params: z.ZodOptional<z.ZodObject<{
        /**
         * This parameter name is reserved by MCP to allow clients and servers to attach additional metadata to their notifications.
         */
        _meta: z.ZodOptional<z.ZodObject<{}, "passthrough", z.ZodTypeAny, z.objectOutputType<{}, z.ZodTypeAny, "passthrough">, z.objectInputType<{}, z.ZodTypeAny, "passthrough">>>;
    }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
        /**
         * This parameter name is reserved by MCP to allow clients and servers to attach additional metadata to their notifications.
         */
        _meta: z.ZodOptional<z.ZodObject<{}, "passthrough", z.ZodTypeAny, z.objectOutputType<{}, z.ZodTypeAny, "passthrough">, z.objectInputType<{}, z.ZodTypeAny, "passthrough">>>;
    }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
        /**
         * This parameter name is reserved by MCP to allow clients and servers to attach additional metadata to their notifications.
         */
        _meta: z.ZodOptional<z.ZodObject<{}, "passthrough", z.ZodTypeAny, z.objectOutputType<{}, z.ZodTypeAny, "passthrough">, z.objectInputType<{}, z.ZodTypeAny, "passthrough">>>;
    }, z.ZodTypeAny, "passthrough">>>;
}, {
    method: z.ZodLiteral<"notifications/message">;
    params: z.ZodObject<{
        /**
         * The severity of this log message.
         */
        level: z.ZodEnum<["debug", "info", "warning", "error"]>;
        /**
         * An optional name of the logger issuing this message.
         */
        logger: z.ZodOptional<z.ZodString>;
        /**
         * The data to be logged, such as a string message or an object. Any JSON serializable type is allowed here.
         */
        data: z.ZodUnknown;
    }, "strip", z.ZodTypeAny, {
        level: "error" | "debug" | "info" | "warning";
        data?: unknown;
        logger?: string | undefined;
    }, {
        level: "error" | "debug" | "info" | "warning";
        data?: unknown;
        logger?: string | undefined;
    }>;
}>, "strip", z.ZodTypeAny, {
    params: {
        level: "error" | "debug" | "info" | "warning";
        data?: unknown;
        logger?: string | undefined;
    };
    method: "notifications/message";
}, {
    params: {
        level: "error" | "debug" | "info" | "warning";
        data?: unknown;
        logger?: string | undefined;
    };
    method: "notifications/message";
}>;
/**
 * A request from the server to sample an LLM via the client. The client has full discretion over which model to select. The client should also inform the user before beginning sampling, to allow them to inspect the request (human in the loop) and decide whether to approve it.
 */
export declare const CreateMessageRequestSchema: z.ZodObject<z.objectUtil.extendShape<{
    method: z.ZodString;
    params: z.ZodOptional<z.ZodObject<{
        _meta: z.ZodOptional<z.ZodObject<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough">>>;
    }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
        _meta: z.ZodOptional<z.ZodObject<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough">>>;
    }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
        _meta: z.ZodOptional<z.ZodObject<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough">>>;
    }, z.ZodTypeAny, "passthrough">>>;
}, {
    method: z.ZodLiteral<"sampling/createMessage">;
    params: z.ZodObject<z.objectUtil.extendShape<{
        _meta: z.ZodOptional<z.ZodObject<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough">>>;
    }, {
        messages: z.ZodArray<z.ZodObject<{
            role: z.ZodEnum<["user", "assistant"]>;
            content: z.ZodUnion<[z.ZodObject<{
                type: z.ZodLiteral<"text">;
                /**
                 * The text content of the message.
                 */
                text: z.ZodString;
            }, "strip", z.ZodTypeAny, {
                type: "text";
                text: string;
            }, {
                type: "text";
                text: string;
            }>, z.ZodObject<{
                type: z.ZodLiteral<"image">;
                /**
                 * The base64-encoded image data.
                 */
                data: z.ZodString;
                /**
                 * The MIME type of the image. Different providers may support different image types.
                 */
                mimeType: z.ZodString;
            }, "strip", z.ZodTypeAny, {
                type: "image";
                data: string;
                mimeType: string;
            }, {
                type: "image";
                data: string;
                mimeType: string;
            }>]>;
        }, "strip", z.ZodTypeAny, {
            role: "user" | "assistant";
            content: {
                type: "text";
                text: string;
            } | {
                type: "image";
                data: string;
                mimeType: string;
            };
        }, {
            role: "user" | "assistant";
            content: {
                type: "text";
                text: string;
            } | {
                type: "image";
                data: string;
                mimeType: string;
            };
        }>, "many">;
        /**
         * An optional system prompt the server wants to use for sampling. The client MAY modify or omit this prompt.
         */
        systemPrompt: z.ZodOptional<z.ZodString>;
        /**
         * A request to include context from one or more MCP servers (including the caller), to be attached to the prompt. The client MAY ignore this request.
         */
        includeContext: z.ZodOptional<z.ZodEnum<["none", "thisServer", "allServers"]>>;
        temperature: z.ZodOptional<z.ZodNumber>;
        /**
         * The maximum number of tokens to sample, as requested by the server. The client MAY choose to sample fewer tokens than requested.
         */
        maxTokens: z.ZodNumber;
        stopSequences: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
        /**
         * Optional metadata to pass through to the LLM provider. The format of this metadata is provider-specific.
         */
        metadata: z.ZodOptional<z.ZodObject<{}, "passthrough", z.ZodTypeAny, z.objectOutputType<{}, z.ZodTypeAny, "passthrough">, z.objectInputType<{}, z.ZodTypeAny, "passthrough">>>;
    }>, "passthrough", z.ZodTypeAny, z.objectOutputType<z.objectUtil.extendShape<{
        _meta: z.ZodOptional<z.ZodObject<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough">>>;
    }, {
        messages: z.ZodArray<z.ZodObject<{
            role: z.ZodEnum<["user", "assistant"]>;
            content: z.ZodUnion<[z.ZodObject<{
                type: z.ZodLiteral<"text">;
                /**
                 * The text content of the message.
                 */
                text: z.ZodString;
            }, "strip", z.ZodTypeAny, {
                type: "text";
                text: string;
            }, {
                type: "text";
                text: string;
            }>, z.ZodObject<{
                type: z.ZodLiteral<"image">;
                /**
                 * The base64-encoded image data.
                 */
                data: z.ZodString;
                /**
                 * The MIME type of the image. Different providers may support different image types.
                 */
                mimeType: z.ZodString;
            }, "strip", z.ZodTypeAny, {
                type: "image";
                data: string;
                mimeType: string;
            }, {
                type: "image";
                data: string;
                mimeType: string;
            }>]>;
        }, "strip", z.ZodTypeAny, {
            role: "user" | "assistant";
            content: {
                type: "text";
                text: string;
            } | {
                type: "image";
                data: string;
                mimeType: string;
            };
        }, {
            role: "user" | "assistant";
            content: {
                type: "text";
                text: string;
            } | {
                type: "image";
                data: string;
                mimeType: string;
            };
        }>, "many">;
        /**
         * An optional system prompt the server wants to use for sampling. The client MAY modify or omit this prompt.
         */
        systemPrompt: z.ZodOptional<z.ZodString>;
        /**
         * A request to include context from one or more MCP servers (including the caller), to be attached to the prompt. The client MAY ignore this request.
         */
        includeContext: z.ZodOptional<z.ZodEnum<["none", "thisServer", "allServers"]>>;
        temperature: z.ZodOptional<z.ZodNumber>;
        /**
         * The maximum number of tokens to sample, as requested by the server. The client MAY choose to sample fewer tokens than requested.
         */
        maxTokens: z.ZodNumber;
        stopSequences: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
        /**
         * Optional metadata to pass through to the LLM provider. The format of this metadata is provider-specific.
         */
        metadata: z.ZodOptional<z.ZodObject<{}, "passthrough", z.ZodTypeAny, z.objectOutputType<{}, z.ZodTypeAny, "passthrough">, z.objectInputType<{}, z.ZodTypeAny, "passthrough">>>;
    }>, z.ZodTypeAny, "passthrough">, z.objectInputType<z.objectUtil.extendShape<{
        _meta: z.ZodOptional<z.ZodObject<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough">>>;
    }, {
        messages: z.ZodArray<z.ZodObject<{
            role: z.ZodEnum<["user", "assistant"]>;
            content: z.ZodUnion<[z.ZodObject<{
                type: z.ZodLiteral<"text">;
                /**
                 * The text content of the message.
                 */
                text: z.ZodString;
            }, "strip", z.ZodTypeAny, {
                type: "text";
                text: string;
            }, {
                type: "text";
                text: string;
            }>, z.ZodObject<{
                type: z.ZodLiteral<"image">;
                /**
                 * The base64-encoded image data.
                 */
                data: z.ZodString;
                /**
                 * The MIME type of the image. Different providers may support different image types.
                 */
                mimeType: z.ZodString;
            }, "strip", z.ZodTypeAny, {
                type: "image";
                data: string;
                mimeType: string;
            }, {
                type: "image";
                data: string;
                mimeType: string;
            }>]>;
        }, "strip", z.ZodTypeAny, {
            role: "user" | "assistant";
            content: {
                type: "text";
                text: string;
            } | {
                type: "image";
                data: string;
                mimeType: string;
            };
        }, {
            role: "user" | "assistant";
            content: {
                type: "text";
                text: string;
            } | {
                type: "image";
                data: string;
                mimeType: string;
            };
        }>, "many">;
        /**
         * An optional system prompt the server wants to use for sampling. The client MAY modify or omit this prompt.
         */
        systemPrompt: z.ZodOptional<z.ZodString>;
        /**
         * A request to include context from one or more MCP servers (including the caller), to be attached to the prompt. The client MAY ignore this request.
         */
        includeContext: z.ZodOptional<z.ZodEnum<["none", "thisServer", "allServers"]>>;
        temperature: z.ZodOptional<z.ZodNumber>;
        /**
         * The maximum number of tokens to sample, as requested by the server. The client MAY choose to sample fewer tokens than requested.
         */
        maxTokens: z.ZodNumber;
        stopSequences: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
        /**
         * Optional metadata to pass through to the LLM provider. The format of this metadata is provider-specific.
         */
        metadata: z.ZodOptional<z.ZodObject<{}, "passthrough", z.ZodTypeAny, z.objectOutputType<{}, z.ZodTypeAny, "passthrough">, z.objectInputType<{}, z.ZodTypeAny, "passthrough">>>;
    }>, z.ZodTypeAny, "passthrough">>;
}>, "strip", z.ZodTypeAny, {
    params: {
        messages: {
            role: "user" | "assistant";
            content: {
                type: "text";
                text: string;
            } | {
                type: "image";
                data: string;
                mimeType: string;
            };
        }[];
        maxTokens: number;
        _meta?: z.objectOutputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough"> | undefined;
        systemPrompt?: string | undefined;
        includeContext?: "none" | "thisServer" | "allServers" | undefined;
        temperature?: number | undefined;
        stopSequences?: string[] | undefined;
        metadata?: z.objectOutputType<{}, z.ZodTypeAny, "passthrough"> | undefined;
    } & {
        [k: string]: unknown;
    };
    method: "sampling/createMessage";
}, {
    params: {
        messages: {
            role: "user" | "assistant";
            content: {
                type: "text";
                text: string;
            } | {
                type: "image";
                data: string;
                mimeType: string;
            };
        }[];
        maxTokens: number;
        _meta?: z.objectInputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough"> | undefined;
        systemPrompt?: string | undefined;
        includeContext?: "none" | "thisServer" | "allServers" | undefined;
        temperature?: number | undefined;
        stopSequences?: string[] | undefined;
        metadata?: z.objectInputType<{}, z.ZodTypeAny, "passthrough"> | undefined;
    } & {
        [k: string]: unknown;
    };
    method: "sampling/createMessage";
}>;
/**
 * The client's response to a sampling/create_message request from the server. The client should inform the user before returning the sampled message, to allow them to inspect the response (human in the loop) and decide whether to allow the server to see it.
 */
export declare const CreateMessageResultSchema: z.ZodObject<z.objectUtil.extendShape<{
    /**
     * This result property is reserved by the protocol to allow clients and servers to attach additional metadata to their responses.
     */
    _meta: z.ZodOptional<z.ZodObject<{}, "passthrough", z.ZodTypeAny, z.objectOutputType<{}, z.ZodTypeAny, "passthrough">, z.objectInputType<{}, z.ZodTypeAny, "passthrough">>>;
}, {
    /**
     * The name of the model that generated the message.
     */
    model: z.ZodString;
    /**
     * The reason why sampling stopped.
     */
    stopReason: z.ZodEnum<["endTurn", "stopSequence", "maxTokens"]>;
    role: z.ZodEnum<["user", "assistant"]>;
    content: z.ZodDiscriminatedUnion<"type", [z.ZodObject<{
        type: z.ZodLiteral<"text">;
        /**
         * The text content of the message.
         */
        text: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        type: "text";
        text: string;
    }, {
        type: "text";
        text: string;
    }>, z.ZodObject<{
        type: z.ZodLiteral<"image">;
        /**
         * The base64-encoded image data.
         */
        data: z.ZodString;
        /**
         * The MIME type of the image. Different providers may support different image types.
         */
        mimeType: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        type: "image";
        data: string;
        mimeType: string;
    }, {
        type: "image";
        data: string;
        mimeType: string;
    }>]>;
}>, "passthrough", z.ZodTypeAny, z.objectOutputType<z.objectUtil.extendShape<{
    /**
     * This result property is reserved by the protocol to allow clients and servers to attach additional metadata to their responses.
     */
    _meta: z.ZodOptional<z.ZodObject<{}, "passthrough", z.ZodTypeAny, z.objectOutputType<{}, z.ZodTypeAny, "passthrough">, z.objectInputType<{}, z.ZodTypeAny, "passthrough">>>;
}, {
    /**
     * The name of the model that generated the message.
     */
    model: z.ZodString;
    /**
     * The reason why sampling stopped.
     */
    stopReason: z.ZodEnum<["endTurn", "stopSequence", "maxTokens"]>;
    role: z.ZodEnum<["user", "assistant"]>;
    content: z.ZodDiscriminatedUnion<"type", [z.ZodObject<{
        type: z.ZodLiteral<"text">;
        /**
         * The text content of the message.
         */
        text: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        type: "text";
        text: string;
    }, {
        type: "text";
        text: string;
    }>, z.ZodObject<{
        type: z.ZodLiteral<"image">;
        /**
         * The base64-encoded image data.
         */
        data: z.ZodString;
        /**
         * The MIME type of the image. Different providers may support different image types.
         */
        mimeType: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        type: "image";
        data: string;
        mimeType: string;
    }, {
        type: "image";
        data: string;
        mimeType: string;
    }>]>;
}>, z.ZodTypeAny, "passthrough">, z.objectInputType<z.objectUtil.extendShape<{
    /**
     * This result property is reserved by the protocol to allow clients and servers to attach additional metadata to their responses.
     */
    _meta: z.ZodOptional<z.ZodObject<{}, "passthrough", z.ZodTypeAny, z.objectOutputType<{}, z.ZodTypeAny, "passthrough">, z.objectInputType<{}, z.ZodTypeAny, "passthrough">>>;
}, {
    /**
     * The name of the model that generated the message.
     */
    model: z.ZodString;
    /**
     * The reason why sampling stopped.
     */
    stopReason: z.ZodEnum<["endTurn", "stopSequence", "maxTokens"]>;
    role: z.ZodEnum<["user", "assistant"]>;
    content: z.ZodDiscriminatedUnion<"type", [z.ZodObject<{
        type: z.ZodLiteral<"text">;
        /**
         * The text content of the message.
         */
        text: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        type: "text";
        text: string;
    }, {
        type: "text";
        text: string;
    }>, z.ZodObject<{
        type: z.ZodLiteral<"image">;
        /**
         * The base64-encoded image data.
         */
        data: z.ZodString;
        /**
         * The MIME type of the image. Different providers may support different image types.
         */
        mimeType: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        type: "image";
        data: string;
        mimeType: string;
    }, {
        type: "image";
        data: string;
        mimeType: string;
    }>]>;
}>, z.ZodTypeAny, "passthrough">>;
/**
 * A reference to a resource or resource template definition.
 */
export declare const ResourceReferenceSchema: z.ZodObject<{
    type: z.ZodLiteral<"ref/resource">;
    /**
     * The URI or URI template of the resource.
     */
    uri: z.ZodString;
}, "strip", z.ZodTypeAny, {
    type: "ref/resource";
    uri: string;
}, {
    type: "ref/resource";
    uri: string;
}>;
/**
 * Identifies a prompt.
 */
export declare const PromptReferenceSchema: z.ZodObject<{
    type: z.ZodLiteral<"ref/prompt">;
    /**
     * The name of the prompt or prompt template
     */
    name: z.ZodString;
}, "strip", z.ZodTypeAny, {
    type: "ref/prompt";
    name: string;
}, {
    type: "ref/prompt";
    name: string;
}>;
/**
 * A request from the client to the server, to ask for completion options.
 */
export declare const CompleteRequestSchema: z.ZodObject<z.objectUtil.extendShape<{
    method: z.ZodString;
    params: z.ZodOptional<z.ZodObject<{
        _meta: z.ZodOptional<z.ZodObject<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough">>>;
    }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
        _meta: z.ZodOptional<z.ZodObject<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough">>>;
    }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
        _meta: z.ZodOptional<z.ZodObject<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough">>>;
    }, z.ZodTypeAny, "passthrough">>>;
}, {
    method: z.ZodLiteral<"completion/complete">;
    params: z.ZodObject<z.objectUtil.extendShape<{
        _meta: z.ZodOptional<z.ZodObject<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough">>>;
    }, {
        ref: z.ZodUnion<[z.ZodObject<{
            type: z.ZodLiteral<"ref/prompt">;
            /**
             * The name of the prompt or prompt template
             */
            name: z.ZodString;
        }, "strip", z.ZodTypeAny, {
            type: "ref/prompt";
            name: string;
        }, {
            type: "ref/prompt";
            name: string;
        }>, z.ZodObject<{
            type: z.ZodLiteral<"ref/resource">;
            /**
             * The URI or URI template of the resource.
             */
            uri: z.ZodString;
        }, "strip", z.ZodTypeAny, {
            type: "ref/resource";
            uri: string;
        }, {
            type: "ref/resource";
            uri: string;
        }>]>;
        /**
         * The argument's information
         */
        argument: z.ZodObject<{
            /**
             * The name of the argument
             */
            name: z.ZodString;
            /**
             * The value of the argument to use for completion matching.
             */
            value: z.ZodString;
        }, "strip", z.ZodTypeAny, {
            value: string;
            name: string;
        }, {
            value: string;
            name: string;
        }>;
    }>, "passthrough", z.ZodTypeAny, z.objectOutputType<z.objectUtil.extendShape<{
        _meta: z.ZodOptional<z.ZodObject<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough">>>;
    }, {
        ref: z.ZodUnion<[z.ZodObject<{
            type: z.ZodLiteral<"ref/prompt">;
            /**
             * The name of the prompt or prompt template
             */
            name: z.ZodString;
        }, "strip", z.ZodTypeAny, {
            type: "ref/prompt";
            name: string;
        }, {
            type: "ref/prompt";
            name: string;
        }>, z.ZodObject<{
            type: z.ZodLiteral<"ref/resource">;
            /**
             * The URI or URI template of the resource.
             */
            uri: z.ZodString;
        }, "strip", z.ZodTypeAny, {
            type: "ref/resource";
            uri: string;
        }, {
            type: "ref/resource";
            uri: string;
        }>]>;
        /**
         * The argument's information
         */
        argument: z.ZodObject<{
            /**
             * The name of the argument
             */
            name: z.ZodString;
            /**
             * The value of the argument to use for completion matching.
             */
            value: z.ZodString;
        }, "strip", z.ZodTypeAny, {
            value: string;
            name: string;
        }, {
            value: string;
            name: string;
        }>;
    }>, z.ZodTypeAny, "passthrough">, z.objectInputType<z.objectUtil.extendShape<{
        _meta: z.ZodOptional<z.ZodObject<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough">>>;
    }, {
        ref: z.ZodUnion<[z.ZodObject<{
            type: z.ZodLiteral<"ref/prompt">;
            /**
             * The name of the prompt or prompt template
             */
            name: z.ZodString;
        }, "strip", z.ZodTypeAny, {
            type: "ref/prompt";
            name: string;
        }, {
            type: "ref/prompt";
            name: string;
        }>, z.ZodObject<{
            type: z.ZodLiteral<"ref/resource">;
            /**
             * The URI or URI template of the resource.
             */
            uri: z.ZodString;
        }, "strip", z.ZodTypeAny, {
            type: "ref/resource";
            uri: string;
        }, {
            type: "ref/resource";
            uri: string;
        }>]>;
        /**
         * The argument's information
         */
        argument: z.ZodObject<{
            /**
             * The name of the argument
             */
            name: z.ZodString;
            /**
             * The value of the argument to use for completion matching.
             */
            value: z.ZodString;
        }, "strip", z.ZodTypeAny, {
            value: string;
            name: string;
        }, {
            value: string;
            name: string;
        }>;
    }>, z.ZodTypeAny, "passthrough">>;
}>, "strip", z.ZodTypeAny, {
    params: {
        ref: {
            type: "ref/resource";
            uri: string;
        } | {
            type: "ref/prompt";
            name: string;
        };
        argument: {
            value: string;
            name: string;
        };
        _meta?: z.objectOutputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough"> | undefined;
    } & {
        [k: string]: unknown;
    };
    method: "completion/complete";
}, {
    params: {
        ref: {
            type: "ref/resource";
            uri: string;
        } | {
            type: "ref/prompt";
            name: string;
        };
        argument: {
            value: string;
            name: string;
        };
        _meta?: z.objectInputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough"> | undefined;
    } & {
        [k: string]: unknown;
    };
    method: "completion/complete";
}>;
/**
 * The server's response to a completion/complete request
 */
export declare const CompleteResultSchema: z.ZodObject<z.objectUtil.extendShape<{
    /**
     * This result property is reserved by the protocol to allow clients and servers to attach additional metadata to their responses.
     */
    _meta: z.ZodOptional<z.ZodObject<{}, "passthrough", z.ZodTypeAny, z.objectOutputType<{}, z.ZodTypeAny, "passthrough">, z.objectInputType<{}, z.ZodTypeAny, "passthrough">>>;
}, {
    completion: z.ZodObject<{
        /**
         * An array of completion values. Must not exceed 100 items.
         */
        values: z.ZodArray<z.ZodString, "many">;
        /**
         * The total number of completion options available. This can exceed the number of values actually sent in the response.
         */
        total: z.ZodOptional<z.ZodNumber>;
        /**
         * Indicates whether there are additional completion options beyond those provided in the current response, even if the exact total is unknown.
         */
        hasMore: z.ZodOptional<z.ZodBoolean>;
    }, "strip", z.ZodTypeAny, {
        values: string[];
        total?: number | undefined;
        hasMore?: boolean | undefined;
    }, {
        values: string[];
        total?: number | undefined;
        hasMore?: boolean | undefined;
    }>;
}>, "passthrough", z.ZodTypeAny, z.objectOutputType<z.objectUtil.extendShape<{
    /**
     * This result property is reserved by the protocol to allow clients and servers to attach additional metadata to their responses.
     */
    _meta: z.ZodOptional<z.ZodObject<{}, "passthrough", z.ZodTypeAny, z.objectOutputType<{}, z.ZodTypeAny, "passthrough">, z.objectInputType<{}, z.ZodTypeAny, "passthrough">>>;
}, {
    completion: z.ZodObject<{
        /**
         * An array of completion values. Must not exceed 100 items.
         */
        values: z.ZodArray<z.ZodString, "many">;
        /**
         * The total number of completion options available. This can exceed the number of values actually sent in the response.
         */
        total: z.ZodOptional<z.ZodNumber>;
        /**
         * Indicates whether there are additional completion options beyond those provided in the current response, even if the exact total is unknown.
         */
        hasMore: z.ZodOptional<z.ZodBoolean>;
    }, "strip", z.ZodTypeAny, {
        values: string[];
        total?: number | undefined;
        hasMore?: boolean | undefined;
    }, {
        values: string[];
        total?: number | undefined;
        hasMore?: boolean | undefined;
    }>;
}>, z.ZodTypeAny, "passthrough">, z.objectInputType<z.objectUtil.extendShape<{
    /**
     * This result property is reserved by the protocol to allow clients and servers to attach additional metadata to their responses.
     */
    _meta: z.ZodOptional<z.ZodObject<{}, "passthrough", z.ZodTypeAny, z.objectOutputType<{}, z.ZodTypeAny, "passthrough">, z.objectInputType<{}, z.ZodTypeAny, "passthrough">>>;
}, {
    completion: z.ZodObject<{
        /**
         * An array of completion values. Must not exceed 100 items.
         */
        values: z.ZodArray<z.ZodString, "many">;
        /**
         * The total number of completion options available. This can exceed the number of values actually sent in the response.
         */
        total: z.ZodOptional<z.ZodNumber>;
        /**
         * Indicates whether there are additional completion options beyond those provided in the current response, even if the exact total is unknown.
         */
        hasMore: z.ZodOptional<z.ZodBoolean>;
    }, "strip", z.ZodTypeAny, {
        values: string[];
        total?: number | undefined;
        hasMore?: boolean | undefined;
    }, {
        values: string[];
        total?: number | undefined;
        hasMore?: boolean | undefined;
    }>;
}>, z.ZodTypeAny, "passthrough">>;
export declare const ClientRequestSchema: z.ZodUnion<[z.ZodObject<z.objectUtil.extendShape<{
    method: z.ZodString;
    params: z.ZodOptional<z.ZodObject<{
        _meta: z.ZodOptional<z.ZodObject<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough">>>;
    }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
        _meta: z.ZodOptional<z.ZodObject<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough">>>;
    }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
        _meta: z.ZodOptional<z.ZodObject<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough">>>;
    }, z.ZodTypeAny, "passthrough">>>;
}, {
    method: z.ZodLiteral<"ping">;
}>, "strip", z.ZodTypeAny, {
    method: "ping";
    params?: z.objectOutputType<{
        _meta: z.ZodOptional<z.ZodObject<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough">>>;
    }, z.ZodTypeAny, "passthrough"> | undefined;
}, {
    method: "ping";
    params?: z.objectInputType<{
        _meta: z.ZodOptional<z.ZodObject<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough">>>;
    }, z.ZodTypeAny, "passthrough"> | undefined;
}>, z.ZodObject<z.objectUtil.extendShape<{
    method: z.ZodString;
    params: z.ZodOptional<z.ZodObject<{
        _meta: z.ZodOptional<z.ZodObject<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough">>>;
    }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
        _meta: z.ZodOptional<z.ZodObject<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough">>>;
    }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
        _meta: z.ZodOptional<z.ZodObject<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough">>>;
    }, z.ZodTypeAny, "passthrough">>>;
}, {
    method: z.ZodLiteral<"initialize">;
    params: z.ZodObject<z.objectUtil.extendShape<{
        _meta: z.ZodOptional<z.ZodObject<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough">>>;
    }, {
        /**
         * The latest version of the Model Context Protocol that the client supports. The client MAY decide to support older versions as well.
         */
        protocolVersion: z.ZodUnion<[z.ZodString, z.ZodNumber]>;
        capabilities: z.ZodObject<{
            /**
             * Experimental, non-standard capabilities that the client supports.
             */
            experimental: z.ZodOptional<z.ZodObject<{}, "passthrough", z.ZodTypeAny, z.objectOutputType<{}, z.ZodTypeAny, "passthrough">, z.objectInputType<{}, z.ZodTypeAny, "passthrough">>>;
            /**
             * Present if the client supports sampling from an LLM.
             */
            sampling: z.ZodOptional<z.ZodObject<{}, "passthrough", z.ZodTypeAny, z.objectOutputType<{}, z.ZodTypeAny, "passthrough">, z.objectInputType<{}, z.ZodTypeAny, "passthrough">>>;
        }, "strip", z.ZodTypeAny, {
            experimental?: z.objectOutputType<{}, z.ZodTypeAny, "passthrough"> | undefined;
            sampling?: z.objectOutputType<{}, z.ZodTypeAny, "passthrough"> | undefined;
        }, {
            experimental?: z.objectInputType<{}, z.ZodTypeAny, "passthrough"> | undefined;
            sampling?: z.objectInputType<{}, z.ZodTypeAny, "passthrough"> | undefined;
        }>;
        clientInfo: z.ZodObject<{
            name: z.ZodString;
            version: z.ZodString;
        }, "strip", z.ZodTypeAny, {
            name: string;
            version: string;
        }, {
            name: string;
            version: string;
        }>;
    }>, "passthrough", z.ZodTypeAny, z.objectOutputType<z.objectUtil.extendShape<{
        _meta: z.ZodOptional<z.ZodObject<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough">>>;
    }, {
        /**
         * The latest version of the Model Context Protocol that the client supports. The client MAY decide to support older versions as well.
         */
        protocolVersion: z.ZodUnion<[z.ZodString, z.ZodNumber]>;
        capabilities: z.ZodObject<{
            /**
             * Experimental, non-standard capabilities that the client supports.
             */
            experimental: z.ZodOptional<z.ZodObject<{}, "passthrough", z.ZodTypeAny, z.objectOutputType<{}, z.ZodTypeAny, "passthrough">, z.objectInputType<{}, z.ZodTypeAny, "passthrough">>>;
            /**
             * Present if the client supports sampling from an LLM.
             */
            sampling: z.ZodOptional<z.ZodObject<{}, "passthrough", z.ZodTypeAny, z.objectOutputType<{}, z.ZodTypeAny, "passthrough">, z.objectInputType<{}, z.ZodTypeAny, "passthrough">>>;
        }, "strip", z.ZodTypeAny, {
            experimental?: z.objectOutputType<{}, z.ZodTypeAny, "passthrough"> | undefined;
            sampling?: z.objectOutputType<{}, z.ZodTypeAny, "passthrough"> | undefined;
        }, {
            experimental?: z.objectInputType<{}, z.ZodTypeAny, "passthrough"> | undefined;
            sampling?: z.objectInputType<{}, z.ZodTypeAny, "passthrough"> | undefined;
        }>;
        clientInfo: z.ZodObject<{
            name: z.ZodString;
            version: z.ZodString;
        }, "strip", z.ZodTypeAny, {
            name: string;
            version: string;
        }, {
            name: string;
            version: string;
        }>;
    }>, z.ZodTypeAny, "passthrough">, z.objectInputType<z.objectUtil.extendShape<{
        _meta: z.ZodOptional<z.ZodObject<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough">>>;
    }, {
        /**
         * The latest version of the Model Context Protocol that the client supports. The client MAY decide to support older versions as well.
         */
        protocolVersion: z.ZodUnion<[z.ZodString, z.ZodNumber]>;
        capabilities: z.ZodObject<{
            /**
             * Experimental, non-standard capabilities that the client supports.
             */
            experimental: z.ZodOptional<z.ZodObject<{}, "passthrough", z.ZodTypeAny, z.objectOutputType<{}, z.ZodTypeAny, "passthrough">, z.objectInputType<{}, z.ZodTypeAny, "passthrough">>>;
            /**
             * Present if the client supports sampling from an LLM.
             */
            sampling: z.ZodOptional<z.ZodObject<{}, "passthrough", z.ZodTypeAny, z.objectOutputType<{}, z.ZodTypeAny, "passthrough">, z.objectInputType<{}, z.ZodTypeAny, "passthrough">>>;
        }, "strip", z.ZodTypeAny, {
            experimental?: z.objectOutputType<{}, z.ZodTypeAny, "passthrough"> | undefined;
            sampling?: z.objectOutputType<{}, z.ZodTypeAny, "passthrough"> | undefined;
        }, {
            experimental?: z.objectInputType<{}, z.ZodTypeAny, "passthrough"> | undefined;
            sampling?: z.objectInputType<{}, z.ZodTypeAny, "passthrough"> | undefined;
        }>;
        clientInfo: z.ZodObject<{
            name: z.ZodString;
            version: z.ZodString;
        }, "strip", z.ZodTypeAny, {
            name: string;
            version: string;
        }, {
            name: string;
            version: string;
        }>;
    }>, z.ZodTypeAny, "passthrough">>;
}>, "strip", z.ZodTypeAny, {
    params: {
        protocolVersion: string | number;
        capabilities: {
            experimental?: z.objectOutputType<{}, z.ZodTypeAny, "passthrough"> | undefined;
            sampling?: z.objectOutputType<{}, z.ZodTypeAny, "passthrough"> | undefined;
        };
        clientInfo: {
            name: string;
            version: string;
        };
        _meta?: z.objectOutputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough"> | undefined;
    } & {
        [k: string]: unknown;
    };
    method: "initialize";
}, {
    params: {
        protocolVersion: string | number;
        capabilities: {
            experimental?: z.objectInputType<{}, z.ZodTypeAny, "passthrough"> | undefined;
            sampling?: z.objectInputType<{}, z.ZodTypeAny, "passthrough"> | undefined;
        };
        clientInfo: {
            name: string;
            version: string;
        };
        _meta?: z.objectInputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough"> | undefined;
    } & {
        [k: string]: unknown;
    };
    method: "initialize";
}>, z.ZodObject<z.objectUtil.extendShape<{
    method: z.ZodString;
    params: z.ZodOptional<z.ZodObject<{
        _meta: z.ZodOptional<z.ZodObject<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough">>>;
    }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
        _meta: z.ZodOptional<z.ZodObject<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough">>>;
    }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
        _meta: z.ZodOptional<z.ZodObject<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough">>>;
    }, z.ZodTypeAny, "passthrough">>>;
}, {
    method: z.ZodLiteral<"completion/complete">;
    params: z.ZodObject<z.objectUtil.extendShape<{
        _meta: z.ZodOptional<z.ZodObject<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough">>>;
    }, {
        ref: z.ZodUnion<[z.ZodObject<{
            type: z.ZodLiteral<"ref/prompt">;
            /**
             * The name of the prompt or prompt template
             */
            name: z.ZodString;
        }, "strip", z.ZodTypeAny, {
            type: "ref/prompt";
            name: string;
        }, {
            type: "ref/prompt";
            name: string;
        }>, z.ZodObject<{
            type: z.ZodLiteral<"ref/resource">;
            /**
             * The URI or URI template of the resource.
             */
            uri: z.ZodString;
        }, "strip", z.ZodTypeAny, {
            type: "ref/resource";
            uri: string;
        }, {
            type: "ref/resource";
            uri: string;
        }>]>;
        /**
         * The argument's information
         */
        argument: z.ZodObject<{
            /**
             * The name of the argument
             */
            name: z.ZodString;
            /**
             * The value of the argument to use for completion matching.
             */
            value: z.ZodString;
        }, "strip", z.ZodTypeAny, {
            value: string;
            name: string;
        }, {
            value: string;
            name: string;
        }>;
    }>, "passthrough", z.ZodTypeAny, z.objectOutputType<z.objectUtil.extendShape<{
        _meta: z.ZodOptional<z.ZodObject<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough">>>;
    }, {
        ref: z.ZodUnion<[z.ZodObject<{
            type: z.ZodLiteral<"ref/prompt">;
            /**
             * The name of the prompt or prompt template
             */
            name: z.ZodString;
        }, "strip", z.ZodTypeAny, {
            type: "ref/prompt";
            name: string;
        }, {
            type: "ref/prompt";
            name: string;
        }>, z.ZodObject<{
            type: z.ZodLiteral<"ref/resource">;
            /**
             * The URI or URI template of the resource.
             */
            uri: z.ZodString;
        }, "strip", z.ZodTypeAny, {
            type: "ref/resource";
            uri: string;
        }, {
            type: "ref/resource";
            uri: string;
        }>]>;
        /**
         * The argument's information
         */
        argument: z.ZodObject<{
            /**
             * The name of the argument
             */
            name: z.ZodString;
            /**
             * The value of the argument to use for completion matching.
             */
            value: z.ZodString;
        }, "strip", z.ZodTypeAny, {
            value: string;
            name: string;
        }, {
            value: string;
            name: string;
        }>;
    }>, z.ZodTypeAny, "passthrough">, z.objectInputType<z.objectUtil.extendShape<{
        _meta: z.ZodOptional<z.ZodObject<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough">>>;
    }, {
        ref: z.ZodUnion<[z.ZodObject<{
            type: z.ZodLiteral<"ref/prompt">;
            /**
             * The name of the prompt or prompt template
             */
            name: z.ZodString;
        }, "strip", z.ZodTypeAny, {
            type: "ref/prompt";
            name: string;
        }, {
            type: "ref/prompt";
            name: string;
        }>, z.ZodObject<{
            type: z.ZodLiteral<"ref/resource">;
            /**
             * The URI or URI template of the resource.
             */
            uri: z.ZodString;
        }, "strip", z.ZodTypeAny, {
            type: "ref/resource";
            uri: string;
        }, {
            type: "ref/resource";
            uri: string;
        }>]>;
        /**
         * The argument's information
         */
        argument: z.ZodObject<{
            /**
             * The name of the argument
             */
            name: z.ZodString;
            /**
             * The value of the argument to use for completion matching.
             */
            value: z.ZodString;
        }, "strip", z.ZodTypeAny, {
            value: string;
            name: string;
        }, {
            value: string;
            name: string;
        }>;
    }>, z.ZodTypeAny, "passthrough">>;
}>, "strip", z.ZodTypeAny, {
    params: {
        ref: {
            type: "ref/resource";
            uri: string;
        } | {
            type: "ref/prompt";
            name: string;
        };
        argument: {
            value: string;
            name: string;
        };
        _meta?: z.objectOutputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough"> | undefined;
    } & {
        [k: string]: unknown;
    };
    method: "completion/complete";
}, {
    params: {
        ref: {
            type: "ref/resource";
            uri: string;
        } | {
            type: "ref/prompt";
            name: string;
        };
        argument: {
            value: string;
            name: string;
        };
        _meta?: z.objectInputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough"> | undefined;
    } & {
        [k: string]: unknown;
    };
    method: "completion/complete";
}>, z.ZodObject<z.objectUtil.extendShape<{
    method: z.ZodString;
    params: z.ZodOptional<z.ZodObject<{
        _meta: z.ZodOptional<z.ZodObject<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough">>>;
    }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
        _meta: z.ZodOptional<z.ZodObject<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough">>>;
    }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
        _meta: z.ZodOptional<z.ZodObject<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough">>>;
    }, z.ZodTypeAny, "passthrough">>>;
}, {
    method: z.ZodLiteral<"logging/setLevel">;
    params: z.ZodObject<z.objectUtil.extendShape<{
        _meta: z.ZodOptional<z.ZodObject<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough">>>;
    }, {
        /**
         * The level of logging that the client wants to receive from the server. The server should send all logs at this level and higher (i.e., more severe) to the client as notifications/logging/message.
         */
        level: z.ZodEnum<["debug", "info", "warning", "error"]>;
    }>, "passthrough", z.ZodTypeAny, z.objectOutputType<z.objectUtil.extendShape<{
        _meta: z.ZodOptional<z.ZodObject<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough">>>;
    }, {
        /**
         * The level of logging that the client wants to receive from the server. The server should send all logs at this level and higher (i.e., more severe) to the client as notifications/logging/message.
         */
        level: z.ZodEnum<["debug", "info", "warning", "error"]>;
    }>, z.ZodTypeAny, "passthrough">, z.objectInputType<z.objectUtil.extendShape<{
        _meta: z.ZodOptional<z.ZodObject<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough">>>;
    }, {
        /**
         * The level of logging that the client wants to receive from the server. The server should send all logs at this level and higher (i.e., more severe) to the client as notifications/logging/message.
         */
        level: z.ZodEnum<["debug", "info", "warning", "error"]>;
    }>, z.ZodTypeAny, "passthrough">>;
}>, "strip", z.ZodTypeAny, {
    params: {
        level: "error" | "debug" | "info" | "warning";
        _meta?: z.objectOutputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough"> | undefined;
    } & {
        [k: string]: unknown;
    };
    method: "logging/setLevel";
}, {
    params: {
        level: "error" | "debug" | "info" | "warning";
        _meta?: z.objectInputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough"> | undefined;
    } & {
        [k: string]: unknown;
    };
    method: "logging/setLevel";
}>, z.ZodObject<z.objectUtil.extendShape<{
    method: z.ZodString;
    params: z.ZodOptional<z.ZodObject<{
        _meta: z.ZodOptional<z.ZodObject<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough">>>;
    }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
        _meta: z.ZodOptional<z.ZodObject<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough">>>;
    }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
        _meta: z.ZodOptional<z.ZodObject<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough">>>;
    }, z.ZodTypeAny, "passthrough">>>;
}, {
    method: z.ZodLiteral<"prompts/get">;
    params: z.ZodObject<z.objectUtil.extendShape<{
        _meta: z.ZodOptional<z.ZodObject<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough">>>;
    }, {
        /**
         * The name of the prompt or prompt template.
         */
        name: z.ZodString;
        /**
         * Arguments to use for templating the prompt.
         */
        arguments: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
    }>, "passthrough", z.ZodTypeAny, z.objectOutputType<z.objectUtil.extendShape<{
        _meta: z.ZodOptional<z.ZodObject<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough">>>;
    }, {
        /**
         * The name of the prompt or prompt template.
         */
        name: z.ZodString;
        /**
         * Arguments to use for templating the prompt.
         */
        arguments: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
    }>, z.ZodTypeAny, "passthrough">, z.objectInputType<z.objectUtil.extendShape<{
        _meta: z.ZodOptional<z.ZodObject<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough">>>;
    }, {
        /**
         * The name of the prompt or prompt template.
         */
        name: z.ZodString;
        /**
         * Arguments to use for templating the prompt.
         */
        arguments: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
    }>, z.ZodTypeAny, "passthrough">>;
}>, "strip", z.ZodTypeAny, {
    params: {
        name: string;
        _meta?: z.objectOutputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough"> | undefined;
        arguments?: Record<string, string> | undefined;
    } & {
        [k: string]: unknown;
    };
    method: "prompts/get";
}, {
    params: {
        name: string;
        _meta?: z.objectInputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough"> | undefined;
        arguments?: Record<string, string> | undefined;
    } & {
        [k: string]: unknown;
    };
    method: "prompts/get";
}>, z.ZodObject<z.objectUtil.extendShape<z.objectUtil.extendShape<{
    method: z.ZodString;
    params: z.ZodOptional<z.ZodObject<{
        _meta: z.ZodOptional<z.ZodObject<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough">>>;
    }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
        _meta: z.ZodOptional<z.ZodObject<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough">>>;
    }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
        _meta: z.ZodOptional<z.ZodObject<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough">>>;
    }, z.ZodTypeAny, "passthrough">>>;
}, {
    params: z.ZodObject<z.objectUtil.extendShape<{
        _meta: z.ZodOptional<z.ZodObject<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough">>>;
    }, {
        /**
         * An opaque token representing the current pagination position.
         * If provided, the server should return results starting after this cursor.
         */
        cursor: z.ZodOptional<z.ZodString>;
    }>, "passthrough", z.ZodTypeAny, z.objectOutputType<z.objectUtil.extendShape<{
        _meta: z.ZodOptional<z.ZodObject<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough">>>;
    }, {
        /**
         * An opaque token representing the current pagination position.
         * If provided, the server should return results starting after this cursor.
         */
        cursor: z.ZodOptional<z.ZodString>;
    }>, z.ZodTypeAny, "passthrough">, z.objectInputType<z.objectUtil.extendShape<{
        _meta: z.ZodOptional<z.ZodObject<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough">>>;
    }, {
        /**
         * An opaque token representing the current pagination position.
         * If provided, the server should return results starting after this cursor.
         */
        cursor: z.ZodOptional<z.ZodString>;
    }>, z.ZodTypeAny, "passthrough">>;
}>, {
    method: z.ZodLiteral<"prompts/list">;
}>, "strip", z.ZodTypeAny, {
    params: {
        _meta?: z.objectOutputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough"> | undefined;
        cursor?: string | undefined;
    } & {
        [k: string]: unknown;
    };
    method: "prompts/list";
}, {
    params: {
        _meta?: z.objectInputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough"> | undefined;
        cursor?: string | undefined;
    } & {
        [k: string]: unknown;
    };
    method: "prompts/list";
}>, z.ZodObject<z.objectUtil.extendShape<z.objectUtil.extendShape<{
    method: z.ZodString;
    params: z.ZodOptional<z.ZodObject<{
        _meta: z.ZodOptional<z.ZodObject<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough">>>;
    }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
        _meta: z.ZodOptional<z.ZodObject<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough">>>;
    }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
        _meta: z.ZodOptional<z.ZodObject<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough">>>;
    }, z.ZodTypeAny, "passthrough">>>;
}, {
    params: z.ZodObject<z.objectUtil.extendShape<{
        _meta: z.ZodOptional<z.ZodObject<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough">>>;
    }, {
        /**
         * An opaque token representing the current pagination position.
         * If provided, the server should return results starting after this cursor.
         */
        cursor: z.ZodOptional<z.ZodString>;
    }>, "passthrough", z.ZodTypeAny, z.objectOutputType<z.objectUtil.extendShape<{
        _meta: z.ZodOptional<z.ZodObject<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough">>>;
    }, {
        /**
         * An opaque token representing the current pagination position.
         * If provided, the server should return results starting after this cursor.
         */
        cursor: z.ZodOptional<z.ZodString>;
    }>, z.ZodTypeAny, "passthrough">, z.objectInputType<z.objectUtil.extendShape<{
        _meta: z.ZodOptional<z.ZodObject<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough">>>;
    }, {
        /**
         * An opaque token representing the current pagination position.
         * If provided, the server should return results starting after this cursor.
         */
        cursor: z.ZodOptional<z.ZodString>;
    }>, z.ZodTypeAny, "passthrough">>;
}>, {
    method: z.ZodLiteral<"resources/list">;
}>, "strip", z.ZodTypeAny, {
    params: {
        _meta?: z.objectOutputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough"> | undefined;
        cursor?: string | undefined;
    } & {
        [k: string]: unknown;
    };
    method: "resources/list";
}, {
    params: {
        _meta?: z.objectInputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough"> | undefined;
        cursor?: string | undefined;
    } & {
        [k: string]: unknown;
    };
    method: "resources/list";
}>, z.ZodObject<z.objectUtil.extendShape<{
    method: z.ZodString;
    params: z.ZodOptional<z.ZodObject<{
        _meta: z.ZodOptional<z.ZodObject<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough">>>;
    }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
        _meta: z.ZodOptional<z.ZodObject<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough">>>;
    }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
        _meta: z.ZodOptional<z.ZodObject<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough">>>;
    }, z.ZodTypeAny, "passthrough">>>;
}, {
    method: z.ZodLiteral<"resources/read">;
    params: z.ZodObject<z.objectUtil.extendShape<{
        _meta: z.ZodOptional<z.ZodObject<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough">>>;
    }, {
        /**
         * The URI of the resource to read. The URI can use any protocol; it is up to the server how to interpret it.
         */
        uri: z.ZodEffects<z.ZodString, URL, string>;
    }>, "passthrough", z.ZodTypeAny, z.objectOutputType<z.objectUtil.extendShape<{
        _meta: z.ZodOptional<z.ZodObject<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough">>>;
    }, {
        /**
         * The URI of the resource to read. The URI can use any protocol; it is up to the server how to interpret it.
         */
        uri: z.ZodEffects<z.ZodString, URL, string>;
    }>, z.ZodTypeAny, "passthrough">, z.objectInputType<z.objectUtil.extendShape<{
        _meta: z.ZodOptional<z.ZodObject<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough">>>;
    }, {
        /**
         * The URI of the resource to read. The URI can use any protocol; it is up to the server how to interpret it.
         */
        uri: z.ZodEffects<z.ZodString, URL, string>;
    }>, z.ZodTypeAny, "passthrough">>;
}>, "strip", z.ZodTypeAny, {
    params: {
        uri: URL;
        _meta?: z.objectOutputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough"> | undefined;
    } & {
        [k: string]: unknown;
    };
    method: "resources/read";
}, {
    params: {
        uri: string;
        _meta?: z.objectInputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough"> | undefined;
    } & {
        [k: string]: unknown;
    };
    method: "resources/read";
}>, z.ZodObject<z.objectUtil.extendShape<{
    method: z.ZodString;
    params: z.ZodOptional<z.ZodObject<{
        _meta: z.ZodOptional<z.ZodObject<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough">>>;
    }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
        _meta: z.ZodOptional<z.ZodObject<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough">>>;
    }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
        _meta: z.ZodOptional<z.ZodObject<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough">>>;
    }, z.ZodTypeAny, "passthrough">>>;
}, {
    method: z.ZodLiteral<"resources/subscribe">;
    params: z.ZodObject<z.objectUtil.extendShape<{
        _meta: z.ZodOptional<z.ZodObject<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough">>>;
    }, {
        /**
         * The URI of the resource to subscribe to. The URI can use any protocol; it is up to the server how to interpret it.
         */
        uri: z.ZodEffects<z.ZodString, URL, string>;
    }>, "passthrough", z.ZodTypeAny, z.objectOutputType<z.objectUtil.extendShape<{
        _meta: z.ZodOptional<z.ZodObject<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough">>>;
    }, {
        /**
         * The URI of the resource to subscribe to. The URI can use any protocol; it is up to the server how to interpret it.
         */
        uri: z.ZodEffects<z.ZodString, URL, string>;
    }>, z.ZodTypeAny, "passthrough">, z.objectInputType<z.objectUtil.extendShape<{
        _meta: z.ZodOptional<z.ZodObject<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough">>>;
    }, {
        /**
         * The URI of the resource to subscribe to. The URI can use any protocol; it is up to the server how to interpret it.
         */
        uri: z.ZodEffects<z.ZodString, URL, string>;
    }>, z.ZodTypeAny, "passthrough">>;
}>, "strip", z.ZodTypeAny, {
    params: {
        uri: URL;
        _meta?: z.objectOutputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough"> | undefined;
    } & {
        [k: string]: unknown;
    };
    method: "resources/subscribe";
}, {
    params: {
        uri: string;
        _meta?: z.objectInputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough"> | undefined;
    } & {
        [k: string]: unknown;
    };
    method: "resources/subscribe";
}>, z.ZodObject<z.objectUtil.extendShape<{
    method: z.ZodString;
    params: z.ZodOptional<z.ZodObject<{
        _meta: z.ZodOptional<z.ZodObject<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough">>>;
    }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
        _meta: z.ZodOptional<z.ZodObject<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough">>>;
    }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
        _meta: z.ZodOptional<z.ZodObject<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough">>>;
    }, z.ZodTypeAny, "passthrough">>>;
}, {
    method: z.ZodLiteral<"resources/unsubscribe">;
    params: z.ZodObject<z.objectUtil.extendShape<{
        _meta: z.ZodOptional<z.ZodObject<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough">>>;
    }, {
        /**
         * The URI of the resource to unsubscribe from.
         */
        uri: z.ZodEffects<z.ZodString, URL, string>;
    }>, "passthrough", z.ZodTypeAny, z.objectOutputType<z.objectUtil.extendShape<{
        _meta: z.ZodOptional<z.ZodObject<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough">>>;
    }, {
        /**
         * The URI of the resource to unsubscribe from.
         */
        uri: z.ZodEffects<z.ZodString, URL, string>;
    }>, z.ZodTypeAny, "passthrough">, z.objectInputType<z.objectUtil.extendShape<{
        _meta: z.ZodOptional<z.ZodObject<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough">>>;
    }, {
        /**
         * The URI of the resource to unsubscribe from.
         */
        uri: z.ZodEffects<z.ZodString, URL, string>;
    }>, z.ZodTypeAny, "passthrough">>;
}>, "strip", z.ZodTypeAny, {
    params: {
        uri: URL;
        _meta?: z.objectOutputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough"> | undefined;
    } & {
        [k: string]: unknown;
    };
    method: "resources/unsubscribe";
}, {
    params: {
        uri: string;
        _meta?: z.objectInputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough"> | undefined;
    } & {
        [k: string]: unknown;
    };
    method: "resources/unsubscribe";
}>, z.ZodObject<z.objectUtil.extendShape<{
    method: z.ZodString;
    params: z.ZodOptional<z.ZodObject<{
        _meta: z.ZodOptional<z.ZodObject<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough">>>;
    }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
        _meta: z.ZodOptional<z.ZodObject<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough">>>;
    }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
        _meta: z.ZodOptional<z.ZodObject<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough">>>;
    }, z.ZodTypeAny, "passthrough">>>;
}, {
    method: z.ZodLiteral<"tools/call">;
    params: z.ZodObject<z.objectUtil.extendShape<{
        _meta: z.ZodOptional<z.ZodObject<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough">>>;
    }, {
        name: z.ZodString;
        arguments: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
    }>, "passthrough", z.ZodTypeAny, z.objectOutputType<z.objectUtil.extendShape<{
        _meta: z.ZodOptional<z.ZodObject<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough">>>;
    }, {
        name: z.ZodString;
        arguments: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
    }>, z.ZodTypeAny, "passthrough">, z.objectInputType<z.objectUtil.extendShape<{
        _meta: z.ZodOptional<z.ZodObject<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough">>>;
    }, {
        name: z.ZodString;
        arguments: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
    }>, z.ZodTypeAny, "passthrough">>;
}>, "strip", z.ZodTypeAny, {
    params: {
        name: string;
        _meta?: z.objectOutputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough"> | undefined;
        arguments?: Record<string, unknown> | undefined;
    } & {
        [k: string]: unknown;
    };
    method: "tools/call";
}, {
    params: {
        name: string;
        _meta?: z.objectInputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough"> | undefined;
        arguments?: Record<string, unknown> | undefined;
    } & {
        [k: string]: unknown;
    };
    method: "tools/call";
}>, z.ZodObject<z.objectUtil.extendShape<z.objectUtil.extendShape<{
    method: z.ZodString;
    params: z.ZodOptional<z.ZodObject<{
        _meta: z.ZodOptional<z.ZodObject<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough">>>;
    }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
        _meta: z.ZodOptional<z.ZodObject<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough">>>;
    }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
        _meta: z.ZodOptional<z.ZodObject<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough">>>;
    }, z.ZodTypeAny, "passthrough">>>;
}, {
    params: z.ZodObject<z.objectUtil.extendShape<{
        _meta: z.ZodOptional<z.ZodObject<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough">>>;
    }, {
        /**
         * An opaque token representing the current pagination position.
         * If provided, the server should return results starting after this cursor.
         */
        cursor: z.ZodOptional<z.ZodString>;
    }>, "passthrough", z.ZodTypeAny, z.objectOutputType<z.objectUtil.extendShape<{
        _meta: z.ZodOptional<z.ZodObject<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough">>>;
    }, {
        /**
         * An opaque token representing the current pagination position.
         * If provided, the server should return results starting after this cursor.
         */
        cursor: z.ZodOptional<z.ZodString>;
    }>, z.ZodTypeAny, "passthrough">, z.objectInputType<z.objectUtil.extendShape<{
        _meta: z.ZodOptional<z.ZodObject<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough">>>;
    }, {
        /**
         * An opaque token representing the current pagination position.
         * If provided, the server should return results starting after this cursor.
         */
        cursor: z.ZodOptional<z.ZodString>;
    }>, z.ZodTypeAny, "passthrough">>;
}>, {
    method: z.ZodLiteral<"tools/list">;
}>, "strip", z.ZodTypeAny, {
    params: {
        _meta?: z.objectOutputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough"> | undefined;
        cursor?: string | undefined;
    } & {
        [k: string]: unknown;
    };
    method: "tools/list";
}, {
    params: {
        _meta?: z.objectInputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough"> | undefined;
        cursor?: string | undefined;
    } & {
        [k: string]: unknown;
    };
    method: "tools/list";
}>]>;
export declare const ClientNotificationSchema: z.ZodUnion<[z.ZodObject<z.objectUtil.extendShape<{
    method: z.ZodString;
    params: z.ZodOptional<z.ZodObject<{
        /**
         * This parameter name is reserved by MCP to allow clients and servers to attach additional metadata to their notifications.
         */
        _meta: z.ZodOptional<z.ZodObject<{}, "passthrough", z.ZodTypeAny, z.objectOutputType<{}, z.ZodTypeAny, "passthrough">, z.objectInputType<{}, z.ZodTypeAny, "passthrough">>>;
    }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
        /**
         * This parameter name is reserved by MCP to allow clients and servers to attach additional metadata to their notifications.
         */
        _meta: z.ZodOptional<z.ZodObject<{}, "passthrough", z.ZodTypeAny, z.objectOutputType<{}, z.ZodTypeAny, "passthrough">, z.objectInputType<{}, z.ZodTypeAny, "passthrough">>>;
    }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
        /**
         * This parameter name is reserved by MCP to allow clients and servers to attach additional metadata to their notifications.
         */
        _meta: z.ZodOptional<z.ZodObject<{}, "passthrough", z.ZodTypeAny, z.objectOutputType<{}, z.ZodTypeAny, "passthrough">, z.objectInputType<{}, z.ZodTypeAny, "passthrough">>>;
    }, z.ZodTypeAny, "passthrough">>>;
}, {
    method: z.ZodLiteral<"notifications/progress">;
    params: z.ZodObject<z.objectUtil.extendShape<{
        /**
         * The progress thus far. This should increase every time progress is made, even if the total is unknown.
         */
        progress: z.ZodNumber;
        /**
         * Total number of items to process (or total progress required), if known.
         */
        total: z.ZodOptional<z.ZodNumber>;
    }, {
        /**
         * The progress token which was given in the initial request, used to associate this notification with the request that is proceeding.
         */
        progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
    }>, "strip", z.ZodTypeAny, {
        progress: number;
        progressToken?: string | number | undefined;
        total?: number | undefined;
    }, {
        progress: number;
        progressToken?: string | number | undefined;
        total?: number | undefined;
    }>;
}>, "strip", z.ZodTypeAny, {
    params: {
        progress: number;
        progressToken?: string | number | undefined;
        total?: number | undefined;
    };
    method: "notifications/progress";
}, {
    params: {
        progress: number;
        progressToken?: string | number | undefined;
        total?: number | undefined;
    };
    method: "notifications/progress";
}>, z.ZodObject<z.objectUtil.extendShape<{
    method: z.ZodString;
    params: z.ZodOptional<z.ZodObject<{
        /**
         * This parameter name is reserved by MCP to allow clients and servers to attach additional metadata to their notifications.
         */
        _meta: z.ZodOptional<z.ZodObject<{}, "passthrough", z.ZodTypeAny, z.objectOutputType<{}, z.ZodTypeAny, "passthrough">, z.objectInputType<{}, z.ZodTypeAny, "passthrough">>>;
    }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
        /**
         * This parameter name is reserved by MCP to allow clients and servers to attach additional metadata to their notifications.
         */
        _meta: z.ZodOptional<z.ZodObject<{}, "passthrough", z.ZodTypeAny, z.objectOutputType<{}, z.ZodTypeAny, "passthrough">, z.objectInputType<{}, z.ZodTypeAny, "passthrough">>>;
    }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
        /**
         * This parameter name is reserved by MCP to allow clients and servers to attach additional metadata to their notifications.
         */
        _meta: z.ZodOptional<z.ZodObject<{}, "passthrough", z.ZodTypeAny, z.objectOutputType<{}, z.ZodTypeAny, "passthrough">, z.objectInputType<{}, z.ZodTypeAny, "passthrough">>>;
    }, z.ZodTypeAny, "passthrough">>>;
}, {
    method: z.ZodLiteral<"notifications/initialized">;
}>, "strip", z.ZodTypeAny, {
    method: "notifications/initialized";
    params?: z.objectOutputType<{
        /**
         * This parameter name is reserved by MCP to allow clients and servers to attach additional metadata to their notifications.
         */
        _meta: z.ZodOptional<z.ZodObject<{}, "passthrough", z.ZodTypeAny, z.objectOutputType<{}, z.ZodTypeAny, "passthrough">, z.objectInputType<{}, z.ZodTypeAny, "passthrough">>>;
    }, z.ZodTypeAny, "passthrough"> | undefined;
}, {
    method: "notifications/initialized";
    params?: z.objectInputType<{
        /**
         * This parameter name is reserved by MCP to allow clients and servers to attach additional metadata to their notifications.
         */
        _meta: z.ZodOptional<z.ZodObject<{}, "passthrough", z.ZodTypeAny, z.objectOutputType<{}, z.ZodTypeAny, "passthrough">, z.objectInputType<{}, z.ZodTypeAny, "passthrough">>>;
    }, z.ZodTypeAny, "passthrough"> | undefined;
}>]>;
export declare const ClientResultSchema: z.ZodUnion<[z.ZodObject<{
    /**
     * This result property is reserved by the protocol to allow clients and servers to attach additional metadata to their responses.
     */
    _meta: z.ZodOptional<z.ZodObject<{}, "passthrough", z.ZodTypeAny, z.objectOutputType<{}, z.ZodTypeAny, "passthrough">, z.objectInputType<{}, z.ZodTypeAny, "passthrough">>>;
}, "strict", z.ZodTypeAny, {
    _meta?: z.objectOutputType<{}, z.ZodTypeAny, "passthrough"> | undefined;
}, {
    _meta?: z.objectInputType<{}, z.ZodTypeAny, "passthrough"> | undefined;
}>, z.ZodObject<z.objectUtil.extendShape<{
    /**
     * This result property is reserved by the protocol to allow clients and servers to attach additional metadata to their responses.
     */
    _meta: z.ZodOptional<z.ZodObject<{}, "passthrough", z.ZodTypeAny, z.objectOutputType<{}, z.ZodTypeAny, "passthrough">, z.objectInputType<{}, z.ZodTypeAny, "passthrough">>>;
}, {
    /**
     * The name of the model that generated the message.
     */
    model: z.ZodString;
    /**
     * The reason why sampling stopped.
     */
    stopReason: z.ZodEnum<["endTurn", "stopSequence", "maxTokens"]>;
    role: z.ZodEnum<["user", "assistant"]>;
    content: z.ZodDiscriminatedUnion<"type", [z.ZodObject<{
        type: z.ZodLiteral<"text">;
        /**
         * The text content of the message.
         */
        text: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        type: "text";
        text: string;
    }, {
        type: "text";
        text: string;
    }>, z.ZodObject<{
        type: z.ZodLiteral<"image">;
        /**
         * The base64-encoded image data.
         */
        data: z.ZodString;
        /**
         * The MIME type of the image. Different providers may support different image types.
         */
        mimeType: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        type: "image";
        data: string;
        mimeType: string;
    }, {
        type: "image";
        data: string;
        mimeType: string;
    }>]>;
}>, "passthrough", z.ZodTypeAny, z.objectOutputType<z.objectUtil.extendShape<{
    /**
     * This result property is reserved by the protocol to allow clients and servers to attach additional metadata to their responses.
     */
    _meta: z.ZodOptional<z.ZodObject<{}, "passthrough", z.ZodTypeAny, z.objectOutputType<{}, z.ZodTypeAny, "passthrough">, z.objectInputType<{}, z.ZodTypeAny, "passthrough">>>;
}, {
    /**
     * The name of the model that generated the message.
     */
    model: z.ZodString;
    /**
     * The reason why sampling stopped.
     */
    stopReason: z.ZodEnum<["endTurn", "stopSequence", "maxTokens"]>;
    role: z.ZodEnum<["user", "assistant"]>;
    content: z.ZodDiscriminatedUnion<"type", [z.ZodObject<{
        type: z.ZodLiteral<"text">;
        /**
         * The text content of the message.
         */
        text: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        type: "text";
        text: string;
    }, {
        type: "text";
        text: string;
    }>, z.ZodObject<{
        type: z.ZodLiteral<"image">;
        /**
         * The base64-encoded image data.
         */
        data: z.ZodString;
        /**
         * The MIME type of the image. Different providers may support different image types.
         */
        mimeType: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        type: "image";
        data: string;
        mimeType: string;
    }, {
        type: "image";
        data: string;
        mimeType: string;
    }>]>;
}>, z.ZodTypeAny, "passthrough">, z.objectInputType<z.objectUtil.extendShape<{
    /**
     * This result property is reserved by the protocol to allow clients and servers to attach additional metadata to their responses.
     */
    _meta: z.ZodOptional<z.ZodObject<{}, "passthrough", z.ZodTypeAny, z.objectOutputType<{}, z.ZodTypeAny, "passthrough">, z.objectInputType<{}, z.ZodTypeAny, "passthrough">>>;
}, {
    /**
     * The name of the model that generated the message.
     */
    model: z.ZodString;
    /**
     * The reason why sampling stopped.
     */
    stopReason: z.ZodEnum<["endTurn", "stopSequence", "maxTokens"]>;
    role: z.ZodEnum<["user", "assistant"]>;
    content: z.ZodDiscriminatedUnion<"type", [z.ZodObject<{
        type: z.ZodLiteral<"text">;
        /**
         * The text content of the message.
         */
        text: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        type: "text";
        text: string;
    }, {
        type: "text";
        text: string;
    }>, z.ZodObject<{
        type: z.ZodLiteral<"image">;
        /**
         * The base64-encoded image data.
         */
        data: z.ZodString;
        /**
         * The MIME type of the image. Different providers may support different image types.
         */
        mimeType: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        type: "image";
        data: string;
        mimeType: string;
    }, {
        type: "image";
        data: string;
        mimeType: string;
    }>]>;
}>, z.ZodTypeAny, "passthrough">>]>;
export declare const ServerRequestSchema: z.ZodUnion<[z.ZodObject<z.objectUtil.extendShape<{
    method: z.ZodString;
    params: z.ZodOptional<z.ZodObject<{
        _meta: z.ZodOptional<z.ZodObject<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough">>>;
    }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
        _meta: z.ZodOptional<z.ZodObject<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough">>>;
    }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
        _meta: z.ZodOptional<z.ZodObject<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough">>>;
    }, z.ZodTypeAny, "passthrough">>>;
}, {
    method: z.ZodLiteral<"ping">;
}>, "strip", z.ZodTypeAny, {
    method: "ping";
    params?: z.objectOutputType<{
        _meta: z.ZodOptional<z.ZodObject<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough">>>;
    }, z.ZodTypeAny, "passthrough"> | undefined;
}, {
    method: "ping";
    params?: z.objectInputType<{
        _meta: z.ZodOptional<z.ZodObject<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough">>>;
    }, z.ZodTypeAny, "passthrough"> | undefined;
}>, z.ZodObject<z.objectUtil.extendShape<{
    method: z.ZodString;
    params: z.ZodOptional<z.ZodObject<{
        _meta: z.ZodOptional<z.ZodObject<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough">>>;
    }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
        _meta: z.ZodOptional<z.ZodObject<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough">>>;
    }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
        _meta: z.ZodOptional<z.ZodObject<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough">>>;
    }, z.ZodTypeAny, "passthrough">>>;
}, {
    method: z.ZodLiteral<"sampling/createMessage">;
    params: z.ZodObject<z.objectUtil.extendShape<{
        _meta: z.ZodOptional<z.ZodObject<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough">>>;
    }, {
        messages: z.ZodArray<z.ZodObject<{
            role: z.ZodEnum<["user", "assistant"]>;
            content: z.ZodUnion<[z.ZodObject<{
                type: z.ZodLiteral<"text">;
                /**
                 * The text content of the message.
                 */
                text: z.ZodString;
            }, "strip", z.ZodTypeAny, {
                type: "text";
                text: string;
            }, {
                type: "text";
                text: string;
            }>, z.ZodObject<{
                type: z.ZodLiteral<"image">;
                /**
                 * The base64-encoded image data.
                 */
                data: z.ZodString;
                /**
                 * The MIME type of the image. Different providers may support different image types.
                 */
                mimeType: z.ZodString;
            }, "strip", z.ZodTypeAny, {
                type: "image";
                data: string;
                mimeType: string;
            }, {
                type: "image";
                data: string;
                mimeType: string;
            }>]>;
        }, "strip", z.ZodTypeAny, {
            role: "user" | "assistant";
            content: {
                type: "text";
                text: string;
            } | {
                type: "image";
                data: string;
                mimeType: string;
            };
        }, {
            role: "user" | "assistant";
            content: {
                type: "text";
                text: string;
            } | {
                type: "image";
                data: string;
                mimeType: string;
            };
        }>, "many">;
        /**
         * An optional system prompt the server wants to use for sampling. The client MAY modify or omit this prompt.
         */
        systemPrompt: z.ZodOptional<z.ZodString>;
        /**
         * A request to include context from one or more MCP servers (including the caller), to be attached to the prompt. The client MAY ignore this request.
         */
        includeContext: z.ZodOptional<z.ZodEnum<["none", "thisServer", "allServers"]>>;
        temperature: z.ZodOptional<z.ZodNumber>;
        /**
         * The maximum number of tokens to sample, as requested by the server. The client MAY choose to sample fewer tokens than requested.
         */
        maxTokens: z.ZodNumber;
        stopSequences: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
        /**
         * Optional metadata to pass through to the LLM provider. The format of this metadata is provider-specific.
         */
        metadata: z.ZodOptional<z.ZodObject<{}, "passthrough", z.ZodTypeAny, z.objectOutputType<{}, z.ZodTypeAny, "passthrough">, z.objectInputType<{}, z.ZodTypeAny, "passthrough">>>;
    }>, "passthrough", z.ZodTypeAny, z.objectOutputType<z.objectUtil.extendShape<{
        _meta: z.ZodOptional<z.ZodObject<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough">>>;
    }, {
        messages: z.ZodArray<z.ZodObject<{
            role: z.ZodEnum<["user", "assistant"]>;
            content: z.ZodUnion<[z.ZodObject<{
                type: z.ZodLiteral<"text">;
                /**
                 * The text content of the message.
                 */
                text: z.ZodString;
            }, "strip", z.ZodTypeAny, {
                type: "text";
                text: string;
            }, {
                type: "text";
                text: string;
            }>, z.ZodObject<{
                type: z.ZodLiteral<"image">;
                /**
                 * The base64-encoded image data.
                 */
                data: z.ZodString;
                /**
                 * The MIME type of the image. Different providers may support different image types.
                 */
                mimeType: z.ZodString;
            }, "strip", z.ZodTypeAny, {
                type: "image";
                data: string;
                mimeType: string;
            }, {
                type: "image";
                data: string;
                mimeType: string;
            }>]>;
        }, "strip", z.ZodTypeAny, {
            role: "user" | "assistant";
            content: {
                type: "text";
                text: string;
            } | {
                type: "image";
                data: string;
                mimeType: string;
            };
        }, {
            role: "user" | "assistant";
            content: {
                type: "text";
                text: string;
            } | {
                type: "image";
                data: string;
                mimeType: string;
            };
        }>, "many">;
        /**
         * An optional system prompt the server wants to use for sampling. The client MAY modify or omit this prompt.
         */
        systemPrompt: z.ZodOptional<z.ZodString>;
        /**
         * A request to include context from one or more MCP servers (including the caller), to be attached to the prompt. The client MAY ignore this request.
         */
        includeContext: z.ZodOptional<z.ZodEnum<["none", "thisServer", "allServers"]>>;
        temperature: z.ZodOptional<z.ZodNumber>;
        /**
         * The maximum number of tokens to sample, as requested by the server. The client MAY choose to sample fewer tokens than requested.
         */
        maxTokens: z.ZodNumber;
        stopSequences: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
        /**
         * Optional metadata to pass through to the LLM provider. The format of this metadata is provider-specific.
         */
        metadata: z.ZodOptional<z.ZodObject<{}, "passthrough", z.ZodTypeAny, z.objectOutputType<{}, z.ZodTypeAny, "passthrough">, z.objectInputType<{}, z.ZodTypeAny, "passthrough">>>;
    }>, z.ZodTypeAny, "passthrough">, z.objectInputType<z.objectUtil.extendShape<{
        _meta: z.ZodOptional<z.ZodObject<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough">>>;
    }, {
        messages: z.ZodArray<z.ZodObject<{
            role: z.ZodEnum<["user", "assistant"]>;
            content: z.ZodUnion<[z.ZodObject<{
                type: z.ZodLiteral<"text">;
                /**
                 * The text content of the message.
                 */
                text: z.ZodString;
            }, "strip", z.ZodTypeAny, {
                type: "text";
                text: string;
            }, {
                type: "text";
                text: string;
            }>, z.ZodObject<{
                type: z.ZodLiteral<"image">;
                /**
                 * The base64-encoded image data.
                 */
                data: z.ZodString;
                /**
                 * The MIME type of the image. Different providers may support different image types.
                 */
                mimeType: z.ZodString;
            }, "strip", z.ZodTypeAny, {
                type: "image";
                data: string;
                mimeType: string;
            }, {
                type: "image";
                data: string;
                mimeType: string;
            }>]>;
        }, "strip", z.ZodTypeAny, {
            role: "user" | "assistant";
            content: {
                type: "text";
                text: string;
            } | {
                type: "image";
                data: string;
                mimeType: string;
            };
        }, {
            role: "user" | "assistant";
            content: {
                type: "text";
                text: string;
            } | {
                type: "image";
                data: string;
                mimeType: string;
            };
        }>, "many">;
        /**
         * An optional system prompt the server wants to use for sampling. The client MAY modify or omit this prompt.
         */
        systemPrompt: z.ZodOptional<z.ZodString>;
        /**
         * A request to include context from one or more MCP servers (including the caller), to be attached to the prompt. The client MAY ignore this request.
         */
        includeContext: z.ZodOptional<z.ZodEnum<["none", "thisServer", "allServers"]>>;
        temperature: z.ZodOptional<z.ZodNumber>;
        /**
         * The maximum number of tokens to sample, as requested by the server. The client MAY choose to sample fewer tokens than requested.
         */
        maxTokens: z.ZodNumber;
        stopSequences: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
        /**
         * Optional metadata to pass through to the LLM provider. The format of this metadata is provider-specific.
         */
        metadata: z.ZodOptional<z.ZodObject<{}, "passthrough", z.ZodTypeAny, z.objectOutputType<{}, z.ZodTypeAny, "passthrough">, z.objectInputType<{}, z.ZodTypeAny, "passthrough">>>;
    }>, z.ZodTypeAny, "passthrough">>;
}>, "strip", z.ZodTypeAny, {
    params: {
        messages: {
            role: "user" | "assistant";
            content: {
                type: "text";
                text: string;
            } | {
                type: "image";
                data: string;
                mimeType: string;
            };
        }[];
        maxTokens: number;
        _meta?: z.objectOutputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough"> | undefined;
        systemPrompt?: string | undefined;
        includeContext?: "none" | "thisServer" | "allServers" | undefined;
        temperature?: number | undefined;
        stopSequences?: string[] | undefined;
        metadata?: z.objectOutputType<{}, z.ZodTypeAny, "passthrough"> | undefined;
    } & {
        [k: string]: unknown;
    };
    method: "sampling/createMessage";
}, {
    params: {
        messages: {
            role: "user" | "assistant";
            content: {
                type: "text";
                text: string;
            } | {
                type: "image";
                data: string;
                mimeType: string;
            };
        }[];
        maxTokens: number;
        _meta?: z.objectInputType<{
            /**
             * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
             */
            progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
        }, z.ZodTypeAny, "passthrough"> | undefined;
        systemPrompt?: string | undefined;
        includeContext?: "none" | "thisServer" | "allServers" | undefined;
        temperature?: number | undefined;
        stopSequences?: string[] | undefined;
        metadata?: z.objectInputType<{}, z.ZodTypeAny, "passthrough"> | undefined;
    } & {
        [k: string]: unknown;
    };
    method: "sampling/createMessage";
}>]>;
export declare const ServerNotificationSchema: z.ZodUnion<[z.ZodObject<z.objectUtil.extendShape<{
    method: z.ZodString;
    params: z.ZodOptional<z.ZodObject<{
        /**
         * This parameter name is reserved by MCP to allow clients and servers to attach additional metadata to their notifications.
         */
        _meta: z.ZodOptional<z.ZodObject<{}, "passthrough", z.ZodTypeAny, z.objectOutputType<{}, z.ZodTypeAny, "passthrough">, z.objectInputType<{}, z.ZodTypeAny, "passthrough">>>;
    }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
        /**
         * This parameter name is reserved by MCP to allow clients and servers to attach additional metadata to their notifications.
         */
        _meta: z.ZodOptional<z.ZodObject<{}, "passthrough", z.ZodTypeAny, z.objectOutputType<{}, z.ZodTypeAny, "passthrough">, z.objectInputType<{}, z.ZodTypeAny, "passthrough">>>;
    }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
        /**
         * This parameter name is reserved by MCP to allow clients and servers to attach additional metadata to their notifications.
         */
        _meta: z.ZodOptional<z.ZodObject<{}, "passthrough", z.ZodTypeAny, z.objectOutputType<{}, z.ZodTypeAny, "passthrough">, z.objectInputType<{}, z.ZodTypeAny, "passthrough">>>;
    }, z.ZodTypeAny, "passthrough">>>;
}, {
    method: z.ZodLiteral<"notifications/progress">;
    params: z.ZodObject<z.objectUtil.extendShape<{
        /**
         * The progress thus far. This should increase every time progress is made, even if the total is unknown.
         */
        progress: z.ZodNumber;
        /**
         * Total number of items to process (or total progress required), if known.
         */
        total: z.ZodOptional<z.ZodNumber>;
    }, {
        /**
         * The progress token which was given in the initial request, used to associate this notification with the request that is proceeding.
         */
        progressToken: z.ZodOptional<z.ZodUnion<[z.ZodString, z.ZodNumber]>>;
    }>, "strip", z.ZodTypeAny, {
        progress: number;
        progressToken?: string | number | undefined;
        total?: number | undefined;
    }, {
        progress: number;
        progressToken?: string | number | undefined;
        total?: number | undefined;
    }>;
}>, "strip", z.ZodTypeAny, {
    params: {
        progress: number;
        progressToken?: string | number | undefined;
        total?: number | undefined;
    };
    method: "notifications/progress";
}, {
    params: {
        progress: number;
        progressToken?: string | number | undefined;
        total?: number | undefined;
    };
    method: "notifications/progress";
}>, z.ZodObject<z.objectUtil.extendShape<{
    method: z.ZodString;
    params: z.ZodOptional<z.ZodObject<{
        /**
         * This parameter name is reserved by MCP to allow clients and servers to attach additional metadata to their notifications.
         */
        _meta: z.ZodOptional<z.ZodObject<{}, "passthrough", z.ZodTypeAny, z.objectOutputType<{}, z.ZodTypeAny, "passthrough">, z.objectInputType<{}, z.ZodTypeAny, "passthrough">>>;
    }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
        /**
         * This parameter name is reserved by MCP to allow clients and servers to attach additional metadata to their notifications.
         */
        _meta: z.ZodOptional<z.ZodObject<{}, "passthrough", z.ZodTypeAny, z.objectOutputType<{}, z.ZodTypeAny, "passthrough">, z.objectInputType<{}, z.ZodTypeAny, "passthrough">>>;
    }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
        /**
         * This parameter name is reserved by MCP to allow clients and servers to attach additional metadata to their notifications.
         */
        _meta: z.ZodOptional<z.ZodObject<{}, "passthrough", z.ZodTypeAny, z.objectOutputType<{}, z.ZodTypeAny, "passthrough">, z.objectInputType<{}, z.ZodTypeAny, "passthrough">>>;
    }, z.ZodTypeAny, "passthrough">>>;
}, {
    method: z.ZodLiteral<"notifications/message">;
    params: z.ZodObject<{
        /**
         * The severity of this log message.
         */
        level: z.ZodEnum<["debug", "info", "warning", "error"]>;
        /**
         * An optional name of the logger issuing this message.
         */
        logger: z.ZodOptional<z.ZodString>;
        /**
         * The data to be logged, such as a string message or an object. Any JSON serializable type is allowed here.
         */
        data: z.ZodUnknown;
    }, "strip", z.ZodTypeAny, {
        level: "error" | "debug" | "info" | "warning";
        data?: unknown;
        logger?: string | undefined;
    }, {
        level: "error" | "debug" | "info" | "warning";
        data?: unknown;
        logger?: string | undefined;
    }>;
}>, "strip", z.ZodTypeAny, {
    params: {
        level: "error" | "debug" | "info" | "warning";
        data?: unknown;
        logger?: string | undefined;
    };
    method: "notifications/message";
}, {
    params: {
        level: "error" | "debug" | "info" | "warning";
        data?: unknown;
        logger?: string | undefined;
    };
    method: "notifications/message";
}>, z.ZodObject<z.objectUtil.extendShape<{
    method: z.ZodString;
    params: z.ZodOptional<z.ZodObject<{
        /**
         * This parameter name is reserved by MCP to allow clients and servers to attach additional metadata to their notifications.
         */
        _meta: z.ZodOptional<z.ZodObject<{}, "passthrough", z.ZodTypeAny, z.objectOutputType<{}, z.ZodTypeAny, "passthrough">, z.objectInputType<{}, z.ZodTypeAny, "passthrough">>>;
    }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
        /**
         * This parameter name is reserved by MCP to allow clients and servers to attach additional metadata to their notifications.
         */
        _meta: z.ZodOptional<z.ZodObject<{}, "passthrough", z.ZodTypeAny, z.objectOutputType<{}, z.ZodTypeAny, "passthrough">, z.objectInputType<{}, z.ZodTypeAny, "passthrough">>>;
    }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
        /**
         * This parameter name is reserved by MCP to allow clients and servers to attach additional metadata to their notifications.
         */
        _meta: z.ZodOptional<z.ZodObject<{}, "passthrough", z.ZodTypeAny, z.objectOutputType<{}, z.ZodTypeAny, "passthrough">, z.objectInputType<{}, z.ZodTypeAny, "passthrough">>>;
    }, z.ZodTypeAny, "passthrough">>>;
}, {
    method: z.ZodLiteral<"notifications/resources/updated">;
    params: z.ZodObject<{
        /**
         * The URI of the resource that has been updated. This might be a sub-resource of the one that the client actually subscribed to.
         */
        uri: z.ZodEffects<z.ZodString, URL, string>;
    }, "strip", z.ZodTypeAny, {
        uri: URL;
    }, {
        uri: string;
    }>;
}>, "strip", z.ZodTypeAny, {
    params: {
        uri: URL;
    };
    method: "notifications/resources/updated";
}, {
    params: {
        uri: string;
    };
    method: "notifications/resources/updated";
}>, z.ZodObject<z.objectUtil.extendShape<{
    method: z.ZodString;
    params: z.ZodOptional<z.ZodObject<{
        /**
         * This parameter name is reserved by MCP to allow clients and servers to attach additional metadata to their notifications.
         */
        _meta: z.ZodOptional<z.ZodObject<{}, "passthrough", z.ZodTypeAny, z.objectOutputType<{}, z.ZodTypeAny, "passthrough">, z.objectInputType<{}, z.ZodTypeAny, "passthrough">>>;
    }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
        /**
         * This parameter name is reserved by MCP to allow clients and servers to attach additional metadata to their notifications.
         */
        _meta: z.ZodOptional<z.ZodObject<{}, "passthrough", z.ZodTypeAny, z.objectOutputType<{}, z.ZodTypeAny, "passthrough">, z.objectInputType<{}, z.ZodTypeAny, "passthrough">>>;
    }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
        /**
         * This parameter name is reserved by MCP to allow clients and servers to attach additional metadata to their notifications.
         */
        _meta: z.ZodOptional<z.ZodObject<{}, "passthrough", z.ZodTypeAny, z.objectOutputType<{}, z.ZodTypeAny, "passthrough">, z.objectInputType<{}, z.ZodTypeAny, "passthrough">>>;
    }, z.ZodTypeAny, "passthrough">>>;
}, {
    method: z.ZodLiteral<"notifications/resources/list_changed">;
}>, "strip", z.ZodTypeAny, {
    method: "notifications/resources/list_changed";
    params?: z.objectOutputType<{
        /**
         * This parameter name is reserved by MCP to allow clients and servers to attach additional metadata to their notifications.
         */
        _meta: z.ZodOptional<z.ZodObject<{}, "passthrough", z.ZodTypeAny, z.objectOutputType<{}, z.ZodTypeAny, "passthrough">, z.objectInputType<{}, z.ZodTypeAny, "passthrough">>>;
    }, z.ZodTypeAny, "passthrough"> | undefined;
}, {
    method: "notifications/resources/list_changed";
    params?: z.objectInputType<{
        /**
         * This parameter name is reserved by MCP to allow clients and servers to attach additional metadata to their notifications.
         */
        _meta: z.ZodOptional<z.ZodObject<{}, "passthrough", z.ZodTypeAny, z.objectOutputType<{}, z.ZodTypeAny, "passthrough">, z.objectInputType<{}, z.ZodTypeAny, "passthrough">>>;
    }, z.ZodTypeAny, "passthrough"> | undefined;
}>, z.ZodObject<z.objectUtil.extendShape<{
    method: z.ZodString;
    params: z.ZodOptional<z.ZodObject<{
        /**
         * This parameter name is reserved by MCP to allow clients and servers to attach additional metadata to their notifications.
         */
        _meta: z.ZodOptional<z.ZodObject<{}, "passthrough", z.ZodTypeAny, z.objectOutputType<{}, z.ZodTypeAny, "passthrough">, z.objectInputType<{}, z.ZodTypeAny, "passthrough">>>;
    }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
        /**
         * This parameter name is reserved by MCP to allow clients and servers to attach additional metadata to their notifications.
         */
        _meta: z.ZodOptional<z.ZodObject<{}, "passthrough", z.ZodTypeAny, z.objectOutputType<{}, z.ZodTypeAny, "passthrough">, z.objectInputType<{}, z.ZodTypeAny, "passthrough">>>;
    }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
        /**
         * This parameter name is reserved by MCP to allow clients and servers to attach additional metadata to their notifications.
         */
        _meta: z.ZodOptional<z.ZodObject<{}, "passthrough", z.ZodTypeAny, z.objectOutputType<{}, z.ZodTypeAny, "passthrough">, z.objectInputType<{}, z.ZodTypeAny, "passthrough">>>;
    }, z.ZodTypeAny, "passthrough">>>;
}, {
    method: z.ZodLiteral<"notifications/tools/list_changed">;
}>, "strip", z.ZodTypeAny, {
    method: "notifications/tools/list_changed";
    params?: z.objectOutputType<{
        /**
         * This parameter name is reserved by MCP to allow clients and servers to attach additional metadata to their notifications.
         */
        _meta: z.ZodOptional<z.ZodObject<{}, "passthrough", z.ZodTypeAny, z.objectOutputType<{}, z.ZodTypeAny, "passthrough">, z.objectInputType<{}, z.ZodTypeAny, "passthrough">>>;
    }, z.ZodTypeAny, "passthrough"> | undefined;
}, {
    method: "notifications/tools/list_changed";
    params?: z.objectInputType<{
        /**
         * This parameter name is reserved by MCP to allow clients and servers to attach additional metadata to their notifications.
         */
        _meta: z.ZodOptional<z.ZodObject<{}, "passthrough", z.ZodTypeAny, z.objectOutputType<{}, z.ZodTypeAny, "passthrough">, z.objectInputType<{}, z.ZodTypeAny, "passthrough">>>;
    }, z.ZodTypeAny, "passthrough"> | undefined;
}>, z.ZodObject<z.objectUtil.extendShape<{
    method: z.ZodString;
    params: z.ZodOptional<z.ZodObject<{
        /**
         * This parameter name is reserved by MCP to allow clients and servers to attach additional metadata to their notifications.
         */
        _meta: z.ZodOptional<z.ZodObject<{}, "passthrough", z.ZodTypeAny, z.objectOutputType<{}, z.ZodTypeAny, "passthrough">, z.objectInputType<{}, z.ZodTypeAny, "passthrough">>>;
    }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
        /**
         * This parameter name is reserved by MCP to allow clients and servers to attach additional metadata to their notifications.
         */
        _meta: z.ZodOptional<z.ZodObject<{}, "passthrough", z.ZodTypeAny, z.objectOutputType<{}, z.ZodTypeAny, "passthrough">, z.objectInputType<{}, z.ZodTypeAny, "passthrough">>>;
    }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
        /**
         * This parameter name is reserved by MCP to allow clients and servers to attach additional metadata to their notifications.
         */
        _meta: z.ZodOptional<z.ZodObject<{}, "passthrough", z.ZodTypeAny, z.objectOutputType<{}, z.ZodTypeAny, "passthrough">, z.objectInputType<{}, z.ZodTypeAny, "passthrough">>>;
    }, z.ZodTypeAny, "passthrough">>>;
}, {
    method: z.ZodLiteral<"notifications/prompts/list_changed">;
}>, "strip", z.ZodTypeAny, {
    method: "notifications/prompts/list_changed";
    params?: z.objectOutputType<{
        /**
         * This parameter name is reserved by MCP to allow clients and servers to attach additional metadata to their notifications.
         */
        _meta: z.ZodOptional<z.ZodObject<{}, "passthrough", z.ZodTypeAny, z.objectOutputType<{}, z.ZodTypeAny, "passthrough">, z.objectInputType<{}, z.ZodTypeAny, "passthrough">>>;
    }, z.ZodTypeAny, "passthrough"> | undefined;
}, {
    method: "notifications/prompts/list_changed";
    params?: z.objectInputType<{
        /**
         * This parameter name is reserved by MCP to allow clients and servers to attach additional metadata to their notifications.
         */
        _meta: z.ZodOptional<z.ZodObject<{}, "passthrough", z.ZodTypeAny, z.objectOutputType<{}, z.ZodTypeAny, "passthrough">, z.objectInputType<{}, z.ZodTypeAny, "passthrough">>>;
    }, z.ZodTypeAny, "passthrough"> | undefined;
}>]>;
export declare const ServerResultSchema: z.ZodUnion<[z.ZodObject<{
    /**
     * This result property is reserved by the protocol to allow clients and servers to attach additional metadata to their responses.
     */
    _meta: z.ZodOptional<z.ZodObject<{}, "passthrough", z.ZodTypeAny, z.objectOutputType<{}, z.ZodTypeAny, "passthrough">, z.objectInputType<{}, z.ZodTypeAny, "passthrough">>>;
}, "strict", z.ZodTypeAny, {
    _meta?: z.objectOutputType<{}, z.ZodTypeAny, "passthrough"> | undefined;
}, {
    _meta?: z.objectInputType<{}, z.ZodTypeAny, "passthrough"> | undefined;
}>, z.ZodObject<z.objectUtil.extendShape<{
    /**
     * This result property is reserved by the protocol to allow clients and servers to attach additional metadata to their responses.
     */
    _meta: z.ZodOptional<z.ZodObject<{}, "passthrough", z.ZodTypeAny, z.objectOutputType<{}, z.ZodTypeAny, "passthrough">, z.objectInputType<{}, z.ZodTypeAny, "passthrough">>>;
}, {
    /**
     * The version of the Model Context Protocol that the server wants to use. This may not match the version that the client requested. If the client cannot support this version, it MUST disconnect.
     */
    protocolVersion: z.ZodUnion<[z.ZodString, z.ZodNumber]>;
    capabilities: z.ZodObject<{
        /**
         * Experimental, non-standard capabilities that the server supports.
         */
        experimental: z.ZodOptional<z.ZodObject<{}, "passthrough", z.ZodTypeAny, z.objectOutputType<{}, z.ZodTypeAny, "passthrough">, z.objectInputType<{}, z.ZodTypeAny, "passthrough">>>;
        /**
         * Present if the server supports sending log messages to the client.
         */
        logging: z.ZodOptional<z.ZodObject<{}, "passthrough", z.ZodTypeAny, z.objectOutputType<{}, z.ZodTypeAny, "passthrough">, z.objectInputType<{}, z.ZodTypeAny, "passthrough">>>;
        /**
         * Present if the server offers any prompt templates.
         */
        prompts: z.ZodOptional<z.ZodObject<{
            /**
             * Whether this server supports notifications for changes to the prompt list.
             */
            listChanged: z.ZodOptional<z.ZodBoolean>;
        }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
            /**
             * Whether this server supports notifications for changes to the prompt list.
             */
            listChanged: z.ZodOptional<z.ZodBoolean>;
        }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
            /**
             * Whether this server supports notifications for changes to the prompt list.
             */
            listChanged: z.ZodOptional<z.ZodBoolean>;
        }, z.ZodTypeAny, "passthrough">>>;
        /**
         * Present if the server offers any resources to read.
         */
        resources: z.ZodOptional<z.ZodObject<{
            /**
             * Whether this server supports subscribing to resource updates.
             */
            subscribe: z.ZodOptional<z.ZodBoolean>;
            /**
             * Whether this server supports notifications for changes to the resource list.
             */
            listChanged: z.ZodOptional<z.ZodBoolean>;
        }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
            /**
             * Whether this server supports subscribing to resource updates.
             */
            subscribe: z.ZodOptional<z.ZodBoolean>;
            /**
             * Whether this server supports notifications for changes to the resource list.
             */
            listChanged: z.ZodOptional<z.ZodBoolean>;
        }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
            /**
             * Whether this server supports subscribing to resource updates.
             */
            subscribe: z.ZodOptional<z.ZodBoolean>;
            /**
             * Whether this server supports notifications for changes to the resource list.
             */
            listChanged: z.ZodOptional<z.ZodBoolean>;
        }, z.ZodTypeAny, "passthrough">>>;
        /**
         * Present if the server offers any tools to call.
         */
        tools: z.ZodOptional<z.ZodObject<{
            /**
             * Whether this server supports notifications for changes to the tool list.
             */
            listChanged: z.ZodOptional<z.ZodBoolean>;
        }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
            /**
             * Whether this server supports notifications for changes to the tool list.
             */
            listChanged: z.ZodOptional<z.ZodBoolean>;
        }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
            /**
             * Whether this server supports notifications for changes to the tool list.
             */
            listChanged: z.ZodOptional<z.ZodBoolean>;
        }, z.ZodTypeAny, "passthrough">>>;
    }, "strip", z.ZodTypeAny, {
        experimental?: z.objectOutputType<{}, z.ZodTypeAny, "passthrough"> | undefined;
        logging?: z.objectOutputType<{}, z.ZodTypeAny, "passthrough"> | undefined;
        prompts?: z.objectOutputType<{
            /**
             * Whether this server supports notifications for changes to the prompt list.
             */
            listChanged: z.ZodOptional<z.ZodBoolean>;
        }, z.ZodTypeAny, "passthrough"> | undefined;
        resources?: z.objectOutputType<{
            /**
             * Whether this server supports subscribing to resource updates.
             */
            subscribe: z.ZodOptional<z.ZodBoolean>;
            /**
             * Whether this server supports notifications for changes to the resource list.
             */
            listChanged: z.ZodOptional<z.ZodBoolean>;
        }, z.ZodTypeAny, "passthrough"> | undefined;
        tools?: z.objectOutputType<{
            /**
             * Whether this server supports notifications for changes to the tool list.
             */
            listChanged: z.ZodOptional<z.ZodBoolean>;
        }, z.ZodTypeAny, "passthrough"> | undefined;
    }, {
        experimental?: z.objectInputType<{}, z.ZodTypeAny, "passthrough"> | undefined;
        logging?: z.objectInputType<{}, z.ZodTypeAny, "passthrough"> | undefined;
        prompts?: z.objectInputType<{
            /**
             * Whether this server supports notifications for changes to the prompt list.
             */
            listChanged: z.ZodOptional<z.ZodBoolean>;
        }, z.ZodTypeAny, "passthrough"> | undefined;
        resources?: z.objectInputType<{
            /**
             * Whether this server supports subscribing to resource updates.
             */
            subscribe: z.ZodOptional<z.ZodBoolean>;
            /**
             * Whether this server supports notifications for changes to the resource list.
             */
            listChanged: z.ZodOptional<z.ZodBoolean>;
        }, z.ZodTypeAny, "passthrough"> | undefined;
        tools?: z.objectInputType<{
            /**
             * Whether this server supports notifications for changes to the tool list.
             */
            listChanged: z.ZodOptional<z.ZodBoolean>;
        }, z.ZodTypeAny, "passthrough"> | undefined;
    }>;
    serverInfo: z.ZodObject<{
        name: z.ZodString;
        version: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        name: string;
        version: string;
    }, {
        name: string;
        version: string;
    }>;
}>, "passthrough", z.ZodTypeAny, z.objectOutputType<z.objectUtil.extendShape<{
    /**
     * This result property is reserved by the protocol to allow clients and servers to attach additional metadata to their responses.
     */
    _meta: z.ZodOptional<z.ZodObject<{}, "passthrough", z.ZodTypeAny, z.objectOutputType<{}, z.ZodTypeAny, "passthrough">, z.objectInputType<{}, z.ZodTypeAny, "passthrough">>>;
}, {
    /**
     * The version of the Model Context Protocol that the server wants to use. This may not match the version that the client requested. If the client cannot support this version, it MUST disconnect.
     */
    protocolVersion: z.ZodUnion<[z.ZodString, z.ZodNumber]>;
    capabilities: z.ZodObject<{
        /**
         * Experimental, non-standard capabilities that the server supports.
         */
        experimental: z.ZodOptional<z.ZodObject<{}, "passthrough", z.ZodTypeAny, z.objectOutputType<{}, z.ZodTypeAny, "passthrough">, z.objectInputType<{}, z.ZodTypeAny, "passthrough">>>;
        /**
         * Present if the server supports sending log messages to the client.
         */
        logging: z.ZodOptional<z.ZodObject<{}, "passthrough", z.ZodTypeAny, z.objectOutputType<{}, z.ZodTypeAny, "passthrough">, z.objectInputType<{}, z.ZodTypeAny, "passthrough">>>;
        /**
         * Present if the server offers any prompt templates.
         */
        prompts: z.ZodOptional<z.ZodObject<{
            /**
             * Whether this server supports notifications for changes to the prompt list.
             */
            listChanged: z.ZodOptional<z.ZodBoolean>;
        }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
            /**
             * Whether this server supports notifications for changes to the prompt list.
             */
            listChanged: z.ZodOptional<z.ZodBoolean>;
        }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
            /**
             * Whether this server supports notifications for changes to the prompt list.
             */
            listChanged: z.ZodOptional<z.ZodBoolean>;
        }, z.ZodTypeAny, "passthrough">>>;
        /**
         * Present if the server offers any resources to read.
         */
        resources: z.ZodOptional<z.ZodObject<{
            /**
             * Whether this server supports subscribing to resource updates.
             */
            subscribe: z.ZodOptional<z.ZodBoolean>;
            /**
             * Whether this server supports notifications for changes to the resource list.
             */
            listChanged: z.ZodOptional<z.ZodBoolean>;
        }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
            /**
             * Whether this server supports subscribing to resource updates.
             */
            subscribe: z.ZodOptional<z.ZodBoolean>;
            /**
             * Whether this server supports notifications for changes to the resource list.
             */
            listChanged: z.ZodOptional<z.ZodBoolean>;
        }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
            /**
             * Whether this server supports subscribing to resource updates.
             */
            subscribe: z.ZodOptional<z.ZodBoolean>;
            /**
             * Whether this server supports notifications for changes to the resource list.
             */
            listChanged: z.ZodOptional<z.ZodBoolean>;
        }, z.ZodTypeAny, "passthrough">>>;
        /**
         * Present if the server offers any tools to call.
         */
        tools: z.ZodOptional<z.ZodObject<{
            /**
             * Whether this server supports notifications for changes to the tool list.
             */
            listChanged: z.ZodOptional<z.ZodBoolean>;
        }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
            /**
             * Whether this server supports notifications for changes to the tool list.
             */
            listChanged: z.ZodOptional<z.ZodBoolean>;
        }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
            /**
             * Whether this server supports notifications for changes to the tool list.
             */
            listChanged: z.ZodOptional<z.ZodBoolean>;
        }, z.ZodTypeAny, "passthrough">>>;
    }, "strip", z.ZodTypeAny, {
        experimental?: z.objectOutputType<{}, z.ZodTypeAny, "passthrough"> | undefined;
        logging?: z.objectOutputType<{}, z.ZodTypeAny, "passthrough"> | undefined;
        prompts?: z.objectOutputType<{
            /**
             * Whether this server supports notifications for changes to the prompt list.
             */
            listChanged: z.ZodOptional<z.ZodBoolean>;
        }, z.ZodTypeAny, "passthrough"> | undefined;
        resources?: z.objectOutputType<{
            /**
             * Whether this server supports subscribing to resource updates.
             */
            subscribe: z.ZodOptional<z.ZodBoolean>;
            /**
             * Whether this server supports notifications for changes to the resource list.
             */
            listChanged: z.ZodOptional<z.ZodBoolean>;
        }, z.ZodTypeAny, "passthrough"> | undefined;
        tools?: z.objectOutputType<{
            /**
             * Whether this server supports notifications for changes to the tool list.
             */
            listChanged: z.ZodOptional<z.ZodBoolean>;
        }, z.ZodTypeAny, "passthrough"> | undefined;
    }, {
        experimental?: z.objectInputType<{}, z.ZodTypeAny, "passthrough"> | undefined;
        logging?: z.objectInputType<{}, z.ZodTypeAny, "passthrough"> | undefined;
        prompts?: z.objectInputType<{
            /**
             * Whether this server supports notifications for changes to the prompt list.
             */
            listChanged: z.ZodOptional<z.ZodBoolean>;
        }, z.ZodTypeAny, "passthrough"> | undefined;
        resources?: z.objectInputType<{
            /**
             * Whether this server supports subscribing to resource updates.
             */
            subscribe: z.ZodOptional<z.ZodBoolean>;
            /**
             * Whether this server supports notifications for changes to the resource list.
             */
            listChanged: z.ZodOptional<z.ZodBoolean>;
        }, z.ZodTypeAny, "passthrough"> | undefined;
        tools?: z.objectInputType<{
            /**
             * Whether this server supports notifications for changes to the tool list.
             */
            listChanged: z.ZodOptional<z.ZodBoolean>;
        }, z.ZodTypeAny, "passthrough"> | undefined;
    }>;
    serverInfo: z.ZodObject<{
        name: z.ZodString;
        version: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        name: string;
        version: string;
    }, {
        name: string;
        version: string;
    }>;
}>, z.ZodTypeAny, "passthrough">, z.objectInputType<z.objectUtil.extendShape<{
    /**
     * This result property is reserved by the protocol to allow clients and servers to attach additional metadata to their responses.
     */
    _meta: z.ZodOptional<z.ZodObject<{}, "passthrough", z.ZodTypeAny, z.objectOutputType<{}, z.ZodTypeAny, "passthrough">, z.objectInputType<{}, z.ZodTypeAny, "passthrough">>>;
}, {
    /**
     * The version of the Model Context Protocol that the server wants to use. This may not match the version that the client requested. If the client cannot support this version, it MUST disconnect.
     */
    protocolVersion: z.ZodUnion<[z.ZodString, z.ZodNumber]>;
    capabilities: z.ZodObject<{
        /**
         * Experimental, non-standard capabilities that the server supports.
         */
        experimental: z.ZodOptional<z.ZodObject<{}, "passthrough", z.ZodTypeAny, z.objectOutputType<{}, z.ZodTypeAny, "passthrough">, z.objectInputType<{}, z.ZodTypeAny, "passthrough">>>;
        /**
         * Present if the server supports sending log messages to the client.
         */
        logging: z.ZodOptional<z.ZodObject<{}, "passthrough", z.ZodTypeAny, z.objectOutputType<{}, z.ZodTypeAny, "passthrough">, z.objectInputType<{}, z.ZodTypeAny, "passthrough">>>;
        /**
         * Present if the server offers any prompt templates.
         */
        prompts: z.ZodOptional<z.ZodObject<{
            /**
             * Whether this server supports notifications for changes to the prompt list.
             */
            listChanged: z.ZodOptional<z.ZodBoolean>;
        }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
            /**
             * Whether this server supports notifications for changes to the prompt list.
             */
            listChanged: z.ZodOptional<z.ZodBoolean>;
        }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
            /**
             * Whether this server supports notifications for changes to the prompt list.
             */
            listChanged: z.ZodOptional<z.ZodBoolean>;
        }, z.ZodTypeAny, "passthrough">>>;
        /**
         * Present if the server offers any resources to read.
         */
        resources: z.ZodOptional<z.ZodObject<{
            /**
             * Whether this server supports subscribing to resource updates.
             */
            subscribe: z.ZodOptional<z.ZodBoolean>;
            /**
             * Whether this server supports notifications for changes to the resource list.
             */
            listChanged: z.ZodOptional<z.ZodBoolean>;
        }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
            /**
             * Whether this server supports subscribing to resource updates.
             */
            subscribe: z.ZodOptional<z.ZodBoolean>;
            /**
             * Whether this server supports notifications for changes to the resource list.
             */
            listChanged: z.ZodOptional<z.ZodBoolean>;
        }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
            /**
             * Whether this server supports subscribing to resource updates.
             */
            subscribe: z.ZodOptional<z.ZodBoolean>;
            /**
             * Whether this server supports notifications for changes to the resource list.
             */
            listChanged: z.ZodOptional<z.ZodBoolean>;
        }, z.ZodTypeAny, "passthrough">>>;
        /**
         * Present if the server offers any tools to call.
         */
        tools: z.ZodOptional<z.ZodObject<{
            /**
             * Whether this server supports notifications for changes to the tool list.
             */
            listChanged: z.ZodOptional<z.ZodBoolean>;
        }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
            /**
             * Whether this server supports notifications for changes to the tool list.
             */
            listChanged: z.ZodOptional<z.ZodBoolean>;
        }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
            /**
             * Whether this server supports notifications for changes to the tool list.
             */
            listChanged: z.ZodOptional<z.ZodBoolean>;
        }, z.ZodTypeAny, "passthrough">>>;
    }, "strip", z.ZodTypeAny, {
        experimental?: z.objectOutputType<{}, z.ZodTypeAny, "passthrough"> | undefined;
        logging?: z.objectOutputType<{}, z.ZodTypeAny, "passthrough"> | undefined;
        prompts?: z.objectOutputType<{
            /**
             * Whether this server supports notifications for changes to the prompt list.
             */
            listChanged: z.ZodOptional<z.ZodBoolean>;
        }, z.ZodTypeAny, "passthrough"> | undefined;
        resources?: z.objectOutputType<{
            /**
             * Whether this server supports subscribing to resource updates.
             */
            subscribe: z.ZodOptional<z.ZodBoolean>;
            /**
             * Whether this server supports notifications for changes to the resource list.
             */
            listChanged: z.ZodOptional<z.ZodBoolean>;
        }, z.ZodTypeAny, "passthrough"> | undefined;
        tools?: z.objectOutputType<{
            /**
             * Whether this server supports notifications for changes to the tool list.
             */
            listChanged: z.ZodOptional<z.ZodBoolean>;
        }, z.ZodTypeAny, "passthrough"> | undefined;
    }, {
        experimental?: z.objectInputType<{}, z.ZodTypeAny, "passthrough"> | undefined;
        logging?: z.objectInputType<{}, z.ZodTypeAny, "passthrough"> | undefined;
        prompts?: z.objectInputType<{
            /**
             * Whether this server supports notifications for changes to the prompt list.
             */
            listChanged: z.ZodOptional<z.ZodBoolean>;
        }, z.ZodTypeAny, "passthrough"> | undefined;
        resources?: z.objectInputType<{
            /**
             * Whether this server supports subscribing to resource updates.
             */
            subscribe: z.ZodOptional<z.ZodBoolean>;
            /**
             * Whether this server supports notifications for changes to the resource list.
             */
            listChanged: z.ZodOptional<z.ZodBoolean>;
        }, z.ZodTypeAny, "passthrough"> | undefined;
        tools?: z.objectInputType<{
            /**
             * Whether this server supports notifications for changes to the tool list.
             */
            listChanged: z.ZodOptional<z.ZodBoolean>;
        }, z.ZodTypeAny, "passthrough"> | undefined;
    }>;
    serverInfo: z.ZodObject<{
        name: z.ZodString;
        version: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        name: string;
        version: string;
    }, {
        name: string;
        version: string;
    }>;
}>, z.ZodTypeAny, "passthrough">>, z.ZodObject<z.objectUtil.extendShape<{
    /**
     * This result property is reserved by the protocol to allow clients and servers to attach additional metadata to their responses.
     */
    _meta: z.ZodOptional<z.ZodObject<{}, "passthrough", z.ZodTypeAny, z.objectOutputType<{}, z.ZodTypeAny, "passthrough">, z.objectInputType<{}, z.ZodTypeAny, "passthrough">>>;
}, {
    completion: z.ZodObject<{
        /**
         * An array of completion values. Must not exceed 100 items.
         */
        values: z.ZodArray<z.ZodString, "many">;
        /**
         * The total number of completion options available. This can exceed the number of values actually sent in the response.
         */
        total: z.ZodOptional<z.ZodNumber>;
        /**
         * Indicates whether there are additional completion options beyond those provided in the current response, even if the exact total is unknown.
         */
        hasMore: z.ZodOptional<z.ZodBoolean>;
    }, "strip", z.ZodTypeAny, {
        values: string[];
        total?: number | undefined;
        hasMore?: boolean | undefined;
    }, {
        values: string[];
        total?: number | undefined;
        hasMore?: boolean | undefined;
    }>;
}>, "passthrough", z.ZodTypeAny, z.objectOutputType<z.objectUtil.extendShape<{
    /**
     * This result property is reserved by the protocol to allow clients and servers to attach additional metadata to their responses.
     */
    _meta: z.ZodOptional<z.ZodObject<{}, "passthrough", z.ZodTypeAny, z.objectOutputType<{}, z.ZodTypeAny, "passthrough">, z.objectInputType<{}, z.ZodTypeAny, "passthrough">>>;
}, {
    completion: z.ZodObject<{
        /**
         * An array of completion values. Must not exceed 100 items.
         */
        values: z.ZodArray<z.ZodString, "many">;
        /**
         * The total number of completion options available. This can exceed the number of values actually sent in the response.
         */
        total: z.ZodOptional<z.ZodNumber>;
        /**
         * Indicates whether there are additional completion options beyond those provided in the current response, even if the exact total is unknown.
         */
        hasMore: z.ZodOptional<z.ZodBoolean>;
    }, "strip", z.ZodTypeAny, {
        values: string[];
        total?: number | undefined;
        hasMore?: boolean | undefined;
    }, {
        values: string[];
        total?: number | undefined;
        hasMore?: boolean | undefined;
    }>;
}>, z.ZodTypeAny, "passthrough">, z.objectInputType<z.objectUtil.extendShape<{
    /**
     * This result property is reserved by the protocol to allow clients and servers to attach additional metadata to their responses.
     */
    _meta: z.ZodOptional<z.ZodObject<{}, "passthrough", z.ZodTypeAny, z.objectOutputType<{}, z.ZodTypeAny, "passthrough">, z.objectInputType<{}, z.ZodTypeAny, "passthrough">>>;
}, {
    completion: z.ZodObject<{
        /**
         * An array of completion values. Must not exceed 100 items.
         */
        values: z.ZodArray<z.ZodString, "many">;
        /**
         * The total number of completion options available. This can exceed the number of values actually sent in the response.
         */
        total: z.ZodOptional<z.ZodNumber>;
        /**
         * Indicates whether there are additional completion options beyond those provided in the current response, even if the exact total is unknown.
         */
        hasMore: z.ZodOptional<z.ZodBoolean>;
    }, "strip", z.ZodTypeAny, {
        values: string[];
        total?: number | undefined;
        hasMore?: boolean | undefined;
    }, {
        values: string[];
        total?: number | undefined;
        hasMore?: boolean | undefined;
    }>;
}>, z.ZodTypeAny, "passthrough">>, z.ZodObject<z.objectUtil.extendShape<{
    /**
     * This result property is reserved by the protocol to allow clients and servers to attach additional metadata to their responses.
     */
    _meta: z.ZodOptional<z.ZodObject<{}, "passthrough", z.ZodTypeAny, z.objectOutputType<{}, z.ZodTypeAny, "passthrough">, z.objectInputType<{}, z.ZodTypeAny, "passthrough">>>;
}, {
    /**
     * An optional description for the prompt.
     */
    description: z.ZodOptional<z.ZodString>;
    messages: z.ZodArray<z.ZodObject<{
        role: z.ZodEnum<["user", "assistant"]>;
        content: z.ZodUnion<[z.ZodObject<{
            type: z.ZodLiteral<"text">;
            /**
             * The text content of the message.
             */
            text: z.ZodString;
        }, "strip", z.ZodTypeAny, {
            type: "text";
            text: string;
        }, {
            type: "text";
            text: string;
        }>, z.ZodObject<{
            type: z.ZodLiteral<"image">;
            /**
             * The base64-encoded image data.
             */
            data: z.ZodString;
            /**
             * The MIME type of the image. Different providers may support different image types.
             */
            mimeType: z.ZodString;
        }, "strip", z.ZodTypeAny, {
            type: "image";
            data: string;
            mimeType: string;
        }, {
            type: "image";
            data: string;
            mimeType: string;
        }>]>;
    }, "strip", z.ZodTypeAny, {
        role: "user" | "assistant";
        content: {
            type: "text";
            text: string;
        } | {
            type: "image";
            data: string;
            mimeType: string;
        };
    }, {
        role: "user" | "assistant";
        content: {
            type: "text";
            text: string;
        } | {
            type: "image";
            data: string;
            mimeType: string;
        };
    }>, "many">;
}>, "passthrough", z.ZodTypeAny, z.objectOutputType<z.objectUtil.extendShape<{
    /**
     * This result property is reserved by the protocol to allow clients and servers to attach additional metadata to their responses.
     */
    _meta: z.ZodOptional<z.ZodObject<{}, "passthrough", z.ZodTypeAny, z.objectOutputType<{}, z.ZodTypeAny, "passthrough">, z.objectInputType<{}, z.ZodTypeAny, "passthrough">>>;
}, {
    /**
     * An optional description for the prompt.
     */
    description: z.ZodOptional<z.ZodString>;
    messages: z.ZodArray<z.ZodObject<{
        role: z.ZodEnum<["user", "assistant"]>;
        content: z.ZodUnion<[z.ZodObject<{
            type: z.ZodLiteral<"text">;
            /**
             * The text content of the message.
             */
            text: z.ZodString;
        }, "strip", z.ZodTypeAny, {
            type: "text";
            text: string;
        }, {
            type: "text";
            text: string;
        }>, z.ZodObject<{
            type: z.ZodLiteral<"image">;
            /**
             * The base64-encoded image data.
             */
            data: z.ZodString;
            /**
             * The MIME type of the image. Different providers may support different image types.
             */
            mimeType: z.ZodString;
        }, "strip", z.ZodTypeAny, {
            type: "image";
            data: string;
            mimeType: string;
        }, {
            type: "image";
            data: string;
            mimeType: string;
        }>]>;
    }, "strip", z.ZodTypeAny, {
        role: "user" | "assistant";
        content: {
            type: "text";
            text: string;
        } | {
            type: "image";
            data: string;
            mimeType: string;
        };
    }, {
        role: "user" | "assistant";
        content: {
            type: "text";
            text: string;
        } | {
            type: "image";
            data: string;
            mimeType: string;
        };
    }>, "many">;
}>, z.ZodTypeAny, "passthrough">, z.objectInputType<z.objectUtil.extendShape<{
    /**
     * This result property is reserved by the protocol to allow clients and servers to attach additional metadata to their responses.
     */
    _meta: z.ZodOptional<z.ZodObject<{}, "passthrough", z.ZodTypeAny, z.objectOutputType<{}, z.ZodTypeAny, "passthrough">, z.objectInputType<{}, z.ZodTypeAny, "passthrough">>>;
}, {
    /**
     * An optional description for the prompt.
     */
    description: z.ZodOptional<z.ZodString>;
    messages: z.ZodArray<z.ZodObject<{
        role: z.ZodEnum<["user", "assistant"]>;
        content: z.ZodUnion<[z.ZodObject<{
            type: z.ZodLiteral<"text">;
            /**
             * The text content of the message.
             */
            text: z.ZodString;
        }, "strip", z.ZodTypeAny, {
            type: "text";
            text: string;
        }, {
            type: "text";
            text: string;
        }>, z.ZodObject<{
            type: z.ZodLiteral<"image">;
            /**
             * The base64-encoded image data.
             */
            data: z.ZodString;
            /**
             * The MIME type of the image. Different providers may support different image types.
             */
            mimeType: z.ZodString;
        }, "strip", z.ZodTypeAny, {
            type: "image";
            data: string;
            mimeType: string;
        }, {
            type: "image";
            data: string;
            mimeType: string;
        }>]>;
    }, "strip", z.ZodTypeAny, {
        role: "user" | "assistant";
        content: {
            type: "text";
            text: string;
        } | {
            type: "image";
            data: string;
            mimeType: string;
        };
    }, {
        role: "user" | "assistant";
        content: {
            type: "text";
            text: string;
        } | {
            type: "image";
            data: string;
            mimeType: string;
        };
    }>, "many">;
}>, z.ZodTypeAny, "passthrough">>, z.ZodObject<z.objectUtil.extendShape<z.objectUtil.extendShape<{
    /**
     * This result property is reserved by the protocol to allow clients and servers to attach additional metadata to their responses.
     */
    _meta: z.ZodOptional<z.ZodObject<{}, "passthrough", z.ZodTypeAny, z.objectOutputType<{}, z.ZodTypeAny, "passthrough">, z.objectInputType<{}, z.ZodTypeAny, "passthrough">>>;
}, {
    /**
     * An opaque token representing the pagination position after the last returned result.
     * If present, there may be more results available.
     */
    nextCursor: z.ZodOptional<z.ZodString>;
}>, {
    prompts: z.ZodArray<z.ZodObject<{
        /**
         * The name of the prompt or prompt template.
         */
        name: z.ZodString;
        /**
         * An optional description of what this prompt provides
         */
        description: z.ZodOptional<z.ZodString>;
        /**
         * A list of arguments to use for templating the prompt.
         */
        arguments: z.ZodOptional<z.ZodArray<z.ZodObject<{
            /**
             * The name of the argument.
             */
            name: z.ZodString;
            /**
             * A human-readable description of the argument.
             */
            description: z.ZodOptional<z.ZodString>;
            /**
             * Whether this argument must be provided.
             */
            required: z.ZodOptional<z.ZodBoolean>;
        }, "strip", z.ZodTypeAny, {
            name: string;
            description?: string | undefined;
            required?: boolean | undefined;
        }, {
            name: string;
            description?: string | undefined;
            required?: boolean | undefined;
        }>, "many">>;
    }, "strip", z.ZodTypeAny, {
        name: string;
        description?: string | undefined;
        arguments?: {
            name: string;
            description?: string | undefined;
            required?: boolean | undefined;
        }[] | undefined;
    }, {
        name: string;
        description?: string | undefined;
        arguments?: {
            name: string;
            description?: string | undefined;
            required?: boolean | undefined;
        }[] | undefined;
    }>, "many">;
}>, "passthrough", z.ZodTypeAny, z.objectOutputType<z.objectUtil.extendShape<z.objectUtil.extendShape<{
    /**
     * This result property is reserved by the protocol to allow clients and servers to attach additional metadata to their responses.
     */
    _meta: z.ZodOptional<z.ZodObject<{}, "passthrough", z.ZodTypeAny, z.objectOutputType<{}, z.ZodTypeAny, "passthrough">, z.objectInputType<{}, z.ZodTypeAny, "passthrough">>>;
}, {
    /**
     * An opaque token representing the pagination position after the last returned result.
     * If present, there may be more results available.
     */
    nextCursor: z.ZodOptional<z.ZodString>;
}>, {
    prompts: z.ZodArray<z.ZodObject<{
        /**
         * The name of the prompt or prompt template.
         */
        name: z.ZodString;
        /**
         * An optional description of what this prompt provides
         */
        description: z.ZodOptional<z.ZodString>;
        /**
         * A list of arguments to use for templating the prompt.
         */
        arguments: z.ZodOptional<z.ZodArray<z.ZodObject<{
            /**
             * The name of the argument.
             */
            name: z.ZodString;
            /**
             * A human-readable description of the argument.
             */
            description: z.ZodOptional<z.ZodString>;
            /**
             * Whether this argument must be provided.
             */
            required: z.ZodOptional<z.ZodBoolean>;
        }, "strip", z.ZodTypeAny, {
            name: string;
            description?: string | undefined;
            required?: boolean | undefined;
        }, {
            name: string;
            description?: string | undefined;
            required?: boolean | undefined;
        }>, "many">>;
    }, "strip", z.ZodTypeAny, {
        name: string;
        description?: string | undefined;
        arguments?: {
            name: string;
            description?: string | undefined;
            required?: boolean | undefined;
        }[] | undefined;
    }, {
        name: string;
        description?: string | undefined;
        arguments?: {
            name: string;
            description?: string | undefined;
            required?: boolean | undefined;
        }[] | undefined;
    }>, "many">;
}>, z.ZodTypeAny, "passthrough">, z.objectInputType<z.objectUtil.extendShape<z.objectUtil.extendShape<{
    /**
     * This result property is reserved by the protocol to allow clients and servers to attach additional metadata to their responses.
     */
    _meta: z.ZodOptional<z.ZodObject<{}, "passthrough", z.ZodTypeAny, z.objectOutputType<{}, z.ZodTypeAny, "passthrough">, z.objectInputType<{}, z.ZodTypeAny, "passthrough">>>;
}, {
    /**
     * An opaque token representing the pagination position after the last returned result.
     * If present, there may be more results available.
     */
    nextCursor: z.ZodOptional<z.ZodString>;
}>, {
    prompts: z.ZodArray<z.ZodObject<{
        /**
         * The name of the prompt or prompt template.
         */
        name: z.ZodString;
        /**
         * An optional description of what this prompt provides
         */
        description: z.ZodOptional<z.ZodString>;
        /**
         * A list of arguments to use for templating the prompt.
         */
        arguments: z.ZodOptional<z.ZodArray<z.ZodObject<{
            /**
             * The name of the argument.
             */
            name: z.ZodString;
            /**
             * A human-readable description of the argument.
             */
            description: z.ZodOptional<z.ZodString>;
            /**
             * Whether this argument must be provided.
             */
            required: z.ZodOptional<z.ZodBoolean>;
        }, "strip", z.ZodTypeAny, {
            name: string;
            description?: string | undefined;
            required?: boolean | undefined;
        }, {
            name: string;
            description?: string | undefined;
            required?: boolean | undefined;
        }>, "many">>;
    }, "strip", z.ZodTypeAny, {
        name: string;
        description?: string | undefined;
        arguments?: {
            name: string;
            description?: string | undefined;
            required?: boolean | undefined;
        }[] | undefined;
    }, {
        name: string;
        description?: string | undefined;
        arguments?: {
            name: string;
            description?: string | undefined;
            required?: boolean | undefined;
        }[] | undefined;
    }>, "many">;
}>, z.ZodTypeAny, "passthrough">>, z.ZodObject<z.objectUtil.extendShape<z.objectUtil.extendShape<{
    /**
     * This result property is reserved by the protocol to allow clients and servers to attach additional metadata to their responses.
     */
    _meta: z.ZodOptional<z.ZodObject<{}, "passthrough", z.ZodTypeAny, z.objectOutputType<{}, z.ZodTypeAny, "passthrough">, z.objectInputType<{}, z.ZodTypeAny, "passthrough">>>;
}, {
    /**
     * An opaque token representing the pagination position after the last returned result.
     * If present, there may be more results available.
     */
    nextCursor: z.ZodOptional<z.ZodString>;
}>, {
    resources: z.ZodArray<z.ZodObject<{
        /**
         * The URI of this resource.
         */
        uri: z.ZodEffects<z.ZodString, URL, string>;
        /**
         * A human-readable name for this resource.
         *
         * This can be used by clients to populate UI elements.
         */
        name: z.ZodString;
        /**
         * A description of what this resource represents.
         *
         * This can be used by clients to improve the LLM's understanding of available resources. It can be thought of like a "hint" to the model.
         */
        description: z.ZodOptional<z.ZodString>;
        /**
         * The MIME type of this resource, if known.
         */
        mimeType: z.ZodOptional<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        name: string;
        uri: URL;
        mimeType?: string | undefined;
        description?: string | undefined;
    }, {
        name: string;
        uri: string;
        mimeType?: string | undefined;
        description?: string | undefined;
    }>, "many">;
}>, "passthrough", z.ZodTypeAny, z.objectOutputType<z.objectUtil.extendShape<z.objectUtil.extendShape<{
    /**
     * This result property is reserved by the protocol to allow clients and servers to attach additional metadata to their responses.
     */
    _meta: z.ZodOptional<z.ZodObject<{}, "passthrough", z.ZodTypeAny, z.objectOutputType<{}, z.ZodTypeAny, "passthrough">, z.objectInputType<{}, z.ZodTypeAny, "passthrough">>>;
}, {
    /**
     * An opaque token representing the pagination position after the last returned result.
     * If present, there may be more results available.
     */
    nextCursor: z.ZodOptional<z.ZodString>;
}>, {
    resources: z.ZodArray<z.ZodObject<{
        /**
         * The URI of this resource.
         */
        uri: z.ZodEffects<z.ZodString, URL, string>;
        /**
         * A human-readable name for this resource.
         *
         * This can be used by clients to populate UI elements.
         */
        name: z.ZodString;
        /**
         * A description of what this resource represents.
         *
         * This can be used by clients to improve the LLM's understanding of available resources. It can be thought of like a "hint" to the model.
         */
        description: z.ZodOptional<z.ZodString>;
        /**
         * The MIME type of this resource, if known.
         */
        mimeType: z.ZodOptional<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        name: string;
        uri: URL;
        mimeType?: string | undefined;
        description?: string | undefined;
    }, {
        name: string;
        uri: string;
        mimeType?: string | undefined;
        description?: string | undefined;
    }>, "many">;
}>, z.ZodTypeAny, "passthrough">, z.objectInputType<z.objectUtil.extendShape<z.objectUtil.extendShape<{
    /**
     * This result property is reserved by the protocol to allow clients and servers to attach additional metadata to their responses.
     */
    _meta: z.ZodOptional<z.ZodObject<{}, "passthrough", z.ZodTypeAny, z.objectOutputType<{}, z.ZodTypeAny, "passthrough">, z.objectInputType<{}, z.ZodTypeAny, "passthrough">>>;
}, {
    /**
     * An opaque token representing the pagination position after the last returned result.
     * If present, there may be more results available.
     */
    nextCursor: z.ZodOptional<z.ZodString>;
}>, {
    resources: z.ZodArray<z.ZodObject<{
        /**
         * The URI of this resource.
         */
        uri: z.ZodEffects<z.ZodString, URL, string>;
        /**
         * A human-readable name for this resource.
         *
         * This can be used by clients to populate UI elements.
         */
        name: z.ZodString;
        /**
         * A description of what this resource represents.
         *
         * This can be used by clients to improve the LLM's understanding of available resources. It can be thought of like a "hint" to the model.
         */
        description: z.ZodOptional<z.ZodString>;
        /**
         * The MIME type of this resource, if known.
         */
        mimeType: z.ZodOptional<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        name: string;
        uri: URL;
        mimeType?: string | undefined;
        description?: string | undefined;
    }, {
        name: string;
        uri: string;
        mimeType?: string | undefined;
        description?: string | undefined;
    }>, "many">;
}>, z.ZodTypeAny, "passthrough">>, z.ZodObject<z.objectUtil.extendShape<{
    /**
     * This result property is reserved by the protocol to allow clients and servers to attach additional metadata to their responses.
     */
    _meta: z.ZodOptional<z.ZodObject<{}, "passthrough", z.ZodTypeAny, z.objectOutputType<{}, z.ZodTypeAny, "passthrough">, z.objectInputType<{}, z.ZodTypeAny, "passthrough">>>;
}, {
    contents: z.ZodArray<z.ZodUnion<[z.ZodObject<z.objectUtil.extendShape<{
        /**
         * The URI of this resource.
         */
        uri: z.ZodEffects<z.ZodString, URL, string>;
        /**
         * The MIME type of this resource, if known.
         */
        mimeType: z.ZodOptional<z.ZodString>;
    }, {
        /**
         * The text of the item. This must only be set if the item can actually be represented as text (not binary data).
         */
        text: z.ZodString;
    }>, "strip", z.ZodTypeAny, {
        text: string;
        uri: URL;
        mimeType?: string | undefined;
    }, {
        text: string;
        uri: string;
        mimeType?: string | undefined;
    }>, z.ZodObject<z.objectUtil.extendShape<{
        /**
         * The URI of this resource.
         */
        uri: z.ZodEffects<z.ZodString, URL, string>;
        /**
         * The MIME type of this resource, if known.
         */
        mimeType: z.ZodOptional<z.ZodString>;
    }, {
        /**
         * A base64-encoded string representing the binary data of the item.
         */
        blob: z.ZodString;
    }>, "strip", z.ZodTypeAny, {
        uri: URL;
        blob: string;
        mimeType?: string | undefined;
    }, {
        uri: string;
        blob: string;
        mimeType?: string | undefined;
    }>]>, "many">;
}>, "passthrough", z.ZodTypeAny, z.objectOutputType<z.objectUtil.extendShape<{
    /**
     * This result property is reserved by the protocol to allow clients and servers to attach additional metadata to their responses.
     */
    _meta: z.ZodOptional<z.ZodObject<{}, "passthrough", z.ZodTypeAny, z.objectOutputType<{}, z.ZodTypeAny, "passthrough">, z.objectInputType<{}, z.ZodTypeAny, "passthrough">>>;
}, {
    contents: z.ZodArray<z.ZodUnion<[z.ZodObject<z.objectUtil.extendShape<{
        /**
         * The URI of this resource.
         */
        uri: z.ZodEffects<z.ZodString, URL, string>;
        /**
         * The MIME type of this resource, if known.
         */
        mimeType: z.ZodOptional<z.ZodString>;
    }, {
        /**
         * The text of the item. This must only be set if the item can actually be represented as text (not binary data).
         */
        text: z.ZodString;
    }>, "strip", z.ZodTypeAny, {
        text: string;
        uri: URL;
        mimeType?: string | undefined;
    }, {
        text: string;
        uri: string;
        mimeType?: string | undefined;
    }>, z.ZodObject<z.objectUtil.extendShape<{
        /**
         * The URI of this resource.
         */
        uri: z.ZodEffects<z.ZodString, URL, string>;
        /**
         * The MIME type of this resource, if known.
         */
        mimeType: z.ZodOptional<z.ZodString>;
    }, {
        /**
         * A base64-encoded string representing the binary data of the item.
         */
        blob: z.ZodString;
    }>, "strip", z.ZodTypeAny, {
        uri: URL;
        blob: string;
        mimeType?: string | undefined;
    }, {
        uri: string;
        blob: string;
        mimeType?: string | undefined;
    }>]>, "many">;
}>, z.ZodTypeAny, "passthrough">, z.objectInputType<z.objectUtil.extendShape<{
    /**
     * This result property is reserved by the protocol to allow clients and servers to attach additional metadata to their responses.
     */
    _meta: z.ZodOptional<z.ZodObject<{}, "passthrough", z.ZodTypeAny, z.objectOutputType<{}, z.ZodTypeAny, "passthrough">, z.objectInputType<{}, z.ZodTypeAny, "passthrough">>>;
}, {
    contents: z.ZodArray<z.ZodUnion<[z.ZodObject<z.objectUtil.extendShape<{
        /**
         * The URI of this resource.
         */
        uri: z.ZodEffects<z.ZodString, URL, string>;
        /**
         * The MIME type of this resource, if known.
         */
        mimeType: z.ZodOptional<z.ZodString>;
    }, {
        /**
         * The text of the item. This must only be set if the item can actually be represented as text (not binary data).
         */
        text: z.ZodString;
    }>, "strip", z.ZodTypeAny, {
        text: string;
        uri: URL;
        mimeType?: string | undefined;
    }, {
        text: string;
        uri: string;
        mimeType?: string | undefined;
    }>, z.ZodObject<z.objectUtil.extendShape<{
        /**
         * The URI of this resource.
         */
        uri: z.ZodEffects<z.ZodString, URL, string>;
        /**
         * The MIME type of this resource, if known.
         */
        mimeType: z.ZodOptional<z.ZodString>;
    }, {
        /**
         * A base64-encoded string representing the binary data of the item.
         */
        blob: z.ZodString;
    }>, "strip", z.ZodTypeAny, {
        uri: URL;
        blob: string;
        mimeType?: string | undefined;
    }, {
        uri: string;
        blob: string;
        mimeType?: string | undefined;
    }>]>, "many">;
}>, z.ZodTypeAny, "passthrough">>, z.ZodObject<z.objectUtil.extendShape<{
    /**
     * This result property is reserved by the protocol to allow clients and servers to attach additional metadata to their responses.
     */
    _meta: z.ZodOptional<z.ZodObject<{}, "passthrough", z.ZodTypeAny, z.objectOutputType<{}, z.ZodTypeAny, "passthrough">, z.objectInputType<{}, z.ZodTypeAny, "passthrough">>>;
}, {
    toolResult: z.ZodUnknown;
}>, "passthrough", z.ZodTypeAny, z.objectOutputType<z.objectUtil.extendShape<{
    /**
     * This result property is reserved by the protocol to allow clients and servers to attach additional metadata to their responses.
     */
    _meta: z.ZodOptional<z.ZodObject<{}, "passthrough", z.ZodTypeAny, z.objectOutputType<{}, z.ZodTypeAny, "passthrough">, z.objectInputType<{}, z.ZodTypeAny, "passthrough">>>;
}, {
    toolResult: z.ZodUnknown;
}>, z.ZodTypeAny, "passthrough">, z.objectInputType<z.objectUtil.extendShape<{
    /**
     * This result property is reserved by the protocol to allow clients and servers to attach additional metadata to their responses.
     */
    _meta: z.ZodOptional<z.ZodObject<{}, "passthrough", z.ZodTypeAny, z.objectOutputType<{}, z.ZodTypeAny, "passthrough">, z.objectInputType<{}, z.ZodTypeAny, "passthrough">>>;
}, {
    toolResult: z.ZodUnknown;
}>, z.ZodTypeAny, "passthrough">>, z.ZodObject<z.objectUtil.extendShape<z.objectUtil.extendShape<{
    /**
     * This result property is reserved by the protocol to allow clients and servers to attach additional metadata to their responses.
     */
    _meta: z.ZodOptional<z.ZodObject<{}, "passthrough", z.ZodTypeAny, z.objectOutputType<{}, z.ZodTypeAny, "passthrough">, z.objectInputType<{}, z.ZodTypeAny, "passthrough">>>;
}, {
    /**
     * An opaque token representing the pagination position after the last returned result.
     * If present, there may be more results available.
     */
    nextCursor: z.ZodOptional<z.ZodString>;
}>, {
    tools: z.ZodArray<z.ZodObject<{
        /**
         * The name of the tool.
         */
        name: z.ZodString;
        /**
         * A human-readable description of the tool.
         */
        description: z.ZodOptional<z.ZodString>;
        /**
         * A JSON Schema object defining the expected parameters for the tool.
         */
        inputSchema: z.ZodObject<{
            type: z.ZodLiteral<"object">;
            properties: z.ZodOptional<z.ZodObject<{}, "passthrough", z.ZodTypeAny, z.objectOutputType<{}, z.ZodTypeAny, "passthrough">, z.objectInputType<{}, z.ZodTypeAny, "passthrough">>>;
        }, "strip", z.ZodTypeAny, {
            type: "object";
            properties?: z.objectOutputType<{}, z.ZodTypeAny, "passthrough"> | undefined;
        }, {
            type: "object";
            properties?: z.objectInputType<{}, z.ZodTypeAny, "passthrough"> | undefined;
        }>;
    }, "strip", z.ZodTypeAny, {
        name: string;
        inputSchema: {
            type: "object";
            properties?: z.objectOutputType<{}, z.ZodTypeAny, "passthrough"> | undefined;
        };
        description?: string | undefined;
    }, {
        name: string;
        inputSchema: {
            type: "object";
            properties?: z.objectInputType<{}, z.ZodTypeAny, "passthrough"> | undefined;
        };
        description?: string | undefined;
    }>, "many">;
}>, "passthrough", z.ZodTypeAny, z.objectOutputType<z.objectUtil.extendShape<z.objectUtil.extendShape<{
    /**
     * This result property is reserved by the protocol to allow clients and servers to attach additional metadata to their responses.
     */
    _meta: z.ZodOptional<z.ZodObject<{}, "passthrough", z.ZodTypeAny, z.objectOutputType<{}, z.ZodTypeAny, "passthrough">, z.objectInputType<{}, z.ZodTypeAny, "passthrough">>>;
}, {
    /**
     * An opaque token representing the pagination position after the last returned result.
     * If present, there may be more results available.
     */
    nextCursor: z.ZodOptional<z.ZodString>;
}>, {
    tools: z.ZodArray<z.ZodObject<{
        /**
         * The name of the tool.
         */
        name: z.ZodString;
        /**
         * A human-readable description of the tool.
         */
        description: z.ZodOptional<z.ZodString>;
        /**
         * A JSON Schema object defining the expected parameters for the tool.
         */
        inputSchema: z.ZodObject<{
            type: z.ZodLiteral<"object">;
            properties: z.ZodOptional<z.ZodObject<{}, "passthrough", z.ZodTypeAny, z.objectOutputType<{}, z.ZodTypeAny, "passthrough">, z.objectInputType<{}, z.ZodTypeAny, "passthrough">>>;
        }, "strip", z.ZodTypeAny, {
            type: "object";
            properties?: z.objectOutputType<{}, z.ZodTypeAny, "passthrough"> | undefined;
        }, {
            type: "object";
            properties?: z.objectInputType<{}, z.ZodTypeAny, "passthrough"> | undefined;
        }>;
    }, "strip", z.ZodTypeAny, {
        name: string;
        inputSchema: {
            type: "object";
            properties?: z.objectOutputType<{}, z.ZodTypeAny, "passthrough"> | undefined;
        };
        description?: string | undefined;
    }, {
        name: string;
        inputSchema: {
            type: "object";
            properties?: z.objectInputType<{}, z.ZodTypeAny, "passthrough"> | undefined;
        };
        description?: string | undefined;
    }>, "many">;
}>, z.ZodTypeAny, "passthrough">, z.objectInputType<z.objectUtil.extendShape<z.objectUtil.extendShape<{
    /**
     * This result property is reserved by the protocol to allow clients and servers to attach additional metadata to their responses.
     */
    _meta: z.ZodOptional<z.ZodObject<{}, "passthrough", z.ZodTypeAny, z.objectOutputType<{}, z.ZodTypeAny, "passthrough">, z.objectInputType<{}, z.ZodTypeAny, "passthrough">>>;
}, {
    /**
     * An opaque token representing the pagination position after the last returned result.
     * If present, there may be more results available.
     */
    nextCursor: z.ZodOptional<z.ZodString>;
}>, {
    tools: z.ZodArray<z.ZodObject<{
        /**
         * The name of the tool.
         */
        name: z.ZodString;
        /**
         * A human-readable description of the tool.
         */
        description: z.ZodOptional<z.ZodString>;
        /**
         * A JSON Schema object defining the expected parameters for the tool.
         */
        inputSchema: z.ZodObject<{
            type: z.ZodLiteral<"object">;
            properties: z.ZodOptional<z.ZodObject<{}, "passthrough", z.ZodTypeAny, z.objectOutputType<{}, z.ZodTypeAny, "passthrough">, z.objectInputType<{}, z.ZodTypeAny, "passthrough">>>;
        }, "strip", z.ZodTypeAny, {
            type: "object";
            properties?: z.objectOutputType<{}, z.ZodTypeAny, "passthrough"> | undefined;
        }, {
            type: "object";
            properties?: z.objectInputType<{}, z.ZodTypeAny, "passthrough"> | undefined;
        }>;
    }, "strip", z.ZodTypeAny, {
        name: string;
        inputSchema: {
            type: "object";
            properties?: z.objectOutputType<{}, z.ZodTypeAny, "passthrough"> | undefined;
        };
        description?: string | undefined;
    }, {
        name: string;
        inputSchema: {
            type: "object";
            properties?: z.objectInputType<{}, z.ZodTypeAny, "passthrough"> | undefined;
        };
        description?: string | undefined;
    }>, "many">;
}>, z.ZodTypeAny, "passthrough">>]>;
export declare class McpError extends Error {
    readonly code: number;
    readonly data?: unknown;
    constructor(code: number, message: string, data?: unknown);
}
export type ProgressToken = z.infer<typeof ProgressTokenSchema>;
export type Cursor = z.infer<typeof CursorSchema>;
export type Request = z.infer<typeof RequestSchema>;
export type Notification = z.infer<typeof NotificationSchema>;
export type Result = z.infer<typeof ResultSchema>;
export type RequestId = z.infer<typeof RequestIdSchema>;
export type JSONRPCRequest = z.infer<typeof JSONRPCRequestSchema>;
export type JSONRPCNotification = z.infer<typeof JSONRPCNotificationSchema>;
export type JSONRPCResponse = z.infer<typeof JSONRPCResponseSchema>;
export type JSONRPCError = z.infer<typeof JSONRPCErrorSchema>;
export type JSONRPCMessage = z.infer<typeof JSONRPCMessageSchema>;
export type EmptyResult = z.infer<typeof EmptyResultSchema>;
export type TextContent = z.infer<typeof TextContentSchema>;
export type ImageContent = z.infer<typeof ImageContentSchema>;
export type SamplingMessage = z.infer<typeof SamplingMessageSchema>;
export type Implementation = z.infer<typeof ImplementationSchema>;
export type ClientCapabilities = z.infer<typeof ClientCapabilitiesSchema>;
export type InitializeRequest = z.infer<typeof InitializeRequestSchema>;
export type ServerCapabilities = z.infer<typeof ServerCapabilitiesSchema>;
export type InitializeResult = z.infer<typeof InitializeResultSchema>;
export type InitializedNotification = z.infer<typeof InitializedNotificationSchema>;
export type PingRequest = z.infer<typeof PingRequestSchema>;
export type Progress = z.infer<typeof ProgressSchema>;
export type ProgressNotification = z.infer<typeof ProgressNotificationSchema>;
export type PaginatedRequest = z.infer<typeof PaginatedRequestSchema>;
export type PaginatedResult = z.infer<typeof PaginatedResultSchema>;
export type ResourceContents = z.infer<typeof ResourceContentsSchema>;
export type TextResourceContents = z.infer<typeof TextResourceContentsSchema>;
export type BlobResourceContents = z.infer<typeof BlobResourceContentsSchema>;
export type Resource = z.infer<typeof ResourceSchema>;
export type ResourceTemplate = z.infer<typeof ResourceTemplateSchema>;
export type ListResourcesRequest = z.infer<typeof ListResourcesRequestSchema>;
export type ListResourcesResult = z.infer<typeof ListResourcesResultSchema>;
export type ListResourceTemplatesRequest = z.infer<typeof ListResourceTemplatesRequestSchema>;
export type ListResourceTemplatesResult = z.infer<typeof ListResourceTemplatesResultSchema>;
export type ReadResourceRequest = z.infer<typeof ReadResourceRequestSchema>;
export type ReadResourceResult = z.infer<typeof ReadResourceResultSchema>;
export type ResourceListChangedNotification = z.infer<typeof ResourceListChangedNotificationSchema>;
export type SubscribeRequest = z.infer<typeof SubscribeRequestSchema>;
export type UnsubscribeRequest = z.infer<typeof UnsubscribeRequestSchema>;
export type ResourceUpdatedNotification = z.infer<typeof ResourceUpdatedNotificationSchema>;
export type PromptArgument = z.infer<typeof PromptArgumentSchema>;
export type Prompt = z.infer<typeof PromptSchema>;
export type ListPromptsRequest = z.infer<typeof ListPromptsRequestSchema>;
export type ListPromptsResult = z.infer<typeof ListPromptsResultSchema>;
export type GetPromptRequest = z.infer<typeof GetPromptRequestSchema>;
export type GetPromptResult = z.infer<typeof GetPromptResultSchema>;
export type PromptListChangedNotification = z.infer<typeof PromptListChangedNotificationSchema>;
export type Tool = z.infer<typeof ToolSchema>;
export type ListToolsRequest = z.infer<typeof ListToolsRequestSchema>;
export type ListToolsResult = z.infer<typeof ListToolsResultSchema>;
export type CallToolResult = z.infer<typeof CallToolResultSchema>;
export type CallToolRequest = z.infer<typeof CallToolRequestSchema>;
export type ToolListChangedNotification = z.infer<typeof ToolListChangedNotificationSchema>;
export type LoggingLevel = z.infer<typeof LoggingLevelSchema>;
export type SetLevelRequest = z.infer<typeof SetLevelRequestSchema>;
export type LoggingMessageNotification = z.infer<typeof LoggingMessageNotificationSchema>;
export type CreateMessageRequest = z.infer<typeof CreateMessageRequestSchema>;
export type CreateMessageResult = z.infer<typeof CreateMessageResultSchema>;
export type ResourceReference = z.infer<typeof ResourceReferenceSchema>;
export type PromptReference = z.infer<typeof PromptReferenceSchema>;
export type CompleteRequest = z.infer<typeof CompleteRequestSchema>;
export type CompleteResult = z.infer<typeof CompleteResultSchema>;
export type ClientRequest = z.infer<typeof ClientRequestSchema>;
export type ClientNotification = z.infer<typeof ClientNotificationSchema>;
export type ClientResult = z.infer<typeof ClientResultSchema>;
export type ServerRequest = z.infer<typeof ServerRequestSchema>;
export type ServerNotification = z.infer<typeof ServerNotificationSchema>;
export type ServerResult = z.infer<typeof ServerResultSchema>;
//# sourceMappingURL=types.d.ts.map