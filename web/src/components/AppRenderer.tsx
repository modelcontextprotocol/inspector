import { useMemo, useState, useEffect, useRef } from "react";
import type { AppRendererClient } from "@modelcontextprotocol/inspector-core/mcp/index.js";
import {
  Tool,
  ContentBlock,
  ServerNotification,
  LoggingMessageNotificationParams,
  type CallToolResult,
} from "@modelcontextprotocol/sdk/types.js";
import {
  AppRenderer as McpUiAppRenderer,
  type McpUiHostContext,
  type RequestHandlerExtra,
} from "@mcp-ui/client";
import {
  type McpUiMessageRequest,
  type McpUiMessageResult,
} from "@modelcontextprotocol/ext-apps/app-bridge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AlertCircle } from "lucide-react";
import { useToast } from "@/lib/hooks/useToast";

interface AppRendererProps {
  sandboxPath: string;
  tool: Tool;
  appRendererClient: AppRendererClient | null;
  toolInput?: Record<string, unknown>;
  onNotification?: (notification: ServerNotification) => void;
}

type ToolResultState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "success"; result: unknown }
  | { status: "error"; error: string };

const AppRenderer = ({
  sandboxPath,
  tool,
  appRendererClient,
  toolInput,
  onNotification,
}: AppRendererProps) => {
  const [error, setError] = useState<string | null>(null);
  const [toolResultState, setToolResultState] = useState<ToolResultState>({
    status: "idle",
  });
  const runIdRef = useRef(0);
  const { toast } = useToast();

  const hostContext: McpUiHostContext = useMemo(
    () => ({
      theme: document.documentElement.classList.contains("dark")
        ? "dark"
        : "light",
    }),
    [],
  );

  // When tool and toolInput are ready, call tools/call and pass result to the app (PR 1075 tool-result)
  useEffect(() => {
    if (!appRendererClient || !tool?.name) return;

    const args = toolInput ?? {};
    const currentRun = ++runIdRef.current;
    setToolResultState({ status: "loading" });

    appRendererClient
      .callTool({
        name: tool.name,
        arguments: args as Record<string, unknown>,
      })
      .then((result) => {
        if (currentRun !== runIdRef.current) return;
        setToolResultState({ status: "success", result });
      })
      .catch((err: unknown) => {
        if (currentRun !== runIdRef.current) return;
        const message = err instanceof Error ? err.message : String(err);
        setToolResultState({ status: "error", error: message });
      });
  }, [appRendererClient, tool?.name, toolInput]);

  const handleOpenLink = async ({ url }: { url: string }) => {
    let isError = true;
    if (url.startsWith("https://") || url.startsWith("http://")) {
      window.open(url, "_blank");
      isError = false;
    }
    return { isError };
  };

  const handleMessage = async (
    params: McpUiMessageRequest["params"],
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- required by RequestHandlerExtra signature
    _extra: RequestHandlerExtra,
  ): Promise<McpUiMessageResult> => {
    const message = params.content
      .filter((block): block is ContentBlock & { type: "text" } =>
        Boolean(block.type === "text"),
      )
      .map((block) => block.text)
      .join("\n");

    if (message) {
      toast({
        description: message,
      });
    }

    return {};
  };

  const handleLoggingMessage = (params: LoggingMessageNotificationParams) => {
    if (onNotification) {
      onNotification({
        method: "notifications/message",
        params,
      } as ServerNotification);
    }
  };

  const toolResult =
    toolResultState.status === "success"
      ? toolResultState.result
      : toolResultState.status === "error"
        ? { content: [{ type: "text" as const, text: toolResultState.error }] }
        : undefined;

  if (!appRendererClient) {
    return (
      <Alert>
        <AlertCircle className="h-4 w-4" />
        <AlertDescription>Waiting for MCP client...</AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {error && (
        <Alert variant="destructive" className="mb-4">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <div
        className="flex-1 border rounded overflow-hidden"
        style={{ minHeight: "400px" }}
      >
        <McpUiAppRenderer
          client={appRendererClient}
          onOpenLink={handleOpenLink}
          onMessage={handleMessage}
          onLoggingMessage={handleLoggingMessage}
          toolName={tool.name}
          hostContext={hostContext}
          toolInput={toolInput}
          toolResult={toolResult as CallToolResult | undefined}
          sandbox={{
            url: new URL(sandboxPath, window.location.origin),
          }}
          onError={(err) => setError(err.message)}
        />
      </div>
    </div>
  );
};

export default AppRenderer;
