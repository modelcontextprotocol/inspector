import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import App from "../App";
import { useConnection } from "../lib/hooks/useConnection";
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import type {
  CreateMessageRequest,
  CreateMessageResult,
} from "@modelcontextprotocol/sdk/types.js";

type OnPendingRequestHandler = (
  request: CreateMessageRequest,
  resolve: (result: CreateMessageResult) => void,
  reject: (error: Error) => void,
) => void;

type SamplingRequestMockProps = {
  request: { id: number };
  onApprove: (id: number, result: CreateMessageResult) => void;
  onReject: (id: number) => void;
};

type UseConnectionReturn = ReturnType<typeof useConnection>;

// Mock auth dependencies first
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

// Keep the test focused on navigation; avoid DynamicJsonForm/schema complexity.
jest.mock("../components/SamplingRequest", () => ({
  __esModule: true,
  default: ({ request, onApprove, onReject }: SamplingRequestMockProps) => (
    <div data-testid="sampling-request">
      <div>sampling-request-{request.id}</div>
      <button
        type="button"
        onClick={() =>
          onApprove(request.id, {
            model: "stub-model",
            stopReason: "endTurn",
            role: "assistant",
            content: { type: "text", text: "" },
          })
        }
      >
        Approve
      </button>
      <button type="button" onClick={() => onReject(request.id)}>
        Reject
      </button>
    </div>
  ),
}));

// Mock fetch
global.fetch = jest.fn().mockResolvedValue({ json: () => Promise.resolve({}) });

jest.mock("../lib/hooks/useConnection", () => ({
  useConnection: jest.fn(),
}));

describe("App - Sampling auto-navigation", () => {
  const mockUseConnection = jest.mocked(useConnection);

  const baseConnectionState = {
    connectionStatus: "connected" as const,
    serverCapabilities: { tools: { listChanged: true, subscribe: true } },
    mcpClient: {
      request: jest.fn(),
      notification: jest.fn(),
      close: jest.fn(),
    } as unknown as Client,
    requestHistory: [],
    clearRequestHistory: jest.fn(),
    makeRequest: jest.fn(),
    sendNotification: jest.fn(),
    handleCompletion: jest.fn(),
    completionsSupported: false,
    connect: jest.fn(),
    disconnect: jest.fn(),
    serverImplementation: null,
    cancelTask: jest.fn(),
    listTasks: jest.fn(),
  };

  beforeEach(() => {
    jest.restoreAllMocks();
    window.location.hash = "#tools";
  });

  test("switches to #sampling when a sampling request arrives and switches back to #tools after approve", async () => {
    let capturedOnPendingRequest: OnPendingRequestHandler | undefined;

    mockUseConnection.mockImplementation((options) => {
      capturedOnPendingRequest = (
        options as { onPendingRequest?: OnPendingRequestHandler }
      ).onPendingRequest;
      return baseConnectionState as unknown as UseConnectionReturn;
    });

    render(<App />);

    // Ensure we start on tools.
    await waitFor(() => {
      expect(window.location.hash).toBe("#tools");
    });

    const resolve = jest.fn();
    const reject = jest.fn();

    act(() => {
      if (!capturedOnPendingRequest) {
        throw new Error("Expected onPendingRequest to be provided");
      }

      capturedOnPendingRequest(
        {
          method: "sampling/createMessage",
          params: { messages: [], maxTokens: 1 },
        },
        resolve,
        reject,
      );
    });

    await waitFor(() => {
      expect(window.location.hash).toBe("#sampling");
      expect(screen.getByTestId("sampling-request")).toBeTruthy();
    });

    fireEvent.click(screen.getByText("Approve"));

    await waitFor(() => {
      expect(resolve).toHaveBeenCalled();
      expect(window.location.hash).toBe("#tools");
    });
  });

  test("switches back to #tools after reject", async () => {
    let capturedOnPendingRequest: OnPendingRequestHandler | undefined;

    mockUseConnection.mockImplementation((options) => {
      capturedOnPendingRequest = (
        options as { onPendingRequest?: OnPendingRequestHandler }
      ).onPendingRequest;
      return baseConnectionState as unknown as UseConnectionReturn;
    });

    render(<App />);

    await waitFor(() => {
      expect(window.location.hash).toBe("#tools");
    });

    const resolve = jest.fn();
    const reject = jest.fn();

    act(() => {
      if (!capturedOnPendingRequest) {
        throw new Error("Expected onPendingRequest to be provided");
      }

      capturedOnPendingRequest(
        {
          method: "sampling/createMessage",
          params: { messages: [], maxTokens: 1 },
        },
        resolve,
        reject,
      );
    });

    await waitFor(() => {
      expect(window.location.hash).toBe("#sampling");
      expect(screen.getByTestId("sampling-request")).toBeTruthy();
    });

    fireEvent.click(screen.getByRole("button", { name: /Reject/i }));

    await waitFor(() => {
      expect(reject).toHaveBeenCalled();
      expect(window.location.hash).toBe("#tools");
    });
  });
});
