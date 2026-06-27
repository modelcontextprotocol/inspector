import { describe, it, expect, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import type {
  ClientCapabilities,
  InitializeResult,
} from "@modelcontextprotocol/sdk/types.js";
import { renderWithMantine, screen } from "../../../test/renderWithMantine";
import {
  CLEAR_OAUTH_STATE_AND_DISCONNECT_LABEL,
  ConnectionInfoContent,
} from "./ConnectionInfoContent";

const fullResult: InitializeResult = {
  protocolVersion: "2025-03-26",
  serverInfo: { name: "Everything Server", version: "2.1.0" },
  capabilities: {
    tools: { listChanged: true },
    resources: { subscribe: true },
    prompts: { listChanged: true },
    logging: {},
    completions: {},
  },
  instructions: "Use tools/list first.",
};

const fullClientCaps: ClientCapabilities = {
  roots: { listChanged: true },
  sampling: {},
  elicitation: {},
  experimental: {},
};

describe("ConnectionInfoContent", () => {
  it("renders server implementation fields under the heading", () => {
    renderWithMantine(
      <ConnectionInfoContent
        initializeResult={fullResult}
        clientCapabilities={fullClientCaps}
        transport="stdio"
      />,
    );
    expect(screen.getByText("Server Implementation")).toBeInTheDocument();
    expect(screen.getByText("Everything Server")).toBeInTheDocument();
    expect(screen.getByText("2.1.0")).toBeInTheDocument();
    expect(screen.getByText("2025-03-26")).toBeInTheDocument();
    expect(screen.getByText("stdio")).toBeInTheDocument();
  });

  it("renders an em-dash when server version is missing", () => {
    renderWithMantine(
      <ConnectionInfoContent
        initializeResult={{
          ...fullResult,
          serverInfo: { name: "No Version Server" } as never,
        }}
        clientCapabilities={fullClientCaps}
        transport="stdio"
      />,
    );
    expect(screen.getByText("—")).toBeInTheDocument();
  });

  it("renders server and client capability sections", () => {
    renderWithMantine(
      <ConnectionInfoContent
        initializeResult={fullResult}
        clientCapabilities={fullClientCaps}
        transport="stdio"
      />,
    );
    expect(screen.getByText("Server Capabilities")).toBeInTheDocument();
    expect(screen.getByText("Client Capabilities")).toBeInTheDocument();
    expect(screen.getByText("Tools")).toBeInTheDocument();
    expect(screen.getByText("Resources")).toBeInTheDocument();
    expect(screen.getByText("Roots")).toBeInTheDocument();
    expect(screen.getByText("Sampling")).toBeInTheDocument();
  });

  it("renders instructions when present", () => {
    renderWithMantine(
      <ConnectionInfoContent
        initializeResult={fullResult}
        clientCapabilities={fullClientCaps}
        transport="stdio"
      />,
    );
    expect(screen.getByText("Server Instructions")).toBeInTheDocument();
    expect(screen.getByText("Use tools/list first.")).toBeInTheDocument();
  });

  it("omits the instructions section when not present", () => {
    renderWithMantine(
      <ConnectionInfoContent
        initializeResult={{ ...fullResult, instructions: undefined }}
        clientCapabilities={fullClientCaps}
        transport="stdio"
      />,
    );
    expect(screen.queryByText("Server Instructions")).not.toBeInTheDocument();
  });

  it("renders client registration kind when provided", () => {
    renderWithMantine(
      <ConnectionInfoContent
        initializeResult={fullResult}
        clientCapabilities={fullClientCaps}
        transport="streamable-http"
        oauth={{
          protocol: "standard",
          authorized: true,
          clientId:
            "https://www.mcpjam.com/.well-known/oauth/client-metadata.json",
          clientRegistrationKind: "cimd",
        }}
      />,
    );
    expect(screen.getByText("Client registration")).toBeInTheDocument();
    expect(screen.getByText("Client ID Metadata (CIMD)")).toBeInTheDocument();
  });

  it("renders OAuth details when provided", () => {
    renderWithMantine(
      <ConnectionInfoContent
        initializeResult={fullResult}
        clientCapabilities={fullClientCaps}
        transport="streamable-http"
        oauth={{
          protocol: "standard",
          authorized: true,
          clientId: "client-abc",
          authUrl: "https://auth.example.com/authorize",
          scopes: ["read", "write"],
          accessToken: "token-123",
        }}
      />,
    );
    expect(screen.getByText("OAuth Details")).toBeInTheDocument();
    expect(screen.getByText("Standard")).toBeInTheDocument();
    expect(screen.getByText("Authorized")).toBeInTheDocument();
    expect(screen.getByText("client-abc")).toBeInTheDocument();
    expect(screen.getByText("Auth URL")).toBeInTheDocument();
    expect(
      screen.getByText("https://auth.example.com/authorize"),
    ).toBeInTheDocument();
    expect(screen.getByText("read, write")).toBeInTheDocument();
    expect(screen.getByText("token-123")).toBeInTheDocument();
  });

  it("renders EMA idp session when provided", () => {
    renderWithMantine(
      <ConnectionInfoContent
        initializeResult={fullResult}
        clientCapabilities={fullClientCaps}
        transport="streamable-http"
        oauth={{
          protocol: "ema",
          authorized: true,
          idpSession: "logged_in",
        }}
      />,
    );
    expect(screen.getByText("Enterprise-managed")).toBeInTheDocument();
    expect(screen.getByText("IdP session")).toBeInTheDocument();
    expect(screen.getByText("Signed in")).toBeInTheDocument();
  });

  it("hides optional OAuth fields that are not provided", () => {
    renderWithMantine(
      <ConnectionInfoContent
        initializeResult={fullResult}
        clientCapabilities={fullClientCaps}
        transport="stdio"
        oauth={{ protocol: "standard", authorized: false }}
      />,
    );
    expect(screen.getByText("OAuth Details")).toBeInTheDocument();
    expect(screen.getByText("Not authorized")).toBeInTheDocument();
    expect(screen.queryByText("Auth URL")).not.toBeInTheDocument();
    expect(screen.queryByText("Scopes")).not.toBeInTheDocument();
    expect(screen.queryByText("Access Token")).not.toBeInTheDocument();
  });

  it("does not render OAuth section when oauth prop is omitted", () => {
    renderWithMantine(
      <ConnectionInfoContent
        initializeResult={fullResult}
        clientCapabilities={fullClientCaps}
        transport="stdio"
      />,
    );
    expect(screen.queryByText("OAuth Details")).not.toBeInTheDocument();
  });

  it("calls onClearOAuth from the OAuth section", async () => {
    const user = userEvent.setup();
    const onClearOAuth = vi.fn();
    renderWithMantine(
      <ConnectionInfoContent
        initializeResult={fullResult}
        clientCapabilities={fullClientCaps}
        transport="streamable-http"
        oauth={{
          protocol: "standard",
          authorized: true,
          clientId: "client-abc",
        }}
        onClearOAuth={onClearOAuth}
      />,
    );
    await user.click(
      screen.getByRole("button", {
        name: CLEAR_OAUTH_STATE_AND_DISCONNECT_LABEL,
      }),
    );
    expect(onClearOAuth).toHaveBeenCalledTimes(1);
  });
});
