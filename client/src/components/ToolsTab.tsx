import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { TabsContent } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import DynamicJsonForm, { DynamicJsonFormRef } from "./DynamicJsonForm";
import type { JsonValue, JsonSchemaType } from "@/utils/jsonUtils";
import { generateDefaultValue } from "@/utils/schemaUtils";
import {
  CompatibilityCallToolResult,
  ListToolsResult,
  Tool,
} from "@modelcontextprotocol/sdk/types.js";
import { Loader2, Send, ChevronDown, ChevronUp, AlertCircle } from "lucide-react";
import { useEffect, useState, useRef } from "react";
import ListPane from "./ListPane";
import JsonView from "./JsonView";
import ToolResults from "./ToolResults";

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
  callTool: (name: string, params: Record<string, unknown>) => Promise<void>;
  selectedTool: Tool | null;
  setSelectedTool: (tool: Tool | null) => void;
  toolResult: CompatibilityCallToolResult | null;
  nextCursor: ListToolsResult["nextCursor"];
  error: string | null;
}) => {
  const [params, setParams] = useState<Record<string, unknown>>({});
  const [isToolRunning, setIsToolRunning] = useState(false);
  const [isOutputSchemaExpanded, setIsOutputSchemaExpanded] = useState(false);
  const formRefs = useRef<Record<string, DynamicJsonFormRef | null>>({});

  useEffect(() => {
    const params = Object.entries(
      selectedTool?.inputSchema.properties ?? [],
    ).map(([key, value]) => [
      key,
      generateDefaultValue(value as JsonSchemaType),
    ]);
    setParams(Object.fromEntries(params));
  }, [selectedTool]);

  return (
    <TabsContent value="tools">
      <div className="grid grid-cols-2 gap-4">
        <ListPane
          items={tools}
          listItems={listTools}
          clearItems={() => {
            clearTools();
            setSelectedTool(null);
          }}
          setSelectedItem={setSelectedTool}
          renderItem={(tool) => (
            <div className="flex flex-col items-start">
              <span className="flex-1">{tool.name}</span>
              <span className="text-sm text-gray-500 text-left">
                {tool.description}
              </span>
            </div>
          )}
          title="Tools"
          buttonText={nextCursor ? "List More Tools" : "List Tools"}
          isButtonDisabled={!nextCursor && tools.length > 0}
        />

        <div className="bg-card border border-border rounded-lg shadow">
          <div className="p-4 border-b border-gray-200 dark:border-border">
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
                <p className="text-sm text-gray-600 dark:text-gray-400">
                  {selectedTool.description}
                </p>
                {Object.entries(selectedTool.inputSchema.properties ?? []).map(
                  ([key, value]) => {
                    const prop = value as JsonSchemaType;
                    return (
                      <div key={key}>
                        <Label
                          htmlFor={key}
                          className="block text-sm font-medium text-gray-700 dark:text-gray-300"
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
                              ref={(ref) => (formRefs.current[key] = ref)}
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
                        ) : prop.type === "number" ||
                          prop.type === "integer" ? (
                          <Input
                            type="number"
                            id={key}
                            name={key}
                            placeholder={prop.description}
                            value={(params[key] as string) ?? ""}
                            onChange={(e) =>
                              setParams({
                                ...params,
                                [key]: Number(e.target.value),
                              })
                            }
                            className="mt-1"
                          />
                        ) : (
                          <div className="mt-1">
                            <DynamicJsonForm
                              ref={(ref) => (formRefs.current[key] = ref)}
                              schema={{
                                type: prop.type,
                                properties: prop.properties,
                                description: prop.description,
                                items: prop.items,
                              }}
                              value={params[key] as JsonValue}
                              onChange={(newValue: JsonValue) => {
                                setParams({
                                  ...params,
                                  [key]: newValue,
                                });
                              }}
                            />
                          </div>
                        )}
                      </div>
                    );
                  },
                )}
                {selectedTool.outputSchema && (
                  <div className="bg-gray-50 dark:bg-gray-900 p-3 rounded-lg">
                    <div className="flex items-center justify-between mb-2">
                      <h4 className="text-sm font-semibold">Output Schema:</h4>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() =>
                          setIsOutputSchemaExpanded(!isOutputSchemaExpanded)
                        }
                        className="h-6 px-2"
                      >
                        {isOutputSchemaExpanded ? (
                          <>
                            <ChevronUp className="h-3 w-3 mr-1" />
                            Collapse
                          </>
                        ) : (
                          <>
                            <ChevronDown className="h-3 w-3 mr-1" />
                            Expand
                          </>
                        )}
                      </Button>
                    </div>
                    <div
                      className={`transition-all ${
                        isOutputSchemaExpanded
                          ? ""
                          : "max-h-[8rem] overflow-y-auto"
                      }`}
                    >
                      <JsonView data={selectedTool.outputSchema} />
                    </div>
                  </div>
                )}
                <Button
                  onClick={async () => {
                    // Validate JSON inputs before calling tool
                    const hasValidationErrors = Object.values(formRefs.current).some(
                      (ref) => ref && !ref.validateJson().isValid
                    );
                    if (hasValidationErrors) return;

                    try {
                      setIsToolRunning(true);
                      await callTool(selectedTool.name, params);
                    } finally {
                      setIsToolRunning(false);
                    }
                  }}
                  disabled={isToolRunning}
                >
                  {isToolRunning ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Running...
                    </>
                  ) : (
                    <>
                      <Send className="w-4 h-4 mr-2" />
                      Run Tool
                    </>
                  )}
                </Button>
                <ToolResults
                  toolResult={toolResult}
                  selectedTool={selectedTool}
                />
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
      </div>
    </TabsContent>
  );
};

export default ToolsTab;
