import { describe, it, expect, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import type {
  ClientCapabilities,
  InitializeResult,
} from "@modelcontextprotocol/sdk/types.js";
import { renderWithMantine, screen } from "../../../test/renderWithMantine";
import { ConnectionInfoModal } from "./ConnectionInfoModal";

const initializeResult: InitializeResult = {
  protocolVersion: "2025-06-18",
  serverInfo: { name: "Test Server", version: "0.1.0" },
  capabilities: {
    tools: { listChanged: true },
    resources: { subscribe: true },
  },
  instructions: "Be excellent to each other.",
};

const clientCapabilities: ClientCapabilities = {
  elicitation: { form: {} },
  tasks: { list: {}, cancel: {} },
};

describe("ConnectionInfoModal", () => {
  it("does not render content when opened is false", () => {
    renderWithMantine(
      <ConnectionInfoModal
        opened={false}
        onClose={vi.fn()}
        initializeResult={initializeResult}
        clientCapabilities={clientCapabilities}
        transport="stdio"
      />,
    );
    expect(screen.queryByText("Connection Info")).not.toBeInTheDocument();
  });

  it("renders the modal title and ConnectionInfoContent when opened", () => {
    renderWithMantine(
      <ConnectionInfoModal
        opened
        onClose={vi.fn()}
        initializeResult={initializeResult}
        clientCapabilities={clientCapabilities}
        transport="stdio"
      />,
    );
    expect(screen.getByText("Connection Info")).toBeInTheDocument();
    expect(screen.getByText("Test Server")).toBeInTheDocument();
    expect(screen.getByText("0.1.0")).toBeInTheDocument();
    expect(screen.getByText("2025-06-18")).toBeInTheDocument();
    expect(screen.getByText("stdio")).toBeInTheDocument();
    expect(screen.getByText("Be excellent to each other.")).toBeInTheDocument();
  });

  it("forwards oauth details to ConnectionInfoContent", () => {
    renderWithMantine(
      <ConnectionInfoModal
        opened
        onClose={vi.fn()}
        initializeResult={initializeResult}
        clientCapabilities={clientCapabilities}
        transport="streamable-http"
        oauth={{
          protocol: "standard",
          authorized: true,
          authUrl: "https://auth.example.com/authorize",
          scopes: ["read", "write"],
          accessToken: "token-abc",
        }}
      />,
    );
    expect(screen.getByText("OAuth Details")).toBeInTheDocument();
    expect(
      screen.getByText("https://auth.example.com/authorize"),
    ).toBeInTheDocument();
    expect(screen.getByText("read, write")).toBeInTheDocument();
    expect(screen.getByText("token-abc")).toBeInTheDocument();
  });

  it("invokes onClose when the CloseButton is clicked", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    renderWithMantine(
      <ConnectionInfoModal
        opened
        onClose={onClose}
        initializeResult={initializeResult}
        clientCapabilities={clientCapabilities}
        transport="stdio"
      />,
    );
    await user.click(screen.getByRole("button", { name: /close/i }));
    expect(onClose).toHaveBeenCalled();
  });

  it("invokes onClose when Escape is pressed", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    renderWithMantine(
      <ConnectionInfoModal
        opened
        onClose={onClose}
        initializeResult={initializeResult}
        clientCapabilities={clientCapabilities}
        transport="stdio"
      />,
    );
    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalled();
  });
});
