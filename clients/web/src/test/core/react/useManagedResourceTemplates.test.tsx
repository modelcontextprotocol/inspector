import { describe, it, expect, beforeEach } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ResourceTemplate } from "@modelcontextprotocol/sdk/types.js";
import { FakeInspectorClient } from "@inspector/core/mcp/__tests__/fakeInspectorClient";
import { ManagedResourceTemplatesState } from "@inspector/core/mcp/state/managedResourceTemplatesState";
import { useManagedResourceTemplates } from "@inspector/core/react/useManagedResourceTemplates";

function template(name: string): ResourceTemplate {
  return { uriTemplate: `tpl://{${name}}`, name };
}

describe("useManagedResourceTemplates", () => {
  let client: FakeInspectorClient;
  let state: ManagedResourceTemplatesState;

  beforeEach(() => {
    client = new FakeInspectorClient({ status: "connected" });
    state = new ManagedResourceTemplatesState(client);
  });

  it("returns the initial templates snapshot from the state", async () => {
    client.queueResourceTemplatePages({
      resourceTemplates: [template("a"), template("b")],
    });
    await state.refresh();

    const { result } = renderHook(() =>
      useManagedResourceTemplates(client, state),
    );
    expect(result.current.resourceTemplates.map((t) => t.name)).toEqual([
      "a",
      "b",
    ]);
  });

  it("returns empty templates when state is null", () => {
    const { result } = renderHook(() =>
      useManagedResourceTemplates(client, null),
    );
    expect(result.current.resourceTemplates).toEqual([]);
  });

  it("updates when state dispatches resourceTemplatesChange", async () => {
    const { result } = renderHook(() =>
      useManagedResourceTemplates(client, state),
    );
    expect(result.current.resourceTemplates).toEqual([]);

    client.queueResourceTemplatePages({ resourceTemplates: [template("a")] });
    await act(async () => {
      await state.refresh();
    });

    await waitFor(() => {
      expect(result.current.resourceTemplates.map((t) => t.name)).toEqual([
        "a",
      ]);
    });
  });

  it("refresh() calls through to state and returns the next templates", async () => {
    client.queueResourceTemplatePages({ resourceTemplates: [template("x")] });
    const { result } = renderHook(() =>
      useManagedResourceTemplates(client, state),
    );

    let next: ResourceTemplate[] = [];
    await act(async () => {
      next = await result.current.refresh();
    });

    expect(next.map((t) => t.name)).toEqual(["x"]);
    expect(result.current.resourceTemplates.map((t) => t.name)).toEqual(["x"]);
  });

  it("refresh() returns [] when state or client is null", async () => {
    const { result } = renderHook(() =>
      useManagedResourceTemplates(null, state),
    );
    await expect(result.current.refresh()).resolves.toEqual([]);

    const { result: result2 } = renderHook(() =>
      useManagedResourceTemplates(client, null),
    );
    await expect(result2.current.refresh()).resolves.toEqual([]);
  });

  it("resets to empty when state becomes null", async () => {
    client.queueResourceTemplatePages({ resourceTemplates: [template("a")] });
    await state.refresh();

    const { result, rerender } = renderHook(
      ({ s }: { s: ManagedResourceTemplatesState | null }) =>
        useManagedResourceTemplates(client, s),
      { initialProps: { s: state as ManagedResourceTemplatesState | null } },
    );
    await waitFor(() => {
      expect(result.current.resourceTemplates.map((t) => t.name)).toEqual([
        "a",
      ]);
    });

    rerender({ s: null });
    await waitFor(() => {
      expect(result.current.resourceTemplates).toEqual([]);
    });
  });

  it("unsubscribes from the state on unmount", async () => {
    const { result, unmount } = renderHook(() =>
      useManagedResourceTemplates(client, state),
    );

    unmount();

    client.queueResourceTemplatePages({ resourceTemplates: [template("a")] });
    await state.refresh();

    expect(result.current.resourceTemplates).toEqual([]);
  });
});
