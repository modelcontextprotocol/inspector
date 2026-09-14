import { describe, it, expect, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import type { MessageEntry } from "@inspector/core/mcp/types.js";
import { renderWithMantine, screen } from "../../../test/renderWithMantine";
import { getAceText, setAceText } from "../../../test/aceEditor";
import { ProtocolEntry } from "./ProtocolEntry";

const successEntry: MessageEntry = {
  id: "req-1",
  timestamp: new Date("2026-03-17T10:30:00Z"),
  direction: "request",
  origin: "client",
  message: {
    jsonrpc: "2.0",
    id: 1,
    method: "tools/call",
    params: { name: "get_weather", arguments: { city: "San Francisco" } },
  },
  response: {
    jsonrpc: "2.0",
    id: 1,
    result: {
      content: [{ type: "text", text: "18C" }],
    },
  },
  duration: 142,
};

const errorEntry: MessageEntry = {
  id: "req-2",
  timestamp: new Date("2026-03-17T10:31:15Z"),
  direction: "request",
  message: {
    jsonrpc: "2.0",
    id: 2,
    method: "tools/call",
    params: { name: "query_database" },
  },
  response: {
    jsonrpc: "2.0",
    id: 2,
    error: { code: -32000, message: "Connection timeout" },
  },
  duration: 3200,
};

const resourceReadEntry: MessageEntry = {
  id: "req-3",
  timestamp: new Date("2026-03-17T10:33:00Z"),
  direction: "request",
  message: {
    jsonrpc: "2.0",
    id: 3,
    method: "resources/read",
    params: { uri: "file:///config.json" },
  },
  response: {
    jsonrpc: "2.0",
    id: 3,
    result: {
      contents: [{ uri: "file:///config.json", text: '{"debug": true}' }],
    },
  },
  duration: 45,
};

const pendingEntry: MessageEntry = {
  id: "req-4",
  timestamp: new Date("2026-03-17T10:34:00Z"),
  direction: "request",
  message: {
    jsonrpc: "2.0",
    id: 4,
    method: "tools/call",
    params: { name: "long_operation" },
  },
};

const noParamsEntry: MessageEntry = {
  id: "req-5",
  timestamp: new Date("2026-03-17T10:35:00Z"),
  direction: "request",
  message: {
    jsonrpc: "2.0",
    id: 5,
    method: "tools/list",
  },
  response: {
    jsonrpc: "2.0",
    id: 5,
    result: { tools: [] },
  },
};

const notificationEntry: MessageEntry = {
  id: "note-1",
  timestamp: new Date("2026-03-17T10:36:00Z"),
  direction: "notification",
  origin: "server",
  message: {
    jsonrpc: "2.0",
    method: "notifications/message",
    params: {
      level: "info",
      logger: "everything-server",
      data: "Roots updated: 2 root(s) received from client",
    },
  },
};

const baseProps = {
  isPinned: false,
  isListExpanded: false,
  onReplay: vi.fn(),
  onTogglePin: vi.fn(),
};

describe("ProtocolEntry", () => {
  it("renders the method, target name, status OK, and duration", () => {
    renderWithMantine(<ProtocolEntry {...baseProps} entry={successEntry} />);
    expect(screen.getByText("tools/call")).toBeInTheDocument();
    expect(screen.getByText("get_weather")).toBeInTheDocument();
    expect(screen.getByText("OK")).toBeInTheDocument();
    expect(screen.getByText("142ms")).toBeInTheDocument();
  });

  it("renders the URI target for resources/read", () => {
    renderWithMantine(
      <ProtocolEntry {...baseProps} entry={resourceReadEntry} />,
    );
    expect(screen.getByText("file:///config.json")).toBeInTheDocument();
    expect(screen.getByText("resources/read")).toBeInTheDocument();
  });

  it("adds a Copy button beside a resource URI target, but not a tool name", () => {
    const { rerender } = renderWithMantine(
      <ProtocolEntry {...baseProps} entry={successEntry} />,
    );
    const withoutResource = screen.queryAllByRole("button", {
      name: "Copy",
    }).length;
    rerender(<ProtocolEntry {...baseProps} entry={resourceReadEntry} />);
    // The resource entry has exactly one more Copy button — the one beside its
    // URI target (both entries otherwise carry the same expanded ContentViewer
    // copy affordances).
    expect(screen.queryAllByRole("button", { name: "Copy" }).length).toBe(
      withoutResource + 1,
    );
  });

  it("renders Error status when response has error", () => {
    renderWithMantine(<ProtocolEntry {...baseProps} entry={errorEntry} />);
    expect(screen.getByText("Error")).toBeInTheDocument();
  });

  it("renders Pending status when no response present", () => {
    renderWithMantine(<ProtocolEntry {...baseProps} entry={pendingEntry} />);
    expect(screen.getByText("Pending")).toBeInTheDocument();
  });

  it("renders no request-style status badge for a notification", () => {
    renderWithMantine(
      <ProtocolEntry {...baseProps} entry={notificationEntry} />,
    );
    // The method badge still labels it; there is no Pending/OK/Error badge,
    // since a fire-and-forget notification has no request lifecycle.
    expect(screen.getByText("notifications/message")).toBeInTheDocument();
    expect(screen.queryByText("Pending")).not.toBeInTheDocument();
    expect(screen.queryByText("OK")).not.toBeInTheDocument();
    expect(screen.queryByText("Error")).not.toBeInTheDocument();
  });

  it("shows client → server for a client-originated entry", () => {
    renderWithMantine(<ProtocolEntry {...baseProps} entry={successEntry} />);
    expect(screen.getByText("client → server")).toBeInTheDocument();
  });

  it("shows server → client for a server-originated entry", () => {
    renderWithMantine(
      <ProtocolEntry {...baseProps} entry={notificationEntry} />,
    );
    expect(screen.getByText("server → client")).toBeInTheDocument();
  });

  it("renders Pin label when not pinned", () => {
    renderWithMantine(<ProtocolEntry {...baseProps} entry={successEntry} />);
    expect(screen.getByRole("button", { name: "Pin" })).toBeInTheDocument();
  });

  it("renders Unpin label when pinned", () => {
    renderWithMantine(
      <ProtocolEntry {...baseProps} entry={successEntry} isPinned={true} />,
    );
    expect(screen.getByRole("button", { name: "Unpin" })).toBeInTheDocument();
  });

  it("invokes onReplay when Replay button is clicked", async () => {
    const user = userEvent.setup();
    const onReplay = vi.fn();
    renderWithMantine(
      <ProtocolEntry {...baseProps} entry={successEntry} onReplay={onReplay} />,
    );
    await user.click(screen.getByRole("button", { name: "Replay" }));
    expect(onReplay).toHaveBeenCalledTimes(1);
  });

  // Edit-and-replay is a second way to *supply* the params, not a second replay
  // implementation — it dispatches through the same `onReplay` (#2151).
  describe("edit and replay (#2151)", () => {
    async function openEditor(user: ReturnType<typeof userEvent.setup>) {
      await user.click(screen.getByRole("button", { name: "Edit and replay" }));
    }

    it("seeds the editor with the entry's params", async () => {
      const user = userEvent.setup();
      renderWithMantine(<ProtocolEntry {...baseProps} entry={successEntry} />);
      await openEditor(user);
      expect(JSON.parse(getAceText())).toEqual({
        name: "get_weather",
        arguments: { city: "San Francisco" },
      });
    });

    // The entry's frame carries `_meta.progressToken`, which replay cannot
    // re-send — so it must not appear in the editor as though it could.
    it("seeds only the params replay will actually read", async () => {
      const user = userEvent.setup();
      const withMeta: MessageEntry = {
        ...successEntry,
        message: {
          ...successEntry.message,
          params: {
            name: "get_weather",
            arguments: { city: "San Francisco" },
            _meta: { progressToken: 2 },
          },
        },
      } as MessageEntry;
      renderWithMantine(<ProtocolEntry {...baseProps} entry={withMeta} />);
      await openEditor(user);

      expect(getAceText()).not.toContain("_meta");
      expect(screen.getByText(/`_meta` is not re-sent/)).toBeInTheDocument();
    });

    it("replays with the edited params", async () => {
      const user = userEvent.setup();
      const onReplay = vi.fn();
      renderWithMantine(
        <ProtocolEntry
          {...baseProps}
          entry={successEntry}
          onReplay={onReplay}
        />,
      );
      await openEditor(user);
      await setAceText('{"name":"get_weather","arguments":{"city":"Boston"}}');
      await user.click(screen.getByRole("button", { name: "Send" }));

      expect(onReplay).toHaveBeenCalledWith({
        name: "get_weather",
        arguments: { city: "Boston" },
      });
      // And the modal is gone — the entry itself is unchanged.
      expect(screen.queryByRole("button", { name: "Send" })).toBeNull();
    });

    it("replays verbatim from the plain Replay button", async () => {
      const user = userEvent.setup();
      const onReplay = vi.fn();
      renderWithMantine(
        <ProtocolEntry
          {...baseProps}
          entry={successEntry}
          onReplay={onReplay}
        />,
      );
      await user.click(screen.getByRole("button", { name: "Replay" }));
      // No argument at all: "not edited" has to be distinguishable from
      // "edited to no params" one level up.
      expect(onReplay).toHaveBeenCalledWith();
    });

    it("is offered only where Replay is", () => {
      const notification: MessageEntry = {
        id: "note-1",
        timestamp: new Date(),
        direction: "notification",
        message: { jsonrpc: "2.0", method: "notifications/message" },
      };
      renderWithMantine(<ProtocolEntry {...baseProps} entry={notification} />);
      expect(
        screen.queryByRole("button", { name: "Edit and replay" }),
      ).toBeNull();
    });

    it("is offered in the compact layout too", () => {
      renderWithMantine(
        <ProtocolEntry {...baseProps} entry={successEntry} embedded />,
      );
      expect(
        screen.getByRole("button", { name: "Edit and replay" }),
      ).toBeInTheDocument();
    });
  });

  it("hides the Replay button for a method that can't be replayed", () => {
    // A notification isn't a replayable client→server request.
    renderWithMantine(
      <ProtocolEntry {...baseProps} entry={notificationEntry} />,
    );
    expect(
      screen.queryByRole("button", { name: "Replay" }),
    ).not.toBeInTheDocument();
    // Pin stays available.
    expect(screen.getByRole("button", { name: "Pin" })).toBeInTheDocument();
  });

  it("orders the actions Replay, then Pin, then the expand toggle on the right", () => {
    renderWithMantine(<ProtocolEntry {...baseProps} entry={successEntry} />);
    const names = screen
      .getAllByRole("button")
      .map((b) => b.getAttribute("aria-label") ?? b.textContent);
    expect(names.indexOf("Replay")).toBeLessThan(names.indexOf("Pin"));
    expect(names.indexOf("Pin")).toBeLessThan(names.indexOf("Expand"));
  });

  it("renders the compact two-line layout with Replay as an icon when embedded", () => {
    renderWithMantine(
      <ProtocolEntry {...baseProps} entry={successEntry} embedded />,
    );
    // Line 1 essentials plus the method are still shown. The timestamp is the
    // compact time-only form (not the full ISO) to fit the narrow line.
    expect(screen.getByText("10:30:00")).toBeInTheDocument();
    expect(
      screen.queryByText("2026-03-17T10:30:00.000Z"),
    ).not.toBeInTheDocument();
    expect(screen.getByText("client → server")).toBeInTheDocument();
    expect(screen.getByText("142ms")).toBeInTheDocument();
    expect(screen.getByText("OK")).toBeInTheDocument();
    expect(screen.getByText("tools/call")).toBeInTheDocument();
    // Replay is an icon button (aria-label), not the text button.
    expect(screen.getByRole("button", { name: "Replay" })).toBeInTheDocument();
    expect(screen.queryByText("Replay")).toBeNull();
  });

  it("keeps action order Replay, Pin, Expand in the compact layout", () => {
    renderWithMantine(
      <ProtocolEntry {...baseProps} entry={successEntry} embedded />,
    );
    const names = screen
      .getAllByRole("button")
      .map((b) => b.getAttribute("aria-label") ?? b.textContent);
    expect(names.indexOf("Replay")).toBeLessThan(names.indexOf("Pin"));
    expect(names.indexOf("Pin")).toBeLessThan(names.indexOf("Expand"));
  });

  it("does not render a Replay icon for a non-replayable method when embedded", () => {
    // A server→client response isn't replayable.
    const responseEntry: MessageEntry = {
      id: "resp-1",
      timestamp: new Date("2026-03-17T10:30:00Z"),
      direction: "response",
      origin: "server",
      message: { jsonrpc: "2.0", id: 1, result: {} },
    };
    renderWithMantine(
      <ProtocolEntry {...baseProps} entry={responseEntry} embedded />,
    );
    expect(
      screen.queryByRole("button", { name: "Replay" }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Pin" })).toBeInTheDocument();
  });

  it("invokes onTogglePin when Pin button is clicked", async () => {
    const user = userEvent.setup();
    const onTogglePin = vi.fn();
    renderWithMantine(
      <ProtocolEntry
        {...baseProps}
        entry={successEntry}
        onTogglePin={onTogglePin}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Pin" }));
    expect(onTogglePin).toHaveBeenCalledTimes(1);
  });

  it("toggles the local expand/collapse state when clicking Expand/Collapse", async () => {
    const user = userEvent.setup();
    renderWithMantine(<ProtocolEntry {...baseProps} entry={successEntry} />);
    expect(screen.getByRole("button", { name: "Expand" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Expand" }));
    expect(
      screen.getByRole("button", { name: "Collapse" }),
    ).toBeInTheDocument();
  });

  it("toggles the local expand/collapse state when clicking Expand/Collapse in the compact layout", async () => {
    const user = userEvent.setup();
    renderWithMantine(
      <ProtocolEntry {...baseProps} entry={successEntry} embedded />,
    );
    expect(screen.getByRole("button", { name: "Expand" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Expand" }));
    expect(
      screen.getByRole("button", { name: "Collapse" }),
    ).toBeInTheDocument();
  });

  it("starts expanded when isListExpanded is true and shows Parameters and Response", () => {
    renderWithMantine(
      <ProtocolEntry
        {...baseProps}
        entry={successEntry}
        isListExpanded={true}
      />,
    );
    expect(screen.getByText("Parameters:")).toBeInTheDocument();
    expect(screen.getByText("Response:")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Collapse" }),
    ).toBeInTheDocument();
  });

  it("syncs the local expanded state when isListExpanded prop changes", () => {
    const { rerender } = renderWithMantine(
      <ProtocolEntry {...baseProps} entry={successEntry} />,
    );
    expect(screen.getByRole("button", { name: "Expand" })).toBeInTheDocument();
    rerender(
      <ProtocolEntry
        {...baseProps}
        entry={successEntry}
        isListExpanded={true}
      />,
    );
    expect(
      screen.getByRole("button", { name: "Collapse" }),
    ).toBeInTheDocument();
  });

  // Both payloads render the same kind of control, so without distinct names a
  // screen reader announces them identically.
  it("names the parameters and response editors distinctly", () => {
    renderWithMantine(
      <ProtocolEntry
        {...baseProps}
        entry={successEntry}
        isListExpanded={true}
      />,
    );
    expect(
      screen.getByLabelText(/tools\/call request parameters JSON/),
    ).toBeInTheDocument();
    expect(
      screen.getByLabelText(/tools\/call response JSON/),
    ).toBeInTheDocument();
  });

  it("does not render the Parameters section when message has no params", () => {
    renderWithMantine(
      <ProtocolEntry
        {...baseProps}
        entry={noParamsEntry}
        isListExpanded={true}
      />,
    );
    expect(screen.queryByText("Parameters:")).not.toBeInTheDocument();
    expect(screen.getByText("Response:")).toBeInTheDocument();
  });

  it("does not render the Response section when no response is present", () => {
    renderWithMantine(
      <ProtocolEntry
        {...baseProps}
        entry={pendingEntry}
        isListExpanded={true}
      />,
    );
    expect(screen.getByText("Parameters:")).toBeInTheDocument();
    expect(screen.queryByText("Response:")).not.toBeInTheDocument();
  });

  it("does not render duration when duration is undefined", () => {
    renderWithMantine(<ProtocolEntry {...baseProps} entry={pendingEntry} />);
    expect(screen.queryByText(/ms$/)).not.toBeInTheDocument();
  });
});

// --- Modern-era (2026-07-28) vocabulary rendering ---------------------------

const inputRequiredEntry: MessageEntry = {
  id: "mrtr-1",
  timestamp: new Date("2026-07-28T10:00:00Z"),
  direction: "request",
  origin: "client",
  message: {
    jsonrpc: "2.0",
    id: 1,
    method: "tools/call",
    params: { name: "book_flight" },
  },
  response: {
    jsonrpc: "2.0",
    id: 1,
    result: {
      resultType: "input_required",
      requestState: "opaque-token",
      inputRequests: { "1": { method: "elicitation/create", params: {} } },
    },
  },
};

const completeEntry: MessageEntry = {
  id: "mrtr-2",
  timestamp: new Date("2026-07-28T10:00:02Z"),
  direction: "request",
  origin: "client",
  message: {
    jsonrpc: "2.0",
    id: 2,
    method: "tools/call",
    params: { name: "book_flight", requestState: "opaque-token" },
  },
  response: {
    jsonrpc: "2.0",
    id: 2,
    result: { resultType: "complete", content: [{ type: "text", text: "ok" }] },
  },
};

const discoverEntry: MessageEntry = {
  id: "disc-1",
  timestamp: new Date("2026-07-28T09:59:00Z"),
  direction: "request",
  origin: "client",
  message: { jsonrpc: "2.0", id: 0, method: "server/discover" },
  response: {
    jsonrpc: "2.0",
    id: 0,
    result: { supportedVersions: ["2026-07-28"], capabilities: {} },
  },
};

const subscriptionNotificationEntry: MessageEntry = {
  id: "sub-1",
  timestamp: new Date("2026-07-28T10:05:00Z"),
  direction: "notification",
  origin: "server",
  message: {
    jsonrpc: "2.0",
    method: "notifications/resources/list_changed",
    params: {
      _meta: { "io.modelcontextprotocol/subscriptionId": "sub-abc" },
    },
  },
};

describe("ProtocolEntry — modern vocabulary", () => {
  it("labels an input_required result", () => {
    renderWithMantine(
      <ProtocolEntry {...baseProps} entry={inputRequiredEntry} />,
    );
    expect(screen.getByText("input required")).toBeInTheDocument();
  });

  it("labels a modern complete result", () => {
    renderWithMantine(<ProtocolEntry {...baseProps} entry={completeEntry} />);
    expect(screen.getByText("complete")).toBeInTheDocument();
  });

  it("suppresses the redundant OK status badge when a resultType badge shows", () => {
    // A modern success carries both a green OK (transport-level) and a
    // resultType badge; the resultType is the single signal, so OK is hidden.
    renderWithMantine(<ProtocolEntry {...baseProps} entry={completeEntry} />);
    expect(screen.getByText("complete")).toBeInTheDocument();
    expect(screen.queryByText("OK")).not.toBeInTheDocument();
  });

  it("still shows the OK status badge on a legacy result with no resultType", () => {
    renderWithMantine(<ProtocolEntry {...baseProps} entry={successEntry} />);
    expect(screen.getByText("OK")).toBeInTheDocument();
  });

  it("does not label resultType on a legacy result", () => {
    renderWithMantine(<ProtocolEntry {...baseProps} entry={successEntry} />);
    expect(screen.queryByText("input required")).not.toBeInTheDocument();
    expect(screen.queryByText("complete")).not.toBeInTheDocument();
  });

  it("renders a modern-only frame's method (no per-frame era badge)", () => {
    renderWithMantine(<ProtocolEntry {...baseProps} entry={discoverEntry} />);
    expect(screen.getByText("server/discover")).toBeInTheDocument();
    // The connection era is shown once in the panel header, not per entry.
    expect(screen.queryByText("modern")).not.toBeInTheDocument();
  });

  it("shows a copyable subscriptionId on a tagged notification", () => {
    renderWithMantine(
      <ProtocolEntry {...baseProps} entry={subscriptionNotificationEntry} />,
    );
    expect(screen.getByText("sub-abc")).toBeInTheDocument();
    // One Copy button beside the subscription id (the notification carries no
    // params ContentViewer copy affordance when collapsed).
    expect(
      screen.getAllByRole("button", { name: "Copy" }).length,
    ).toBeGreaterThanOrEqual(1);
  });

  it("shows the subscriptionId in the embedded compact layout", () => {
    renderWithMantine(
      <ProtocolEntry
        {...baseProps}
        entry={subscriptionNotificationEntry}
        embedded
      />,
    );
    expect(screen.getByText("sub-abc")).toBeInTheDocument();
  });

  it("shows the modern badges in the embedded compact layout", () => {
    renderWithMantine(
      <ProtocolEntry {...baseProps} entry={inputRequiredEntry} embedded />,
    );
    expect(screen.getByText("input required")).toBeInTheDocument();
  });

  describe("modern spec-error chip (SEP-2243 / SEP-2575)", () => {
    const headerMismatchEntry: MessageEntry = {
      id: "req-err-20",
      timestamp: new Date("2026-07-28T10:30:00Z"),
      direction: "request",
      origin: "client",
      message: {
        jsonrpc: "2.0",
        id: 20,
        method: "tools/call",
        params: { name: "get_weather" },
      },
      response: {
        jsonrpc: "2.0",
        id: 20,
        error: { code: -32020, message: "Mcp-Method mismatch" },
      },
      duration: 12,
    };

    it("chips a -32020 HeaderMismatch and explains it in the expanded alert", () => {
      renderWithMantine(
        <ProtocolEntry
          {...baseProps}
          entry={headerMismatchEntry}
          isListExpanded={true}
        />,
      );
      // Chip on the header row + title in the expanded alert.
      expect(
        screen.getAllByText("-32020 HeaderMismatch").length,
      ).toBeGreaterThan(0);
      expect(
        screen.getByText(/An Mcp-\* header did not match/),
      ).toBeInTheDocument();
    });

    it("lists the supported versions for a -32022", () => {
      const entry: MessageEntry = {
        ...headerMismatchEntry,
        id: "req-err-22",
        response: {
          jsonrpc: "2.0",
          id: 20,
          error: {
            code: -32022,
            message: "unsupported",
            data: { supported: ["2025-11-25", "2026-07-28"] },
          },
        },
      };
      renderWithMantine(
        <ProtocolEntry {...baseProps} entry={entry} isListExpanded={true} />,
      );
      expect(
        screen.getByText(/Server supports: 2025-11-25, 2026-07-28/),
      ).toBeInTheDocument();
    });

    const methodNotFoundEntry: MessageEntry = {
      ...headerMismatchEntry,
      id: "req-err-601",
      response: {
        jsonrpc: "2.0",
        id: 20,
        error: { code: -32601, message: "Method not found" },
      },
    };

    it("recognises a -32601 folded onto the request when the correlated fetch is a 404", () => {
      // -32601 arrives as HTTP 404 and is folded onto the pending request by
      // enrichProtocolEntries; the 404 status marks it as the modern taxonomy.
      renderWithMantine(
        <ProtocolEntry
          {...baseProps}
          entry={methodNotFoundEntry}
          correlatedHttpStatus={404}
        />,
      );
      expect(
        screen.getAllByText("-32601 MethodNotFound").length,
      ).toBeGreaterThan(0);
    });

    it("does NOT dress up an ordinary in-band -32601 on a 200 as the modern spec error", () => {
      // A server returning -32601 in-band on HTTP 200 for an unsupported method
      // is a plain JSON-RPC error, not the modern 404 taxonomy — no spec chip,
      // no 404-asserting alert, and no reveal link.
      renderWithMantine(
        <ProtocolEntry
          {...baseProps}
          entry={methodNotFoundEntry}
          isListExpanded={true}
          correlatedHttpStatus={200}
          onRevealInNetwork={() => {}}
        />,
      );
      expect(screen.queryByText("-32601 MethodNotFound")).toBeNull();
      expect(
        screen.queryByRole("button", { name: /View the HTTP request/ }),
      ).not.toBeInTheDocument();
      // ...but it still renders as an ordinary Error.
      expect(screen.getAllByText("Error").length).toBeGreaterThan(0);
    });

    it("does NOT modern-frame a -32601 with no correlated fetch (e.g. stdio)", () => {
      // Over stdio there is no Network entry at all, so correlatedHttpStatus is
      // undefined. An unknown status is not a 404, so an unsupported-method probe
      // is a plain error — no modern badge, no 404-asserting copy.
      renderWithMantine(
        <ProtocolEntry
          {...baseProps}
          entry={methodNotFoundEntry}
          isListExpanded={true}
        />,
      );
      expect(screen.queryByText("-32601 MethodNotFound")).toBeNull();
      expect(screen.getAllByText("Error").length).toBeGreaterThan(0);
    });

    it("does not chip an ordinary (non-spec) error like -32000", () => {
      renderWithMantine(<ProtocolEntry {...baseProps} entry={errorEntry} />);
      // errorEntry carries -32000 (implementation-defined) → no spec chip.
      expect(screen.queryByText(/HeaderMismatch|MethodNotFound/)).toBeNull();
      // ...but it still renders as an Error.
      expect(screen.getByText("Error")).toBeInTheDocument();
    });

    it("shows a 'view in Network' link when onRevealInNetwork is provided, and calls it", async () => {
      const user = userEvent.setup();
      const onReveal = vi.fn();
      renderWithMantine(
        <ProtocolEntry
          {...baseProps}
          entry={headerMismatchEntry}
          isListExpanded={true}
          onRevealInNetwork={onReveal}
        />,
      );
      const link = screen.getByRole("button", {
        name: /View the HTTP request in the Network tab/,
      });
      await user.click(link);
      expect(onReveal).toHaveBeenCalledTimes(1);
    });

    it("omits the reveal link when there is no correlated Network entry", () => {
      renderWithMantine(
        <ProtocolEntry
          {...baseProps}
          entry={headerMismatchEntry}
          isListExpanded={true}
        />,
      );
      expect(
        screen.queryByRole("button", { name: /View the HTTP request/ }),
      ).not.toBeInTheDocument();
    });

    it("omits the reveal link for a protocol-only error even with a correlation", () => {
      // -32021 MissingRequiredClientCapability is not header/HTTP related, so
      // no link — even though a callback (correlated entry) is supplied.
      const capabilityEntry: MessageEntry = {
        ...headerMismatchEntry,
        id: "req-err-21",
        response: {
          jsonrpc: "2.0",
          id: 20,
          error: { code: -32021, message: "missing capability" },
        },
      };
      renderWithMantine(
        <ProtocolEntry
          {...baseProps}
          entry={capabilityEntry}
          isListExpanded={true}
          onRevealInNetwork={() => {}}
        />,
      );
      expect(
        screen.getAllByText("-32021 MissingRequiredClientCapability").length,
      ).toBeGreaterThan(0);
      expect(
        screen.queryByRole("button", { name: /View the HTTP request/ }),
      ).not.toBeInTheDocument();
    });

    it("shows the chip only in the wide layout, not the compact sidebar row", () => {
      // Compact: only the expanded-detail alert carries the label (1 match); no
      // row chip. Wide: the row chip AND the alert (2 matches).
      const { unmount } = renderWithMantine(
        <ProtocolEntry {...baseProps} entry={headerMismatchEntry} embedded />,
      );
      expect(screen.getAllByText("-32020 HeaderMismatch")).toHaveLength(1);
      unmount();

      renderWithMantine(
        <ProtocolEntry {...baseProps} entry={headerMismatchEntry} />,
      );
      expect(screen.getAllByText("-32020 HeaderMismatch")).toHaveLength(2);
    });
  });
});

// A response the server answered successfully but the CLIENT then refused —
// e.g. the SDK's era codec rejecting a 2026-07-28 list result missing
// `ttlMs`/`cacheScope`. The wire frame is a valid JSON-RPC result, so before
// #1953 this rendered as a clean success.
describe("ProtocolEntry — client-rejected response", () => {
  const REASON = "Invalid result for tools/list: ttlMs required";

  const rejectedEntry: MessageEntry = {
    id: "rej-1",
    timestamp: new Date("2026-07-28T10:00:00Z"),
    direction: "request",
    origin: "client",
    message: { jsonrpc: "2.0", id: 9, method: "tools/list", params: {} },
    response: {
      jsonrpc: "2.0",
      id: 9,
      result: { resultType: "complete", tools: [] },
    },
    clientError: REASON,
  };

  it("renders Error rather than a success status", () => {
    renderWithMantine(<ProtocolEntry {...baseProps} entry={rejectedEntry} />);
    expect(screen.getByText("Error")).toBeInTheDocument();
    expect(screen.queryByText("OK")).not.toBeInTheDocument();
  });

  it("shows the Error badge even though a resultType badge is present", () => {
    // The resultType normally suppresses the status badge (a modern success
    // says "complete"). A rejected result must not hide behind it — the wire
    // said complete, the client disagreed, and both are worth seeing.
    renderWithMantine(<ProtocolEntry {...baseProps} entry={rejectedEntry} />);
    expect(screen.getByText("complete")).toBeInTheDocument();
    expect(screen.getByText("Error")).toBeInTheDocument();
  });

  it("names the Inspector as the rejecter and gives the reason when expanded", () => {
    renderWithMantine(
      <ProtocolEntry {...baseProps} entry={rejectedEntry} isListExpanded />,
    );
    expect(screen.getByText("Rejected by the Inspector")).toBeInTheDocument();
    expect(screen.getByText(REASON)).toBeInTheDocument();
  });

  // messageLogState falls back to the standalone response frame when no request
  // entry was there to fold into (a trimmed log, or a reconnect boundary). That
  // entry is not `direction: "request"`, so the request-only status lifecycle
  // would have rendered it without any badge at all.
  const rejectedStandaloneResponse: MessageEntry = {
    id: "rej-standalone",
    timestamp: new Date("2026-07-28T10:00:00Z"),
    direction: "response",
    origin: "server",
    message: {
      jsonrpc: "2.0",
      id: 11,
      result: { resultType: "complete", tools: [] },
    },
    clientError: REASON,
  };

  it("renders Error on a rejected standalone response entry", () => {
    renderWithMantine(
      <ProtocolEntry {...baseProps} entry={rejectedStandaloneResponse} />,
    );
    expect(screen.getByText("Error")).toBeInTheDocument();
  });

  it("still renders no status badge on an unrejected standalone response", () => {
    const clean: MessageEntry = {
      ...rejectedStandaloneResponse,
      clientError: undefined,
    };
    renderWithMantine(<ProtocolEntry {...baseProps} entry={clean} />);
    expect(screen.queryByText("Error")).not.toBeInTheDocument();
    expect(screen.queryByText("OK")).not.toBeInTheDocument();
    expect(screen.queryByText("Pending")).not.toBeInTheDocument();
  });

  it("shows no rejection alert on an ordinary success", () => {
    renderWithMantine(
      <ProtocolEntry {...baseProps} entry={successEntry} isListExpanded />,
    );
    expect(
      screen.queryByText("Rejected by the Inspector"),
    ).not.toBeInTheDocument();
  });
});
