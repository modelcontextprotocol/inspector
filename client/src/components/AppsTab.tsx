import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { TabsContent } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import DynamicJsonForm, { DynamicJsonFormRef } from "./DynamicJsonForm";
import type { JsonValue, JsonSchemaType } from "@/utils/jsonUtils";
import {
  generateDefaultValue,
  isPropertyRequired,
  normalizeUnionType,
  resolveRef,
} from "@/utils/schemaUtils";
import type {
  CompatibilityCallToolResult,
  ListToolsResult,
  Tool,
  ReadResourceResult,
} from "@modelcontextprotocol/sdk/types.js";
import {
  Loader2,
  Send,
  ChevronRight,
  AlertCircle,
  Maximize2,
  Minimize2,
} from "lucide-react";
import { useEffect, useState, useRef, useCallback } from "react";
import ListPane from "./ListPane";
import ToolResults from "./ToolResults";
import IconDisplay, { WithIcons } from "./IconDisplay";
import {
  getAppTools,
  getToolAppResourceUri,
  getUiResource,
  createAppBridge,
  setupIframeSandbox,
  initializeApp,
  type ModelContext,
  type AppMessage,
} from "@/lib/app-utils";
import type { AppBridge } from "@modelcontextprotocol/ext-apps/app-bridge";

interface AppsTabProps {
  tools: Tool[];
  listTools: () => void;
  clearTools: () => void;
  callTool: (
    name: string,
    params: Record<string, unknown>,
  ) => Promise<CompatibilityCallToolResult>;
  selectedTool: Tool | null;
  setSelectedTool: (tool: Tool | null) => void;
  toolResult: CompatibilityCallToolResult | null;
  nextCursor: ListToolsResult["nextCursor"];
  error: string | null;
  resourceContent: Record<string, string>;
  onReadResource?: (uri: string) => void;
  makeResourceRequest: (uri: string) => Promise<ReadResourceResult>;
}

