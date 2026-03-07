/**
 * @vitest-environment jsdom
 */
import { describe, it, expect } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useInspectorClient } from "../../react/useInspectorClient.js";
import type { InspectorClient } from "../../mcp/inspectorClient.js";
import { InspectorClientEventTarget } from "../../mcp/inspectorClientEventTarget.js";
import type { ConnectionStatus } from "../../mcp/index.js";

/**
 * Mock InspectorClient that synchronously dispatches events when connect() or
 * disconnect() are called so state updates run inside act().
 */
class MockInspectorClient extends InspectorClientEventTarget {
  private status: ConnectionStatus = "disconnected";

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
}

describe("useInspectorClient", () => {
  it("returns disconnected state and no-op connect/disconnect when given null", async () => {
    const { result } = renderHook(() => useInspectorClient(null));

    expect(result.current.status).toBe("disconnected");
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
