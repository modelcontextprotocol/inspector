import { Button } from "@/components/ui/button";
import JsonView from "./JsonView";
import { useMemo, useState, useCallback } from "react";
import {
  CreateMessageResult,
  CreateMessageResultSchema,
  Tool,
} from "@modelcontextprotocol/sdk/types.js";
import { PendingRequest } from "./SamplingTab";
import DynamicJsonForm from "./DynamicJsonForm";
import { useToast } from "@/lib/hooks/useToast";
import { JsonSchemaType, JsonValue } from "@/utils/jsonUtils";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Plus, Trash2, ChevronDown, ChevronUp } from "lucide-react";

export type SamplingRequestProps = {
  request: PendingRequest;
  onApprove: (id: number, result: CreateMessageResult) => void;
  onReject: (id: number) => void;
};

type ContentType = "text" | "image" | "audio" | "tool_use" | "tool_result";

type ContentBlock =
  | { type: "text"; text: string }
  | { type: "image"; data: string; mimeType: string }
  | { type: "audio"; data: string; mimeType: string }
  | {
      type: "tool_use";
      name: string;
      id: string;
      input: Record<string, unknown>;
    }
  | {
      type: "tool_result";
      toolUseId: string;
      content: ContentBlock[];
      isError?: boolean;
    };

type StopReason = "endTurn" | "stopSequence" | "maxTokens" | "toolUse";

const STOP_REASONS: { value: StopReason; label: string }[] = [
  { value: "endTurn", label: "End Turn" },
  { value: "stopSequence", label: "Stop Sequence" },
  { value: "maxTokens", label: "Max Tokens" },
  { value: "toolUse", label: "Tool Use" },
];

const CONTENT_TYPES: { value: ContentType; label: string }[] = [
  { value: "text", label: "Text" },
  { value: "image", label: "Image" },
  { value: "audio", label: "Audio" },
  { value: "tool_use", label: "Tool Use" },
  { value: "tool_result", label: "Tool Result" },
];

function generateId(): string {
  return `toolu_${crypto.randomUUID?.() || Math.random().toString(36).slice(2)}`;
}

function createDefaultContentBlock(type: ContentType): ContentBlock {
  switch (type) {
    case "text":
      return { type: "text", text: "" };
    case "image":
      return { type: "image", data: "", mimeType: "image/png" };
    case "audio":
      return { type: "audio", data: "", mimeType: "audio/wav" };
    case "tool_use":
      return { type: "tool_use", name: "", id: generateId(), input: {} };
    case "tool_result":
      return {
        type: "tool_result",
        toolUseId: "",
        content: [],
        isError: false,
      };
  }
}

