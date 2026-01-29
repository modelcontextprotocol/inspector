import { useEffect, useMemo, useState } from "react";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { Tool } from "@modelcontextprotocol/sdk/types.js";
import {
  AppRenderer as McpUiAppRenderer,
  type McpUiHostContext,
} from "@mcp-ui/client";
import { getToolUiResourceUri } from "@modelcontextprotocol/ext-apps/app-bridge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AlertCircle } from "lucide-react";

interface AppRendererProps {
  tool: Tool;
  mcpClient: Client | null;
  onReadResource: (uri: string) => void;
  resourceContent: string;
  toolInput?: Record<string, unknown>;
}

const AppRenderer = ({
  tool,
  mcpClient,
  onReadResource,
  resourceContent,
  toolInput,
}: AppRendererProps) => {
  const [error, setError] = useState<string | null>(null);

  // Extract UI metadata from tool
  const resourceUri = getToolUiResourceUri(tool);

  // Parse HTML from resourceContent if it's a JSON-encoded resource response
  const html = useMemo(() => {
    let retval = "";
    if (resourceContent) {
      try {
        const parsed = JSON.parse(resourceContent);
        if (parsed.error) {
          setError(parsed.error);
          return "";
        }
        if (parsed.contents && Array.isArray(parsed.contents)) {
          // MCP resource response format: TextResourceContents has uri, mimeType?, and text
          const textContent = parsed.contents.find(
            (c: { text?: string }) => c.text !== undefined,
          );
          retval = textContent?.text || resourceContent;
        }
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
      } catch (err) {
        retval = resourceContent;
      }
    }
    return retval;
  }, [resourceContent]);

  // Fetch UI resource when component mounts or tool changes
  useEffect(() => {
    if (resourceUri && !resourceContent && !error) {
      onReadResource(resourceUri);
    }
  }, [resourceUri, resourceContent, onReadResource, error]);

  const hostContext: McpUiHostContext = useMemo(
    () => ({
      theme: document.documentElement.classList.contains("dark")
        ? "dark"
        : "light",
    }),
    [],
  );

  if (!resourceUri) {
    return (
      <Alert variant="destructive">
        <AlertCircle className="h-4 w-4" />
        <AlertDescription>
          No UI resource URI found in tool metadata
        </AlertDescription>
      </Alert>
    );
  }

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
          toolName={tool.name}
          html={html}
          hostContext={hostContext}
          toolInput={toolInput}
          sandbox={{
            url: new URL("/sandbox_proxy.html", window.location.origin),
          }}
          onError={(err) => setError(err.message)}
        />
      </div>
    </div>
  );
};

export default AppRenderer;
