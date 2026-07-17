import { describe, it, expect } from "vitest";
import { act, renderHook } from "@testing-library/react";
import type {
  ClientCapabilities,
  Implementation,
  ServerCapabilities,
} from "@modelcontextprotocol/client";
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
      protocolVersion: "2025-06-18",
    });
    const { result } = renderHook(() => useInspectorClient(client));
    expect(result.current.status).toBe("connected");
    expect(result.current.capabilities).toEqual(CAPABILITIES);
    expect(result.current.serverInfo).toEqual(SERVER_INFO);
    expect(result.current.instructions).toBe("hello");
    expect(result.current.protocolVersion).toBe("2025-06-18");
    expect(result.current.appRendererClient).toBeNull();
  });

  it("returns disconnected defaults when client is null", () => {
    const { result } = renderHook(() => useInspectorClient(null));
    expect(result.current.status).toBe("disconnected");
    expect(result.current.capabilities).toBeUndefined();
    expect(result.current.serverInfo).toBeUndefined();
    expect(result.current.instructions).toBeUndefined();
    expect(result.current.protocolVersion).toBeUndefined();
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

  it("subscribes to protocolVersionChange and updates", () => {
    const client = new FakeInspectorClient();
    const { result } = renderHook(() => useInspectorClient(client));
    expect(result.current.protocolVersion).toBeUndefined();
    act(() => {
      client.setProtocolVersion("2025-06-18");
    });
    expect(result.current.protocolVersion).toBe("2025-06-18");
  });

  it("returns initial protocolEra / discoverResult from the client", () => {
    const discoverResult = {
      supportedVersions: ["2026-07-28"],
      serverInfo: SERVER_INFO,
      capabilities: {},
    };
    const client = new FakeInspectorClient({
      status: "connected",
      protocolEra: "modern",
      discoverResult,
    });
    const { result } = renderHook(() => useInspectorClient(client));
    expect(result.current.protocolEra).toBe("modern");
    expect(result.current.discoverResult).toEqual(discoverResult);
  });

  it("subscribes to protocolEraChange and discoverResultChange", () => {
    const client = new FakeInspectorClient();
    const { result } = renderHook(() => useInspectorClient(client));
    expect(result.current.protocolEra).toBeUndefined();
    expect(result.current.discoverResult).toBeUndefined();
    const discoverResult = {
      supportedVersions: ["2026-07-28"],
      serverInfo: SERVER_INFO,
      capabilities: {},
    };
    act(() => {
      client.setProtocolEra("modern");
      client.setDiscoverResult(discoverResult);
    });
    expect(result.current.protocolEra).toBe("modern");
    expect(result.current.discoverResult).toEqual(discoverResult);
  });

  it("resets protocolEra / discoverResult to defaults when client becomes null", () => {
    const client = new FakeInspectorClient({
      status: "connected",
      protocolEra: "modern",
      discoverResult: {
        supportedVersions: ["2026-07-28"],
        serverInfo: SERVER_INFO,
        capabilities: {},
      },
    });
    const { result, rerender } = renderHook(({ c }) => useInspectorClient(c), {
      initialProps: { c: client as FakeInspectorClient | null },
    });
    expect(result.current.protocolEra).toBe("modern");
    rerender({ c: null });
    expect(result.current.protocolEra).toBeUndefined();
    expect(result.current.discoverResult).toBeUndefined();
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

  it("captures lastError from the client's error event", () => {
    const client = new FakeInspectorClient({ status: "connected" });
    const { result } = renderHook(() => useInspectorClient(client));
    expect(result.current.lastError).toBeUndefined();
    act(() => {
      client.dispatchTypedEvent("error", new Error("stdio subprocess crashed"));
    });
    expect(result.current.lastError).toBe("stdio subprocess crashed");
  });

  it("clears lastError when a new connection attempt begins (connecting)", () => {
    const client = new FakeInspectorClient({ status: "connected" });
    const { result } = renderHook(() => useInspectorClient(client));
    act(() => {
      client.dispatchTypedEvent("error", new Error("SSE stream dropped"));
    });
    expect(result.current.lastError).toBe("SSE stream dropped");

    // A reconnect drives status → "connecting", which clears the stale error.
    act(() => {
      client.setStatus("connecting");
    });
    expect(result.current.lastError).toBeUndefined();
  });

  it("keeps lastError across the error status transition", () => {
    const client = new FakeInspectorClient({ status: "connected" });
    const { result } = renderHook(() => useInspectorClient(client));
    // The transport onerror path fires statusChange("error") then error; the
    // "error" status must not clear the message the error event carries.
    act(() => {
      client.setStatus("error");
      client.dispatchTypedEvent("error", new Error("HTTP 503"));
    });
    expect(result.current.status).toBe("error");
    expect(result.current.lastError).toBe("HTTP 503");
  });

  it("keeps lastError across a trailing disconnected transition", () => {
    const client = new FakeInspectorClient({ status: "connected" });
    const { result } = renderHook(() => useInspectorClient(client));
    act(() => {
      client.dispatchTypedEvent("error", new Error("stdio crashed"));
    });
    expect(result.current.lastError).toBe("stdio crashed");

    // A real crash often trails the error with an onclose → statusChange
    // ("disconnected"). The toast effect depends on that NOT clearing
    // lastError (only the next "connecting" edge does).
    act(() => {
      client.setStatus("disconnected");
    });
    expect(result.current.status).toBe("disconnected");
    expect(result.current.lastError).toBe("stdio crashed");
  });

  it("resets lastError when the client prop changes", () => {
    const a = new FakeInspectorClient({ status: "connected" });
    const b = new FakeInspectorClient({ status: "connected" });
    const { result, rerender } = renderHook(
      ({ c }: { c: InspectorClientProtocol }) => useInspectorClient(c),
      { initialProps: { c: a as InspectorClientProtocol } },
    );
    act(() => {
      a.dispatchTypedEvent("error", new Error("boom"));
    });
    expect(result.current.lastError).toBe("boom");

    rerender({ c: b });
    expect(result.current.lastError).toBeUndefined();

    // The old client's error event is ignored after the swap.
    act(() => {
      a.dispatchTypedEvent("error", new Error("late"));
    });
    expect(result.current.lastError).toBeUndefined();
  });

  it("resets lastError when client becomes null", () => {
    const client = new FakeInspectorClient({ status: "connected" });
    const { result, rerender } = renderHook(
      ({ c }: { c: InspectorClientProtocol | null }) => useInspectorClient(c),
      { initialProps: { c: client as InspectorClientProtocol | null } },
    );
    act(() => {
      client.dispatchTypedEvent("error", new Error("boom"));
    });
    expect(result.current.lastError).toBe("boom");
    rerender({ c: null });
    expect(result.current.lastError).toBeUndefined();
  });

  it("reads clientCapabilities lazily from the client and defaults to {} when null", () => {
    const advertised: ClientCapabilities = {
      elicitation: { form: {} },
      tasks: { list: {}, cancel: {} },
    };
    const client = new FakeInspectorClient({
      status: "connected",
      clientCapabilities: advertised,
    });
    const { result, rerender } = renderHook(
      ({ c }: { c: InspectorClientProtocol | null }) => useInspectorClient(c),
      { initialProps: { c: client as InspectorClientProtocol | null } },
    );
    expect(result.current.clientCapabilities).toEqual(advertised);

    rerender({ c: null });
    expect(result.current.clientCapabilities).toEqual({});
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
