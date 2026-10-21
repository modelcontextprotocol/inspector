import { render, waitFor } from "@testing-library/react";
import { useEffect } from "react";
import App from "../App";
import { useConnection } from "../lib/hooks/useConnection";
import {
  OAuthConnectionSnapshot,
  readOAuthConnectionSnapshot,
  saveOAuthConnectionSnapshot,
} from "../lib/oauthConnectionSnapshot";

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

// Stand in for a successful code exchange: report back immediately and
// record whether App agreed to reconnect.
const mockConnectRefusals: (string | undefined)[] = [];
jest.mock("../components/OAuthCallback", () => ({
  __esModule: true,
  default: function MockOAuthCallback({
    onConnect,
  }: {
    onConnect: (serverUrl: string) => string | undefined;
  }) {
    useEffect(() => {
      mockConnectRefusals.push(onConnect("https://remote.example/mcp"));
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
    mockConnectRefusals.length = 0;
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

  const SNAPSHOT: OAuthConnectionSnapshot = {
    serverUrl: "https://remote.example/mcp",
    transportType: "streamable-http",
    connectionType: "proxy",
    command: "snapshot-cmd",
    args: "--snapshot",
    // getMCPProxyAddress with the default config under jsdom
    proxyAddress: "http://localhost:6277",
  };

  const renderCallback = async () => {
    window.history.replaceState({}, "", `/oauth/callback${INJECTED_QUERY}`);
    const view = render(<App />);
    await waitFor(() => expect(mockConnectRefusals).toHaveLength(1));
    return view;
  };

  const expectNeverStdio = () => {
    for (const [options] of mockUseConnection.mock.calls) {
      expect(options.transportType).not.toBe("stdio");
      expect(options.command).not.toBe("injected-cmd");
      expect(options.config.MCP_PROXY_FULL_ADDRESS.value).not.toBe(
        "http://injected.example",
      );
      expect(options.config.MCP_PROXY_AUTH_TOKEN.value).not.toBe(
        "injected-token",
      );
    }
  };

  test("reconnects with the snapshot on a normal streamable-http round trip", async () => {
    saveOAuthConnectionSnapshot(SNAPSHOT);

    await renderCallback();

    expect(mockConnectRefusals).toEqual([undefined]);
    expect(connect).toHaveBeenCalledTimes(1);
    const [options] = mockUseConnection.mock.calls[0];
    expect(options.transportType).toBe("streamable-http");
    expect(options.sseUrl).toBe("https://remote.example/mcp");
    expect(options.command).toBe("snapshot-cmd");
    expect(options.args).toBe("--snapshot");
    expectNeverStdio();
    expect(readOAuthConnectionSnapshot()).toBeNull();
  });

  test("reconnects with the snapshot on an sse round trip", async () => {
    saveOAuthConnectionSnapshot({ ...SNAPSHOT, transportType: "sse" });

    await renderCallback();

    expect(connect).toHaveBeenCalledTimes(1);
    expect(mockUseConnection.mock.calls[0][0].transportType).toBe("sse");
  });

  test("ignores stdio settings another tab wrote to localStorage", async () => {
    saveOAuthConnectionSnapshot(SNAPSHOT);

    // Another tab opens the entry route with a connection in its query; it
    // saves those settings to origin-wide localStorage on mount.
    window.history.replaceState(
      {},
      "",
      "/?transport=stdio&serverCommand=other-tab-cmd&serverArgs=--other",
    );
    render(<App />).unmount();
    expect(localStorage.getItem("lastTransportType")).toBe("stdio");
    expect(localStorage.getItem("lastCommand")).toBe("other-tab-cmd");
    mockUseConnection.mockClear();

    await renderCallback();

    expect(connect).toHaveBeenCalledTimes(1);
    for (const [options] of mockUseConnection.mock.calls) {
      expect(options.transportType).toBe("streamable-http");
      expect(options.command).toBe("snapshot-cmd");
      expect(options.args).toBe("--snapshot");
    }
  });

  test("does not reconnect without a snapshot", async () => {
    localStorage.setItem("lastTransportType", "stdio");

    await renderCallback();

    expect(mockConnectRefusals[0]).toMatch(/No saved connection/);
    expect(connect).not.toHaveBeenCalled();
  });

  test("does not reconnect for a stdio snapshot", async () => {
    saveOAuthConnectionSnapshot({ ...SNAPSHOT, transportType: "stdio" });

    await renderCallback();

    expect(mockConnectRefusals[0]).toMatch(/only to SSE and Streamable HTTP/);
    expect(connect).not.toHaveBeenCalled();
    expect(readOAuthConnectionSnapshot()).toBeNull();
  });

  test("does not reconnect when the proxy address differs from the snapshot", async () => {
    saveOAuthConnectionSnapshot(SNAPSHOT);
    localStorage.setItem(
      "inspectorConfig_v1",
      JSON.stringify({
        MCP_PROXY_FULL_ADDRESS: {
          label: "",
          description: "",
          value: "http://other-proxy.example",
          is_session_item: false,
        },
      }),
    );

    await renderCallback();

    expect(mockConnectRefusals[0]).toMatch(/changed during authorization/);
    expect(connect).not.toHaveBeenCalled();
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
