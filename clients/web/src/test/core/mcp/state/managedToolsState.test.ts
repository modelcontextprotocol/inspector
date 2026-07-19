import { describe, it, expect, beforeEach } from "vitest";
import type { Tool } from "@modelcontextprotocol/client";
import type { InspectorServerSettings } from "@inspector/core/mcp/types.js";
import { ManagedToolsState } from "@inspector/core/mcp/state/managedToolsState";
import { FakeInspectorClient } from "@inspector/core/mcp/__tests__/fakeInspectorClient";
import { waitForChangeEvent } from "./waitForChangeEvent";

function tool(name: string): Tool {
  return { name, inputSchema: { type: "object" } };
}

const AUTO_REFRESH_SETTINGS: InspectorServerSettings = {
  headers: [],
  env: [],
  metadata: [],
  connectionTimeout: 0,
  requestTimeout: 0,
  taskTtl: 60000,
  maxFetchRequests: 1000,
  autoRefreshOnListChanged: true,
  roots: [],
};

// Paginated mode on, plus auto-refresh on — paginated must win so the
// aggregate walk never runs (#1721).
const PAGINATED_SETTINGS: InspectorServerSettings = {
  ...AUTO_REFRESH_SETTINGS,
  paginatedLists: true,
};

function waitForToolsChange(state: ManagedToolsState): Promise<Tool[]> {
  return waitForChangeEvent(state, "toolsChange");
}

function waitForListChanged(state: ManagedToolsState): Promise<boolean> {
  return waitForChangeEvent(state, "listChangedChange");
}

