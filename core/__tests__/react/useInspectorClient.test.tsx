/**
 * @vitest-environment jsdom
 */
import { describe, it, expect } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useInspectorClient } from "../../react/useInspectorClient.js";
import type { InspectorClient } from "../../mcp/inspectorClient.js";
import { InspectorClientEventTarget } from "../../mcp/inspectorClientEventTarget.js";
import type { ConnectionStatus } from "../../mcp/index.js";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";

/**
 * Mock InspectorClient that synchronously dispatches events when connect(),
 * disconnect(), or listTools() are called so state updates run inside act().
 */
class MockInspectorClient extends InspectorClientEventTarget {
  private status: ConnectionStatus = "disconnected";
  private tools: Tool[] = [];

  getStatus(): ConnectionStatus {
    return this.status;
  }
  getMessages() {
    return [];
  }
  getStderrLogs() {
    return [];
  }
  getFetchRequests() {
    return [];
  }
  getTools(): Tool[] {
    return [...this.tools];
  }
  getResources() {
    return [];
  }
  getResourceTemplates() {
    return [];
  }
  getPrompts() {
    return [];
  }
  getCapabilities() {
    return undefined;
  }
  getServerInfo() {
    return undefined;
  }
  getInstructions() {
    return undefined;
  }
  getAppRendererClient() {
    return null;
  }

  async connect(): Promise<void> {
    this.status = "connected";
    this.dispatchTypedEvent("statusChange", "connected");
  }

  async disconnect(): Promise<void> {
    this.status = "disconnected";
    this.dispatchTypedEvent("statusChange", "disconnected");
  }

  async listTools(): Promise<void> {
    this.tools = [
      { name: "mock_tool", inputSchema: { type: "object" as const } },
    ];
    this.dispatchTypedEvent("toolsChange", this.tools);
  }
}

describe("useInspectorClient", () => {
  it("returns disconnected state and no-op connect/disconnect when given null", async () => {
    const { result } = renderHook(() => useInspectorClient(null));

    expect(result.current.status).toBe("disconnected");
    expect(result.current.messages).toEqual([]);
    expect(result.current.tools).toEqual([]);
    expect(result.current.appRendererClient).toBeNull();

    await act(async () => {
      await result.current.connect();
    });
    expect(result.current.status).toBe("disconnected");

    await act(async () => {
      await result.current.disconnect();
    });
    expect(result.current.status).toBe("disconnected");
  });

  it("syncs initial state from InspectorClient and updates after connect", async () => {
    const client = new MockInspectorClient();
    const { result } = renderHook(() =>
      useInspectorClient(client as unknown as InspectorClient),
    );

    expect(result.current.status).toBe("disconnected");

    await act(async () => {
      await result.current.connect();
    });

    expect(result.current.status).toBe("connected");
  });

  it("updates tools when client emits toolsChange", async () => {
    const client = new MockInspectorClient();
    const { result } = renderHook(() =>
      useInspectorClient(client as unknown as InspectorClient),
    );

    await act(async () => {
      await result.current.connect();
    });
    expect(result.current.status).toBe("connected");

    await act(async () => {
      await client.listTools();
    });

    const tools = result.current.tools;
    expect(Array.isArray(tools)).toBe(true);
    expect(tools.length).toBeGreaterThan(0);
  });

  it("updates status after disconnect", async () => {
    const client = new MockInspectorClient();
    const { result } = renderHook(() =>
      useInspectorClient(client as unknown as InspectorClient),
    );

    await act(async () => {
      await result.current.connect();
    });
    expect(result.current.status).toBe("connected");

    await act(async () => {
      await result.current.disconnect();
    });

    expect(result.current.status).toBe("disconnected");
  });
});
