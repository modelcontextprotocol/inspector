import { useEffect, useState, useCallback } from "react";
import { TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AlertCircle, RefreshCw, X } from "lucide-react";
import { Tool } from "@modelcontextprotocol/sdk/types.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { getToolUiResourceUri } from "@modelcontextprotocol/ext-apps/app-bridge";
import AppRenderer from "./AppRenderer";

interface AppsTabProps {
  tools: Tool[];
  listTools: () => void;
  error: string | null;
  mcpClient: Client | null;
  onReadResource: (uri: string) => void;
  resourceContentMap: Record<string, string>;
}

// Type guard to check if a tool has UI metadata
const hasUIMetadata = (tool: Tool): boolean => {
  return !!getToolUiResourceUri(tool);
};

const AppsTab = ({
  tools,
  listTools,
  error,
  mcpClient,
  onReadResource,
  resourceContentMap,
}: AppsTabProps) => {
  const [appTools, setAppTools] = useState<Tool[]>([]);
  const [selectedTool, setSelectedTool] = useState<Tool | null>(null);

  // Filter tools that have UI metadata
  useEffect(() => {
    const filtered = tools.filter(hasUIMetadata);
    console.log("[AppsTab] Filtered app tools:", {
      totalTools: tools.length,
      appTools: filtered.length,
      appToolNames: filtered.map((t) => t.name),
    });
    setAppTools(filtered);

    // If current selected tool is no longer available, reset selection
    if (selectedTool && !filtered.find((t) => t.name === selectedTool.name)) {
      setSelectedTool(null);
    }
  }, [tools, selectedTool]);

  const handleRefresh = useCallback(() => {
    listTools();
  }, [listTools]);

  const handleCloseApp = useCallback(() => {
    setSelectedTool(null);
  }, []);

  return (
    <TabsContent value="apps" className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold">MCP Apps</h2>
        <Button onClick={handleRefresh} variant="outline" size="sm">
          <RefreshCw className="w-4 h-4 mr-2" />
          Refresh
        </Button>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {appTools.length === 0 ? (
        <Alert>
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            No MCP Apps available. Apps are tools that include a{" "}
            <code className="text-xs bg-muted px-1 py-0.5 rounded">
              _meta.ui.resourceUri
            </code>{" "}
            field in their tool definition.
          </AlertDescription>
        </Alert>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {appTools.map((tool) => {
            const resourceUri = getToolUiResourceUri(tool) || "";

            return (
              <div
                key={tool.name}
                className="border rounded-lg p-4 hover:border-primary cursor-pointer transition-colors"
                onClick={() => setSelectedTool(tool)}
              >
                <h3 className="font-semibold text-lg mb-2">{tool.name}</h3>
                {tool.description && (
                  <p className="text-sm text-muted-foreground mb-3">
                    {tool.description}
                  </p>
                )}
                <div className="text-xs text-muted-foreground">
                  <span className="font-mono bg-muted px-1 py-0.5 rounded">
                    {resourceUri}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {selectedTool &&
        (() => {
          const resourceUri = getToolUiResourceUri(selectedTool) || "";
          const content = resourceContentMap[resourceUri] || "";

          console.log("[AppsTab] Rendering app:", {
            toolName: selectedTool.name,
            resourceUri,
            hasContent: !!content,
            contentLength: content.length,
            resourceContentMapKeys: Object.keys(resourceContentMap),
          });

          return (
            <div className="mt-6 border-t pt-6">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-xl font-semibold">{selectedTool.name}</h3>
                <Button
                  onClick={handleCloseApp}
                  variant="ghost"
                  size="sm"
                  aria-label="Close app"
                >
                  <X className="w-4 h-4" />
                </Button>
              </div>
              <AppRenderer
                tool={selectedTool}
                mcpClient={mcpClient}
                onReadResource={onReadResource}
                resourceContent={content}
              />
            </div>
          );
        })()}
    </TabsContent>
  );
};

export default AppsTab;
