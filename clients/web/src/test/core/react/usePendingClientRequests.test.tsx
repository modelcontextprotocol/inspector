import { describe, it, expect } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { FakeInspectorClient } from "@inspector/core/mcp/__tests__/fakeInspectorClient";
import { usePendingClientRequests } from "@inspector/core/react/usePendingClientRequests";
import { SamplingCreateMessage } from "@inspector/core/mcp/samplingCreateMessage";
import { ElicitationCreateMessage } from "@inspector/core/mcp/elicitationCreateMessage";
import type { InspectorClientProtocol } from "@inspector/core/mcp/inspectorClientProtocol";

const noop = (): void => {};

function makeSample(): SamplingCreateMessage {
  return new SamplingCreateMessage(
    {
      method: "sampling/createMessage",
      params: { messages: [], maxTokens: 100 },
    },
    noop,
    noop,
    noop,
  );
}

function makeElicitation(): ElicitationCreateMessage {
  return new ElicitationCreateMessage(
    {
      method: "elicitation/create",
      params: {
        message: "Provide details",
        requestedSchema: { type: "object", properties: {} },
      },
    },
    noop,
    noop,
  );
}

describe("usePendingClientRequests", () => {
  it("returns empty arrays when the client is null", () => {
    const { result } = renderHook(() => usePendingClientRequests(null));
    expect(result.current.pendingSamples).toEqual([]);
    expect(result.current.pendingElicitations).toEqual([]);
  });

  it("returns the client's initial pending requests", () => {
    const client = new FakeInspectorClient();
    const sample = makeSample();
    const elicitation = makeElicitation();
    client.setPendingSamples([sample]);
    client.setPendingElicitations([elicitation]);

    const { result } = renderHook(() => usePendingClientRequests(client));
    expect(result.current.pendingSamples).toEqual([sample]);
    expect(result.current.pendingElicitations).toEqual([elicitation]);
  });

  it("subscribes to pendingSamplesChange", () => {
    const client = new FakeInspectorClient();
    const { result } = renderHook(() => usePendingClientRequests(client));
    expect(result.current.pendingSamples).toEqual([]);

    const sample = makeSample();
    act(() => {
      client.setPendingSamples([sample]);
    });
    expect(result.current.pendingSamples).toEqual([sample]);

    act(() => {
      client.setPendingSamples([]);
    });
    expect(result.current.pendingSamples).toEqual([]);
  });

  it("subscribes to pendingElicitationsChange", () => {
    const client = new FakeInspectorClient();
    const { result } = renderHook(() => usePendingClientRequests(client));
    expect(result.current.pendingElicitations).toEqual([]);

    const elicitation = makeElicitation();
    act(() => {
      client.setPendingElicitations([elicitation]);
    });
    expect(result.current.pendingElicitations).toEqual([elicitation]);
  });

  it("resets to empty when the client becomes null", () => {
    const client = new FakeInspectorClient();
    client.setPendingSamples([makeSample()]);
    const { result, rerender } = renderHook(
      ({ c }: { c: InspectorClientProtocol | null }) =>
        usePendingClientRequests(c),
      { initialProps: { c: client as InspectorClientProtocol | null } },
    );
    expect(result.current.pendingSamples).toHaveLength(1);

    rerender({ c: null });
    expect(result.current.pendingSamples).toEqual([]);
    expect(result.current.pendingElicitations).toEqual([]);
  });

  it("re-subscribes when the client prop changes", () => {
    const a = new FakeInspectorClient();
    const b = new FakeInspectorClient();
    const { result, rerender } = renderHook(
      ({ c }: { c: InspectorClientProtocol }) => usePendingClientRequests(c),
      { initialProps: { c: a as InspectorClientProtocol } },
    );

    rerender({ c: b });

    // Events on the OLD client are ignored.
    act(() => {
      a.setPendingSamples([makeSample()]);
    });
    expect(result.current.pendingSamples).toEqual([]);

    // Events on the NEW client are observed.
    const sample = makeSample();
    act(() => {
      b.setPendingSamples([sample]);
    });
    expect(result.current.pendingSamples).toEqual([sample]);
  });

  it("unsubscribes on unmount", () => {
    const client = new FakeInspectorClient();
    const { result, unmount } = renderHook(() =>
      usePendingClientRequests(client),
    );
    unmount();
    act(() => {
      client.setPendingSamples([makeSample()]);
    });
    expect(result.current.pendingSamples).toEqual([]);
  });
});
