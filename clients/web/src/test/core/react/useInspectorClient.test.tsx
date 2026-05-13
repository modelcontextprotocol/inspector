import { describe, it, expect } from "vitest";
import { act, renderHook } from "@testing-library/react";
import type {
  Implementation,
  ServerCapabilities,
} from "@modelcontextprotocol/sdk/types.js";
import { FakeInspectorClient } from "@inspector/core/mcp/__tests__/fakeInspectorClient";
import { useInspectorClient } from "@inspector/core/react/useInspectorClient";
import type { InspectorClientProtocol } from "@inspector/core/mcp/inspectorClientProtocol";

const CAPABILITIES: ServerCapabilities = { tools: { listChanged: true } };
const SERVER_INFO: Implementation = { name: "srv", version: "1.0" };

describe("useInspectorClient", () => {
  it("returns initial accessors from the client", () => {
    const client = new FakeInspectorClient({
      status: "connected",
      capabilities: CAPABILITIES,
      serverInfo: SERVER_INFO,
      instructions: "hello",
    });
    const { result } = renderHook(() => useInspectorClient(client));
    expect(result.current.status).toBe("connected");
    expect(result.current.capabilities).toEqual(CAPABILITIES);
    expect(result.current.serverInfo).toEqual(SERVER_INFO);
    expect(result.current.instructions).toBe("hello");
    expect(result.current.appRendererClient).toBeNull();
  });

  it("returns disconnected defaults when client is null", () => {
    const { result } = renderHook(() => useInspectorClient(null));
    expect(result.current.status).toBe("disconnected");
    expect(result.current.capabilities).toBeUndefined();
    expect(result.current.serverInfo).toBeUndefined();
    expect(result.current.instructions).toBeUndefined();
    expect(result.current.appRendererClient).toBeNull();
  });

  it("subscribes to statusChange and updates", () => {
    const client = new FakeInspectorClient();
    const { result } = renderHook(() => useInspectorClient(client));
    expect(result.current.status).toBe("disconnected");
    act(() => {
      client.setStatus("connecting");
    });
    expect(result.current.status).toBe("connecting");
    act(() => {
      client.setStatus("connected");
    });
    expect(result.current.status).toBe("connected");
  });

  it("subscribes to capabilities/serverInfo/instructions changes", () => {
    const client = new FakeInspectorClient();
    const { result } = renderHook(() => useInspectorClient(client));
    act(() => {
      client.setCapabilities(CAPABILITIES);
      client.setServerInfo(SERVER_INFO);
      client.setInstructions("after");
    });
    expect(result.current.capabilities).toEqual(CAPABILITIES);
    expect(result.current.serverInfo).toEqual(SERVER_INFO);
    expect(result.current.instructions).toBe("after");
  });

  it("connect() and disconnect() proxy to the client and update status", async () => {
    const client = new FakeInspectorClient();
    const { result } = renderHook(() => useInspectorClient(client));

    await act(async () => {
      await result.current.connect();
    });
    expect(result.current.status).toBe("connected");

    await act(async () => {
      await result.current.disconnect();
    });
    expect(result.current.status).toBe("disconnected");
  });

  it("connect() and disconnect() are no-ops when client is null", async () => {
    const { result } = renderHook(() => useInspectorClient(null));
    await expect(result.current.connect()).resolves.toBeUndefined();
    await expect(result.current.disconnect()).resolves.toBeUndefined();
  });

  it("resets to defaults when client becomes null", () => {
    const client = new FakeInspectorClient({
      status: "connected",
      capabilities: CAPABILITIES,
    });
    const { result, rerender } = renderHook(
      ({ c }: { c: InspectorClientProtocol | null }) => useInspectorClient(c),
      { initialProps: { c: client as InspectorClientProtocol | null } },
    );
    expect(result.current.status).toBe("connected");
    rerender({ c: null });
    expect(result.current.status).toBe("disconnected");
    expect(result.current.capabilities).toBeUndefined();
  });

  it("re-subscribes when the client prop changes", () => {
    const a = new FakeInspectorClient({ status: "connected" });
    const b = new FakeInspectorClient({ status: "disconnected" });
    const { result, rerender } = renderHook(
      ({ c }: { c: InspectorClientProtocol }) => useInspectorClient(c),
      { initialProps: { c: a as InspectorClientProtocol } },
    );
    expect(result.current.status).toBe("connected");

    rerender({ c: b });
    expect(result.current.status).toBe("disconnected");

    // After rerender, events on the OLD client should be ignored.
    act(() => {
      a.setStatus("error");
    });
    expect(result.current.status).toBe("disconnected");

    // Events on the NEW client should be observed.
    act(() => {
      b.setStatus("connecting");
    });
    expect(result.current.status).toBe("connecting");
  });

  it("unsubscribes on unmount", () => {
    const client = new FakeInspectorClient({ status: "connected" });
    const { result, unmount } = renderHook(() => useInspectorClient(client));
    unmount();
    act(() => {
      client.setStatus("error");
    });
    // The hook is unmounted; result.current still reads the last rendered
    // value ("connected") rather than the post-unmount event.
    expect(result.current.status).toBe("connected");
  });

  it("reads appRendererClient lazily from the client on each render", () => {
    const client = new FakeInspectorClient({ status: "connected" });
    const { result, rerender } = renderHook(() => useInspectorClient(client));
    expect(result.current.appRendererClient).toBeNull();

    const sentinel = { iam: "renderer" };
    client.setAppRendererClient(sentinel);
    rerender();
    expect(result.current.appRendererClient).toBe(sentinel);
  });
});
