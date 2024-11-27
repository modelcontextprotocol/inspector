import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { TabsContent } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import {
  ListToolsResult,
  Tool,
  CallToolResultSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { AlertCircle, Send } from "lucide-react";
import { useState } from "react";
import ListPane from "./ListPane";

import { CompatibilityCallToolResult } from "@modelcontextprotocol/sdk/types.js";

const ToolsTab = ({
  tools,
  listTools,
  callTool,
  selectedTool,
  setSelectedTool,
  toolResult,
  nextCursor,
  error,
}: {
  tools: Tool[];
  listTools: () => void;
  callTool: (name: string, params: Record<string, unknown>) => void;
  selectedTool: Tool | null;
  setSelectedTool: (tool: Tool) => void;
  toolResult: CompatibilityCallToolResult | null;
  nextCursor: ListToolsResult["nextCursor"];
  error: string | null;
}) => {
  const [params, setParams] = useState<Record<string, unknown>>({});

  const renderToolResult = () => {
    if (!toolResult) return null;

    if ("content" in toolResult) {
      const parsedResult = CallToolResultSchema.safeParse(toolResult);
      if (!parsedResult.success) {
        return (
          <>
            <h4 className="font-semibold mb-2">Invalid Tool Result:</h4>
            <pre className="bg-gray-50 dark:bg-gray-800 dark:text-gray-100 p-4 rounded text-sm overflow-auto max-h-64">
              {JSON.stringify(toolResult, null, 2)}
            </pre>
            <h4 className="font-semibold mb-2">Errors:</h4>
            {parsedResult.error.errors.map((error, idx) => (
              <pre 
                key={idx}
                className="bg-gray-50 dark:bg-gray-800 dark:text-gray-100 p-4 rounded text-sm overflow-auto max-h-64"
              >
                {JSON.stringify(error, null, 2)}
              </pre>
            ))}
          </>
        );
      }
      const structuredResult = parsedResult.data;
      const isError = structuredResult.isError ?? false;

      return (
        <>
          <h4 className="font-semibold mb-2">
            Tool Result: {isError ? "Error" : "Success"}
          </h4>
          {structuredResult.content.map((item, index) => (
            <div key={index} className="mb-2">
              {item.type === "text" && (
                <pre className="bg-gray-50 dark:bg-gray-800 dark:text-gray-100 p-4 rounded text-sm overflow-auto max-h-64">
                  {item.text}
                </pre>
              )}
              {item.type === "image" && (
                <img
                  src={`data:${item.mimeType};base64,${item.data}`}
                  alt="Tool result image"
                  className="max-w-full h-auto"
                />
              )}
              {item.type === "resource" && (
                <pre className="bg-gray-50  dark:bg-gray-800 dark:text-gray-100 whitespace-pre-wrap break-words p-4 rounded text-sm overflow-auto max-h-64">
                  {JSON.stringify(item.resource, null, 2)}
                </pre>
              )}
            </div>
          ))}
        </>
      );
    } else if ("toolResult" in toolResult) {
      return (
        <>
          <h4 className="font-semibold mb-2">Tool Result (Legacy):</h4>
          <pre className="bg-gray-50 p-4 rounded text-sm overflow-auto max-h-64">
            {JSON.stringify(toolResult.toolResult, null, 2)}
          </pre>
        </>
      );
    }
  };

  return (
    <TabsContent value="tools" className="grid grid-cols-2 gap-4">
      <ListPane
        items={tools}
        listItems={listTools}
        setSelectedItem={setSelectedTool}
        renderItem={(tool) => (
          <>
            <span className="flex-1">{tool.name}</span>
            <span className="text-sm text-gray-500 text-right">
              {tool.description}
            </span>
          </>
        )}
        title="Tools"
        buttonText={nextCursor ? "List More Tools" : "List Tools"}
        isButtonDisabled={!nextCursor && tools.length > 0}
      />

      <div className="bg-card rounded-lg shadow">
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
              {Object.entries(selectedTool.inputSchema.properties ?? []).map(
                ([key, value]) => (
                  <div key={key}>
                    <Label
                      htmlFor={key}
                      className="block text-sm font-medium text-gray-700"
                    >
                      {key}
                    </Label>
                    {
                      /* @ts-expect-error value type is currently unknown */
                      value.type === "string" ? (
                        <Textarea
                          id={key}
                          name={key}
                          // @ts-expect-error value type is currently unknown
                          placeholder={value.description}
                          onChange={(e) =>
                            setParams({
                              ...params,
                              [key]: e.target.value,
                            })
                          }
                          className="mt-1"
                        />
                      ) : (
                        <Input
                          // @ts-expect-error value type is currently unknown
                          type={value.type === "number" ? "number" : "text"}
                          id={key}
                          name={key}
                          // @ts-expect-error value type is currently unknown
                          placeholder={value.description}
                          onChange={(e) =>
                            setParams({
                              ...params,
                              [key]:
                                // @ts-expect-error value type is currently unknown
                                value.type === "number"
                                  ? Number(e.target.value)
                                  : e.target.value,
                            })
                          }
                          className="mt-1"
                        />
                      )
                    }
                  </div>
                ),
              )}
              <Button onClick={() => callTool(selectedTool.name, params)}>
                <Send className="w-4 h-4 mr-2" />
                Run Tool
              </Button>
              {toolResult && renderToolResult()}
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