describe("ManagedToolsState", () => {
  let client: FakeInspectorClient;
  let state: ManagedToolsState;

  beforeEach(() => {
    // Default to a server that advertises `tools` so the existing flow tests
    // exercise the live `listAllTools` path; capability-absent tests below
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

  it("refresh returns early and does not call listAllTools when disconnected", async () => {
    const result = await state.refresh();
    expect(result).toEqual([]);
    expect(client.listAllTools).not.toHaveBeenCalled();
  });

  it("refresh skips listAllTools when the server doesn't advertise tools capability", async () => {
    // Regression (#1350): a tools-less server replied to tools/list with
    // -32601 "Method not found", surfacing in the console on every connect.
    const toolless = new FakeInspectorClient({
      capabilities: { prompts: {}, resources: {} },
    });
    toolless.setStatus("connected");
    const toollessState = new ManagedToolsState(toolless, 0);

    const result = await toollessState.refresh();
    expect(result).toEqual([]);
    expect(toolless.listAllTools).not.toHaveBeenCalled();
  });

  it("connect against a tools-less server doesn't fire listAllTools", async () => {
    // The connect event runs refresh; the capability gate must also catch it
    // there, not only the publicly-callable refresh().
    const toolless = new FakeInspectorClient({ capabilities: { prompts: {} } });
    toolless.setStatus("connected");
    const toollessState = new ManagedToolsState(toolless, 0);

    const changePromise = waitForToolsChange(toollessState);
    toolless.dispatchTypedEvent("connect");
    await changePromise;
    expect(toolless.listAllTools).not.toHaveBeenCalled();
    expect(toollessState.getTools()).toEqual([]);
  });

  it("refresh fetches the full list and dispatches toolsChange", async () => {
    client.setStatus("connected");
    client.queueToolPages({ tools: [tool("a"), tool("b")] });

    const changePromise = waitForToolsChange(state);
    const result = await state.refresh();

    expect(result.map((t) => t.name)).toEqual(["a", "b"]);
    expect(await changePromise).toEqual(result);
    expect(state.getTools().map((t) => t.name)).toEqual(["a", "b"]);
  });

  it("refresh delegates all-page aggregation to listAllTools (one call)", async () => {
    // The SDK's high-level verb walks every page; the managed state makes a
    // single `listAllTools` call rather than looping single pages itself.
    client.setStatus("connected");
    client.queueToolPages(
      { tools: [tool("a")], nextCursor: "c1" },
      { tools: [tool("b")], nextCursor: "c2" },
      { tools: [tool("c")] },
    );

    const result = await state.refresh();
    expect(result.map((t) => t.name)).toEqual(["a", "b", "c"]);
    expect(client.listAllTools).toHaveBeenCalledTimes(1);
  });

  it("refresh passes setMetadata-supplied metadata to listAllTools", async () => {
    client.setStatus("connected");
    state.setMetadata({ k: "v" });
    client.queueToolPages({ tools: [tool("a")] });
    await state.refresh();
    expect(client.listAllTools).toHaveBeenCalledWith({
      cacheMode: undefined,
      metadata: { k: "v" },
    });
  });

  it("refresh argument overrides setMetadata", async () => {
    client.setStatus("connected");
    state.setMetadata({ k: "default" });
    client.queueToolPages({ tools: [tool("a")] });
    await state.refresh({ k: "override" });
    expect(client.listAllTools).toHaveBeenCalledWith({
      cacheMode: undefined,
      metadata: { k: "override" },
    });
  });

  it("refresh forwards an explicit cacheMode to listAllTools", async () => {
    // A user-initiated refresh (via the hook) passes cacheMode:"refresh" to
    // force a cache-bypassing round trip on modern servers (#1721).
    client.setStatus("connected");
    client.queueToolPages({ tools: [tool("a")] });
    await state.refresh(undefined, "refresh");
    expect(client.listAllTools).toHaveBeenCalledWith({
      cacheMode: "refresh",
      metadata: undefined,
    });
  });

  it("connect does NOT fetch in paginated mode (#1721)", async () => {
    // The aggregate list isn't the display source in paginated mode, so the
    // connect-time all-page walk is skipped (the defensive point of the setting).
    const spClient = new FakeInspectorClient({
      capabilities: { tools: {} },
      serverSettings: PAGINATED_SETTINGS,
    });
    spClient.setStatus("connected");
    const spState = new ManagedToolsState(spClient, 0);
    spClient.queueToolPages({ tools: [tool("a")] });
    spClient.dispatchTypedEvent("connect");
    await new Promise((r) => setTimeout(r, 0));
    expect(spClient.listAllTools).not.toHaveBeenCalled();
    expect(spState.getTools()).toEqual([]);
    spState.destroy();
  });

  it("list_changed only lights the indicator in paginated mode, never aggregates (#1721)", async () => {
    // Paginated wins over autoRefreshOnListChanged: the indicator lights but
    // the aggregate walk never runs.
    const spClient = new FakeInspectorClient({
      capabilities: { tools: {} },
      serverSettings: PAGINATED_SETTINGS,
    });
    spClient.setStatus("connected");
    const spState = new ManagedToolsState(spClient, 0);
    const changed = waitForListChanged(spState);
    spClient.dispatchTypedEvent("toolsListChanged");
    expect(await changed).toBe(true);
    expect(spClient.listAllTools).not.toHaveBeenCalled();
    spState.destroy();
  });

  it("connect event triggers a refresh", async () => {
    client.setStatus("connected");
    client.queueToolPages({ tools: [tool("a")] });
    const changePromise = waitForToolsChange(state);
    client.dispatchTypedEvent("connect");
    const next = await changePromise;
    expect(next.map((t) => t.name)).toEqual(["a"]);
  });

  it("toolsListChanged lights the indicator without fetching by default (#1444)", async () => {
    // Auto-refresh off: a list_changed lights the indicator with NO list call;
    // the user pulls the new list via Refresh.
    client.setStatus("connected");
    const changed = waitForListChanged(state);
    client.dispatchTypedEvent("toolsListChanged");
    expect(await changed).toBe(true);
    expect(client.listAllTools).not.toHaveBeenCalled(); // no automatic fetch
    expect(state.getTools()).toEqual([]); // displayed list untouched
  });

  it("debounces a burst of list_changed into a single indicator light, no fetch (#1444)", async () => {
    // The everything-server case: a rapid burst collapses to one indicator
    // light once it settles, and never fetches in flag-only mode.
    client.setStatus("connected");
    let fired = 0;
    state.addEventListener("listChangedChange", () => {
      fired++;
    });
    client.dispatchTypedEvent("toolsListChanged");
    client.dispatchTypedEvent("toolsListChanged");
    client.dispatchTypedEvent("toolsListChanged");
    await new Promise((r) => setTimeout(r, 0));
    expect(fired).toBe(1); // one debounced flip
    expect(state.getListChanged()).toBe(true);
    expect(client.listAllTools).not.toHaveBeenCalled();
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
    autoClient.listAllTools.mockImplementationOnce(
      () =>
        new Promise<{ tools: Tool[] }>((resolve) => {
          release = resolve;
        }),
    );
    autoClient.queueToolPages({ tools: [tool("a")] });

    autoClient.dispatchTypedEvent("toolsListChanged");
    await new Promise((r) => setTimeout(r, 0));
    expect(autoClient.listAllTools).toHaveBeenCalledTimes(1);

    autoClient.dispatchTypedEvent("toolsListChanged");
    await new Promise((r) => setTimeout(r, 0));
    expect(autoClient.listAllTools).toHaveBeenCalledTimes(1); // coalesced

    release({ tools: [tool("a")] });
    await new Promise((r) => setTimeout(r, 0));
    expect(autoClient.listAllTools).toHaveBeenCalledTimes(2);
    // The (coalesced) auto-refresh applied the new list.
    expect(autoState.getTools().map((t) => t.name)).toEqual(["a"]);
  });

  it("toolsListChanged auto-refreshes (cacheMode:refresh) when the server opts in", async () => {
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
    // A list_changed means the prior list is stale → bypass the cache.
    expect(autoClient.listAllTools).toHaveBeenCalledWith({
      cacheMode: "refresh",
      metadata: undefined,
    });
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

  it("statusChange to error clears tools (error is terminal, #1490)", async () => {
    client.setStatus("connected");
    client.queueToolPages({ tools: [tool("a")] });
    await state.refresh();
    expect(state.getTools()).toHaveLength(1);

    const changePromise = waitForToolsChange(state);
    client.setStatus("error");
    const next = await changePromise;
    expect(next).toEqual([]);
    expect(state.getTools()).toEqual([]);
  });

  it("statusChange to a non-terminal value (connecting) does not clear tools", async () => {
    client.setStatus("connected");
    client.queueToolPages({ tools: [tool("a")] });
    await state.refresh();
    client.setStatus("connecting");
    expect(state.getTools().map((t) => t.name)).toEqual(["a"]);
  });

  it("clears a pending list_changed debounce timer when the connection goes terminal", async () => {
    // A non-zero debounce leaves the timer pending; a terminal statusChange must
    // clear it so no stale indicator/fetch fires after disconnect.
    client.setStatus("connected");
    const debounced = new ManagedToolsState(client, 1000);
    client.dispatchTypedEvent("toolsListChanged"); // schedules the debounce timer
    client.setStatus("disconnected"); // terminal → clears the pending timer
    await new Promise((r) => setTimeout(r, 5));
    expect(debounced.getListChanged()).toBe(false);
    debounced.destroy();
  });

  it("clears a pending list_changed debounce timer on destroy", async () => {
    client.setStatus("connected");
    const debounced = new ManagedToolsState(client, 1000);
    client.dispatchTypedEvent("toolsListChanged"); // schedules the debounce timer
    debounced.destroy(); // unsubscribe clears the pending timer
    await new Promise((r) => setTimeout(r, 5));
    // No indicator lit and the list stays empty — the timer never fired.
    expect(debounced.getListChanged()).toBe(false);
    expect(debounced.getTools()).toEqual([]);
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
      await set; // wait for the debounced notification to set the flag
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
      await set; // wait for the debounced notification to set the flag
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
