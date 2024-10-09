import { TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Send, AlertCircle } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { useState } from "react";
import { Label } from "@/components/ui/label";

export type Tool = {
  name: string;
  description: string;
  inputSchema: {
    type: string;
    properties: Record<string, { type: string; description: string }>;
  };
};

const ToolsTab = ({
  tools,
  listTools,
  callTool,
  selectedTool,
  setSelectedTool,
  toolResult,
  error,
}: {
  tools: Tool[];
  listTools: () => void;
  callTool: (name: string, params: Record<string, unknown>) => void;
  selectedTool: Tool | null;
  setSelectedTool: (tool: Tool) => void;
  toolResult: string;
  error: string | null;
}) => {
  const [params, setParams] = useState<Record<string, unknown>>({});

  return (
    <TabsContent value="tools" className="grid grid-cols-2 gap-4">
      <div className="bg-white rounded-lg shadow">
        <div className="p-4 border-b border-gray-200">
          <h3 className="font-semibold">Tools</h3>
        </div>
        <div className="p-4">
          <Button variant="outline" className="w-full mb-4" onClick={listTools}>
            List Tools
          </Button>
          <div className="space-y-2">
            {tools.map((tool, index) => (
              <div
                key={index}
                className="flex items-center p-2 rounded hover:bg-gray-50 cursor-pointer"
                onClick={() => setSelectedTool(tool)}
              >
                <span className="flex-1">{tool.name}</span>
                <span className="text-sm text-gray-500">
                  {tool.description}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="bg-white rounded-lg shadow">
        <div className="p-4 border-b border-gray-200">
          <h3 className="font-semibold">
            {selectedTool ? selectedTool.name : "Select a tool"}
          </h3>
        </div>
        <div className="p-4">
          {error ? (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertTitle>Error</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : selectedTool ? (
            <div className="space-y-4">
              <p className="text-sm text-gray-600">
                {selectedTool.description}
              </p>
              {Object.entries(selectedTool.inputSchema.properties).map(
                ([key, value]) => (
                  <div key={key}>
                    <Label
                      htmlFor={key}
                      className="block text-sm font-medium text-gray-700"
                    >
                      {key}
                    </Label>
                    <Input
                      type={value.type === "number" ? "number" : "text"}
                      id={key}
                      name={key}
                      placeholder={value.description}
                      onChange={(e) =>
                        setParams({
                          ...params,
                          [key]:
                            value.type === "number"
                              ? Number(e.target.value)
                              : e.target.value,
                        })
                      }
                    />
                  </div>
                ),
              )}
              <Button onClick={() => callTool(selectedTool.name, params)}>
                <Send className="w-4 h-4 mr-2" />
                Run Tool
              </Button>
              {toolResult && (
                <>
                  <h4 className="font-semibold mb-2">Tool Result:</h4>
                  <pre className="bg-gray-50 p-4 rounded text-sm overflow-auto max-h-64">
                    {toolResult}
                  </pre>
                </>
              )}
            </div>
          ) : (
            <Alert>
              <AlertDescription>
                Select a tool from the list to view its details and run it
              </AlertDescription>
            </Alert>
          )}
        </div>
      </div>
    </TabsContent>
  );
};

export default ToolsTab;
