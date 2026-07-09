import { describe, it, expect, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import type {
  ConnectionState,
  MCPServerConfig,
} from "@inspector/core/mcp/types.js";
import { renderWithMantine, screen } from "../../../test/renderWithMantine";
import { ServerCard } from "./ServerCard";

const stdioConfig: MCPServerConfig = {
  command: "npx -y @modelcontextprotocol/server-everything",
};

const httpConfig: MCPServerConfig = {
  type: "streamable-http",
  url: "https://api.example.com/mcp",
};

const sseConfig: MCPServerConfig = {
  type: "sse",
  url: "https://api.example.com/sse",
};

const connected: ConnectionState = {
  status: "connected",
  protocolVersion: "2025-06-18",
};
const disconnected: ConnectionState = { status: "disconnected" };
const connecting: ConnectionState = { status: "connecting" };
const errored: ConnectionState = {
  status: "error",
  retryCount: 2,
  error: { message: "Connection refused", details: "ECONNREFUSED" },
};

const handlers = {
  onToggleConnection: vi.fn(),
  onConnectionInfo: vi.fn(),
  onSettings: vi.fn(),
  onEdit: vi.fn(),
  onClone: vi.fn(),
  onRemove: vi.fn(),
};

const baseProps = {
  id: "srv-1",
  name: "My MCP Server",
  config: stdioConfig,
  info: { name: "My MCP Server", version: "1.2.0" },
  connection: connected,
  ...handlers,
};

describe("ServerCard", () => {
  it("renders the server name and version badge", () => {
    renderWithMantine(<ServerCard {...baseProps} />);
    expect(screen.getByText("My MCP Server")).toBeInTheDocument();
    expect(screen.getByText("1.2.0")).toBeInTheDocument();
  });

  it("renders STDIO transport details", () => {
    renderWithMantine(<ServerCard {...baseProps} />);
    expect(screen.getByText("STDIO")).toBeInTheDocument();
    expect(screen.getByText("Standard I/O")).toBeInTheDocument();
    expect(
      screen.getByText("npx -y @modelcontextprotocol/server-everything"),
    ).toBeInTheDocument();
  });

  it("renders HTTP transport details for streamable-http config", () => {
    renderWithMantine(
      <ServerCard {...baseProps} config={httpConfig} info={undefined} />,
    );
    expect(screen.getByText("HTTP")).toBeInTheDocument();
    expect(screen.getByText("Streamable HTTP")).toBeInTheDocument();
    expect(screen.getByText("https://api.example.com/mcp")).toBeInTheDocument();
  });

  it("renders SSE transport details", () => {
    renderWithMantine(<ServerCard {...baseProps} config={sseConfig} />);
    expect(
      screen.getByText("SSE (Server Sent Events) [deprecated]"),
    ).toBeInTheDocument();
    expect(screen.getByText("https://api.example.com/sse")).toBeInTheDocument();
  });

  it("hides body content in compact mode", () => {
    renderWithMantine(
      <ServerCard {...baseProps} connection={disconnected} compact />,
    );
    expect(screen.queryByText("Standard I/O")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Clone" }),
    ).not.toBeInTheDocument();
  });

  it("invokes action callbacks for Clone, Edit, Remove, Server Info, and Settings", async () => {
    const user = userEvent.setup();
    const onClone = vi.fn();
    const onEdit = vi.fn();
    const onRemove = vi.fn();
    const onConnectionInfo = vi.fn();
    const onSettings = vi.fn();
    renderWithMantine(
      <ServerCard
        {...baseProps}
        onClone={onClone}
        onEdit={onEdit}
        onRemove={onRemove}
        onConnectionInfo={onConnectionInfo}
        onSettings={onSettings}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Clone" }));
    await user.click(screen.getByRole("button", { name: "Edit" }));
    await user.click(screen.getByRole("button", { name: "Remove" }));
    await user.click(screen.getByRole("button", { name: "Connection Info" }));
    await user.click(screen.getByRole("button", { name: "Settings" }));
    expect(onClone).toHaveBeenCalledWith("srv-1");
    expect(onEdit).toHaveBeenCalledWith("srv-1");
    expect(onRemove).toHaveBeenCalledWith("srv-1");
    expect(onConnectionInfo).toHaveBeenCalledWith("srv-1");
    expect(onSettings).toHaveBeenCalledWith("srv-1");
  });

  it("invokes onToggleConnection when the connection switch is clicked", async () => {
    const user = userEvent.setup();
    const onToggleConnection = vi.fn();
    renderWithMantine(
      <ServerCard
        {...baseProps}
        connection={disconnected}
        onToggleConnection={onToggleConnection}
      />,
    );
    const toggle = screen.getByRole("switch");
    await user.click(toggle);
    expect(onToggleConnection).toHaveBeenCalledWith("srv-1");
  });

  it("dims the card when activeServer is set to a different id", () => {
    const { container } = renderWithMantine(
      <ServerCard {...baseProps} activeServer="other" />,
    );
    expect(container.querySelector('[aria-disabled="true"]')).not.toBeNull();
  });

  it("does not dim when activeServer matches this id", () => {
    const { container } = renderWithMantine(
      <ServerCard {...baseProps} activeServer="srv-1" />,
    );
    expect(container.querySelector('[aria-disabled="true"]')).toBeNull();
  });

  it("renders the negotiated protocol version when connected", () => {
    renderWithMantine(<ServerCard {...baseProps} connection={connected} />);
    expect(screen.getByText("MCP 2025-06-18")).toBeInTheDocument();
  });

  it("omits the protocol version when not connected", () => {
    renderWithMantine(
      <ServerCard
        {...baseProps}
        connection={{ status: "disconnected", protocolVersion: "2025-06-18" }}
      />,
    );
    expect(screen.queryByText("MCP 2025-06-18")).not.toBeInTheDocument();
  });

  it("omits the protocol version when connected but none was negotiated", () => {
    renderWithMantine(
      <ServerCard {...baseProps} connection={{ status: "connected" }} />,
    );
    expect(
      screen.queryByText(/^MCP \d{4}-\d{2}-\d{2}$/),
    ).not.toBeInTheDocument();
  });

  it("omits the version badge when info is missing", () => {
    renderWithMantine(<ServerCard {...baseProps} info={undefined} />);
    expect(screen.queryByText("1.2.0")).not.toBeInTheDocument();
  });

  it("renders Server Info button when connected", () => {
    renderWithMantine(<ServerCard {...baseProps} connection={connected} />);
    expect(
      screen.getByRole("button", { name: "Connection Info" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Settings" }),
    ).toBeInTheDocument();
  });

  it.each([
    ["disconnected", disconnected],
    ["connecting", connecting],
    ["error", errored],
  ] as const)(
    "omits Server Info button when status is %s but keeps Settings",
    (_label, state) => {
      renderWithMantine(<ServerCard {...baseProps} connection={state} />);
      expect(
        screen.queryByRole("button", { name: "Connection Info" }),
      ).not.toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: "Settings" }),
      ).toBeInTheDocument();
    },
  );

  it("does not render an InlineError when the connection has an error", () => {
    // Handshake errors are surfaced via a toast at the App level
    // (notifications.show); the card itself stays focused on the
    // ConnectionToggle status indicator.
    renderWithMantine(<ServerCard {...baseProps} connection={errored} />);
    expect(screen.queryByText("Connection refused")).not.toBeInTheDocument();
  });

  it("renders the dragHandle slot when provided", () => {
    renderWithMantine(
      <ServerCard
        {...baseProps}
        dragHandle={<button type="button">grip</button>}
      />,
    );
    expect(screen.getByRole("button", { name: "grip" })).toBeInTheDocument();
  });

  it("renders no drag handle by default", () => {
    renderWithMantine(<ServerCard {...baseProps} />);
    expect(
      screen.queryByRole("button", { name: "grip" }),
    ).not.toBeInTheDocument();
  });

  it("renders the dragHandle before the server name in the header", () => {
    renderWithMantine(
      <ServerCard
        {...baseProps}
        dragHandle={<button type="button">grip</button>}
      />,
    );
    const grip = screen.getByRole("button", { name: "grip" });
    const name = screen.getByText("My MCP Server");
    // DOM order: the grip precedes the name (left of it in the header row).
    expect(grip.compareDocumentPosition(name)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
  });

  describe("read-only (writable=false)", () => {
    it("hides Clone/Edit/Remove/Settings but keeps connect + Connection Info", () => {
      renderWithMantine(<ServerCard {...baseProps} writable={false} />);
      expect(
        screen.queryByRole("button", { name: "Clone" }),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: "Edit" }),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: "Remove" }),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: "Settings" }),
      ).not.toBeInTheDocument();
      // connection === connected, so Connection Info stays available.
      expect(
        screen.getByRole("button", { name: "Connection Info" }),
      ).toBeInTheDocument();
    });

    it("shows mutation actions when writable (default)", () => {
      renderWithMantine(<ServerCard {...baseProps} />);
      expect(screen.getByRole("button", { name: "Edit" })).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: "Settings" }),
      ).toBeInTheDocument();
    });
  });

  describe("freshly-added highlight", () => {
    it("scrolls into view when highlighted", () => {
      const scrollIntoView = vi.fn();
      const orig = Element.prototype.scrollIntoView;
      Element.prototype.scrollIntoView = scrollIntoView;
      try {
        renderWithMantine(<ServerCard {...baseProps} highlighted />);
        expect(scrollIntoView).toHaveBeenCalled();
      } finally {
        Element.prototype.scrollIntoView = orig;
      }
    });

    it("draws the green highlight-variant border when highlighted", () => {
      const { container } = renderWithMantine(
        <ServerCard {...baseProps} highlighted />,
      );
      expect(
        container.querySelector('[data-variant="highlighted"]'),
      ).not.toBeNull();
    });

    it("does not draw the highlight border when not highlighted", () => {
      const { container } = renderWithMantine(<ServerCard {...baseProps} />);
      expect(
        container.querySelector('[data-variant="highlighted"]'),
      ).toBeNull();
    });

    it("does not scroll when not highlighted", () => {
      const scrollIntoView = vi.fn();
      const orig = Element.prototype.scrollIntoView;
      Element.prototype.scrollIntoView = scrollIntoView;
      try {
        renderWithMantine(<ServerCard {...baseProps} />);
        expect(scrollIntoView).not.toHaveBeenCalled();
      } finally {
        Element.prototype.scrollIntoView = orig;
      }
    });

    it("clears the highlight when the card is clicked", async () => {
      const user = userEvent.setup();
      const onClearHighlight = vi.fn();
      renderWithMantine(
        <ServerCard
          {...baseProps}
          highlighted
          onClearHighlight={onClearHighlight}
        />,
      );
      await user.click(screen.getByText("My MCP Server"));
      expect(onClearHighlight).toHaveBeenCalledTimes(1);
    });

    it("does not clear on click when not highlighted", async () => {
      const user = userEvent.setup();
      const onClearHighlight = vi.fn();
      renderWithMantine(
        <ServerCard {...baseProps} onClearHighlight={onClearHighlight} />,
      );
      await user.click(screen.getByText("My MCP Server"));
      expect(onClearHighlight).not.toHaveBeenCalled();
    });

    it("still toggles the connection when the switch is clicked while highlighted", async () => {
      const user = userEvent.setup();
      const onToggleConnection = vi.fn();
      const onClearHighlight = vi.fn();
      renderWithMantine(
        <ServerCard
          {...baseProps}
          connection={disconnected}
          highlighted
          onToggleConnection={onToggleConnection}
          onClearHighlight={onClearHighlight}
        />,
      );
      // A single click both connects and dismisses the highlight — the card
      // isn't remounted, so the toggle's action isn't swallowed.
      await user.click(screen.getByRole("switch"));
      expect(onToggleConnection).toHaveBeenCalledWith("srv-1");
      expect(onClearHighlight).toHaveBeenCalledTimes(1);
    });
  });

  describe("connection-failed border (#1621)", () => {
    it("draws the red errored-variant border when errored", () => {
      const { container } = renderWithMantine(
        <ServerCard {...baseProps} connection={disconnected} errored />,
      );
      expect(
        container.querySelector('[data-variant="errored"]'),
      ).not.toBeNull();
    });

    it("does not draw the errored border when not errored", () => {
      const { container } = renderWithMantine(
        <ServerCard {...baseProps} connection={disconnected} />,
      );
      expect(container.querySelector('[data-variant="errored"]')).toBeNull();
    });

    it("prefers the dimmed (disabled) variant over the errored border", () => {
      // A dimmed card (another server active) is inert; that wins over the
      // error border so the card can't look interactive.
      const { container } = renderWithMantine(
        <ServerCard
          {...baseProps}
          connection={disconnected}
          activeServer="other"
          errored
        />,
      );
      expect(
        container.querySelector('[data-variant="disabled"]'),
      ).not.toBeNull();
      expect(container.querySelector('[data-variant="errored"]')).toBeNull();
    });

    it("prefers the errored border over the freshly-added highlight", () => {
      const { container } = renderWithMantine(
        <ServerCard
          {...baseProps}
          connection={disconnected}
          errored
          highlighted
        />,
      );
      expect(
        container.querySelector('[data-variant="errored"]'),
      ).not.toBeNull();
      expect(
        container.querySelector('[data-variant="highlighted"]'),
      ).toBeNull();
    });

    it("scrolls the card into view on the errored transition", () => {
      vi.useFakeTimers();
      const scrollIntoView = vi.fn();
      const orig = Element.prototype.scrollIntoView;
      Element.prototype.scrollIntoView = scrollIntoView;
      try {
        const { rerender } = renderWithMantine(
          <ServerCard {...baseProps} connection={disconnected} />,
        );
        // No scroll while not errored.
        vi.advanceTimersByTime(1000);
        expect(scrollIntoView).not.toHaveBeenCalled();

        // Becoming errored schedules a deferred scroll (past the column open).
        rerender(
          <ServerCard {...baseProps} connection={disconnected} errored />,
        );
        expect(scrollIntoView).not.toHaveBeenCalled();
        vi.advanceTimersByTime(320);
        expect(scrollIntoView).toHaveBeenCalledTimes(1);

        // A further re-render while still errored does not scroll again (so it
        // won't fight a user who scrolled away).
        rerender(
          <ServerCard
            {...baseProps}
            name="Renamed"
            connection={disconnected}
            errored
          />,
        );
        vi.advanceTimersByTime(1000);
        expect(scrollIntoView).toHaveBeenCalledTimes(1);
      } finally {
        Element.prototype.scrollIntoView = orig;
        vi.useRealTimers();
      }
    });

    it("does not scroll when mounted already errored (no transition)", () => {
      vi.useFakeTimers();
      const scrollIntoView = vi.fn();
      const orig = Element.prototype.scrollIntoView;
      Element.prototype.scrollIntoView = scrollIntoView;
      try {
        renderWithMantine(
          <ServerCard {...baseProps} connection={disconnected} errored />,
        );
        vi.advanceTimersByTime(1000);
        expect(scrollIntoView).not.toHaveBeenCalled();
      } finally {
        Element.prototype.scrollIntoView = orig;
        vi.useRealTimers();
      }
    });
  });
});
