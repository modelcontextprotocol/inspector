import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import DynamicJsonForm from "./DynamicJsonForm";
import type { JsonValue, JsonSchemaType } from "@/utils/jsonUtils";
import { generateDefaultValue } from "@/utils/schemaUtils";
import { Tool } from "@modelcontextprotocol/sdk/types.js";
import { Loader2, Send, Code2, Save, X } from "lucide-react";
import { useEffect, useState } from "react";
import { createMcpJamRequest, generateDefaultRequestName } from "@/utils/requestUtils";
import { RequestStorage } from "@/utils/requestStorage";
import { CreateMcpJamRequestInput, McpJamRequest, UpdateMcpJamRequestInput } from "@/lib/requestTypes";

interface ToolRunCardProps {
  selectedTool: Tool | null;
  callTool: (name: string, params: Record<string, unknown>) => Promise<void>;
  loadedRequest?: McpJamRequest | null;
}

const ToolRunCard = ({ selectedTool, callTool, loadedRequest }: ToolRunCardProps) => {
  const [params, setParams] = useState<Record<string, unknown>>({});
  const [isToolRunning, setIsToolRunning] = useState(false);
  const [showSaveDialog, setShowSaveDialog] = useState(false);
  const [saveRequestName, setSaveRequestName] = useState("");
  const [saveRequestDescription, setSaveRequestDescription] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [paramsInitialized, setParamsInitialized] = useState(false);
  const [currentRequestId, setCurrentRequestId] = useState<string | null>(null);

  // Reset initialization flag when tool changes
  useEffect(() => {
    setParamsInitialized(false);
    setCurrentRequestId(null); // Clear current request when tool changes
  }, [selectedTool?.name]);

  useEffect(() => {
    if (loadedRequest && selectedTool && loadedRequest.toolName === selectedTool.name) {
      // Load parameters from saved request
      setParams(loadedRequest.parameters);
      setParamsInitialized(true);
      setCurrentRequestId(loadedRequest.id); // Track which request is loaded
    } else if (selectedTool && !paramsInitialized) {
      // Generate default parameters for the selected tool only if not already initialized
      const params = Object.entries(
        selectedTool?.inputSchema.properties ?? [],
      ).map(([key, value]) => {
        const defaultValue = generateDefaultValue(value as JsonSchemaType);
        return [key, defaultValue];
      });
      
      const paramsObject = Object.fromEntries(params);
      setParams(paramsObject);
      setParamsInitialized(true);
      setCurrentRequestId(null); // No request loaded, so clear the ID
    }
  }, [selectedTool, loadedRequest, paramsInitialized]);

  const handleSaveRequest = async () => {
    if (!selectedTool) return;

    try {
      setIsSaving(true);

      if (currentRequestId) {
        // Update existing request
        const updateInput: UpdateMcpJamRequestInput = {
          parameters: params as Record<string, JsonValue>,
        };

        if (saveRequestName.trim()) {
          updateInput.name = saveRequestName;
        }
        if (saveRequestDescription.trim()) {
          updateInput.description = saveRequestDescription;
        }

        RequestStorage.updateRequest(currentRequestId, updateInput);
      } else {
        // Create new request
        const requestInput: CreateMcpJamRequestInput = {
          name: saveRequestName || generateDefaultRequestName(selectedTool, params as Record<string, JsonValue>),
          description: saveRequestDescription,
          toolName: selectedTool.name,
          tool: selectedTool,
          parameters: params as Record<string, JsonValue>,
          tags: [],
          isFavorite: false,
        };

        const request = createMcpJamRequest(requestInput);
        RequestStorage.addRequest(request);
        setCurrentRequestId(request.id); // Track the newly created request
      }

      // Reset dialog state
      setShowSaveDialog(false);
      setSaveRequestName("");
      setSaveRequestDescription("");
      
      // Dispatch custom event to notify other components
      window.dispatchEvent(new CustomEvent("requestSaved"));
    } catch (error) {
      console.error("Failed to save request:", error);
      alert("Failed to save request. Please try again.");
    } finally {
      setIsSaving(false);
    }
  };

  const openSaveDialog = () => {
    if (!selectedTool) return;
    
    if (currentRequestId && loadedRequest) {
      // Pre-populate with current request data when updating
      setSaveRequestName(loadedRequest.name);
      setSaveRequestDescription(loadedRequest.description || "");
    } else {
      // Pre-populate with default name for new requests
      setSaveRequestName(generateDefaultRequestName(selectedTool, params as Record<string, JsonValue>));
      setSaveRequestDescription("");
    }
    setShowSaveDialog(true);
  };

  const isUpdatingExistingRequest = currentRequestId !== null;

  return (
    <div className="bg-gradient-to-br from-card/95 via-card to-card/95 backdrop-blur-sm rounded-xl shadow-lg border border-border/40 overflow-hidden transition-all duration-300 hover:shadow-xl hover:border-border/60">
      {/* Header */}
      <div className="bg-gradient-to-r from-muted/50 via-muted/30 to-muted/50 backdrop-blur-sm p-3 border-b border-border/30">
        <div className="flex items-center space-x-2">
          <div className="flex-1">
            <h1 className="font-mono text-sm bg-gradient-to-r from-secondary/70 to-secondary/50 px-3 py-1.5 rounded-lg border border-border/30 text-foreground font-semibold shadow-sm inline-block">
              {selectedTool ? selectedTool.name : "Select a tool"}
            </h1>
            {selectedTool && (
              <p className="text-xs text-muted-foreground/80 mt-0.5 line-clamp-1">
                {selectedTool.description}
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="p-3">
        {selectedTool ? (
          <div className="space-y-3">
            {/* Parameters Section */}
            {Object.keys(selectedTool.inputSchema.properties ?? {}).length >
              0 && (
              <div className="space-y-2">
                <div className="flex items-center space-x-1.5 pb-1.5 border-b border-border/20">
                  <Code2 className="w-3 h-3 text-muted-foreground" />
                  <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                    Parameters
                  </span>
                </div>

                <div className="space-y-2.5">
                  {Object.entries(
                    selectedTool.inputSchema.properties ?? [],
                  ).map(([key, value]) => {
                    const prop = value as JsonSchemaType;
                    return (
                      <div key={key} className="group">
                        {/* Parameter Name - Code Style */}
                        <div className="flex items-center space-x-1.5 mb-1.5">
                          <span className="font-mono text-xs bg-gradient-to-r from-secondary/80 to-secondary/60 px-2 py-1 rounded-md border border-border/30 text-foreground font-medium shadow-sm">
                            {key}
                          </span>
                          <span className="text-xs text-muted-foreground bg-muted/50 px-1.5 py-0.5 rounded font-medium">
                            {prop.type}
                          </span>
                        </div>

                        {/* Parameter Description */}
                        {prop.description && (
                          <p className="text-xs text-muted-foreground/80 mb-1.5 ml-0.5 italic line-clamp-1">
                            {prop.description}
                          </p>
                        )}

                        {/* Input Field */}
                        <div className="relative">
                          {prop.type === "boolean" ? (
                            <div className="flex items-center space-x-2 p-2.5 bg-gradient-to-r from-background/50 to-background/30 border border-border/30 rounded-lg hover:border-border/50 transition-all duration-200">
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
                                className="data-[state=checked]:bg-primary data-[state=checked]:border-primary h-3.5 w-3.5"
                              />
                              <label
                                htmlFor={key}
                                className="text-xs font-medium text-foreground cursor-pointer flex-1"
                              >
                                {prop.description || "Toggle this option"}
                              </label>
                            </div>
                          ) : prop.type === "string" ? (
                            <Textarea
                              id={key}
                              name={key}
                              placeholder={
                                prop.description || `Enter ${key}...`
                              }
                              value={(params[key] as string) ?? ""}
                              onChange={(e) =>
                                setParams({
                                  ...params,
                                  [key]: e.target.value,
                                })
                              }
                              className="font-mono text-xs bg-gradient-to-br from-background/80 to-background/60 border-border/40 rounded-lg focus:border-primary/50 focus:ring-1 focus:ring-primary/20 transition-all duration-200 min-h-[60px] resize-none p-2"
                            />
                          ) : prop.type === "object" ||
                            prop.type === "array" ? (
                            <div className="bg-gradient-to-br from-background/80 to-background/60 border border-border/40 rounded-lg p-2.5 hover:border-border/60 transition-all duration-200">
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
                          ) : prop.type === "number" ||
                            prop.type === "integer" ? (
                            <Input
                              type="number"
                              id={key}
                              name={key}
                              placeholder={
                                prop.description || `Enter ${key}...`
                              }
                              value={params[key] !== undefined && params[key] !== null ? String(params[key]) : ""}
                              onChange={(e) => {
                                const value = e.target.value;
                                
                                let newParams;
                                if (value === "") {
                                  newParams = {
                                    ...params,
                                    [key]: undefined,
                                  };
                                } else {
                                  const numValue = Number(value);
                                  if (!isNaN(numValue)) {
                                    newParams = {
                                      ...params,
                                      [key]: numValue,
                                    };
                                  } else {
                                    return; // Don't update if invalid
                                  }
                                }
                                
                                setParams(newParams);
                              }}
                              className="font-mono text-xs bg-gradient-to-br from-background/80 to-background/60 border-border/40 rounded-lg focus:border-primary/50 focus:ring-1 focus:ring-primary/20 transition-all duration-200 h-8"
                            />
                          ) : (
                            <div className="bg-gradient-to-br from-background/80 to-background/60 border border-border/40 rounded-lg p-2.5 hover:border-border/60 transition-all duration-200">
                              <DynamicJsonForm
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
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Action Buttons */}
            <div className="pt-2 border-t border-border/20 space-y-2">
              {/* Save and Run Buttons */}
              <div className="flex space-x-2">
                <Button
                  onClick={openSaveDialog}
                  variant="outline"
                  className="flex-1 h-8 bg-gradient-to-r from-secondary/20 to-secondary/10 hover:from-secondary/30 hover:to-secondary/20 text-foreground font-medium rounded-lg border-border/40 hover:border-border/60 transition-all duration-300 text-xs"
                >
                  <Save className="w-3.5 h-3.5 mr-2" />
                  {isUpdatingExistingRequest ? "Update Request" : "Save Request"}
                </Button>
                
                <Button
                  onClick={async () => {
                    try {
                      setIsToolRunning(true);
                      await callTool(selectedTool.name, params);
                    } finally {
                      setIsToolRunning(false);
                    }
                  }}
                  disabled={isToolRunning}
                  className="flex-1 h-8 bg-gradient-to-r from-primary to-primary/90 hover:from-primary/90 hover:to-primary/80 text-primary-foreground font-medium rounded-lg shadow-md hover:shadow-lg transition-all duration-300 transform hover:scale-[1.01] active:scale-[0.99] text-xs"
                >
                  {isToolRunning ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 mr-2 animate-spin" />
                      Executing...
                    </>
                  ) : (
                    <>
                      <Send className="w-3.5 h-3.5 mr-2" />
                      Run Tool
                    </>
                  )}
                </Button>
              </div>

              {/* Save Dialog */}
              {showSaveDialog && (
                <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50">
                  <div className="bg-card border border-border rounded-xl shadow-xl p-4 w-full max-w-md mx-4">
                    <div className="flex items-center justify-between mb-3">
                      <h3 className="text-sm font-semibold text-foreground">
                        {isUpdatingExistingRequest ? "Update Request" : "Save Request"}
                      </h3>
                      <Button
                        onClick={() => setShowSaveDialog(false)}
                        variant="ghost"
                        size="sm"
                        className="h-6 w-6 p-0 hover:bg-muted"
                      >
                        <X className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                    
                    <div className="space-y-3">
                      <div>
                        <label className="text-xs font-medium text-muted-foreground mb-1 block">
                          Request Name
                        </label>
                        <Input
                          value={saveRequestName}
                          onChange={(e) => setSaveRequestName(e.target.value)}
                          placeholder="Enter request name..."
                          className="text-xs h-8"
                        />
                      </div>
                      
                      <div>
                        <label className="text-xs font-medium text-muted-foreground mb-1 block">
                          Description (optional)
                        </label>
                        <Textarea
                          value={saveRequestDescription}
                          onChange={(e) => setSaveRequestDescription(e.target.value)}
                          placeholder="Enter description..."
                          className="text-xs min-h-[60px] resize-none"
                        />
                      </div>
                      
                      <div className="flex space-x-2 pt-2">
                        <Button
                          onClick={() => setShowSaveDialog(false)}
                          variant="outline"
                          className="flex-1 h-8 text-xs"
                        >
                          Cancel
                        </Button>
                        <Button
                          onClick={handleSaveRequest}
                          disabled={isSaving}
                          className="flex-1 h-8 text-xs"
                        >
                          {isSaving ? (
                            <>
                              <Loader2 className="w-3.5 h-3.5 mr-2 animate-spin" />
                              {isUpdatingExistingRequest ? "Updating..." : "Saving..."}
                            </>
                          ) : (
                            <>
                              <Save className="w-3.5 h-3.5 mr-2" />
                              {isUpdatingExistingRequest ? "Update" : "Save"}
                            </>
                          )}
                        </Button>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center py-6 text-center">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-muted/30 to-muted/50 flex items-center justify-center mb-3">
              <Code2 className="w-5 h-5 text-muted-foreground/60" />
            </div>
            <h4 className="text-sm font-semibold text-foreground mb-1">
              Ready to Execute
            </h4>
            <p className="text-muted-foreground text-xs max-w-sm">
              Select a tool from the list to configure its parameters and
              execute it
            </p>
          </div>
        )}
      </div>
    </div>
  );
};

export default ToolRunCard;
