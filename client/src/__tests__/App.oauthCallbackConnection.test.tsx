import { render, waitFor } from "@testing-library/react";
import { useEffect } from "react";
import App from "../App";
import { useConnection } from "../lib/hooks/useConnection";

// The OAuth callback route is reached by a redirect from the authorization
// server, so its query string must not define the connection that the
// callback goes on to open. These tests render App on that route with the
// real config helpers and check what the connection is built from.

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

// Stand in for a successful code exchange: report back immediately.
jest.mock("../components/OAuthCallback", () => ({
  __esModule: true,
  default: function MockOAuthCallback({
    onConnect,
  }: {
    onConnect: (serverUrl: string) => void;
  }) {
    useEffect(() => {
      onConnect("https://remote.example/mcp");
    }, [onConnect]);
    return <div>OAuth callback</div>;
  },
}));

jest.mock("../lib/hooks/useDraggablePane", () => ({
  useDraggablePane: () => ({ height: 300, handleDragStart: jest.fn() }),
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

jest.mock("../lib/hooks/useConnection", () => ({
  useConnection: jest.fn(),
}));

// The proxy's /config lookup is irrelevant here; leave it pending so it never
// updates state after a test has finished.
global.fetch = jest.fn(() => new Promise<Response>(() => {}));

const INJECTED_QUERY =
  "?code=abc&state=xyz&transport=stdio" +
  "&serverCommand=injected-cmd&serverArgs=--injected" +
  "&MCP_PROXY_FULL_ADDRESS=http%3A%2F%2Finjected.example" +
  "&MCP_PROXY_AUTH_TOKEN=injected-token";

describe("App - OAuth callback connection settings", () => {
  const mockUseConnection = jest.mocked(useConnection);
  const connect = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    localStorage.clear();
    sessionStorage.clear();
    localStorage.setItem("lastTransportType", "streamable-http");
    localStorage.setItem("lastSseUrl", "https://remote.example/mcp");
    localStorage.setItem("lastCommand", "saved-cmd");
    localStorage.setItem("lastArgs", "--saved");
    mockUseConnection.mockReturnValue({
      connectionStatus: "disconnected",
      serverCapabilities: null,
      mcpClient: null,
      requestHistory: [],
      clearRequestHistory: jest.fn(),
      makeRequest: jest.fn(),
      sendNotification: jest.fn(),
      handleCompletion: jest.fn(),
      completionsSupported: false,
      connect,
      disconnect: jest.fn(),
      serverImplementation: null,
    } as unknown as ReturnType<typeof useConnection>);
  });

  afterEach(() => {
    window.history.replaceState({}, "", "/");
    localStorage.clear();
    sessionStorage.clear();
  });

  test("reconnects with the saved connection, not the callback URL's", async () => {
    window.history.replaceState({}, "", `/oauth/callback${INJECTED_QUERY}`);

    render(<App />);

    await waitFor(() => expect(connect).toHaveBeenCalled());

    for (const [options] of mockUseConnection.mock.calls) {
      expect(options.transportType).toBe("streamable-http");
      expect(options.command).toBe("saved-cmd");
      expect(options.args).toBe("--saved");
      expect(options.config.MCP_PROXY_FULL_ADDRESS.value).not.toBe(
        "http://injected.example",
      );
      expect(options.config.MCP_PROXY_AUTH_TOKEN.value).not.toBe(
        "injected-token",
      );
    }
  });

  test("still takes connection settings from the query on the entry route", () => {
    window.history.replaceState({}, "", `/${INJECTED_QUERY}`);

    render(<App />);

    const [options] = mockUseConnection.mock.calls[0];
    expect(options.transportType).toBe("stdio");
    expect(options.command).toBe("injected-cmd");
    expect(options.args).toBe("--injected");
    expect(connect).not.toHaveBeenCalled();
  });
});
