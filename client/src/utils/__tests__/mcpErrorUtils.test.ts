import { describe, expect, test } from "@jest/globals";
import { McpError } from "@modelcontextprotocol/sdk/types.js";
import {
  getMcpErrorInfo,
  parseUnsupportedProtocolVersionError,
} from "../mcpErrorUtils";

describe("mcpErrorUtils", () => {
  describe("parseUnsupportedProtocolVersionError", () => {
    test("parses supported protocol versions", () => {
      const details = parseUnsupportedProtocolVersionError(
        "MCP error -32602: Unsupported protocol version: 2025-11-25 - supported versions: 2025-06-18,2025-03-26,2024-11-05,2024-10-07",
      );

      expect(details).toEqual({
        supportedProtocolVersions: [
          "2025-06-18",
          "2025-03-26",
          "2024-11-05",
          "2024-10-07",
        ],
      });
    });

    test("returns null when no relevant fields are present", () => {
      expect(parseUnsupportedProtocolVersionError("Some other error")).toBe(
        null,
      );
    });
  });

  describe("getMcpErrorInfo", () => {
    test("extracts code/message/data from McpError", () => {
      const error = new McpError(-32602, "Unsupported protocol version", {
        foo: "bar",
      });

      expect(getMcpErrorInfo(error)).toEqual({
        code: -32602,
        message: "MCP error -32602: Unsupported protocol version",
        data: { foo: "bar" },
      });
    });

    test("extracts message from Error", () => {
      const error = new Error("Connection failed");
      expect(getMcpErrorInfo(error)).toBe(null);
    });

    test("extracts MCP error code from Error.message", () => {
      const error = new Error(
        "McpError: MCP error -32602: Unsupported protocol version",
      );
      expect(getMcpErrorInfo(error)).toEqual({
        code: -32602,
        message: "McpError: MCP error -32602: Unsupported protocol version",
      });
    });

    test("returns null for HTTP error-like objects", () => {
      expect(getMcpErrorInfo({ code: 401, message: "Unauthorized" })).toBe(
        null,
      );
      expect(getMcpErrorInfo({ code: 403, message: "Forbidden" })).toBe(null);
    });
  });
});
