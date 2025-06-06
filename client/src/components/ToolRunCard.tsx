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
import {
  createMcpJamRequest,
  generateDefaultRequestName,
} from "@/utils/requestUtils";
import { RequestStorage } from "@/utils/requestStorage";
import {
  CreateMcpJamRequestInput,
  McpJamRequest,
  UpdateMcpJamRequestInput,
} from "@/lib/requestTypes";

const BUTTON_STYLES = {
  save: "flex-1 h-8 bg-gradient-to-r from-secondary/20 to-secondary/10 hover:from-secondary/30 hover:to-secondary/20 text-foreground font-medium rounded-lg border-border/40 hover:border-border/60 transition-all duration-300 text-xs",
  run: "flex-1 h-8 bg-gradient-to-r from-secondary/20 to-secondary/10 hover:from-secondary/30 hover:to-secondary/20 dark:from-secondary/30 dark:to-secondary/20 dark:hover:from-secondary/40 dark:hover:to-secondary/30 text-foreground font-medium rounded-lg border border-border/40 hover:border-border/60 dark:border-border/60 dark:hover:border-border/80 shadow-sm hover:shadow-md dark:shadow-secondary/10 dark:hover:shadow-secondary/20 transition-all duration-300 text-xs",
};

const INPUT_STYLES = {
  base: "font-mono text-xs bg-gradient-to-br from-background/80 to-background/60 border-border/40 rounded-lg focus:border-primary/50 focus:ring-1 focus:ring-primary/20 transition-all duration-200",
  container:
    "bg-gradient-to-br from-background/80 to-background/60 border border-border/40 rounded-lg hover:border-border/60 transition-all duration-200",
};

const initializeParams = (tool: Tool): Record<string, unknown> => {
  if (!tool?.inputSchema?.properties) return {};

  return Object.fromEntries(
    Object.entries(tool.inputSchema.properties).map(([key, value]) => [
      key,
      generateDefaultValue(value as JsonSchemaType),
    ]),
  );
};

const handleNumberInput = (
  value: string,
  params: Record<string, unknown>,
  key: string,
  setParams: (params: Record<string, unknown>) => void,
) => {
  if (value === "") {
    setParams({ ...params, [key]: undefined });
    return;
  }

  const numValue = Number(value);
  if (!isNaN(numValue)) {
    setParams({ ...params, [key]: numValue });
  }
};

const ToolHeader = ({ tool }: { tool: Tool | null }) => (
  <div className="bg-gradient-to-r from-muted/50 via-muted/30 to-muted/50 backdrop-blur-sm p-3 border-b border-border/30">
    <div className="flex items-center space-x-2">
      <div className="flex-1">
        <h1 className="font-mono text-sm bg-gradient-to-r from-secondary/70 to-secondary/50 px-3 py-1.5 rounded-lg border border-border/30 text-foreground font-semibold shadow-sm inline-block">
          {tool ? tool.name : "Select a tool"}
        </h1>
        {tool && (
          <p className="text-xs text-muted-foreground/80 mt-0.5 line-clamp-1">
            {tool.description}
          </p>
        )}
      </div>
    </div>
  </div>
);

interface ParameterInputProps {
  paramKey: string;
  prop: JsonSchemaType;
  value: unknown;
  onChange: (key: string, value: unknown) => void;
}

const ParameterInput = ({
  paramKey,
  prop,
  value,
  onChange,
}: ParameterInputProps) => {
  const renderInput = () => {
    switch (prop.type) {
      case "boolean":
        return (
          <div className="flex items-center space-x-2 p-2.5 bg-gradient-to-r from-background/50 to-background/30 border border-border/30 rounded-lg hover:border-border/50 transition-all duration-200">
            <Checkbox
              id={paramKey}
              name={paramKey}
              checked={!!value}
              onCheckedChange={(checked: boolean) =>
                onChange(paramKey, checked)
              }
              className="data-[state=checked]:bg-primary data-[state=checked]:border-primary h-3.5 w-3.5"
            />
            <label
              htmlFor={paramKey}
              className="text-xs font-medium text-foreground cursor-pointer flex-1"
            >
              {prop.description || "Toggle this option"}
            </label>
          </div>
        );

      case "string":
        return (
          <Textarea
            id={paramKey}
            name={paramKey}
            placeholder={prop.description || `Enter ${paramKey}...`}
            value={(value as string) ?? ""}
            onChange={(e) => onChange(paramKey, e.target.value)}
            className={`${INPUT_STYLES.base} min-h-[60px] resize-none p-2`}
          />
        );

      case "number":
      case "integer":
        return (
          <Input
            type="number"
            id={paramKey}
            name={paramKey}
            placeholder={prop.description || `Enter ${paramKey}...`}
            value={value !== undefined && value !== null ? String(value) : ""}
            onChange={(e) =>
              handleNumberInput(
                e.target.value,
                { [paramKey]: value },
                paramKey,
                (params) => onChange(paramKey, params[paramKey]),
              )
            }
            className={`${INPUT_STYLES.base} h-8`}
          />
        );

      case "object":
      case "array":
      default:
        return (
          <div className={INPUT_STYLES.container + " p-2.5"}>
            <DynamicJsonForm
              schema={{
                type: prop.type,
                properties: prop.properties,
                description: prop.description,
                items: prop.items,
              }}
              value={(value as JsonValue) ?? generateDefaultValue(prop)}
              onChange={(newValue: JsonValue) => onChange(paramKey, newValue)}
            />
          </div>
        );
    }
  };

  return (
    <div className="group">
      {/* Parameter Name */}
      <div className="flex items-center space-x-1.5 mb-1.5">
        <span className="font-mono text-xs bg-gradient-to-r from-secondary/80 to-secondary/60 px-2 py-1 rounded-md border border-border/30 text-foreground font-medium shadow-sm">
          {paramKey}
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
      <div className="relative">{renderInput()}</div>
    </div>
  );
};

