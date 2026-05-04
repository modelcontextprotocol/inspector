import { act, render, waitFor } from "@testing-library/react";
import App from "../App";
import { useConnection } from "../lib/hooks/useConnection";
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import type { ServerNotification } from "@modelcontextprotocol/sdk/types.js";
import { cacheToolOutputSchemas } from "../utils/schemaUtils";

type OnNotificationHandler = (notification: ServerNotification) => void;
type UseConnectionReturn = ReturnType<typeof useConnection>;

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

jest.mock("../lib/hooks/useToast", () => ({
  useToast: () => ({ toast: jest.fn() }),
}));

jest.mock("../utils/schemaUtils", () => ({
  ...jest.requireActual("../utils/schemaUtils"),
  cacheToolOutputSchemas: jest.fn(),
}));

global.fetch = jest.fn().mockResolvedValue({ json: () => Promise.resolve({}) });

jest.mock("../lib/hooks/useConnection", () => ({
  useConnection: jest.fn(),
}));

describe("App - list_changed notification handling", () => {
  const mockUseConnection = jest.mocked(useConnection);
  const mockCacheToolOutputSchemas = jest.mocked(cacheToolOutputSchemas);

  const makeConnectionState = (makeRequest: jest.Mock) => ({
    connectionStatus: "connected" as const,
    serverCapabilities: {
      tools: { listChanged: true },
      resources: { listChanged: true },
      prompts: { listChanged: true },
    },
    mcpClient: {
      request: jest.fn(),
      notification: jest.fn(),
      close: jest.fn(),
    } as unknown as Client,
    requestHistory: [],
    clearRequestHistory: jest.fn(),
    makeRequest,
    sendNotification: jest.fn(),
    handleCompletion: jest.fn(),
    completionsSupported: false,
    connect: jest.fn(),
    disconnect: jest.fn(),
    serverImplementation: null,
    cancelTask: jest.fn(),
    listTasks: jest.fn(),
  });

  beforeEach(() => {
    jest.restoreAllMocks();
    mockCacheToolOutputSchemas.mockClear();
    window.location.hash = "#tools";
  });

  const captureOnNotification = (makeRequest: jest.Mock) => {
    let captured: OnNotificationHandler | undefined;
    mockUseConnection.mockImplementation((options) => {
      captured = (options as { onNotification?: OnNotificationHandler })
        .onNotification;
      return makeConnectionState(makeRequest) as unknown as UseConnectionReturn;
    });
    return () => {
      if (!captured) {
        throw new Error("Expected onNotification to be provided");
      }
      return captured;
    };
  };

  test("notifications/tools/list_changed re-fetches tools and clears cached output schemas", async () => {
    const makeRequest = jest
      .fn()
      .mockResolvedValue({ tools: [], nextCursor: undefined });
    const getOnNotification = captureOnNotification(makeRequest);

    render(<App />);
    await waitFor(() => {
      expect(mockUseConnection).toHaveBeenCalled();
    });

    act(() => {
      getOnNotification()({
        method: "notifications/tools/list_changed",
      } as ServerNotification);
    });

    await waitFor(() => {
      expect(makeRequest).toHaveBeenCalledWith(
        expect.objectContaining({ method: "tools/list" }),
        expect.anything(),
      );
    });
    // Schema cache must be cleared before the refetch kicks off, so any
    // in-flight validator can't run against a stale compiled schema.
    expect(mockCacheToolOutputSchemas).toHaveBeenCalledWith([]);
    const clearCallOrder =
      mockCacheToolOutputSchemas.mock.invocationCallOrder[0];
    const toolsListCallOrder = makeRequest.mock.invocationCallOrder.find(
      (_, i) => makeRequest.mock.calls[i][0].method === "tools/list",
    );
    expect(clearCallOrder).toBeLessThan(toolsListCallOrder!);
  });

  test("notifications/resources/list_changed re-fetches resources and templates", async () => {
    const makeRequest = jest.fn().mockImplementation((request) => {
      if (request.method === "resources/list") {
        return Promise.resolve({ resources: [], nextCursor: undefined });
      }
      if (request.method === "resources/templates/list") {
        return Promise.resolve({
          resourceTemplates: [],
          nextCursor: undefined,
        });
      }
      return Promise.resolve({});
    });
    const getOnNotification = captureOnNotification(makeRequest);

    render(<App />);
    await waitFor(() => {
      expect(mockUseConnection).toHaveBeenCalled();
    });

    act(() => {
      getOnNotification()({
        method: "notifications/resources/list_changed",
      } as ServerNotification);
    });

    await waitFor(() => {
      expect(makeRequest).toHaveBeenCalledWith(
        expect.objectContaining({ method: "resources/list" }),
        expect.anything(),
      );
      expect(makeRequest).toHaveBeenCalledWith(
        expect.objectContaining({ method: "resources/templates/list" }),
        expect.anything(),
      );
    });
  });

  test("notifications/prompts/list_changed re-fetches prompts", async () => {
    const makeRequest = jest.fn().mockResolvedValue({ prompts: [] });
    const getOnNotification = captureOnNotification(makeRequest);

    render(<App />);
    await waitFor(() => {
      expect(mockUseConnection).toHaveBeenCalled();
    });

    act(() => {
      getOnNotification()({
        method: "notifications/prompts/list_changed",
      } as ServerNotification);
    });

    await waitFor(() => {
      expect(makeRequest).toHaveBeenCalledWith(
        expect.objectContaining({ method: "prompts/list" }),
        expect.anything(),
      );
    });
  });
});
