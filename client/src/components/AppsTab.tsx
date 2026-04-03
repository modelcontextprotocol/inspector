import { useEffect, useState, useCallback, useRef } from "react";
import { TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  AlertCircle,
  X,
  Play,
  Loader2,
  ChevronRight,
  Maximize2,
  Minimize2,
} from "lucide-react";
import {
  Tool,
  ServerNotification,
  CompatibilityCallToolResult,
} from "@modelcontextprotocol/sdk/types.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { getToolUiResourceUri } from "@modelcontextprotocol/ext-apps/app-bridge";
import AppRenderer from "./AppRenderer";
import ListPane from "./ListPane";
import IconDisplay, { WithIcons } from "./IconDisplay";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import DynamicJsonForm, { DynamicJsonFormRef } from "./DynamicJsonForm";
import { JsonSchemaType, JsonValue } from "@/utils/jsonUtils";
import {
  generateDefaultValue,
  isPropertyRequired,
  normalizeUnionType,
  resolveRef,
} from "@/utils/schemaUtils";

interface AppsTabProps {
  sandboxPath: string;
  tools: Tool[];
  listTools: () => void;
  callTool: (
    name: string,
    params: Record<string, unknown>,
    metadata?: Record<string, unknown>,
    runAsTask?: boolean,
  ) => Promise<CompatibilityCallToolResult>;
  prefilledToolCall?: {
    id: number;
    toolName: string;
    params: Record<string, unknown>;
    result: CompatibilityCallToolResult;
  } | null;
  onPrefilledToolCallConsumed?: (callId: number) => void;
  error: string | null;
  mcpClient: Client | null;
  onNotification?: (notification: ServerNotification) => void;
}

// Type guard to check if a tool has UI metadata
const hasUIMetadata = (tool: Tool): boolean => {
  return !!getToolUiResourceUri(tool);
};

const cloneToolParams = (
  source: Record<string, unknown>,
): Record<string, unknown> => {
  try {
    return structuredClone(source);
  } catch {
    return { ...source };
  }
};

