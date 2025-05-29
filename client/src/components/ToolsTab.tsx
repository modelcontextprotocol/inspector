import {
  CompatibilityCallToolResult,
  ListToolsResult,
  Tool,
} from "@modelcontextprotocol/sdk/types.js";
import { useEffect } from "react";
import ListPane from "./ListPane";
import { ConnectionStatus } from "@/lib/constants";
import ToolRunCard from "./ToolRunCard";
import { McpJamRequest } from "@/lib/requestTypes";

const ToolsTab = ({
  tools,
  listTools,
  clearTools,
  callTool,
  selectedTool,
  setSelectedTool,
  nextCursor,
  connectionStatus,
  loadedRequest,
}: {
  tools: Tool[];
  listTools: () => void;
  clearTools: () => void;
  callTool: (name: string, params: Record<string, unknown>) => Promise<void>;
  selectedTool: Tool | null;
  setSelectedTool: (tool: Tool | null) => void;
  toolResult: CompatibilityCallToolResult | null;
  nextCursor: ListToolsResult["nextCursor"];
  error: string | null;
  connectionStatus: ConnectionStatus;
  loadedRequest?: McpJamRequest | null;
}) => {
  useEffect(() => {
    if (connectionStatus === "connected") {
      listTools();
    }
  }, [connectionStatus]);

  // Auto-select tool when a request is loaded
  useEffect(() => {
    if (loadedRequest && tools.length > 0) {
      const matchingTool = tools.find(tool => tool.name === loadedRequest.toolName);
      if (matchingTool) {
        setSelectedTool(matchingTool);
      }
    }
  }, [loadedRequest, tools, setSelectedTool]);

  return (
    <div className="grid grid-cols-2 gap-4">
      <ListPane
        items={tools}
        listItems={listTools}
        clearItems={() => {
          clearTools();
          setSelectedTool(null);
        }}
        setSelectedItem={setSelectedTool}
        renderItem={(tool) => {
          const parameters = tool.inputSchema.properties
            ? Object.keys(tool.inputSchema.properties)
            : [];

          return (
            <div className="bg-white dark:bg-gray-900 rounded-lg p-3 shadow-sm border border-gray-100 dark:border-gray-800 hover:shadow-md hover:border-blue-200 dark:hover:border-blue-800 transition-all duration-200 group">
              <div className="flex flex-col space-y-2.5">
                {/* Tool name with emoji and styling */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-2">
                    <span className="text-lg">🛠️</span>
                    <span className="font-mono text-xs bg-gradient-to-r from-slate-100 to-gray-100 dark:from-slate-800 dark:to-gray-800 px-2.5 py-1 rounded-md border border-slate-300 dark:border-slate-600 text-slate-800 dark:text-slate-200 font-medium shadow-sm">
                      {tool.name}
                    </span>
                  </div>
                  {parameters.length > 0 && (
                    <span className="text-xs text-gray-400 dark:text-gray-600 font-medium">
                      {parameters.length} param
                      {parameters.length !== 1 ? "s" : ""}
                    </span>
                  )}
                </div>

                {/* Tool description */}
                <p className="text-xs text-gray-600 dark:text-gray-400 leading-relaxed line-clamp-2">
                  {tool.description}
                </p>
              </div>
            </div>
          );
        }}
        title="Tools"
        isButtonDisabled={!nextCursor && tools.length > 0}
        searchKey="name"
        searchPlaceholder="Search tools by name..."
        buttonText="Load Tools"
      />

      <ToolRunCard 
        selectedTool={selectedTool} 
        callTool={callTool} 
        loadedRequest={loadedRequest}
      />
    </div>
  );
};

export default ToolsTab;
