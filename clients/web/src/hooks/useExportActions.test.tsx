import { describe, it, expect, beforeEach, vi } from "vitest";
import { act } from "react";
import type { Tool } from "@modelcontextprotocol/client";
import type { MessageEntry } from "@inspector/core/mcp/types.js";
import type { InspectorClient } from "@inspector/core/mcp/index.js";
import { renderWithMantine } from "../test/renderWithMantine";
import {
  useExportActions,
  type ExportActions,
  type UseExportActionsParams,
} from "./useExportActions";

const { notificationsMock } = vi.hoisted(() => ({
  notificationsMock: { show: vi.fn(), update: vi.fn(), hide: vi.fn() },
}));
vi.mock("@mantine/notifications", () => ({
  notifications: notificationsMock,
}));

// The download is a DOM side effect; the assertions here are about *what* was
// serialized and under which filename, so the writer itself is spied on.
const { downloadJsonFile } = vi.hoisted(() => ({
  downloadJsonFile: vi.fn(),
}));
vi.mock("../lib/downloadFile", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/downloadFile")>()),
  downloadJsonFile,
}));

const { replayProtocolRequest } = vi.hoisted(() => ({
  replayProtocolRequest: vi.fn(),
}));
vi.mock("../lib/protocolReplay", () => ({ replayProtocolRequest }));

const AT = new Date(0);

const request = (id: string, method: string): MessageEntry => ({
  id,
  direction: "request",
  timestamp: AT,
  message: { jsonrpc: "2.0", id: 1, method, params: { a: 1 } },
});

const logNotification = (id: string): MessageEntry => ({
  id,
  direction: "notification",
  timestamp: AT,
  message: { jsonrpc: "2.0", method: "notifications/message" },
});

function harness(overrides: Partial<UseExportActionsParams> = {}) {
  const messageLogState = { clearMessages: vi.fn() };
  const fetchRequestLogState = { clearFetchRequests: vi.fn() };
  const stderrLogState = { clearStderrLogs: vi.fn() };
  const setPinnedProtocolIds = vi.fn();
  const params: UseExportActionsParams = {
    activeServerId: "srv",
    // Structurally checked against the hook's narrowed store parameters — each
    // names only the clearing method these handlers call.
    messageLogState,
    fetchRequestLogState,
    stderrLogState,
    messages: [],
    fetchRequests: [],
    logs: [],
    stderrLogs: [],
    pinnedProtocolIds: new Set<string>(),
    setPinnedProtocolIds,
    inspectorClient: {} as InspectorClient,
    tools: [] as Tool[],
    ...overrides,
  };
  let latest: ExportActions | undefined;
  function Probe() {
    latest = useExportActions(params);
    return null;
  }
  renderWithMantine(<Probe />);
  return {
    messageLogState,
    fetchRequestLogState,
    stderrLogState,
    setPinnedProtocolIds,
    run: (fn: (api: ExportActions) => void) =>
      act(() => {
        if (!latest) throw new Error("hook did not render");
        fn(latest);
      }),
    /** The JSON handed to the writer, parsed. */
    exported: () => JSON.parse(downloadJsonFile.mock.calls[0][1] as string),
    filename: () => downloadJsonFile.mock.calls[0][0] as string,
  };
}