const AppsTab = ({
  sandboxPath,
  tools,
  listTools,
  callTool,
  prefilledToolCall,
  onPrefilledToolCallConsumed,
  error,
  mcpClient,
  onNotification,
}: AppsTabProps) => {
  const [appTools, setAppTools] = useState<Tool[]>([]);
  const [selectedTool, setSelectedTool] = useState<Tool | null>(null);
  const [params, setParams] = useState<Record<string, unknown>>({});
  const [isAppOpen, setIsAppOpen] = useState(false);
  const [isOpeningApp, setIsOpeningApp] = useState(false);
  const [isMaximized, setIsMaximized] = useState(false);
  const [hasValidationErrors, setHasValidationErrors] = useState(false);
  const [submittedParams, setSubmittedParams] = useState<
    Record<string, unknown> | undefined
  >(undefined);
  const [submittedToolResult, setSubmittedToolResult] =
    useState<CompatibilityCallToolResult | null>(null);
  const formRefs = useRef<Record<string, DynamicJsonFormRef | null>>({});
  const openAppRunIdRef = useRef(0);
  const prefillingParamsRef = useRef<Record<string, unknown> | null>(null);
  const consumedPrefilledCallIdRef = useRef<number | null>(null);

  const buildInitialParams = useCallback((tool: Tool) => {
    const initialParams = Object.entries(tool.inputSchema.properties ?? []).map(
      ([key, value]) => {
        const resolvedValue = resolveRef(
          value as JsonSchemaType,
          tool.inputSchema as JsonSchemaType,
        );
        return [
          key,
          generateDefaultValue(
            resolvedValue,
            key,
            tool.inputSchema as JsonSchemaType,
          ),
        ];
      },
    );
    return Object.fromEntries(initialParams);
  }, []);

  // Function to check if any form has validation errors
  const checkValidationErrors = useCallback(() => {
    const errors = Object.values(formRefs.current).some(
      (ref) => ref && !ref.validateJson().isValid,
    );
    setHasValidationErrors(errors);
    return errors;
  }, []);

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
      setIsAppOpen(false);
      setSubmittedParams(undefined);
      setSubmittedToolResult(null);
    }
  }, [tools, selectedTool]);

  useEffect(() => {
    if (selectedTool) {
      const prefillingParams = prefillingParamsRef.current;
      if (prefillingParams) {
        setParams(prefillingParams);
        prefillingParamsRef.current = null;
      } else {
        setParams(buildInitialParams(selectedTool));
      }
      setHasValidationErrors(false);
      formRefs.current = {};
    } else {
      setParams({});
      setIsAppOpen(false);
      setSubmittedParams(undefined);
      setSubmittedToolResult(null);
    }
  }, [buildInitialParams, selectedTool]);

  useEffect(() => {
    if (!prefilledToolCall) {
      return;
    }

    if (consumedPrefilledCallIdRef.current === prefilledToolCall.id) {
      return;
    }

    const matchingTool = appTools.find(
      (tool) => tool.name === prefilledToolCall.toolName,
    );
    if (!matchingTool) {
      return;
    }

    const hydratedParams = cloneToolParams(prefilledToolCall.params);

    openAppRunIdRef.current += 1;
    setIsOpeningApp(false);
    prefillingParamsRef.current = hydratedParams;
    setSelectedTool(matchingTool);
    setSubmittedParams(hydratedParams);
    setSubmittedToolResult(prefilledToolCall.result);
    setIsAppOpen(true);
    setIsMaximized(false);
    consumedPrefilledCallIdRef.current = prefilledToolCall.id;
    onPrefilledToolCallConsumed?.(prefilledToolCall.id);
  }, [appTools, onPrefilledToolCallConsumed, prefilledToolCall]);

  const handleRefresh = useCallback(() => {
    listTools();
  }, [listTools]);

  const executeToolAndOpenApp = useCallback(
    async (tool: Tool, toolParams: Record<string, unknown>) => {
      const runId = ++openAppRunIdRef.current;
      const runParams = cloneToolParams(toolParams);
      prefillingParamsRef.current = null;
      setIsOpeningApp(true);
      setSubmittedParams(runParams);
      setSubmittedToolResult(null);
      try {
        const result = await callTool(tool.name, runParams);

        if (runId !== openAppRunIdRef.current) {
          return;
        }

        setSubmittedParams(runParams);
        setSubmittedToolResult(result);
        setIsAppOpen(true);
      } catch {
        if (runId !== openAppRunIdRef.current) {
          return;
        }

        setSubmittedToolResult(null);
        setIsAppOpen(false);
      } finally {
        if (runId === openAppRunIdRef.current) {
          setIsOpeningApp(false);
        }
      }
    },
    [callTool],
  );

  const handleCloseApp = useCallback(() => {
    openAppRunIdRef.current += 1;
    setIsOpeningApp(false);
    setIsAppOpen(false);
    setSubmittedToolResult(null);
  }, []);

  const handleOpenApp = useCallback(async () => {
    if (!selectedTool || checkValidationErrors()) {
      return;
    }

    await executeToolAndOpenApp(selectedTool, params);
  }, [checkValidationErrors, executeToolAndOpenApp, params, selectedTool]);

  const handleSelectTool = useCallback(
    (tool: Tool) => {
      openAppRunIdRef.current += 1;
      setIsOpeningApp(false);
      prefillingParamsRef.current = null;
      setSelectedTool(tool);
      setSubmittedParams(undefined);
      setSubmittedToolResult(null);
      const hasFields =
        tool.inputSchema.properties &&
        Object.keys(tool.inputSchema.properties).length > 0;

      if (hasFields) {
        setIsAppOpen(false);
        return;
      }

      const initialParams = buildInitialParams(tool);
      void executeToolAndOpenApp(tool, initialParams);
    },
    [buildInitialParams, executeToolAndOpenApp],
  );

  const handleDeselectTool = useCallback(() => {
    openAppRunIdRef.current += 1;
    setIsOpeningApp(false);
    prefillingParamsRef.current = null;
    setSelectedTool(null);
    setIsAppOpen(false);
    setIsMaximized(false);
    setSubmittedParams(undefined);
    setSubmittedToolResult(null);
  }, []);

  return (
    <TabsContent value="apps" className="space-y-4">
      <div
        className={
          isMaximized
            ? "grid grid-cols-1 gap-4"
            : "grid grid-cols-1 md:grid-cols-2 gap-4"
        }
      >
        {!isMaximized && (
          <ListPane
            items={appTools}
            listItems={handleRefresh}
            setSelectedItem={handleSelectTool}
            renderItem={(tool) => {
              return (
                <div className="flex items-start w-full gap-2">
                  <div className="flex-shrink-0 mt-1">
                    <IconDisplay icons={(tool as WithIcons).icons} size="sm" />
                  </div>
                  <div className="flex flex-col flex-1 min-w-0">
                    <span className="truncate font-semibold">{tool.name}</span>
                    {tool.description && (
                      <span className="text-sm text-gray-500 text-left line-clamp-2">
                        {tool.description}
                      </span>
                    )}
                  </div>
                  <ChevronRight className="w-4 h-4 flex-shrink-0 text-gray-400 mt-1" />
                </div>
              );
            }}
            title="MCP Apps"
            buttonText="Refresh Apps"
          />
        )}

        <div className="bg-card border border-border rounded-lg shadow">
          <div className="p-4 border-b border-gray-200 dark:border-border">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                {selectedTool && (
                  <IconDisplay
                    icons={(selectedTool as WithIcons).icons}
                    size="md"
                  />
                )}
                <h3 className="font-semibold">
                  {selectedTool ? selectedTool.name : "Select an app"}
                </h3>
              </div>
              <div className="flex items-center gap-2">
                {selectedTool && isAppOpen && (
                  <Button
                    onClick={() => setIsMaximized(!isMaximized)}
                    variant="ghost"
                    size="sm"
                    aria-label={isMaximized ? "Minimize" : "Maximize"}
                  >
                    {isMaximized ? (
                      <Minimize2 className="w-4 h-4" />
                    ) : (
                      <Maximize2 className="w-4 h-4" />
                    )}
                  </Button>
                )}
                {selectedTool && (
                  <Button
                    onClick={handleDeselectTool}
                    variant="ghost"
                    size="sm"
                    aria-label="Close app"
                  >
                    <X className="w-4 h-4" />
                  </Button>
                )}
              </div>
            </div>
          </div>

          <div className="p-4">
            {error && (
              <Alert variant="destructive" className="mb-4">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            {selectedTool ? (
              (() => {
                const hasFields =
                  selectedTool.inputSchema.properties &&
                  Object.keys(selectedTool.inputSchema.properties).length > 0;

                return (
                  <div className="space-y-4">
                    {!isAppOpen ? (
                      <div className="space-y-4">
                        {selectedTool.description && (
                          <p className="text-sm text-gray-600 dark:text-gray-400 whitespace-pre-wrap">
                            {selectedTool.description}
                          </p>
                        )}

                        <div className="space-y-4 border rounded-lg p-4 bg-muted/30">
                          <h4 className="font-medium text-sm">App Input</h4>
                          {Object.entries(
                            selectedTool.inputSchema.properties ?? [],
                          ).map(([key, value]) => {
                            // First resolve any $ref references
                            const resolvedValue = resolveRef(
                              value as JsonSchemaType,
                              selectedTool.inputSchema as JsonSchemaType,
                            );
                            const prop = normalizeUnionType(resolvedValue);
                            const inputSchema =
                              selectedTool.inputSchema as JsonSchemaType;
                            const required = isPropertyRequired(
                              key,
                              inputSchema,
                            );

                            return (
                              <div key={key} className="space-y-2">
                                <div className="flex justify-between">
                                  <Label
                                    htmlFor={key}
                                    className="block text-sm font-medium text-gray-700 dark:text-gray-300"
                                  >
                                    {key}
                                    {required && (
                                      <span className="text-red-500 ml-1">
                                        *
                                      </span>
                                    )}
                                  </Label>
                                  {prop.nullable ? (
                                    <div className="flex items-center space-x-2">
                                      <Checkbox
                                        id={`${key}-null`}
                                        checked={params[key] === null}
                                        onCheckedChange={(checked: boolean) =>
                                          setParams({
                                            ...params,
                                            [key]: checked
                                              ? null
                                              : prop.type === "array"
                                                ? undefined
                                                : prop.default !== null
                                                  ? prop.default
                                                  : prop.type === "boolean"
                                                    ? false
                                                    : prop.type === "string"
                                                      ? ""
                                                      : undefined,
                                          })
                                        }
                                      />
                                      <label
                                        htmlFor={`${key}-null`}
                                        className="text-sm font-medium text-gray-700 dark:text-gray-300"
                                      >
                                        null
                                      </label>
                                    </div>
                                  ) : null}
                                </div>

                                <div
                                  className={`${prop.nullable && params[key] === null ? "pointer-events-none opacity-50" : ""}`}
                                >
                                  {prop.type === "boolean" ? (
                                    <div className="flex items-center space-x-2">
                                      <Checkbox
                                        id={key}
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
                                        {prop.description ||
                                          "Toggle this option"}
                                      </label>
                                    </div>
                                  ) : prop.type === "string" && prop.enum ? (
                                    <Select
                                      value={
                                        params[key] === undefined
                                          ? ""
                                          : String(params[key])
                                      }
                                      onValueChange={(value) => {
                                        setParams({
                                          ...params,
                                          [key]:
                                            value === "" ? undefined : value,
                                        });
                                      }}
                                    >
                                      <SelectTrigger id={key}>
                                        <SelectValue
                                          placeholder={
                                            prop.description ||
                                            "Select an option"
                                          }
                                        />
                                      </SelectTrigger>
                                      <SelectContent>
                                        {prop.enum.map((option) => (
                                          <SelectItem
                                            key={option}
                                            value={option}
                                          >
                                            {option}
                                          </SelectItem>
                                        ))}
                                      </SelectContent>
                                    </Select>
                                  ) : prop.type === "string" ? (
                                    <Textarea
                                      id={key}
                                      placeholder={prop.description}
                                      value={
                                        params[key] === undefined
                                          ? ""
                                          : String(params[key])
                                      }
                                      onChange={(e) => {
                                        setParams({
                                          ...params,
                                          [key]:
                                            e.target.value === ""
                                              ? undefined
                                              : e.target.value,
                                        });
                                      }}
                                    />
                                  ) : prop.type === "object" ||
                                    prop.type === "array" ? (
                                    <DynamicJsonForm
                                      ref={(ref) =>
                                        (formRefs.current[key] = ref)
                                      }
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
                                        setTimeout(checkValidationErrors, 100);
                                      }}
                                    />
                                  ) : prop.type === "number" ||
                                    prop.type === "integer" ? (
                                    <Input
                                      type="number"
                                      id={key}
                                      placeholder={prop.description}
                                      value={
                                        params[key] === undefined
                                          ? ""
                                          : String(params[key])
                                      }
                                      onChange={(e) => {
                                        const value = e.target.value;
                                        if (value === "") {
                                          setParams({
                                            ...params,
                                            [key]: undefined,
                                          });
                                        } else {
                                          const num = Number(value);
                                          setParams({
                                            ...params,
                                            [key]: isNaN(num) ? value : num,
                                          });
                                        }
                                      }}
                                    />
                                  ) : (
                                    <DynamicJsonForm
                                      ref={(ref) =>
                                        (formRefs.current[key] = ref)
                                      }
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
                                        setTimeout(checkValidationErrors, 100);
                                      }}
                                    />
                                  )}
                                </div>
                              </div>
                            );
                          })}

                          <Button
                            onClick={() => void handleOpenApp()}
                            className="w-full"
                            disabled={hasValidationErrors || isOpeningApp}
                          >
                            {isOpeningApp ? (
                              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                            ) : (
                              <Play className="w-4 h-4 mr-2" />
                            )}
                            {isOpeningApp ? "Opening App..." : "Open App"}
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <div className="space-y-4">
                        {hasFields && (
                          <div className="flex justify-end">
                            <Button
                              onClick={handleCloseApp}
                              variant="outline"
                              size="sm"
                            >
                              Back to Input
                            </Button>
                          </div>
                        )}
                        <div className="h-[600px]">
                          <AppRenderer
                            sandboxPath={sandboxPath}
                            tool={selectedTool}
                            mcpClient={mcpClient}
                            toolInput={submittedParams}
                            toolResult={submittedToolResult}
                            onNotification={onNotification}
                          />
                        </div>
                      </div>
                    )}
                  </div>
                );
              })()
            ) : (
              <div className="flex flex-col items-center justify-center py-12 text-muted-foreground space-y-4">
                <AlertCircle className="w-12 h-12 opacity-20" />
                <p>Select an app from the list to get started</p>
                {appTools.length === 0 && (
                  <p className="text-xs text-center max-w-[200px]">
                    No MCP Apps available. Apps are tools that include a{" "}
                    <code className="bg-muted px-1 rounded">
                      _meta.ui.resourceUri
                    </code>
                  </p>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </TabsContent>
  );
};

export default AppsTab;
