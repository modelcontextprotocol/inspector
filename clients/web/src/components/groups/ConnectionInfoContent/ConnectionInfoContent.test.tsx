import { describe, it, expect, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import type {
  ClientCapabilities,
  InitializeResult,
} from "@modelcontextprotocol/client";
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
    // Exactly three em dashes: the missing server version, plus the two
    // extension sections (the fixtures advertise none on either side).
    expect(screen.getAllByText("—")).toHaveLength(3);
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

  it("defaults to the Legacy era, and marks the session N/A for stdio", () => {
    renderWithMantine(
      <ConnectionInfoContent
        initializeResult={fullResult}
        clientCapabilities={fullClientCaps}
        transport="stdio"
      />,
    );
    expect(screen.getByText("Era")).toBeInTheDocument();
    expect(screen.getByText("Legacy")).toBeInTheDocument();
    // stdio has no HTTP session concept.
    expect(screen.getByText("N/A (stdio)")).toBeInTheDocument();
    // No discover result → no Discovery section.
    expect(screen.queryByText("Discovery")).not.toBeInTheDocument();
  });

  it("marks a legacy HTTP connection as session-based", () => {
    renderWithMantine(
      <ConnectionInfoContent
        initializeResult={fullResult}
        clientCapabilities={fullClientCaps}
        transport="streamable-http"
        protocolEra="legacy"
      />,
    );
    expect(screen.getByText("Legacy")).toBeInTheDocument();
    expect(screen.getByText("Session-based")).toBeInTheDocument();
  });

  it("shows the Modern era as sessionless and renders the discovery section", () => {
    renderWithMantine(
      <ConnectionInfoContent
        initializeResult={fullResult}
        clientCapabilities={fullClientCaps}
        transport="streamable-http"
        protocolEra="modern"
        discoverResult={{
          supportedVersions: ["2026-07-28", "2025-11-25"],
          serverInfo: { name: "Everything Server", version: "2.1.0" },
          capabilities: {
            tools: {},
            extensions: {
              "io.modelcontextprotocol/tasks": {},
            },
          },
        }}
      />,
    );
    expect(screen.getByText("Modern")).toBeInTheDocument();
    expect(screen.getByText("Sessionless")).toBeInTheDocument();
    expect(screen.getByText("Discovery")).toBeInTheDocument();
    expect(screen.getByText("2026-07-28, 2025-11-25")).toBeInTheDocument();
  });

  it("renders an em-dash for empty supported versions in Discovery", () => {
    renderWithMantine(
      <ConnectionInfoContent
        initializeResult={fullResult}
        clientCapabilities={fullClientCaps}
        transport="streamable-http"
        protocolEra="modern"
        discoverResult={{
          supportedVersions: [],
          serverInfo: { name: "Everything Server", version: "2.1.0" },
          capabilities: { tools: {} },
        }}
      />,
    );
    expect(screen.getByText("Supported versions")).toBeInTheDocument();
    // Extensions moved out of Discovery into their own era-transparent section.
    expect(screen.queryByText("Discovery")).toBeInTheDocument();
    // Exactly three em dashes: empty supported versions, plus the two extension
    // sections (the fixtures advertise none).
    expect(screen.getAllByText("—")).toHaveLength(3);
  });

  it("shows server extensions on a LEGACY connection (no discovery), from server capabilities (#1740)", () => {
    renderWithMantine(
      <ConnectionInfoContent
        initializeResult={{
          ...fullResult,
          capabilities: {
            ...fullResult.capabilities,
            extensions: { "io.modelcontextprotocol/tasks": {} },
          },
        }}
        clientCapabilities={fullClientCaps}
        transport="streamable-http"
        protocolEra="legacy"
      />,
    );
    // No discoverResult (legacy) but the server's extension still renders,
    // sourced from the negotiated server capabilities rather than discovery.
    expect(screen.queryByText("Discovery")).not.toBeInTheDocument();
    expect(screen.getByText("Server Extensions")).toBeInTheDocument();
    expect(
      screen.getByText("io.modelcontextprotocol/tasks"),
    ).toBeInTheDocument();
  });

  it("shows the Inspector's own advertised extensions (#1740)", () => {
    renderWithMantine(
      <ConnectionInfoContent
        initializeResult={fullResult}
        clientCapabilities={{
          ...fullClientCaps,
          extensions: {
            "io.modelcontextprotocol/tasks": {},
            "io.modelcontextprotocol/ui": { mimeTypes: ["text/html"] },
          },
        }}
        transport="streamable-http"
        protocolEra="legacy"
      />,
    );
    expect(screen.getByText("Advertised Extensions")).toBeInTheDocument();
    expect(
      screen.getByText(
        "io.modelcontextprotocol/tasks, io.modelcontextprotocol/ui",
      ),
    ).toBeInTheDocument();
  });

  it("renders em-dashes for the extensions sections when neither side advertises any (#1740)", () => {
    renderWithMantine(
      <ConnectionInfoContent
        initializeResult={fullResult}
        clientCapabilities={fullClientCaps}
        transport="streamable-http"
        protocolEra="legacy"
      />,
    );
    expect(screen.getByText("Server Extensions")).toBeInTheDocument();
    expect(screen.getByText("Advertised Extensions")).toBeInTheDocument();
    // Exactly two em dashes: the two extension sections (the server version is
    // present in the fixture, so it does not em-dash).
    expect(screen.getAllByText("—")).toHaveLength(2);
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

  it("renders the EMA idp session as Session expired", () => {
    renderWithMantine(
      <ConnectionInfoContent
        initializeResult={fullResult}
        clientCapabilities={fullClientCaps}
        transport="streamable-http"
        oauth={{
          protocol: "ema",
          authorized: false,
          idpSession: "expired",
        }}
      />,
    );
    expect(screen.getByText("IdP session")).toBeInTheDocument();
    expect(screen.getByText("Session expired")).toBeInTheDocument();
  });

  it("renders the EMA idp session as Not signed in for the none state", () => {
    renderWithMantine(
      <ConnectionInfoContent
        initializeResult={fullResult}
        clientCapabilities={fullClientCaps}
        transport="streamable-http"
        oauth={{
          protocol: "ema",
          authorized: false,
          idpSession: "none",
        }}
      />,
    );
    expect(screen.getByText("IdP session")).toBeInTheDocument();
    expect(screen.getByText("Not signed in")).toBeInTheDocument();
  });

  it("omits the IdP session row when EMA oauth has no idpSession", () => {
    renderWithMantine(
      <ConnectionInfoContent
        initializeResult={fullResult}
        clientCapabilities={fullClientCaps}
        transport="streamable-http"
        oauth={{ protocol: "ema", authorized: true }}
      />,
    );
    expect(screen.getByText("Enterprise-managed")).toBeInTheDocument();
    expect(screen.queryByText("IdP session")).not.toBeInTheDocument();
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