describe("useExportActions", () => {
  beforeEach(() => {
    downloadJsonFile.mockClear();
    replayProtocolRequest.mockReset();
    notificationsMock.show.mockClear();
  });

  describe("clear", () => {
    it("clears only the log notifications from the message log", () => {
      const h = harness();
      h.run((api) => api.onClearLogs());
      const predicate = h.messageLogState.clearMessages.mock.calls[0][0] as (
        m: MessageEntry,
      ) => boolean;
      expect(predicate(logNotification("n1"))).toBe(true);
      expect(predicate(request("r1", "tools/call"))).toBe(false);
    });

    it("keeps pinned entries when clearing the protocol panel", () => {
      const h = harness({ pinnedProtocolIds: new Set(["keep"]) });
      h.run((api) => api.onClearProtocol());
      const predicate = h.messageLogState.clearMessages.mock.calls[0][0] as (
        m: MessageEntry,
      ) => boolean;
      expect(predicate(request("keep", "ping"))).toBe(false);
      expect(predicate(request("other", "ping"))).toBe(true);
    });

    it("clears one protocol section by pin membership", () => {
      const h = harness({ pinnedProtocolIds: new Set(["keep"]) });
      h.run((api) => api.onClearProtocolSection("history"));
      let predicate = h.messageLogState.clearMessages.mock.calls[0][0] as (
        m: MessageEntry,
      ) => boolean;
      expect(predicate(request("keep", "ping"))).toBe(false);
      expect(h.setPinnedProtocolIds).not.toHaveBeenCalled();

      h.run((api) => api.onClearProtocolSection("pinned"));
      predicate = h.messageLogState.clearMessages.mock.calls[1][0] as (
        m: MessageEntry,
      ) => boolean;
      expect(predicate(request("keep", "ping"))).toBe(true);
      // Clearing the pinned section drops the now-stale id set.
      expect(h.setPinnedProtocolIds).toHaveBeenCalledWith(new Set());
    });

    it("clears the network and console stores", () => {
      const h = harness();
      h.run((api) => {
        api.onClearNetwork();
        api.onClearConsole();
      });
      expect(h.fetchRequestLogState.clearFetchRequests).toHaveBeenCalled();
      expect(h.stderrLogState.clearStderrLogs).toHaveBeenCalled();
    });

    it("no-ops when the stores are absent", () => {
      const h = harness({
        messageLogState: null,
        fetchRequestLogState: null,
        stderrLogState: null,
      });
      h.run((api) => {
        api.onClearLogs();
        api.onClearProtocol();
        api.onClearNetwork();
        api.onClearConsole();
        api.onClearProtocolSection("pinned");
      });
      expect(h.messageLogState.clearMessages).not.toHaveBeenCalled();
    });
  });

  describe("export", () => {
    it("stamps the server id and the kind into the filename", () => {
      const h = harness({ logs: [{ level: "info" }] as never });
      h.run((api) => api.onExportLogs());
      expect(h.filename()).toMatch(/^inspector-logs-srv-.*\.json$/);
    });

    it("writes each view's entries", () => {
      const cases: [keyof ExportActions, Partial<UseExportActionsParams>][] = [
        ["onExportProtocol", { messages: [request("r1", "ping")] }],
        ["onExportNetwork", { fetchRequests: [{ id: "f1" }] as never }],
        ["onExportLogs", { logs: [{ id: "l1" }] as never }],
        ["onExportConsole", { stderrLogs: [{ id: "s1" }] as never }],
      ];
      for (const [action, params] of cases) {
        downloadJsonFile.mockClear();
        const h = harness(params);
        h.run((api) => (api[action] as () => void)());
        expect(h.exported()).toHaveLength(1);
      }
    });

    it("writes nothing when the view is empty", () => {
      const h = harness();
      h.run((api) => {
        api.onExportLogs();
        api.onExportProtocol();
        api.onExportNetwork();
        api.onExportConsole();
        api.onExportProtocolSection("pinned");
        api.onExportProtocolSection("history");
      });
      expect(downloadJsonFile).not.toHaveBeenCalled();
    });

    it("exports one protocol section by pin membership", () => {
      const h = harness({
        messages: [request("keep", "ping"), request("other", "ping")],
        pinnedProtocolIds: new Set(["keep"]),
      });
      h.run((api) => api.onExportProtocolSection("pinned"));
      expect(h.filename()).toContain("protocol-pinned");
      expect(h.exported()).toEqual([expect.objectContaining({ id: "keep" })]);

      downloadJsonFile.mockClear();
      h.run((api) => api.onExportProtocolSection("history"));
      expect(h.filename()).toContain("protocol-unpinned");
      expect(h.exported()).toEqual([expect.objectContaining({ id: "other" })]);
    });
  });

  describe("replay", () => {
    it("re-issues the entry's own method and params", async () => {
      replayProtocolRequest.mockResolvedValue(null);
      const h = harness({ messages: [request("r1", "tools/list")] });
      h.run((api) => api.onReplayProtocol("r1"));
      await vi.waitFor(() => {
        expect(replayProtocolRequest).toHaveBeenCalledWith(
          expect.anything(),
          "tools/list",
          { a: 1 },
          [],
        );
      });
      expect(notificationsMock.show).not.toHaveBeenCalled();
    });

    // Edit-and-replay dispatches through this same call, so the only thing that
    // distinguishes it is the params (#2151).
    it("re-issues with edited params when given an override", async () => {
      replayProtocolRequest.mockResolvedValue(null);
      const h = harness({ messages: [request("r1", "tools/list")] });
      h.run((api) => api.onReplayProtocol("r1", { a: 2, b: "x" }));
      await vi.waitFor(() => {
        expect(replayProtocolRequest).toHaveBeenCalledWith(
          expect.anything(),
          "tools/list",
          { a: 2, b: "x" },
          [],
        );
      });
    });

    // `null` is an edit to no params at all — an emptied editor — and must not
    // be read as "no edit", which would silently re-send the original params.
    it("re-issues with no params when the override is null", async () => {
      replayProtocolRequest.mockResolvedValue(null);
      const h = harness({ messages: [request("r1", "tools/list")] });
      h.run((api) => api.onReplayProtocol("r1", null));
      await vi.waitFor(() => {
        expect(replayProtocolRequest).toHaveBeenCalledWith(
          expect.anything(),
          "tools/list",
          undefined,
          [],
        );
      });
    });

    it("surfaces a pre-flight refusal as a toast", async () => {
      replayProtocolRequest.mockResolvedValue("Nope.");
      const h = harness({ messages: [request("r1", "tools/list")] });
      h.run((api) => api.onReplayProtocol("r1"));
      await vi.waitFor(() => {
        expect(notificationsMock.show).toHaveBeenCalledWith(
          expect.objectContaining({ title: "Can't replay", message: "Nope." }),
        );
      });
    });

    it("surfaces a thrown failure as a toast", async () => {
      replayProtocolRequest.mockRejectedValue(new Error("boom"));
      const h = harness({ messages: [request("r1", "tools/list")] });
      h.run((api) => api.onReplayProtocol("r1"));
      await vi.waitFor(() => {
        expect(notificationsMock.show).toHaveBeenCalledWith(
          expect.objectContaining({ title: "Replay failed", message: "boom" }),
        );
      });
    });

    it("stringifies a non-Error rejection", async () => {
      replayProtocolRequest.mockRejectedValue("plain");
      const h = harness({ messages: [request("r1", "tools/list")] });
      h.run((api) => api.onReplayProtocol("r1"));
      await vi.waitFor(() => {
        expect(notificationsMock.show).toHaveBeenCalledWith(
          expect.objectContaining({ message: "plain" }),
        );
      });
    });

    it("does nothing when disconnected, when the id is unknown, or when the entry carries no method", () => {
      const noClient = harness({
        inspectorClient: null,
        messages: [request("r1", "tools/list")],
      });
      noClient.run((api) => api.onReplayProtocol("r1"));

      const unknown = harness({ messages: [request("r1", "tools/list")] });
      unknown.run((api) => api.onReplayProtocol("nope"));

      const result = harness({
        messages: [
          {
            id: "r1",
            direction: "response",
            timestamp: AT,
            message: { jsonrpc: "2.0", id: 1, result: {} },
          },
        ],
      });
      result.run((api) => api.onReplayProtocol("r1"));

      expect(replayProtocolRequest).not.toHaveBeenCalled();
    });

    it("passes no params when the entry declares none", async () => {
      replayProtocolRequest.mockResolvedValue(null);
      const h = harness({
        messages: [
          {
            id: "r1",
            direction: "request",
            timestamp: AT,
            message: { jsonrpc: "2.0", id: 1, method: "ping" },
          },
        ],
      });
      h.run((api) => api.onReplayProtocol("r1"));
      await vi.waitFor(() => {
        expect(replayProtocolRequest).toHaveBeenCalledWith(
          expect.anything(),
          "ping",
          undefined,
          [],
        );
      });
    });
  });
});