const AppsTab = ({
  tools,
  listTools,
  clearTools,
  callTool,
  selectedTool,
  setSelectedTool,
  toolResult,
  nextCursor,
  error,
  resourceContent,
  onReadResource,
  makeResourceRequest,
}: AppsTabProps) => {
  const [params, setParams] = useState<Record<string, unknown>>({});
  const [isToolRunning, setIsToolRunning] = useState(false);
  const [hasValidationErrors, setHasValidationErrors] = useState(false);
  const [isAppLoading, setIsAppLoading] = useState(false);
  const [appError, setAppError] = useState<string | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [modelContext, setModelContext] = useState<ModelContext | null>(null);
  const [appMessages, setAppMessages] = useState<AppMessage[]>([]);
  const formRefs = useRef<Record<string, DynamicJsonFormRef | null>>({});
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const appBridgeRef = useRef<AppBridge | null>(null);

  const appTools = getAppTools(tools);

  const checkValidationErrors = () => {
    const errors = Object.values(formRefs.current).some(
      (ref) => ref && !ref.validateJson().isValid,
    );
    setHasValidationErrors(errors);
    return errors;
  };

  useEffect(() => {
    const params = Object.entries(
      selectedTool?.inputSchema.properties ?? [],
    ).map(([key, value]) => {
      const resolvedValue = resolveRef(
        value as JsonSchemaType,
        selectedTool?.inputSchema as JsonSchemaType,
      );
      return [
        key,
        generateDefaultValue(
          resolvedValue,
          key,
          selectedTool?.inputSchema as JsonSchemaType,
        ),
      ];
    });
    setParams(Object.fromEntries(params));
    setHasValidationErrors(false);
    formRefs.current = {};
    setAppError(null);
    setModelContext(null);
    setAppMessages([]);
    setIsFullscreen(false);
  }, [selectedTool]);

  const handleAppBridgeCallbacks = useCallback(
    () => ({
      onContextUpdate: (context: ModelContext | null) => {
        setModelContext(context);
      },
      onMessage: (message: AppMessage) => {
        setAppMessages((prev) => [...prev, message]);
      },
      onDisplayModeChange: (mode: "inline" | "fullscreen") => {
        setIsFullscreen(mode === "fullscreen");
      },
    }),
    [],
  );

  const runAppTool = async () => {
    if (!selectedTool || !iframeRef.current) return;
    if (checkValidationErrors()) return;

    const resourceUri = getToolAppResourceUri(selectedTool);
    if (!resourceUri) {
      setAppError("Tool does not have a UI resource");
      return;
    }

    try {
      setIsToolRunning(true);
      setIsAppLoading(true);
      setAppError(null);
      setModelContext(null);
      setAppMessages([]);

      const { html, permissions } = await getUiResource(
        makeResourceRequest,
        resourceUri,
      );

      setupIframeSandbox(iframeRef.current, permissions);

      const appBridge = createAppBridge(
        iframeRef.current,
        handleAppBridgeCallbacks(),
        {
          containerDimensions: { maxHeight: 600 },
          displayMode: isFullscreen ? "fullscreen" : "inline",
        },
      );
      appBridgeRef.current = appBridge;

      const resultPromise = callTool(selectedTool.name, params);

      await initializeApp(
        iframeRef.current,
        appBridge,
        html,
        params,
        resultPromise,
      );

      setIsAppLoading(false);

      await resultPromise;
    } catch (e) {
      setAppError(e instanceof Error ? e.message : String(e));
      setIsAppLoading(false);
    } finally {
      setIsToolRunning(false);
    }
  };

  const toggleFullscreen = () => {
    const newMode = !isFullscreen;
    setIsFullscreen(newMode);
    if (appBridgeRef.current) {
      appBridgeRef.current.sendHostContextChange({
        displayMode: newMode ? "fullscreen" : "inline",
      });
    }
  };

  return (
    <TabsContent value="apps">
      <div
        className={`grid ${isFullscreen ? "grid-cols-1" : "grid-cols-2"} gap-4`}
      >
        {!isFullscreen && (
          <ListPane
            items={appTools}
            listItems={listTools}
            clearItems={() => {
              clearTools();
              setSelectedTool(null);
            }}
            setSelectedItem={setSelectedTool}
            renderItem={(tool) => (
              <div className="flex items-start w-full gap-2">
                <div className="flex-shrink-0 mt-1">
                  <IconDisplay icons={(tool as WithIcons).icons} size="sm" />
                </div>
                <div className="flex flex-col flex-1 min-w-0">
                  <span className="truncate">{tool.name}</span>
                  <span className="text-sm text-gray-500 text-left line-clamp-2">
                    {tool.description}
                  </span>
                </div>
                <ChevronRight className="w-4 h-4 flex-shrink-0 text-gray-400 mt-1" />
              </div>
            )}
            title="Apps"
            buttonText={nextCursor ? "List More Tools" : "List Tools"}
            isButtonDisabled={!nextCursor && appTools.length > 0}
          />
        )}

        <div
          className={`bg-card border border-border rounded-lg shadow ${isFullscreen ? "col-span-1" : ""}`}
        >
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
              {selectedTool && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={toggleFullscreen}
                  className="h-8 w-8 p-0"
                >
                  {isFullscreen ? (
                    <Minimize2 className="h-4 w-4" />
                  ) : (
                    <Maximize2 className="h-4 w-4" />
                  )}
                </Button>
              )}
            </div>
          </div>
          <div className="p-4">
            {selectedTool ? (
              <div className="space-y-4">
                {(error || appError) && (
                  <Alert variant="destructive">
                    <AlertCircle className="h-4 w-4" />
                    <AlertTitle>Error</AlertTitle>
                    <AlertDescription className="break-all">
                      {error || appError}
                    </AlertDescription>
                  </Alert>
                )}
                <p className="text-sm text-gray-600 dark:text-gray-400 whitespace-pre-wrap max-h-48 overflow-y-auto">
                  {selectedTool.description}
                </p>
                {Object.entries(selectedTool.inputSchema.properties ?? []).map(
                  ([key, value]) => {
                    const resolvedValue = resolveRef(
                      value as JsonSchemaType,
                      selectedTool.inputSchema as JsonSchemaType,
                    );
                    const prop = normalizeUnionType(resolvedValue);
                    const inputSchema =
                      selectedTool.inputSchema as JsonSchemaType;
                    const required = isPropertyRequired(key, inputSchema);
                    return (
                      <div key={key}>
                        <div className="flex justify-between">
                          <Label
                            htmlFor={key}
                            className="block text-sm font-medium text-gray-700 dark:text-gray-300"
                          >
                            {key}
                            {required && (
                              <span className="text-red-500 ml-1">*</span>
                            )}
                          </Label>
                          {prop.nullable ? (
                            <div className="flex items-center space-x-2">
                              <Checkbox
                                id={key}
                                name={key}
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
                                              : prop.type === "number" ||
                                                  prop.type === "integer"
                                                ? undefined
                                                : undefined,
                                  })
                                }
                              />
                              <label
                                htmlFor={key}
                                className="text-sm font-medium text-gray-700 dark:text-gray-300"
                              >
                                null
                              </label>
                            </div>
                          ) : null}
                        </div>

                        <div
                          role="toolinputwrapper"
                          className={`${prop.nullable && params[key] === null ? "pointer-events-none opacity-50" : ""}`}
                        >
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
                          ) : prop.type === "string" && prop.enum ? (
                            <Select
                              value={
                                params[key] === undefined
                                  ? ""
                                  : String(params[key])
                              }
                              onValueChange={(value) => {
                                if (value === "") {
                                  setParams({
                                    ...params,
                                    [key]: undefined,
                                  });
                                } else {
                                  setParams({
                                    ...params,
                                    [key]: value,
                                  });
                                }
                              }}
                            >
                              <SelectTrigger id={key} className="mt-1">
                                <SelectValue
                                  placeholder={
                                    prop.description || "Select an option"
                                  }
                                />
                              </SelectTrigger>
                              <SelectContent>
                                {prop.enum.map((option) => (
                                  <SelectItem key={option} value={option}>
                                    {option}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          ) : prop.type === "string" ? (
                            <Textarea
                              id={key}
                              name={key}
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
                                  setParams({
                                    ...params,
                                    [key]: value,
                                  });
                                }
                              }}
                              className="mt-1"
                            />
                          ) : prop.type === "object" ||
                            prop.type === "array" ? (
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
                                  setTimeout(checkValidationErrors, 100);
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
                                  if (!isNaN(num)) {
                                    setParams({
                                      ...params,
                                      [key]: num,
                                    });
                                  } else {
                                    setParams({
                                      ...params,
                                      [key]: value,
                                    });
                                  }
                                }
                              }}
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
                                  setTimeout(checkValidationErrors, 100);
                                }}
                              />
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  },
                )}
                <Button
                  onClick={runAppTool}
                  disabled={isToolRunning || hasValidationErrors}
                >
                  {isToolRunning ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Running...
                    </>
                  ) : (
                    <>
                      <Send className="w-4 h-4 mr-2" />
                      Run App
                    </>
                  )}
                </Button>

                <div
                  className={`border border-border rounded-lg overflow-hidden ${isFullscreen ? "min-h-[600px]" : "min-h-[400px]"}`}
                >
                  {isAppLoading && (
                    <div className="flex items-center justify-center h-full bg-gray-50 dark:bg-gray-900">
                      <Loader2 className="w-8 h-8 animate-spin text-gray-400" />
                    </div>
                  )}
                  <iframe
                    ref={iframeRef}
                    className={`w-full border-0 ${isAppLoading ? "hidden" : ""}`}
                    style={{ minHeight: isFullscreen ? "600px" : "400px" }}
                    title={`App: ${selectedTool.name}`}
                  />
                </div>

                {modelContext && (
                  <div className="bg-blue-50 dark:bg-blue-900/20 p-3 rounded-lg">
                    <h4 className="text-sm font-semibold mb-2">
                      Model Context:
                    </h4>
                    <pre className="text-xs overflow-auto max-h-32">
                      {JSON.stringify(modelContext, null, 2)}
                    </pre>
                  </div>
                )}

                {appMessages.length > 0 && (
                  <div className="bg-gray-50 dark:bg-gray-900 p-3 rounded-lg">
                    <h4 className="text-sm font-semibold mb-2">
                      App Messages:
                    </h4>
                    <div className="space-y-2 max-h-32 overflow-auto">
                      {appMessages.map((msg, idx) => (
                        <div
                          key={idx}
                          className="text-xs p-2 bg-white dark:bg-gray-800 rounded"
                        >
                          {msg.content.map((c, i) => (
                            <span key={i}>
                              {c.type === "text" ? c.text : `[${c.type}]`}
                            </span>
                          ))}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <ToolResults
                  toolResult={toolResult}
                  selectedTool={selectedTool}
                  resourceContent={resourceContent}
                  onReadResource={onReadResource}
                />
              </div>
            ) : (
              <Alert>
                <AlertDescription>
                  Select an app from the list to view its details and run it
                </AlertDescription>
              </Alert>
            )}
          </div>
        </div>
      </div>
    </TabsContent>
  );
};

export default AppsTab;
