import { useState, useCallback, useMemo } from "react";
import { TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Tool } from "@modelcontextprotocol/sdk/types.js";
import {
  GripVertical,
  Plus,
  Trash2,
  Copy,
  RotateCcw,
  ChevronDown,
  ChevronRight,
  Download,
} from "lucide-react";

// ── Types ──────────────────────────────────────────────────

type Direction = "send" | "receive";

interface ProtocolStep {
  id: string;
  type: "action" | "choice" | "recursion";
  direction?: Direction;
  label?: string;
  toolName?: string;
  branches?: ProtocolBranch[];
  recVar?: string;
  isRecRef?: boolean;
}

interface ProtocolBranch {
  id: string;
  label: string;
  steps: ProtocolStep[];
}

// ── Helpers ────────────────────────────────────────────────

let nextId = 0;
const uid = () => `step-${++nextId}`;

function stepsToProtocol(steps: ProtocolStep[]): string {
  if (steps.length === 0) return "end";

  const parts: string[] = [];

  for (const step of steps) {
    if (step.type === "action") {
      if (step.isRecRef && step.recVar) {
        parts.push(step.recVar);
      } else {
        const prefix = step.direction === "send" ? "!" : "?";
        parts.push(`${prefix}${step.label}`);
      }
    } else if (step.type === "choice" && step.branches) {
      const prefix = step.direction === "send" ? "!" : "?";
      const branchStrs = step.branches.map((b) => {
        const inner = stepsToProtocol(b.steps);
        return inner === "end" ? b.label : `${b.label}.${inner}`;
      });
      parts.push(`${prefix}{${branchStrs.join(", ")}}`);
    } else if (step.type === "recursion" && step.recVar) {
      const inner = stepsToProtocol(steps.slice(steps.indexOf(step) + 1));
      const body =
        step.branches && step.branches.length > 0
          ? stepsToProtocol(
              step.branches[0].steps.concat(
                steps.slice(steps.indexOf(step) + 1),
              ),
            )
          : inner;
      return `rec ${step.recVar}.${body}`;
    }
  }

  if (parts.length === 0) return "end";
  return parts.join(".") + ".end";
}

function generatePythonSnippet(protocol: string, tools: Tool[]): string {
  const toolNames = tools.map((t) => t.name).slice(0, 5);
  const toolEntries = toolNames
    .map((n) => `        "${n}": ${n}_fn,`)
    .join("\n");

  return `from llmcontract import Monitor, MonitoredClient, ToolMiddleware, LLMResponse

# Define the protocol
protocol = "${protocol}"

# Create a shared monitor
monitor = Monitor(protocol)

# Wrap your LLM client
client = MonitoredClient(
    llm_call=your_llm_fn,
    response_adapter=your_adapter,
    monitor=monitor,
    send_label="Request",
    receive_label=lambda r: "ToolCall" if r.has_tool_calls else "FinalAnswer",
)

# Register tools with the middleware
tools = ToolMiddleware(
    monitor=monitor,
    tools={
${toolEntries || '        # "tool_name": tool_fn,'}
    },
)`;
}

// ── Protocol Builder Component ─────────────────────────────

