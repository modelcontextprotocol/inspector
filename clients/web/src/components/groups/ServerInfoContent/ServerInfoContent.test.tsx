import { describe, it, expect } from "vitest";
import type {
  ClientCapabilities,
  InitializeResult,
} from "@modelcontextprotocol/sdk/types.js";
import { renderWithMantine, screen } from "../../../test/renderWithMantine";
import { ServerInfoContent } from "./ServerInfoContent";

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

describe("ServerInfoContent", () => {
  it("renders server info fields", () => {
    renderWithMantine(
      <ServerInfoContent
        initializeResult={fullResult}
        clientCapabilities={fullClientCaps}
        transport="stdio"
      />,
    );
    expect(screen.getByText("Server Information")).toBeInTheDocument();
    expect(screen.getByText("Everything Server")).toBeInTheDocument();
    expect(screen.getByText("2.1.0")).toBeInTheDocument();
    expect(screen.getByText("2025-03-26")).toBeInTheDocument();
    expect(screen.getByText("stdio")).toBeInTheDocument();
  });

  it("renders an em-dash when server version is missing", () => {
    renderWithMantine(
      <ServerInfoContent
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
      <ServerInfoContent
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
      <ServerInfoContent
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
      <ServerInfoContent
        initializeResult={{ ...fullResult, instructions: undefined }}
        clientCapabilities={fullClientCaps}
        transport="stdio"
      />,
    );
    expect(screen.queryByText("Server Instructions")).not.toBeInTheDocument();
  });

  it("renders OAuth details when provided", () => {
    renderWithMantine(
      <ServerInfoContent
        initializeResult={fullResult}
        clientCapabilities={fullClientCaps}
        transport="streamable-http"
        oauth={{
          authUrl: "https://auth.example.com/authorize",
          scopes: ["read", "write"],
          accessToken: "token-123",
        }}
      />,
    );
    expect(screen.getByText("OAuth Details")).toBeInTheDocument();
    expect(screen.getByText("Auth URL")).toBeInTheDocument();
    expect(
      screen.getByText("https://auth.example.com/authorize"),
    ).toBeInTheDocument();
    expect(screen.getByText("read, write")).toBeInTheDocument();
    expect(screen.getByText("token-123")).toBeInTheDocument();
  });

  it("hides OAuth fields that are not provided", () => {
    renderWithMantine(
      <ServerInfoContent
        initializeResult={fullResult}
        clientCapabilities={fullClientCaps}
        transport="stdio"
        oauth={{ scopes: [] }}
      />,
    );
    expect(screen.getByText("OAuth Details")).toBeInTheDocument();
    expect(screen.queryByText("Auth URL")).not.toBeInTheDocument();
    expect(screen.queryByText("Scopes")).not.toBeInTheDocument();
    expect(screen.queryByText("Access Token")).not.toBeInTheDocument();
  });

  it("does not render OAuth section when oauth prop is omitted", () => {
    renderWithMantine(
      <ServerInfoContent
        initializeResult={fullResult}
        clientCapabilities={fullClientCaps}
        transport="stdio"
      />,
    );
    expect(screen.queryByText("OAuth Details")).not.toBeInTheDocument();
  });
});