const ParametersSection = ({
  tool,
  params,
  onParamChange,
}: {
  tool: Tool;
  params: Record<string, unknown>;
  onParamChange: (key: string, value: unknown) => void;
}) => {
  const properties = tool.inputSchema.properties ?? {};

  if (Object.keys(properties).length === 0) return null;

  return (
    <div className="space-y-2">
      <div className="flex items-center space-x-1.5 pb-1.5 border-b border-border/20">
        <Code2 className="w-3 h-3 text-muted-foreground" />
        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
          Parameters
        </span>
      </div>

      <div className="space-y-2.5">
        {Object.entries(properties).map(([key, value]) => (
          <ParameterInput
            key={key}
            paramKey={key}
            prop={value as JsonSchemaType}
            value={params[key]}
            onChange={onParamChange}
          />
        ))}
      </div>
    </div>
  );
};

const ActionButtons = ({
  onSave,
  onRun,
  isRunning,
  isUpdating,
}: {
  onSave: () => void;
  onRun: () => void;
  isRunning: boolean;
  isUpdating: boolean;
}) => (
  <div className="pt-2 border-t border-border/20 space-y-2">
    <div className="flex space-x-2">
      <Button onClick={onSave} variant="outline" className={BUTTON_STYLES.save}>
        <Save className="w-3.5 h-3.5 mr-2" />
        {isUpdating ? "Update Request" : "Save Request"}
      </Button>

      <Button
        onClick={onRun}
        variant="outline"
        disabled={isRunning}
        className={BUTTON_STYLES.run}
      >
        {isRunning ? (
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
  </div>
);

interface SaveDialogProps {
  isOpen: boolean;
  isUpdating: boolean;
  requestName: string;
  requestDescription: string;
  isSaving: boolean;
  onClose: () => void;
  onSave: () => void;
  onNameChange: (name: string) => void;
  onDescriptionChange: (description: string) => void;
}

const SaveDialog = ({
  isOpen,
  isUpdating,
  requestName,
  requestDescription,
  isSaving,
  onClose,
  onSave,
  onNameChange,
  onDescriptionChange,
}: SaveDialogProps) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50">
      <div className="bg-card border border-border rounded-xl shadow-xl p-4 w-full max-w-md mx-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-foreground">
            {isUpdating ? "Update Request" : "Save Request"}
          </h3>
          <Button
            onClick={onClose}
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
              value={requestName}
              onChange={(e) => onNameChange(e.target.value)}
              placeholder="Enter request name..."
              className="text-xs h-8"
            />
          </div>

          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">
              Description (optional)
            </label>
            <Textarea
              value={requestDescription}
              onChange={(e) => onDescriptionChange(e.target.value)}
              placeholder="Enter description..."
              className="text-xs min-h-[60px] resize-none"
            />
          </div>

          <div className="flex space-x-2 pt-2">
            <Button
              onClick={onClose}
              variant="outline"
              className="flex-1 h-8 text-xs"
            >
              Cancel
            </Button>
            <Button
              onClick={onSave}
              disabled={isSaving}
              className="flex-1 h-8 text-xs"
            >
              {isSaving ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 mr-2 animate-spin" />
                  {isUpdating ? "Updating..." : "Saving..."}
                </>
              ) : (
                <>
                  <Save className="w-3.5 h-3.5 mr-2" />
                  {isUpdating ? "Update" : "Save"}
                </>
              )}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
};

const EmptyState = () => (
  <div className="flex flex-col items-center justify-center py-6 text-center">
    <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-muted/30 to-muted/50 flex items-center justify-center mb-3">
      <Code2 className="w-5 h-5 text-muted-foreground/60" />
    </div>
    <h4 className="text-sm font-semibold text-foreground mb-1">
      Ready to Execute
    </h4>
    <p className="text-muted-foreground text-xs max-w-sm">
      Select a tool from the list to configure its parameters and execute it
    </p>
  </div>
);

