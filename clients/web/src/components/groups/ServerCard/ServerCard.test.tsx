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
});
