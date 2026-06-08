import { describe, it, expect, beforeEach } from "vitest";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import type { InspectorServerSettings } from "@inspector/core/mcp/types.js";
import { ManagedToolsState } from "@inspector/core/mcp/state/managedToolsState";
import { FakeInspectorClient } from "@inspector/core/mcp/__tests__/fakeInspectorClient";

function tool(name: string): Tool {
  return { name, inputSchema: { type: "object" } };
}

const AUTO_REFRESH_SETTINGS: InspectorServerSettings = {
  headers: [],
  metadata: [],
  connectionTimeout: 0,
  requestTimeout: 0,
  taskTtl: 60000,
  autoRefreshOnListChanged: true,
  roots: [],
};

function waitForToolsChange(state: ManagedToolsState): Promise<Tool[]> {
  return new Promise((resolve) => {
    state.addEventListener("toolsChange", (e) => resolve(e.detail), {
      once: true,
    });
  });
}

function waitForListChanged(state: ManagedToolsState): Promise<boolean> {
  return new Promise((resolve) => {
    state.addEventListener("listChangedChange", (e) => resolve(e.detail), {
      once: true,
    });
  });
}

describe("ManagedToolsState", () => {
  let client: FakeInspectorClient;
  let state: ManagedToolsState;

  beforeEach(() => {
    // Default to a server that advertises `tools` so the existing flow tests
    // exercise the live `listTools` path; capability-absent tests below
    // override this.
    client = new FakeInspectorClient({ capabilities: { tools: {} } });
    state = new ManagedToolsState(client, 0);
  });

  it("starts with empty tools", () => {
    expect(state.getTools()).toEqual([]);
  });

  it("getTools returns a defensive copy", () => {
    const a = state.getTools();
    const b = state.getTools();
    expect(a).not.toBe(b);
  });

  it("refresh returns early and does not call listTools when disconnected", async () => {
    const result = await state.refresh();
    expect(result).toEqual([]);
    expect(client.listTools).not.toHaveBeenCalled();
  });

  it("refresh skips listTools when the server doesn't advertise tools capability", async () => {
    // Regression (#1350): a tools-less server replied to tools/list with
    // -32601 "Method not found", surfacing in the console on every connect.
    const toolless = new FakeInspectorClient({
      capabilities: { prompts: {}, resources: {} },
    });
    toolless.setStatus("connected");
    const toollessState = new ManagedToolsState(toolless, 0);

    const result = await toollessState.refresh();
    expect(result).toEqual([]);
    expect(toolless.listTools).not.toHaveBeenCalled();
  });

  it("connect against a tools-less server doesn't fire listTools", async () => {
    // The connect event runs refresh; the capability gate must also catch it
    // there, not only the publicly-callable refresh().
    const toolless = new FakeInspectorClient({ capabilities: { prompts: {} } });
    toolless.setStatus("connected");
    const toollessState = new ManagedToolsState(toolless, 0);

    toolless.dispatchTypedEvent("connect");
    // Yield so the async refresh chained off connect runs.
    await Promise.resolve();
    await Promise.resolve();
    expect(toolless.listTools).not.toHaveBeenCalled();
    expect(toollessState.getTools()).toEqual([]);
  });

  it("refresh fetches a single page and dispatches toolsChange", async () => {
    client.setStatus("connected");
    client.queueToolPages({ tools: [tool("a"), tool("b")] });

    const changePromise = waitForToolsChange(state);
    const result = await state.refresh();

    expect(result.map((t) => t.name)).toEqual(["a", "b"]);
    expect(await changePromise).toEqual(result);
    expect(state.getTools().map((t) => t.name)).toEqual(["a", "b"]);
  });

  it("refresh accumulates across multiple paginated pages", async () => {
    client.setStatus("connected");
    client.queueToolPages(
      { tools: [tool("a")], nextCursor: "c1" },
      { tools: [tool("b")], nextCursor: "c2" },
      { tools: [tool("c")] },
    );

    const result = await state.refresh();
    expect(result.map((t) => t.name)).toEqual(["a", "b", "c"]);
    expect(client.listTools).toHaveBeenCalledTimes(3);
  });

  it("refresh passes setMetadata-supplied metadata to listTools", async () => {
    client.setStatus("connected");
    state.setMetadata({ k: "v" });
    client.queueToolPages({ tools: [tool("a")] });
    await state.refresh();
    expect(client.listTools).toHaveBeenCalledWith(undefined, { k: "v" });
  });

  it("refresh argument overrides setMetadata", async () => {
    client.setStatus("connected");
    state.setMetadata({ k: "default" });
    client.queueToolPages({ tools: [tool("a")] });
    await state.refresh({ k: "override" });
    expect(client.listTools).toHaveBeenCalledWith(undefined, { k: "override" });
  });

  it("connect event triggers a refresh", async () => {
    client.setStatus("connected");
    client.queueToolPages({ tools: [tool("a")] });
    const changePromise = waitForToolsChange(state);
    client.dispatchTypedEvent("connect");
    const next = await changePromise;
    expect(next.map((t) => t.name)).toEqual(["a"]);
  });

  it("toolsListChanged peeks but does NOT replace the displayed list by default", async () => {
    // Diff-aware (#1444): the notification fetches to compare, but the
    // displayed list stays put until the user pulls via Refresh.
    client.setStatus("connected");
    client.queueToolPages({ tools: [tool("a"), tool("b")] });
    const changed = waitForListChanged(state);
    client.dispatchTypedEvent("toolsListChanged");
    expect(await changed).toBe(true); // the peeked list differs from []
    expect(client.listTools).toHaveBeenCalled(); // it fetched to compare
    expect(state.getTools()).toEqual([]); // ...but did not replace the display
  });

  it("toolsListChanged does NOT light the indicator when the list is unchanged", async () => {
    // The everything-server case: a list_changed that re-sends an identical
    // list must not light the indicator.
    client.setStatus("connected");
    client.queueToolPages({ tools: [tool("a")] });
    await state.refresh();
    expect(state.getTools().map((t) => t.name)).toEqual(["a"]);

    let fired = false;
    state.addEventListener("listChangedChange", () => {
      fired = true;
    });
    // Re-send the same single-tool page on the next peek.
    client.queueToolPages({ tools: [tool("a")] });
    client.dispatchTypedEvent("toolsListChanged");
    // Let the async peek (fetch + compare) settle.
    await new Promise((r) => setTimeout(r, 0));
    expect(client.listTools).toHaveBeenCalledTimes(2); // refresh + peek
    expect(fired).toBe(false);
    expect(state.getListChanged()).toBe(false);
  });

  it("debounces a burst of list_changed into a single fetch (#1444)", async () => {
    // The everything-server case: a rapid burst of notifications must collapse
    // into one list call once it settles, not one per notification.
    client.setStatus("connected");
    client.queueToolPages({ tools: [tool("a")] });
    const changed = waitForListChanged(state);
    client.dispatchTypedEvent("toolsListChanged");
    client.dispatchTypedEvent("toolsListChanged");
    client.dispatchTypedEvent("toolsListChanged");
    expect(await changed).toBe(true);
    expect(client.listTools).toHaveBeenCalledTimes(1); // one debounced fetch
  });

  it("coalesces a peek that fires while an earlier one is still fetching (#1444)", async () => {
    // Defense beyond the debounce: a post-debounce notification landing during
    // an in-flight peek queues a single re-run instead of a concurrent fetch.
    client.setStatus("connected");
    let release: (value: { tools: Tool[] }) => void = () => {};
    client.listTools.mockImplementationOnce(
      () =>
        new Promise<{ tools: Tool[] }>((resolve) => {
          release = resolve;
        }),
    );
    client.queueToolPages({ tools: [tool("a")] });

    // First notification → debounced peek starts and hangs.
    client.dispatchTypedEvent("toolsListChanged");
    await new Promise((r) => setTimeout(r, 0));
    expect(client.listTools).toHaveBeenCalledTimes(1);

    // Second notification while the peek is hung → coalesced, no concurrent fetch.
    client.dispatchTypedEvent("toolsListChanged");
    await new Promise((r) => setTimeout(r, 0));
    expect(client.listTools).toHaveBeenCalledTimes(1);

    // Releasing the first peek runs exactly one coalesced re-run.
    release({ tools: [tool("a")] });
    await new Promise((r) => setTimeout(r, 0));
    expect(client.listTools).toHaveBeenCalledTimes(2);
  });

  it("coalesces an auto-refresh that fires while an earlier one is still fetching (#1444)", async () => {
    // The guard covers the auto-refresh path too, so a slow refresh can't be
    // clobbered by an overlapping one from a later notification.
    const autoClient = new FakeInspectorClient({
      capabilities: { tools: {} },
      serverSettings: AUTO_REFRESH_SETTINGS,
    });
    autoClient.setStatus("connected");
    const autoState = new ManagedToolsState(autoClient, 0);
    let release: (value: { tools: Tool[] }) => void = () => {};
    autoClient.listTools.mockImplementationOnce(
      () =>
        new Promise<{ tools: Tool[] }>((resolve) => {
          release = resolve;
        }),
    );
    autoClient.queueToolPages({ tools: [tool("a")] });

    autoClient.dispatchTypedEvent("toolsListChanged");
    await new Promise((r) => setTimeout(r, 0));
    expect(autoClient.listTools).toHaveBeenCalledTimes(1);

    autoClient.dispatchTypedEvent("toolsListChanged");
    await new Promise((r) => setTimeout(r, 0));
    expect(autoClient.listTools).toHaveBeenCalledTimes(1); // coalesced

    release({ tools: [tool("a")] });
    await new Promise((r) => setTimeout(r, 0));
    expect(autoClient.listTools).toHaveBeenCalledTimes(2);
    // The (coalesced) auto-refresh applied the new list.
    expect(autoState.getTools().map((t) => t.name)).toEqual(["a"]);
  });

  it("clears the indicator when a later notification reverts the list to the displayed one (#1444)", async () => {
    client.setStatus("connected");
    client.queueToolPages({ tools: [tool("a")] });
    await state.refresh(); // displayed = [a]

    // Server adds a tool → indicator lights.
    client.queueToolPages({ tools: [tool("a"), tool("b")] });
    const lit = waitForListChanged(state);
    client.dispatchTypedEvent("toolsListChanged");
    expect(await lit).toBe(true);

    // Server reverts to [a] (matches the displayed list) → indicator clears.
    client.queueToolPages({ tools: [tool("a")] });
    const cleared = waitForListChanged(state);
    client.dispatchTypedEvent("toolsListChanged");
    expect(await cleared).toBe(false);
    expect(state.getListChanged()).toBe(false);
  });

  it("toolsListChanged auto-refreshes when the server opts in", async () => {
    const autoClient = new FakeInspectorClient({
      capabilities: { tools: {} },
      serverSettings: AUTO_REFRESH_SETTINGS,
    });
    autoClient.setStatus("connected");
    const autoState = new ManagedToolsState(autoClient, 0);
    autoClient.queueToolPages({ tools: [tool("a")] });
    const changed = waitForToolsChange(autoState);
    autoClient.dispatchTypedEvent("toolsListChanged");
    expect((await changed).map((t) => t.name)).toEqual(["a"]);
    expect(autoClient.listTools).toHaveBeenCalled();
  });

  it("honors a live setServerSettings toggle without a reconnect (#1444)", async () => {
    // Starts in flag-only mode (no settings); flip auto-refresh on live.
    client.setStatus("connected");
    client.setServerSettings(AUTO_REFRESH_SETTINGS);
    client.queueToolPages({ tools: [tool("a")] });
    const changed = waitForToolsChange(state);
    client.dispatchTypedEvent("toolsListChanged");
    // The list is applied (auto-refresh), proving the manager read the new
    // setting at notification time rather than a connect-time snapshot.
    expect((await changed).map((t) => t.name)).toEqual(["a"]);
  });

  it("statusChange to disconnected clears tools and dispatches toolsChange", async () => {
    client.setStatus("connected");
    client.queueToolPages({ tools: [tool("a")] });
    await state.refresh();
    expect(state.getTools()).toHaveLength(1);

    const changePromise = waitForToolsChange(state);
    client.setStatus("disconnected");
    const next = await changePromise;
    expect(next).toEqual([]);
    expect(state.getTools()).toEqual([]);
  });

  it("statusChange to other (non-disconnected) values does not clear tools", async () => {
    client.setStatus("connected");
    client.queueToolPages({ tools: [tool("a")] });
    await state.refresh();
    client.setStatus("error");
    expect(state.getTools().map((t) => t.name)).toEqual(["a"]);
  });

  it("throws when pagination exceeds 100 pages", async () => {
    client.setStatus("connected");
    // Always returns a non-terminal cursor; refresh should bail out at the cap.
    client.listTools.mockImplementation(async () => ({
      tools: [tool("a")],
      nextCursor: "always",
    }));
    await expect(state.refresh()).rejects.toThrow(/Maximum pagination limit/);
  });

  it("destroy unsubscribes from client events and clears state", async () => {
    client.setStatus("connected");
    client.queueToolPages({ tools: [tool("a")] });
    await state.refresh();
    expect(state.getTools()).toHaveLength(1);

    state.destroy();
    expect(state.getTools()).toEqual([]);

    // No further refreshes after destroy(): events on client should be ignored.
    client.queueToolPages({ tools: [tool("b")] });
    client.dispatchTypedEvent("toolsListChanged");
    // Give microtasks a chance to flush so a stray refresh would have landed.
    await Promise.resolve();
    expect(state.getTools()).toEqual([]);
  });

  describe("listChanged (#1402)", () => {
    it("starts cleared", () => {
      expect(state.getListChanged()).toBe(false);
    });

    it("toolsListChanged sets the flag and dispatches listChangedChange", async () => {
      client.setStatus("connected");
      client.queueToolPages({ tools: [tool("a")] });
      const changed = waitForListChanged(state);
      client.dispatchTypedEvent("toolsListChanged");
      expect(await changed).toBe(true);
      expect(state.getListChanged()).toBe(true);
    });

    it("clearListChanged resets the flag and dispatches false", async () => {
      client.setStatus("connected");
      client.queueToolPages({ tools: [tool("a")] });
      const set = waitForListChanged(state);
      client.dispatchTypedEvent("toolsListChanged");
      await set; // wait for the async peek to set the flag
      expect(state.getListChanged()).toBe(true);

      const changed = waitForListChanged(state);
      state.clearListChanged();
      expect(await changed).toBe(false);
      expect(state.getListChanged()).toBe(false);
    });

    it("clearListChanged is a no-op (no event) when already cleared", () => {
      let fired = false;
      state.addEventListener("listChangedChange", () => {
        fired = true;
      });
      state.clearListChanged();
      expect(fired).toBe(false);
    });

    it("disconnect clears the flag", async () => {
      client.setStatus("connected");
      client.queueToolPages({ tools: [tool("a")] });
      const set = waitForListChanged(state);
      client.dispatchTypedEvent("toolsListChanged");
      await set; // wait for the async peek to set the flag
      expect(state.getListChanged()).toBe(true);

      const changed = waitForListChanged(state);
      client.setStatus("disconnected");
      expect(await changed).toBe(false);
      expect(state.getListChanged()).toBe(false);
    });
  });

  it("destroy is idempotent", () => {
    state.destroy();
    expect(() => state.destroy()).not.toThrow();
  });
});
