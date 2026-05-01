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

const connected: ConnectionState = { status: "connected" };
const disconnected: ConnectionState = { status: "disconnected" };
const errored: ConnectionState = {
  status: "error",
  retryCount: 2,
  error: { message: "Connection refused", details: "ECONNREFUSED" },
};

const handlers = {
  onToggleConnection: vi.fn(),
  onServerInfo: vi.fn(),
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

  it("renders the InlineError when connection has an error", () => {
    renderWithMantine(<ServerCard {...baseProps} connection={errored} />);
    expect(screen.getByText("Connection refused")).toBeInTheDocument();
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
    const onServerInfo = vi.fn();
    const onSettings = vi.fn();
    renderWithMantine(
      <ServerCard
        {...baseProps}
        onClone={onClone}
        onEdit={onEdit}
        onRemove={onRemove}
        onServerInfo={onServerInfo}
        onSettings={onSettings}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Clone" }));
    await user.click(screen.getByRole("button", { name: "Edit" }));
    await user.click(screen.getByRole("button", { name: "Remove" }));
    await user.click(screen.getByRole("button", { name: "Server Info" }));
    await user.click(screen.getByRole("button", { name: "Settings" }));
    expect(onClone).toHaveBeenCalledWith("srv-1");
    expect(onEdit).toHaveBeenCalledWith("srv-1");
    expect(onRemove).toHaveBeenCalledWith("srv-1");
    expect(onServerInfo).toHaveBeenCalledWith("srv-1");
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

  it("omits the version badge when info is missing", () => {
    renderWithMantine(<ServerCard {...baseProps} info={undefined} />);
    expect(screen.queryByText("1.2.0")).not.toBeInTheDocument();
  });
});
