import { useMemo, useState } from "react";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import {
  Tool,
  ContentBlock,
  ServerNotification,
  LoggingMessageNotificationParams,
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
  mcpClient: Client | null;
  toolInput?: Record<string, unknown>;
  onNotification?: (notification: ServerNotification) => void;
}

const AppRenderer = ({
  sandboxPath,
  tool,
  mcpClient,
  toolInput,
  onNotification,
}: AppRendererProps) => {
  const [error, setError] = useState<string | null>(null);
  const { toast } = useToast();

  const hostContext: McpUiHostContext = useMemo(
    () => ({
      theme: document.documentElement.classList.contains("dark")
        ? "dark"
        : "light",
    }),
    [],
  );

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
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
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

  if (!mcpClient) {
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
          client={mcpClient}
          onOpenLink={handleOpenLink}
          onMessage={handleMessage}
          onLoggingMessage={handleLoggingMessage}
          toolName={tool.name}
          hostContext={hostContext}
          toolInput={toolInput}
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
