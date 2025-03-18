import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { TabsContent } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import DynamicJsonForm, { JsonSchemaType, JsonValue } from "./DynamicJsonForm";
import { generateDefaultValue } from "@/utils/schemaUtils";
import {
  CallToolResultSchema,
  CompatibilityCallToolResult,
  ListToolsResult,
  Tool,
} from "@modelcontextprotocol/sdk/types.js";
import { AlertCircle, Send } from "lucide-react";
import { useEffect, useState } from "react";
import ListPane from "./ListPane";

// Utility function to escape Unicode characters
function escapeUnicode(obj: any): string {
  return JSON.stringify(
    obj,
    (_key: string, value) => {
      if (typeof value === "string") {
        // Replace non-ASCII characters with their Unicode escape sequences
        return value.replace(/[^\0-\x7F]/g, (char) => {
          return "\\u" + ("0000" + char.charCodeAt(0).toString(16)).slice(-4);
        });
      }
      return value;
    },
    2,
  );
}

const ToolsTab = ({
  tools,
  listTools,
  clearTools,
  callTool,
  selectedTool,
  setSelectedTool,
  toolResult,
  nextCursor,
  error,
}: {
  tools: Tool[];
  listTools: () => void;
  clearTools: () => void;
  callTool: (name: string, params: Record<string, unknown>) => void;
  selectedTool: Tool | null;
  setSelectedTool: (tool: Tool | null) => void;
  toolResult: CompatibilityCallToolResult | null;
  nextCursor: ListToolsResult["nextCursor"];
  error: string | null;
}) => {
  const [params, setParams] = useState<Record<string, unknown>>({});
  useEffect(() => {
    setParams({});
  }, [selectedTool]);

  const renderToolResult = () => {
    if (!toolResult) return null;

    if ("content" in toolResult) {
      const parsedResult = CallToolResultSchema.safeParse(toolResult);
      if (!parsedResult.success) {
        return (
          <>
            <h4 className="font-semibold mb-2">Invalid Tool Result:</h4>
            <pre className="bg-gray-50 dark:bg-gray-800 dark:text-gray-100 p-4 rounded text-sm overflow-auto max-h-64">
              {escapeUnicode(toolResult)}
            </pre>
            <h4 className="font-semibold mb-2">Errors:</h4>
            {parsedResult.error.errors.map((error, idx) => (
              <pre
                key={idx}
                className="bg-gray-50 dark:bg-gray-800 dark:text-gray-100 p-4 rounded text-sm overflow-auto max-h-64"
              >
                {escapeUnicode(error)}
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
              {item.type === "resource" &&
                (item.resource?.mimeType?.startsWith("audio/") ? (
                  <audio
                    controls
                    src={`data:${item.resource.mimeType};base64,${item.resource.blob}`}
                    className="w-full"
                  >
                    <p>Your browser does not support audio playback</p>
                  </audio>
                ) : (
                  <pre className="bg-gray-50 dark:bg-gray-800 dark:text-gray-100 whitespace-pre-wrap break-words p-4 rounded text-sm overflow-auto max-h-64">
                    {escapeUnicode(item.resource)}
                  </pre>
                ))}
            </div>
          ))}
        </>
      );
    } else if ("toolResult" in toolResult) {
      return (
        <>
          <h4 className="font-semibold mb-2">Tool Result (Legacy):</h4>
          <pre className="bg-gray-50 dark:bg-gray-800 dark:text-gray-100 p-4 rounded text-sm overflow-auto max-h-64">
            {escapeUnicode(toolResult.toolResult)}
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
        clearItems={() => {
          clearTools();
          setSelectedTool(null);
        }}
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
                ([key, value]) => {
                  const prop = value as JsonSchemaType;
                  return (
                    <div key={key}>
                      <Label
                        htmlFor={key}
                        className="block text-sm font-medium text-gray-700"
                      >
                        {key}
                      </Label>
                      {prop.type === "boolean" ? (
                        <div className="flex items-center space-x-2 mt-2">
                          <Checkbox
                            id={key}
                            name={key}
                            checked={!!params[key]}
                            onCheckedChange={(checked: boolean) =>
                              setParams({
                                ...params,
                                [key]: checked,
                              })
                            }
                          />
                          <label
                            htmlFor={key}
                            className="text-sm font-medium text-gray-700 dark:text-gray-300"
                          >
                            {prop.description || "Toggle this option"}
                          </label>
                        </div>
                      ) : prop.type === "string" ? (
                        <Textarea
                          id={key}
                          name={key}
                          placeholder={prop.description}
                          value={(params[key] as string) ?? ""}
                          onChange={(e) =>
                            setParams({
                              ...params,
                              [key]: e.target.value,
                            })
                          }
                          className="mt-1"
                        />
                      ) : prop.type === "object" || prop.type === "array" ? (
                        <div className="mt-1">
                          <DynamicJsonForm
                            schema={{
                              type: prop.type,
                              properties: prop.properties,
                              description: prop.description,
                              items: prop.items,
                            }}
                            value={
                              (params[key] as JsonValue) ??
                              generateDefaultValue(prop)
                            }
                            onChange={(newValue: JsonValue) => {
                              setParams({
                                ...params,
                                [key]: newValue,
                              });
                            }}
                          />
                        </div>
                      ) : (
                        <Input
                          type={prop.type === "number" ? "number" : "text"}
                          id={key}
                          name={key}
                          placeholder={prop.description}
                          onChange={(e) =>
                            setParams({
                              ...params,
                              [key]:
                                prop.type === "number"
                                  ? Number(e.target.value)
                                  : e.target.value,
                            })
                          }
                          className="mt-1"
                        />
                      )}
                    </div>
                  );
                },
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