interface ToolRunCardProps {
  selectedTool: Tool | null;
  callTool: (name: string, params: Record<string, unknown>) => Promise<void>;
  loadedRequest?: McpJamRequest | null;
  selectedServerName: string;
}

const ToolRunCard = ({
  selectedTool,
  callTool,
  loadedRequest,
  selectedServerName,
}: ToolRunCardProps) => {
  // State
  const [params, setParams] = useState<Record<string, unknown>>({});
  const [isToolRunning, setIsToolRunning] = useState(false);
  const [showSaveDialog, setShowSaveDialog] = useState(false);
  const [saveRequestName, setSaveRequestName] = useState("");
  const [saveRequestDescription, setSaveRequestDescription] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [paramsInitialized, setParamsInitialized] = useState(false);
  const [currentRequestId, setCurrentRequestId] = useState<string | null>(null);

  // Effects
  useEffect(() => {
    setParamsInitialized(false);
    setCurrentRequestId(null);
  }, [selectedTool?.name]);

  useEffect(() => {
    if (
      loadedRequest &&
      selectedTool &&
      loadedRequest.toolName === selectedTool.name
    ) {
      setParams(loadedRequest.parameters);
      setParamsInitialized(true);
      setCurrentRequestId(loadedRequest.id);
    } else if (selectedTool && !paramsInitialized) {
      setParams(initializeParams(selectedTool));
      setParamsInitialized(true);
      setCurrentRequestId(null);
    }
  }, [selectedTool, loadedRequest, paramsInitialized]);

  // Handlers
  const handleParamChange = (key: string, value: unknown) => {
    setParams((prev) => ({ ...prev, [key]: value }));
  };

  const handleSaveRequest = async () => {
    if (!selectedTool) return;

    try {
      setIsSaving(true);

      if (currentRequestId) {
        const updateInput: UpdateMcpJamRequestInput = {
          parameters: params as Record<string, JsonValue>,
        };

        if (saveRequestName.trim()) updateInput.name = saveRequestName;
        if (saveRequestDescription.trim())
          updateInput.description = saveRequestDescription;

        RequestStorage.updateRequest(currentRequestId, updateInput);
      } else {
        const requestInput: CreateMcpJamRequestInput = {
          name:
            saveRequestName ||
            generateDefaultRequestName(
              selectedTool,
              params as Record<string, JsonValue>,
            ),
          description: saveRequestDescription,
          toolName: selectedTool.name,
          tool: selectedTool,
          parameters: params as Record<string, JsonValue>,
          tags: [],
          isFavorite: false,
          clientId: selectedServerName,
        };

        const request = createMcpJamRequest(requestInput);
        RequestStorage.addRequest(request);
        setCurrentRequestId(request.id);
      }

      setShowSaveDialog(false);
      setSaveRequestName("");
      setSaveRequestDescription("");
      window.dispatchEvent(new CustomEvent("requestSaved"));
    } catch (error) {
      console.error("Failed to save request:", error);
      alert("Failed to save request. Please try again.");
    } finally {
      setIsSaving(false);
    }
  };

  const handleOpenSaveDialog = () => {
    if (!selectedTool) return;

    if (currentRequestId && loadedRequest) {
      setSaveRequestName(loadedRequest.name);
      setSaveRequestDescription(loadedRequest.description || "");
    } else {
      setSaveRequestName(
        generateDefaultRequestName(
          selectedTool,
          params as Record<string, JsonValue>,
        ),
      );
      setSaveRequestDescription("");
    }
    setShowSaveDialog(true);
  };

  const handleRunTool = async () => {
    if (!selectedTool) return;

    try {
      setIsToolRunning(true);
      await callTool(selectedTool.name, params);
    } finally {
      setIsToolRunning(false);
    }
  };

  const isUpdatingExistingRequest = currentRequestId !== null;

  return (
    <div className="bg-gradient-to-br from-card/95 via-card to-card/95 backdrop-blur-sm rounded-xl shadow-lg border border-border/40 overflow-hidden transition-all duration-300 hover:shadow-xl hover:border-border/60">
      <ToolHeader tool={selectedTool} />

      <div className="p-3">
        {selectedTool ? (
          <div className="space-y-3">
            <ParametersSection
              tool={selectedTool}
              params={params}
              onParamChange={handleParamChange}
            />

            <ActionButtons
              onSave={handleOpenSaveDialog}
              onRun={handleRunTool}
              isRunning={isToolRunning}
              isUpdating={isUpdatingExistingRequest}
            />

            <SaveDialog
              isOpen={showSaveDialog}
              isUpdating={isUpdatingExistingRequest}
              requestName={saveRequestName}
              requestDescription={saveRequestDescription}
              isSaving={isSaving}
              onClose={() => setShowSaveDialog(false)}
              onSave={handleSaveRequest}
              onNameChange={setSaveRequestName}
              onDescriptionChange={setSaveRequestDescription}
            />
          </div>
        ) : (
          <EmptyState />
        )}
      </div>
    </div>
  );
};

export default ToolRunCard;
