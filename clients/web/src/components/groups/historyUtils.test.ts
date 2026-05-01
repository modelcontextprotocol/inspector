import { describe, it, expect } from "vitest";
import type { MessageEntry } from "@inspector/core/mcp/types.js";
import { extractMethod } from "./historyUtils";

describe("extractMethod", () => {
  it("returns the method name for a request entry", () => {
    const entry: MessageEntry = {
      id: "1",
      timestamp: new Date(),
      direction: "request",
      message: {
        jsonrpc: "2.0",
        id: 1,
        method: "tools/list",
      },
    };
    expect(extractMethod(entry)).toBe("tools/list");
  });

  it("returns the method name for a notification entry", () => {
    const entry: MessageEntry = {
      id: "2",
      timestamp: new Date(),
      direction: "notification",
      message: {
        jsonrpc: "2.0",
        method: "notifications/initialized",
      },
    };
    expect(extractMethod(entry)).toBe("notifications/initialized");
  });

  it("returns 'response' for a result-response entry without a method", () => {
    const entry: MessageEntry = {
      id: "3",
      timestamp: new Date(),
      direction: "response",
      message: {
        jsonrpc: "2.0",
        id: 1,
        result: { tools: [] },
      },
    };
    expect(extractMethod(entry)).toBe("response");
  });

  it("returns 'response' for an error-response entry without a method", () => {
    const entry: MessageEntry = {
      id: "4",
      timestamp: new Date(),
      direction: "response",
      message: {
        jsonrpc: "2.0",
        id: 1,
        error: { code: -32600, message: "Invalid Request" },
      },
    };
    expect(extractMethod(entry)).toBe("response");
  });
});
