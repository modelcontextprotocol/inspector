import { McpError } from "@modelcontextprotocol/sdk/types.js";

export const parseUnsupportedProtocolVersionError = (
  message: string,
): { supportedProtocolVersions: string[] } | null => {
  const supportedMatch = message.match(/supported versions:\s*([^\n]+)/i);
  const supportedProtocolVersions = supportedMatch
    ? supportedMatch[1]
        .split(/[,\s]+/)
        .map((value) => value.trim())
        .filter(Boolean)
    : undefined;

  if (!supportedProtocolVersions?.length) {
    return null;
  }

  return {
    supportedProtocolVersions,
  };
};

export interface McpErrorInfo {
  code?: number;
  message: string;
  data?: unknown;
}

export const getMcpErrorInfo = (error: unknown): McpErrorInfo | null => {
  if (error instanceof McpError) {
    return { code: error.code, message: error.message, data: error.data };
  }

  if (error instanceof Error) {
    const mcpCodeMatch = error.message.match(/\bMCP error\s+(-?\d+):/i);
    const code = mcpCodeMatch ? Number(mcpCodeMatch[1]) : undefined;
    if (!Number.isFinite(code)) {
      return null;
    }
    return { code, message: error.message };
  }

  if (error && typeof error === "object") {
    const maybeAny = error as Record<string, unknown>;
    const maybeCode = maybeAny["code"];
    const maybeMessage = maybeAny["message"];
    const maybeData = maybeAny["data"];

    if (
      typeof maybeMessage === "string" &&
      typeof maybeCode === "number" &&
      maybeCode < 0
    ) {
      return { code: maybeCode, message: maybeMessage, data: maybeData };
    }
  }

  return null;
};