const ProtocolBuilderTab = ({
  tools,
  listTools,
}: {
  tools: Tool[];
  listTools: () => void;
}) => {
  const [steps, setSteps] = useState<ProtocolStep[]>([]);
  const [expandedTools, setExpandedTools] = useState(true);
  const [copied, setCopied] = useState<"dsl" | "python" | null>(null);

  const protocol = useMemo(() => {
    if (steps.length === 0) return "end";
    return stepsToProtocol(steps);
  }, [steps]);

  const pythonSnippet = useMemo(
    () => generatePythonSnippet(protocol, tools),
    [protocol, tools],
  );

  const addStep = useCallback((step: ProtocolStep) => {
    setSteps((prev) => [...prev, step]);
  }, []);

  const removeStep = useCallback((id: string) => {
    setSteps((prev) => prev.filter((s) => s.id !== id));
  }, []);

  const addToolAsSteps = useCallback((tool: Tool) => {
    const sendStep: ProtocolStep = {
      id: uid(),
      type: "action",
      direction: "send",
      label: tool.name,
      toolName: tool.name,
    };
    const recvStep: ProtocolStep = {
      id: uid(),
      type: "action",
      direction: "receive",
      label: `${tool.name}Result`,
      toolName: tool.name,
    };
    setSteps((prev) => [...prev, sendStep, recvStep]);
  }, []);

  const addChoice = useCallback((direction: Direction) => {
    const step: ProtocolStep = {
      id: uid(),
      type: "choice",
      direction,
      branches: [
        { id: uid(), label: "BranchA", steps: [] },
        { id: uid(), label: "BranchB", steps: [] },
      ],
    };
    setSteps((prev) => [...prev, step]);
  }, []);

  const addRecursion = useCallback(() => {
    const varName = `X${steps.filter((s) => s.type === "recursion").length}`;
    const recStep: ProtocolStep = {
      id: uid(),
      type: "recursion",
      recVar: varName,
    };
    setSteps((prev) => [...prev, recStep]);
  }, [steps]);

  const addRecRef = useCallback((varName: string) => {
    const step: ProtocolStep = {
      id: uid(),
      type: "action",
      isRecRef: true,
      recVar: varName,
    };
    setSteps((prev) => [...prev, step]);
  }, []);

  const updateBranchLabel = useCallback(
    (stepId: string, branchId: string, label: string) => {
      setSteps((prev) =>
        prev.map((s) => {
          if (s.id !== stepId || !s.branches) return s;
          return {
            ...s,
            branches: s.branches.map((b) =>
              b.id === branchId ? { ...b, label } : b,
            ),
          };
        }),
      );
    },
    [],
  );

  const addBranch = useCallback((stepId: string) => {
    setSteps((prev) =>
      prev.map((s) => {
        if (s.id !== stepId || !s.branches) return s;
        return {
          ...s,
          branches: [
            ...s.branches,
            {
              id: uid(),
              label: `Branch${String.fromCharCode(65 + s.branches.length)}`,
              steps: [],
            },
          ],
        };
      }),
    );
  }, []);

  const removeBranch = useCallback((stepId: string, branchId: string) => {
    setSteps((prev) =>
      prev.map((s) => {
        if (s.id !== stepId || !s.branches) return s;
        if (s.branches.length <= 2) return s;
        return {
          ...s,
          branches: s.branches.filter((b) => b.id !== branchId),
        };
      }),
    );
  }, []);

  const copyToClipboard = useCallback(
    (text: string, type: "dsl" | "python") => {
      navigator.clipboard.writeText(text);
      setCopied(type);
      setTimeout(() => setCopied(null), 2000);
    },
    [],
  );

  const clearAll = useCallback(() => {
    setSteps([]);
  }, []);

  const recVars = steps
    .filter((s) => s.type === "recursion" && s.recVar)
    .map((s) => s.recVar!);

  return (
    <TabsContent value="protocol-builder">
      <div className="flex flex-col h-full">
        <div className="grid grid-cols-3 gap-4 p-4 h-full">
          {/* ── Left: Tool Palette ── */}
          <div className="flex flex-col gap-3 overflow-y-auto">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300">
                MCP Tools
              </h3>
              <Button variant="outline" size="sm" onClick={listTools}>
                Refresh
              </Button>
            </div>

            {tools.length === 0 ? (
              <div className="text-center py-8">
                <p className="text-sm text-gray-500 mb-3">
                  No tools discovered yet
                </p>
                <Button variant="outline" size="sm" onClick={listTools}>
                  List Tools
                </Button>
              </div>
            ) : (
              <div className="space-y-1">
                <button
                  onClick={() => setExpandedTools(!expandedTools)}
                  className="flex items-center gap-1 text-xs font-medium text-gray-500 uppercase tracking-wider w-full"
                >
                  {expandedTools ? (
                    <ChevronDown className="w-3 h-3" />
                  ) : (
                    <ChevronRight className="w-3 h-3" />
                  )}
                  Available Tools ({tools.length})
                </button>
                {expandedTools &&
                  tools.map((tool) => (
                    <button
                      key={tool.name}
                      onClick={() => addToolAsSteps(tool)}
                      className="w-full text-left px-3 py-2 rounded-md text-sm border border-gray-200 dark:border-gray-700 hover:border-blue-400 hover:bg-blue-50 dark:hover:bg-blue-950 transition-colors group"
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-mono text-xs font-medium">
                          {tool.name}
                        </span>
                        <Plus className="w-3 h-3 opacity-0 group-hover:opacity-100 text-blue-500" />
                      </div>
                      {tool.description && (
                        <p className="text-xs text-gray-500 mt-0.5 truncate">
                          {tool.description}
                        </p>
                      )}
                    </button>
                  ))}
              </div>
            )}

            <div className="border-t pt-3 mt-2 space-y-2">
              <p className="text-xs font-medium text-gray-500 uppercase tracking-wider">
                Protocol Constructs
              </p>
              <Button
                variant="outline"
                size="sm"
                className="w-full justify-start"
                onClick={() =>
                  addStep({
                    id: uid(),
                    type: "action",
                    direction: "send",
                    label: "Action",
                  })
                }
              >
                <span className="text-green-600 font-mono mr-2">!</span>
                Send Action
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="w-full justify-start"
                onClick={() =>
                  addStep({
                    id: uid(),
                    type: "action",
                    direction: "receive",
                    label: "Action",
                  })
                }
              >
                <span className="text-blue-600 font-mono mr-2">?</span>
                Receive Action
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="w-full justify-start"
                onClick={() => addChoice("send")}
              >
                <span className="text-green-600 font-mono mr-2">!{"{}"}</span>
                Internal Choice
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="w-full justify-start"
                onClick={() => addChoice("receive")}
              >
                <span className="text-blue-600 font-mono mr-2">?{"{}"}</span>
                External Choice
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="w-full justify-start"
                onClick={addRecursion}
              >
                <span className="text-amber-600 font-mono mr-2">rec</span>
                Recursion
              </Button>
              {recVars.length > 0 && (
                <div className="space-y-1 pl-2">
                  {recVars.map((v) => (
                    <Button
                      key={v}
                      variant="ghost"
                      size="sm"
                      className="w-full justify-start text-xs"
                      onClick={() => addRecRef(v)}
                    >
                      <span className="text-amber-600 font-mono mr-2">→</span>
                      Loop back to {v}
                    </Button>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* ── Middle: Protocol Steps ── */}
          <div className="flex flex-col gap-3 overflow-y-auto">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300">
                Protocol Sequence
              </h3>
              <Button
                variant="ghost"
                size="sm"
                onClick={clearAll}
                disabled={steps.length === 0}
              >
                <RotateCcw className="w-3 h-3 mr-1" />
                Clear
              </Button>
            </div>

            {steps.length === 0 ? (
              <div className="flex-1 flex items-center justify-center border-2 border-dashed border-gray-200 dark:border-gray-700 rounded-lg">
                <p className="text-sm text-gray-400 text-center px-4">
                  Click tools or constructs on the left to build your protocol
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                {steps.map((step) => (
                  <StepCard
                    key={step.id}
                    step={step}
                    onRemove={() => removeStep(step.id)}
                    onUpdateLabel={(label) =>
                      setSteps((prev) =>
                        prev.map((s) =>
                          s.id === step.id ? { ...s, label } : s,
                        ),
                      )
                    }
                    onUpdateBranchLabel={updateBranchLabel}
                    onAddBranch={() => addBranch(step.id)}
                    onRemoveBranch={(branchId) =>
                      removeBranch(step.id, branchId)
                    }
                  />
                ))}

                {/* Terminal indicator */}
                <div className="flex items-center gap-2 px-3 py-2 rounded-md bg-gray-100 dark:bg-gray-800 border border-gray-200 dark:border-gray-700">
                  <span className="font-mono text-xs text-gray-500 italic">
                    end
                  </span>
                </div>
              </div>
            )}
          </div>

          {/* ── Right: Output ── */}
          <div className="flex flex-col gap-3 overflow-y-auto">
            <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300">
              Output
            </h3>

            {/* DSL */}
            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <p className="text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Session Type DSL
                </p>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => copyToClipboard(protocol, "dsl")}
                >
                  <Copy className="w-3 h-3 mr-1" />
                  {copied === "dsl" ? "Copied!" : "Copy"}
                </Button>
              </div>
              <pre className="p-3 rounded-md bg-gray-100 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 font-mono text-xs whitespace-pre-wrap break-all">
                <ProtocolHighlight protocol={protocol} />
              </pre>
            </div>

            {/* State machine preview */}
            <div className="space-y-1">
              <p className="text-xs font-medium text-gray-500 uppercase tracking-wider">
                State Machine Preview
              </p>
              <div className="p-3 rounded-md bg-gray-100 dark:bg-gray-800 border border-gray-200 dark:border-gray-700">
                <StateMachinePreview protocol={protocol} />
              </div>
            </div>

            {/* Python snippet */}
            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <p className="text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Python Integration
                </p>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => copyToClipboard(pythonSnippet, "python")}
                >
                  <Copy className="w-3 h-3 mr-1" />
                  {copied === "python" ? "Copied!" : "Copy"}
                </Button>
              </div>
              <pre className="p-3 rounded-md bg-gray-100 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 font-mono text-xs whitespace-pre-wrap overflow-x-auto max-h-64">
                {pythonSnippet}
              </pre>
            </div>

            {/* Download button */}
            <Button
              variant="outline"
              size="sm"
              className="w-full"
              onClick={() => {
                const content = `# Protocol: ${protocol}\n\n${pythonSnippet}`;
                const blob = new Blob([content], { type: "text/plain" });
                const url = URL.createObjectURL(blob);
                const a = document.createElement("a");
                a.href = url;
                a.download = "protocol.py";
                a.click();
                URL.revokeObjectURL(url);
              }}
            >
              <Download className="w-3 h-3 mr-1" />
              Download Python File
            </Button>
          </div>
        </div>
      </div>
    </TabsContent>
  );
};

// ── Step Card ──────────────────────────────────────────────

function StepCard({
  step,
  onRemove,
  onUpdateLabel,
  onUpdateBranchLabel,
  onAddBranch,
  onRemoveBranch,
}: {
  step: ProtocolStep;
  onRemove: () => void;
  onUpdateLabel: (label: string) => void;
  onUpdateBranchLabel: (
    stepId: string,
    branchId: string,
    label: string,
  ) => void;
  onAddBranch: () => void;
  onRemoveBranch: (branchId: string) => void;
}) {
  if (step.type === "action" && step.isRecRef) {
    return (
      <div className="flex items-center gap-2 px-3 py-2 rounded-md bg-amber-50 dark:bg-amber-950 border border-amber-200 dark:border-amber-800">
        <GripVertical className="w-3 h-3 text-gray-400" />
        <span className="font-mono text-xs text-amber-700 dark:text-amber-300">
          ↻ loop → {step.recVar}
        </span>
        <div className="flex-1" />
        <button onClick={onRemove} className="text-gray-400 hover:text-red-500">
          <Trash2 className="w-3 h-3" />
        </button>
      </div>
    );
  }

  if (step.type === "action") {
    const isSend = step.direction === "send";
    const bgClass = isSend
      ? "bg-green-50 dark:bg-green-950 border-green-200 dark:border-green-800"
      : "bg-blue-50 dark:bg-blue-950 border-blue-200 dark:border-blue-800";
    const prefixClass = isSend
      ? "text-green-600 dark:text-green-400"
      : "text-blue-600 dark:text-blue-400";

    return (
      <div
        className={`flex items-center gap-2 px-3 py-2 rounded-md border ${bgClass}`}
      >
        <GripVertical className="w-3 h-3 text-gray-400" />
        <span className={`font-mono text-xs font-bold ${prefixClass}`}>
          {isSend ? "!" : "?"}
        </span>
        <input
          type="text"
          value={step.label || ""}
          onChange={(e) => onUpdateLabel(e.target.value)}
          className="font-mono text-xs bg-transparent border-none outline-none flex-1 min-w-0"
          placeholder="label"
        />
        {step.toolName && (
          <span className="text-xs text-gray-400 truncate max-w-24">
            ({step.toolName})
          </span>
        )}
        <button onClick={onRemove} className="text-gray-400 hover:text-red-500">
          <Trash2 className="w-3 h-3" />
        </button>
      </div>
    );
  }

  if (step.type === "choice") {
    const isSend = step.direction === "send";
    const borderClass = isSend
      ? "border-green-300 dark:border-green-700"
      : "border-blue-300 dark:border-blue-700";
    const prefixClass = isSend
      ? "text-green-600 dark:text-green-400"
      : "text-blue-600 dark:text-blue-400";

    return (
      <div className={`rounded-md border-2 ${borderClass} overflow-hidden`}>
        <div className="flex items-center gap-2 px-3 py-2 bg-gray-50 dark:bg-gray-800">
          <GripVertical className="w-3 h-3 text-gray-400" />
          <span className={`font-mono text-xs font-bold ${prefixClass}`}>
            {isSend ? "!" : "?"}
            {"{"}
          </span>
          <span className="text-xs text-gray-500">
            {isSend ? "Internal" : "External"} Choice
          </span>
          <div className="flex-1" />
          <button
            onClick={onAddBranch}
            className="text-gray-400 hover:text-blue-500"
          >
            <Plus className="w-3 h-3" />
          </button>
          <button
            onClick={onRemove}
            className="text-gray-400 hover:text-red-500"
          >
            <Trash2 className="w-3 h-3" />
          </button>
        </div>
        <div className="p-2 space-y-1">
          {step.branches?.map((branch) => (
            <div
              key={branch.id}
              className="flex items-center gap-2 px-2 py-1.5 bg-white dark:bg-gray-900 rounded border border-gray-200 dark:border-gray-700"
            >
              <input
                type="text"
                value={branch.label}
                onChange={(e) =>
                  onUpdateBranchLabel(step.id, branch.id, e.target.value)
                }
                className="font-mono text-xs bg-transparent border-none outline-none flex-1 min-w-0"
                placeholder="branch label"
              />
              {(step.branches?.length ?? 0) > 2 && (
                <button
                  onClick={() => onRemoveBranch(branch.id)}
                  className="text-gray-400 hover:text-red-500"
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              )}
            </div>
          ))}
        </div>
        <div className="px-3 py-1 bg-gray-50 dark:bg-gray-800">
          <span className={`font-mono text-xs font-bold ${prefixClass}`}>
            {"}"}
          </span>
        </div>
      </div>
    );
  }

  if (step.type === "recursion") {
    return (
      <div className="flex items-center gap-2 px-3 py-2 rounded-md bg-amber-50 dark:bg-amber-950 border border-amber-200 dark:border-amber-800">
        <GripVertical className="w-3 h-3 text-gray-400" />
        <span className="font-mono text-xs font-bold text-amber-600 dark:text-amber-400">
          rec
        </span>
        <span className="font-mono text-xs text-amber-700 dark:text-amber-300">
          {step.recVar}
        </span>
        <span className="font-mono text-xs text-gray-400">.</span>
        <div className="flex-1" />
        <button onClick={onRemove} className="text-gray-400 hover:text-red-500">
          <Trash2 className="w-3 h-3" />
        </button>
      </div>
    );
  }

  return null;
}

// ── Protocol Syntax Highlighting ───────────────────────────

function ProtocolHighlight({ protocol }: { protocol: string }) {
  const tokens: { text: string; cls: string }[] = [];
  let i = 0;
  const src = protocol;

  while (i < src.length) {
    if (src[i] === "!") {
      tokens.push({ text: "!", cls: "text-green-600 dark:text-green-400" });
      i++;
    } else if (src[i] === "?") {
      tokens.push({ text: "?", cls: "text-blue-600 dark:text-blue-400" });
      i++;
    } else if (
      src[i] === "." ||
      src[i] === "{" ||
      src[i] === "}" ||
      src[i] === ","
    ) {
      tokens.push({ text: src[i], cls: "text-gray-400" });
      i++;
    } else if (
      src.slice(i, i + 3) === "rec" &&
      (i + 3 >= src.length || !/[a-zA-Z0-9_]/.test(src[i + 3]))
    ) {
      tokens.push({
        text: "rec",
        cls: "text-amber-600 dark:text-amber-400 italic",
      });
      i += 3;
    } else if (
      src.slice(i, i + 3) === "end" &&
      (i + 3 >= src.length || !/[a-zA-Z0-9_]/.test(src[i + 3]))
    ) {
      tokens.push({ text: "end", cls: "text-gray-500 italic" });
      i += 3;
    } else if (/[a-zA-Z0-9_]/.test(src[i])) {
      const start = i;
      while (i < src.length && /[a-zA-Z0-9_]/.test(src[i])) i++;
      tokens.push({
        text: src.slice(start, i),
        cls: "text-gray-900 dark:text-gray-100",
      });
    } else if (src[i] === " ") {
      tokens.push({ text: " ", cls: "" });
      i++;
    } else {
      tokens.push({ text: src[i], cls: "" });
      i++;
    }
  }

  return (
    <>
      {tokens.map((t, idx) => (
        <span key={idx} className={t.cls}>
          {t.text}
        </span>
      ))}
    </>
  );
}

// ── State Machine Preview ──────────────────────────────────

function StateMachinePreview({ protocol }: { protocol: string }) {
  // Simple parser → FSM for visualization
  const { states, transitions } = useMemo(() => {
    try {
      return parseToFSM(protocol);
    } catch {
      return { states: [], transitions: [] };
    }
  }, [protocol]);

  if (states.length === 0) {
    return (
      <p className="text-xs text-gray-400 italic">
        Add steps to see the state machine
      </p>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-1">
      {transitions.map((t, i) => (
        <div key={i} className="flex items-center gap-1">
          <span className="inline-flex items-center justify-center px-2 py-0.5 rounded text-xs font-mono bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-600">
            S{t.from}
          </span>
          <span className="text-xs text-gray-400">→</span>
          <span
            className={`text-xs font-mono px-1.5 py-0.5 rounded ${
              t.dir === "send"
                ? "bg-green-100 dark:bg-green-900 text-green-700 dark:text-green-300"
                : t.dir === "receive"
                  ? "bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300"
                  : "bg-gray-100 dark:bg-gray-800 text-gray-600"
            }`}
          >
            {t.dir === "send" ? "!" : t.dir === "receive" ? "?" : ""}
            {t.label}
          </span>
          <span className="text-xs text-gray-400">→</span>
        </div>
      ))}
      <span className="inline-flex items-center justify-center px-2 py-0.5 rounded text-xs font-mono bg-white dark:bg-gray-900 border-2 border-gray-400 dark:border-gray-500">
        S{states.length > 0 ? states[states.length - 1] : 0}
      </span>
    </div>
  );
}

function parseToFSM(protocol: string): {
  states: number[];
  transitions: { from: number; to: number; dir: string; label: string }[];
} {
  const states: number[] = [0];
  const transitions: {
    from: number;
    to: number;
    dir: string;
    label: string;
  }[] = [];
  let stateId = 0;
  let i = 0;
  const src = protocol;

  const skipWS = () => {
    while (i < src.length && " \t\n\r".includes(src[i])) i++;
  };

  const readIdent = () => {
    skipWS();
    const start = i;
    while (i < src.length && /[a-zA-Z0-9_]/.test(src[i])) i++;
    return src.slice(start, i);
  };

  const parseSimple = () => {
    skipWS();
    if (i >= src.length) return;

    if (src[i] === "!" || src[i] === "?") {
      const dir = src[i] === "!" ? "send" : "receive";
      i++;
      skipWS();
      if (i < src.length && src[i] === "{") {
        // choice
        i++;
        while (i < src.length && src[i] !== "}") {
          skipWS();
          const label = readIdent();
          if (label) {
            const from = stateId;
            stateId++;
            states.push(stateId);
            transitions.push({ from, to: stateId, dir, label });
          }
          skipWS();
          if (src[i] === ".") {
            i++;
            parseSimple();
          }
          if (src[i] === ",") i++;
        }
        if (src[i] === "}") i++;
      } else {
        const label = readIdent();
        if (label) {
          const from = stateId;
          stateId++;
          states.push(stateId);
          transitions.push({ from, to: stateId, dir, label });
        }
      }
    } else if (src.slice(i, i + 3) === "rec") {
      i += 3;
      readIdent(); // var name
      skipWS();
      if (src[i] === ".") i++;
      parseSimple();
      return;
    } else if (src.slice(i, i + 3) === "end") {
      i += 3;
      return;
    } else {
      // recvar or label
      const ident = readIdent();
      if (ident && ident !== "end") {
        // rec var reference — skip
      }
    }

    skipWS();
    if (src[i] === ".") {
      i++;
      parseSimple();
    }
  };

  try {
    parseSimple();
  } catch {
    // graceful fallback
  }

  return { states, transitions };
}

export default ProtocolBuilderTab;
