import type {
  JSONRPCRequest,
  JSONRPCNotification,
  JSONRPCResultResponse,
  JSONRPCErrorResponse,
  JSONRPCMessage,
} from "@modelcontextprotocol/sdk/types.js";

export type {
  JSONRPCRequest,
  JSONRPCNotification,
  JSONRPCResultResponse,
  JSONRPCErrorResponse,
  JSONRPCMessage,
};

export interface MessageEntry {
  id: string;
  timestamp: Date;
  direction: "request" | "response" | "notification";
  message:
    | JSONRPCRequest
    | JSONRPCNotification
    | JSONRPCResultResponse
    | JSONRPCErrorResponse;
  response?: JSONRPCResultResponse | JSONRPCErrorResponse;
  duration?: number; // Time between request and response in ms
}

export interface MessageHistory {
  [serverName: string]: MessageEntry[];
}
