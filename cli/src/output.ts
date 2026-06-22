export type ErrorCategory =
  | "transport"
  | "capability"
  | "protocol"
  | "application"
  | "validation";

export interface StructuredError {
  category: ErrorCategory;
  code: string;
  message: string;
}

export interface LogEntry {
  level: string;
  logger?: string;
  message: string;
  timestamp: string;
}

export interface StructuredOutput {
  structuredVersion: number;
  success: boolean;
  method: string;
  durationMs: number;
  result: Record<string, unknown> | null;
  error: StructuredError | null;
  logs: LogEntry[];
}

export class StructuredCliError extends Error {
  category: ErrorCategory;

  constructor(message: string, category: ErrorCategory) {
    super(message);
    this.category = category;
    this.name = "StructuredCliError";
  }
}

export function categorizeError(error: unknown): StructuredError {
  if (error instanceof StructuredCliError) {
    return {
      category: error.category,
      code: error.category.toUpperCase() + "_ERROR",
      message: error.message,
    };
  }

  const message =
    error instanceof Error ? error.message : String(error || "Unknown error");

  if (
    message.includes("Failed to connect") ||
    message.includes("ECONNREFUSED") ||
    message.includes("timed out") ||
    message.includes("Failed to create transport") ||
    message.includes("socket hang up") ||
    message.includes("ENOTFOUND")
  ) {
    return { category: "transport", code: "TRANSPORT_ERROR", message };
  }

  if (
    message.includes("does not support") ||
    message.includes("capability not supported")
  ) {
    return {
      category: "capability",
      code: "CAPABILITY_NOT_SUPPORTED",
      message,
    };
  }

  if (
    message.includes("JSON-RPC") ||
    message.includes("handshake") ||
    message.includes("protocol error")
  ) {
    return { category: "protocol", code: "PROTOCOL_ERROR", message };
  }

  if (
    message.includes("is required") ||
    message.includes("Invalid") ||
    message.includes("Unsupported method")
  ) {
    return { category: "validation", code: "VALIDATION_ERROR", message };
  }

  return { category: "application", code: "APPLICATION_ERROR", message };
}

export function formatStructuredOutput(output: StructuredOutput): string {
  return JSON.stringify(output, null, 2);
}
