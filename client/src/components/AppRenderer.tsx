import { useEffect, useRef, useState } from "react";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { Tool } from "@modelcontextprotocol/sdk/types.js";
import {
  AppBridge,
  PostMessageTransport,
  getToolUiResourceUri,
  buildAllowAttribute,
} from "@modelcontextprotocol/ext-apps/app-bridge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AlertCircle, Loader2 } from "lucide-react";

interface AppRendererProps {
  tool: Tool;
  mcpClient: Client | null;
  onReadResource: (uri: string) => void;
  resourceContent: string;
}

interface UIResourceMeta {
  ui?: {
    resourceUri?: string;
    permissions?: Record<string, unknown>;
    csp?: string;
  };
}

const AppRenderer = ({
  tool,
  mcpClient,
  onReadResource,
  resourceContent,
}: AppRendererProps) => {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const bridgeRef = useRef<AppBridge | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [initialized, setInitialized] = useState(false);

  // Extract UI metadata from tool
  const resourceUri = getToolUiResourceUri(tool);
  const meta = (tool as Tool & { _meta?: UIResourceMeta })._meta;
  const permissions = meta?.ui?.permissions;

  // Fetch UI resource when component mounts or tool changes
  useEffect(() => {
    console.log("[AppRenderer] Resource fetch check:", {
      resourceUri,
      hasResourceContent: !!resourceContent,
      resourceContentLength: resourceContent?.length || 0,
    });

    if (resourceUri && !resourceContent) {
      console.log("[AppRenderer] Fetching resource:", resourceUri);
      setLoading(true);
      setError(null);
      onReadResource(resourceUri);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resourceUri, resourceContent]);

  // Set up AppBridge and render the app
  useEffect(() => {
    console.log("[AppRenderer] Setup check:", {
      hasResourceContent: !!resourceContent,
      hasIframe: !!iframeRef.current,
      hasMcpClient: !!mcpClient,
      resourceContentPreview: resourceContent?.substring(0, 100),
    });

    if (!resourceContent || !iframeRef.current || !mcpClient) {
      console.log("[AppRenderer] Setup conditions not met, skipping");
      return;
    }

    console.log("[AppRenderer] Starting app setup");
    const iframe = iframeRef.current;
    let bridge: AppBridge | null = null;
    let transport: PostMessageTransport | null = null;

    const setupApp = async () => {
      try {
        console.log("[AppRenderer] Creating AppBridge...");
        // Create AppBridge with the MCP client
        bridge = new AppBridge(
          mcpClient,
          { name: "MCP Inspector", version: "0.19.0" },
          {
            openLinks: {},
            serverTools: {},
            logging: {},
          },
          {
            hostContext: {
              theme: document.documentElement.classList.contains("dark")
                ? "dark"
                : "light",
            },
          },
        );

        // Set up event handlers
        bridge.oninitialized = () => {
          console.log("[AppRenderer] MCP App initialized successfully");
          setInitialized(true);
        };

        bridge.onerror = (error: Error) => {
          console.error("MCP App error:", error);
          setError(error.message || "An error occurred");
        };

        // Create the iframe document with the UI resource content
        const iframeDoc =
          iframe.contentDocument || iframe.contentWindow?.document;
        if (!iframeDoc) {
          throw new Error("Could not access iframe document");
        }

        // Parse the resource content to extract HTML
        let htmlContent = resourceContent;
        console.log("[AppRenderer] Parsing resource content...");
        try {
          const parsed = JSON.parse(resourceContent);
          console.log("[AppRenderer] Parsed JSON:", {
            hasContents: !!parsed.contents,
            isArray: Array.isArray(parsed.contents),
            contentsLength: parsed.contents?.length,
          });
          if (parsed.contents && Array.isArray(parsed.contents)) {
            // MCP resource response format: TextResourceContents has uri, mimeType?, and text
            const textContent = parsed.contents.find(
              (c: { uri?: string; mimeType?: string; text?: string }) =>
                c.text !== undefined,
            );
            if (textContent?.text) {
              htmlContent = textContent.text;
              console.log(
                "[AppRenderer] Extracted HTML from contents, length:",
                htmlContent.length,
                "mimeType:",
                textContent.mimeType,
              );
            } else {
              console.warn(
                "[AppRenderer] No text content found in contents array:",
                parsed.contents,
              );
            }
          }
        } catch (err) {
          console.log("[AppRenderer] Not JSON, using content as-is:", err);
        }

        // Write the HTML content to the iframe
        console.log("[AppRenderer] Writing HTML to iframe...");
        iframeDoc.open();
        iframeDoc.write(htmlContent);
        iframeDoc.close();
        console.log("[AppRenderer] HTML written to iframe");

        // Clear loading state so iframe becomes visible
        // This is required for PostMessage communication to work
        setLoading(false);
        console.log("[AppRenderer] Iframe now visible, ready for PostMessage");

        // Wait for iframe to load
        await new Promise<void>((resolve) => {
          if (iframe.contentWindow) {
            iframe.contentWindow.addEventListener("load", () => resolve(), {
              once: true,
            });
          } else {
            resolve();
          }
        });

        // Create PostMessageTransport for communication
        if (!iframe.contentWindow) {
          throw new Error("Iframe contentWindow not available");
        }

        console.log("[AppRenderer] Creating PostMessageTransport...");
        transport = new PostMessageTransport(
          iframe.contentWindow,
          iframe.contentWindow,
        );

        // Connect the bridge
        console.log("[AppRenderer] Connecting AppBridge...");
        await bridge.connect(transport);
        console.log("[AppRenderer] AppBridge connected successfully");

        bridgeRef.current = bridge;
      } catch (err) {
        console.error("Error setting up MCP App:", err);
        setError(err instanceof Error ? err.message : "Failed to set up app");
        setLoading(false);
      }
    };

    setupApp();

    // Cleanup
    return () => {
      if (bridge) {
        bridge.close().catch(console.error);
      }
      bridgeRef.current = null;
      setInitialized(false);
    };
  }, [resourceContent, mcpClient]);

  // Build iframe attributes
  const allowAttribute = buildAllowAttribute(permissions);

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

  return (
    <div className="flex flex-col h-full">
      {loading && (
        <Alert>
          <Loader2 className="h-4 w-4 animate-spin" />
          <AlertDescription>Loading MCP App...</AlertDescription>
        </Alert>
      )}

      {error && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <iframe
        ref={iframeRef}
        className="w-full flex-1 border rounded"
        sandbox="allow-scripts allow-same-origin"
        allow={allowAttribute}
        style={{
          minHeight: "400px",
          display: loading ? "none" : "block",
        }}
        title={`MCP App: ${tool.name}`}
      />

      {initialized && (
        <div className="text-xs text-muted-foreground mt-2">
          App connected • {tool.name}
        </div>
      )}
    </div>
  );
};

export default AppRenderer;