// Component to render a single content block editor
const ContentBlockEditor = ({
  block,
  index,
  onChange,
  onRemove,
  tools,
  canRemove,
}: {
  block: ContentBlock;
  index: number;
  onChange: (block: ContentBlock) => void;
  onRemove: () => void;
  tools?: Tool[];
  canRemove: boolean;
}) => {
  const [isExpanded, setIsExpanded] = useState(true);

  const handleTypeChange = (newType: ContentType) => {
    onChange(createDefaultContentBlock(newType));
  };

  return (
    <div className="border rounded-lg p-3 space-y-3 bg-gray-50 dark:bg-gray-800">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setIsExpanded(!isExpanded)}
            className="h-6 w-6 p-0"
          >
            {isExpanded ? (
              <ChevronUp className="h-4 w-4" />
            ) : (
              <ChevronDown className="h-4 w-4" />
            )}
          </Button>
          <span className="text-sm font-medium">Block {index + 1}</span>
          <Select
            value={block.type}
            onValueChange={(v) => handleTypeChange(v as ContentType)}
          >
            <SelectTrigger className="w-32 h-7">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {CONTENT_TYPES.map((ct) => (
                <SelectItem key={ct.value} value={ct.value}>
                  {ct.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {canRemove && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onRemove}
            className="h-6 w-6 p-0 text-red-500 hover:text-red-700"
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        )}
      </div>

      {isExpanded && (
        <div className="space-y-2 pl-8">
          {block.type === "text" && (
            <div>
              <Label className="text-xs">Text</Label>
              <textarea
                className="w-full mt-1 p-2 border rounded text-sm min-h-[80px] bg-white dark:bg-gray-900"
                value={block.text}
                onChange={(e) => onChange({ ...block, text: e.target.value })}
                placeholder="Enter text content..."
              />
            </div>
          )}

          {block.type === "image" && (
            <>
              <div>
                <Label className="text-xs">MIME Type</Label>
                <Input
                  className="mt-1 h-8"
                  value={block.mimeType}
                  onChange={(e) =>
                    onChange({ ...block, mimeType: e.target.value })
                  }
                  placeholder="image/png"
                />
              </div>
              <div>
                <Label className="text-xs">Base64 Data</Label>
                <textarea
                  className="w-full mt-1 p-2 border rounded text-sm min-h-[60px] font-mono text-xs bg-white dark:bg-gray-900"
                  value={block.data}
                  onChange={(e) => onChange({ ...block, data: e.target.value })}
                  placeholder="Base64 encoded image data..."
                />
              </div>
            </>
          )}

          {block.type === "audio" && (
            <>
              <div>
                <Label className="text-xs">MIME Type</Label>
                <Input
                  className="mt-1 h-8"
                  value={block.mimeType}
                  onChange={(e) =>
                    onChange({ ...block, mimeType: e.target.value })
                  }
                  placeholder="audio/wav"
                />
              </div>
              <div>
                <Label className="text-xs">Base64 Data</Label>
                <textarea
                  className="w-full mt-1 p-2 border rounded text-sm min-h-[60px] font-mono text-xs bg-white dark:bg-gray-900"
                  value={block.data}
                  onChange={(e) => onChange({ ...block, data: e.target.value })}
                  placeholder="Base64 encoded audio data..."
                />
              </div>
            </>
          )}

          {block.type === "tool_use" && (
            <>
              <div>
                <Label className="text-xs">Tool Name</Label>
                {tools && tools.length > 0 ? (
                  <Select
                    value={block.name}
                    onValueChange={(v) => onChange({ ...block, name: v })}
                  >
                    <SelectTrigger className="mt-1 h-8">
                      <SelectValue placeholder="Select a tool..." />
                    </SelectTrigger>
                    <SelectContent>
                      {tools.map((tool) => (
                        <SelectItem key={tool.name} value={tool.name}>
                          {tool.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <Input
                    className="mt-1 h-8"
                    value={block.name}
                    onChange={(e) =>
                      onChange({ ...block, name: e.target.value })
                    }
                    placeholder="tool_name"
                  />
                )}
              </div>
              <div>
                <Label className="text-xs">Tool Call ID</Label>
                <Input
                  className="mt-1 h-8 font-mono text-xs"
                  value={block.id}
                  onChange={(e) => onChange({ ...block, id: e.target.value })}
                  placeholder="toolu_..."
                />
              </div>
              <div>
                <Label className="text-xs">Input (JSON)</Label>
                <DynamicJsonForm
                  schema={
                    (tools?.find((t) => t.name === block.name)
                      ?.inputSchema as JsonSchemaType) || {
                      type: "object",
                      properties: {},
                    }
                  }
                  value={block.input as JsonValue}
                  onChange={(newValue) =>
                    onChange({
                      ...block,
                      input: newValue as Record<string, unknown>,
                    })
                  }
                />
              </div>
            </>
          )}

          {block.type === "tool_result" && (
            <>
              <div>
                <Label className="text-xs">Tool Use ID</Label>
                <Input
                  className="mt-1 h-8 font-mono text-xs"
                  value={block.toolUseId}
                  onChange={(e) =>
                    onChange({ ...block, toolUseId: e.target.value })
                  }
                  placeholder="toolu_..."
                />
              </div>
              <div className="flex items-center space-x-2">
                <Checkbox
                  id={`isError-${index}`}
                  checked={block.isError || false}
                  onCheckedChange={(checked) =>
                    onChange({ ...block, isError: checked === true })
                  }
                />
                <Label htmlFor={`isError-${index}`} className="text-xs">
                  Is Error
                </Label>
              </div>
              <div>
                <Label className="text-xs">
                  Result Content (JSON array of content blocks)
                </Label>
                <textarea
                  className="w-full mt-1 p-2 border rounded text-sm min-h-[80px] font-mono text-xs bg-white dark:bg-gray-900"
                  value={JSON.stringify(block.content, null, 2)}
                  onChange={(e) => {
                    try {
                      const parsed = JSON.parse(e.target.value);
                      onChange({ ...block, content: parsed });
                    } catch {
                      // Keep current value if JSON is invalid
                    }
                  }}
                  placeholder='[{"type": "text", "text": "result..."}]'
                />
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
};

// Component to display tools from the request
const ToolsDisplay = ({
  tools,
  toolChoice,
}: {
  tools?: Tool[];
  toolChoice?: { mode?: string };
}) => {
  const [isExpanded, setIsExpanded] = useState(false);

  if (!tools || tools.length === 0) {
    return null;
  }

  return (
    <div className="border rounded-lg p-3 bg-blue-50 dark:bg-blue-900/20 mb-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-blue-700 dark:text-blue-300">
            Available Tools ({tools.length})
          </span>
          {toolChoice?.mode && (
            <span className="text-xs px-2 py-0.5 rounded bg-blue-100 dark:bg-blue-800 text-blue-700 dark:text-blue-300">
              mode: {toolChoice.mode}
            </span>
          )}
        </div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => setIsExpanded(!isExpanded)}
          className="h-6"
        >
          {isExpanded ? "Hide" : "Show"}
        </Button>
      </div>
      {isExpanded && (
        <div className="mt-2 space-y-2">
          {tools.map((tool) => (
            <div
              key={tool.name}
              className="p-2 bg-white dark:bg-gray-800 rounded border text-sm"
            >
              <div className="font-medium">{tool.name}</div>
              {tool.description && (
                <div className="text-xs text-gray-500 mt-1">
                  {tool.description}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

const SamplingRequest = ({
  onApprove,
  request,
  onReject,
}: SamplingRequestProps) => {
  const { toast } = useToast();

  const [model, setModel] = useState("stub-model");
  const [stopReason, setStopReason] = useState<StopReason>("endTurn");
  const [role, setRole] = useState<"assistant" | "user">("assistant");
  const [contentBlocks, setContentBlocks] = useState<ContentBlock[]>([
    { type: "text", text: "" },
  ]);

  // Extract tools from the request
  const tools = useMemo(() => {
    const params = request.request.params as {
      tools?: Tool[];
      toolChoice?: { mode?: string };
    };
    return params?.tools;
  }, [request.request.params]);

  const toolChoice = useMemo(() => {
    const params = request.request.params as {
      tools?: Tool[];
      toolChoice?: { mode?: string };
    };
    return params?.toolChoice;
  }, [request.request.params]);

  const addContentBlock = useCallback(() => {
    setContentBlocks((prev) => [...prev, { type: "text", text: "" }]);
  }, []);

  const removeContentBlock = useCallback((index: number) => {
    setContentBlocks((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const updateContentBlock = useCallback(
    (index: number, block: ContentBlock) => {
      setContentBlocks((prev) => prev.map((b, i) => (i === index ? block : b)));
    },
    [],
  );

  const handleApprove = (id: number) => {
    // Build the result object
    const content =
      contentBlocks.length === 1 ? contentBlocks[0] : contentBlocks;

    const result = {
      model,
      stopReason,
      role,
      content,
    };

    const validationResult = CreateMessageResultSchema.safeParse(result);
    if (!validationResult.success) {
      toast({
        title: "Validation Error",
        description: `Invalid message result: ${validationResult.error.message}`,
        variant: "destructive",
      });
      return;
    }

    onApprove(id, validationResult.data);
  };

  return (
    <div
      data-testid="sampling-request"
      className="flex gap-4 p-4 border rounded-lg"
    >
      {/* Left panel: Request display */}
      <div className="flex-1 space-y-3">
        <h4 className="text-sm font-semibold">Incoming Request</h4>
        <ToolsDisplay tools={tools} toolChoice={toolChoice} />
        <div className="bg-gray-50 dark:bg-gray-800 dark:text-gray-100 p-2 rounded max-h-96 overflow-auto">
          <JsonView data={JSON.stringify(request.request)} />
        </div>
      </div>

      {/* Right panel: Response builder */}
      <form className="flex-1 space-y-4">
        <h4 className="text-sm font-semibold">Build Response</h4>

        {/* Model field */}
        <div>
          <Label className="text-xs">Model</Label>
          <Input
            className="mt-1 h-8"
            value={model}
            onChange={(e) => setModel(e.target.value)}
            placeholder="model name"
          />
        </div>

        {/* Stop Reason dropdown */}
        <div>
          <Label className="text-xs">Stop Reason</Label>
          <Select
            value={stopReason}
            onValueChange={(v) => setStopReason(v as StopReason)}
          >
            <SelectTrigger className="mt-1 h-8">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {STOP_REASONS.map((sr) => (
                <SelectItem key={sr.value} value={sr.value}>
                  {sr.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Role dropdown */}
        <div>
          <Label className="text-xs">Role</Label>
          <Select
            value={role}
            onValueChange={(v) => setRole(v as "assistant" | "user")}
          >
            <SelectTrigger className="mt-1 h-8">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="assistant">Assistant</SelectItem>
              <SelectItem value="user">User</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Content blocks */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <Label className="text-xs">Content Blocks</Label>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={addContentBlock}
              className="h-7"
            >
              <Plus className="h-3 w-3 mr-1" />
              Add Block
            </Button>
          </div>

          <div className="space-y-2 max-h-64 overflow-y-auto">
            {contentBlocks.map((block, index) => (
              <ContentBlockEditor
                key={index}
                block={block}
                index={index}
                onChange={(b) => updateContentBlock(index, b)}
                onRemove={() => removeContentBlock(index)}
                tools={tools}
                canRemove={contentBlocks.length > 1}
              />
            ))}
          </div>
        </div>

        {/* Action buttons */}
        <div className="flex space-x-2 pt-2">
          <Button type="button" onClick={() => handleApprove(request.id)}>
            Approve
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => onReject(request.id)}
          >
            Reject
          </Button>
        </div>
      </form>
    </div>
  );
};

export default SamplingRequest;
