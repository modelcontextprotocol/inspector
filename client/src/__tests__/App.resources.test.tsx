import "@testing-library/jest-dom";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import App from "../App";
import { useConnection } from "../lib/hooks/useConnection";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";

jest.mock("@modelcontextprotocol/sdk/client/auth.js", () => ({
  auth: jest.fn(),
}));

jest.mock("../lib/oauth-state-machine", () => ({
  OAuthStateMachine: jest.fn(),
}));

jest.mock("../lib/auth", () => ({
  InspectorOAuthClientProvider: jest.fn().mockImplementation(() => ({
    tokens: jest.fn().mockResolvedValue(null),
    clear: jest.fn(),
  })),
  DebugInspectorOAuthClientProvider: jest.fn(),
}));

jest.mock("../utils/configUtils", () => ({
  ...jest.requireActual("../utils/configUtils"),
  getMCPProxyAddress: jest.fn(() => "http://localhost:6277"),
  getMCPProxyAuthToken: jest.fn(() => ({
    token: "",
    header: "X-MCP-Proxy-Auth",
  })),
  getInitialTransportType: jest.fn(() => "stdio"),
  getInitialSseUrl: jest.fn(() => "http://localhost:3001/sse"),
  getInitialCommand: jest.fn(() => "mcp-server-everything"),
  getInitialArgs: jest.fn(() => ""),
  initializeInspectorConfig: jest.fn(() => ({})),
  saveInspectorConfig: jest.fn(),
  getMCPTaskTtl: jest.fn(() => 3600),
}));

jest.mock("../lib/hooks/useDraggablePane", () => ({
  useDraggablePane: () => ({
    height: 300,
    handleDragStart: jest.fn(),
  }),
  useDraggableSidebar: () => ({
    width: 320,
    isDragging: false,
    handleDragStart: jest.fn(),
  }),
}));

jest.mock("../components/Sidebar", () => ({
  __esModule: true,
  default: () => <div>Sidebar</div>,
}));

global.fetch = jest.fn().mockResolvedValue({ json: () => Promise.resolve({}) });

jest.mock("../lib/hooks/useConnection", () => ({
  useConnection: jest.fn(),
}));

describe("App - Resources panel", () => {
  const mockUseConnection = jest.mocked(useConnection);

  beforeEach(() => {
    jest.restoreAllMocks();
    window.location.hash = "#resources";
  });

  test("switching back to a cached resource shows the selected resource content", async () => {
    const makeRequest = jest.fn().mockImplementation(async (request) => {
      if (request.method === "resources/list") {
        return {
          resources: [
            {
              uri: "mcp://benefitsolver/report/tools-md",
              name: "Build a Report approved tools",
              description: "Tools payload",
              mimeType: "text/markdown",
            },
            {
              uri: "mcp://benefitsolver/report/context-md",
              name: "Build a Report current context",
              description: "Context payload",
              mimeType: "text/markdown",
            },
          ],
        };
      }

      if (
        request.method === "resources/read" &&
        request.params.uri === "mcp://benefitsolver/report/tools-md"
      ) {
        return {
          contents: [
            {
              uri: "mcp://benefitsolver/report/tools-md",
              mimeType: "text/markdown",
              text: "# Approved Report MCP Tools",
            },
          ],
        };
      }

      if (
        request.method === "resources/read" &&
        request.params.uri === "mcp://benefitsolver/report/context-md"
      ) {
        return {
          contents: [
            {
              uri: "mcp://benefitsolver/report/context-md",
              mimeType: "text/markdown",
              text: "# Current Report Builder Context",
            },
          ],
        };
      }

      return {};
    });

    mockUseConnection.mockReturnValue({
      connectionStatus: "connected" as const,
      serverCapabilities: {
        resources: {},
      },
      serverImplementation: {
        name: "benefitsolver-report-mcp",
        version: "1.0.0",
      },
      mcpClient: {
        request: jest.fn(),
        notification: jest.fn(),
        close: jest.fn(),
      } as unknown as Client,
      requestHistory: [],
      clearRequestHistory: jest.fn(),
      makeRequest,
      cancelTask: jest.fn(),
      listTasks: jest.fn(),
      sendNotification: jest.fn(),
      handleCompletion: jest.fn(),
      completionsSupported: false,
      connect: jest.fn(),
      disconnect: jest.fn(),
    } as ReturnType<typeof useConnection>);

    render(<App />);

    fireEvent.click(screen.getByText("List Resources"));

    await waitFor(() => {
      expect(
        screen.getByText("Build a Report approved tools"),
      ).toBeInTheDocument();
      expect(
        screen.getByText("Build a Report current context"),
      ).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText("Build a Report approved tools"));

    await waitFor(() => {
      expect(screen.getByText(/Approved Report MCP Tools/)).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText("Build a Report current context"));

    await waitFor(() => {
      expect(
        screen.getByText(/Current Report Builder Context/),
      ).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText("Build a Report approved tools"));

    await waitFor(() => {
      expect(screen.getByText(/Approved Report MCP Tools/)).toBeInTheDocument();
      expect(
        screen.queryByText(/Current Report Builder Context/),
      ).not.toBeInTheDocument();
    });
  });
});
