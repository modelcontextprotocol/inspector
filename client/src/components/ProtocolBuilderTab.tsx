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
  Target,
  GitBranch,
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
  pairId?: string; // links ! and ? steps together
}

interface ProtocolBranch {
  id: string;
  label: string;
  steps: ProtocolStep[];
}

// Target for where palette clicks should add steps
interface InsertTarget {
  choiceStepId: string;
  branchId: string;
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

  return `from llmsessioncontract import Monitor, MonitoredClient, ToolMiddleware, LLMResponse

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

// ── Recursive state helpers ────────────────────────────────

function updateStepDeep(
  steps: ProtocolStep[],
  stepId: string,
  updater: (step: ProtocolStep) => ProtocolStep,
): ProtocolStep[] {
  return steps.map((s) => {
    if (s.id === stepId) return updater(s);
    if (s.branches) {
      return {
        ...s,
        branches: s.branches.map((b) => ({
          ...b,
          steps: updateStepDeep(b.steps, stepId, updater),
        })),
      };
    }
    return s;
  });
}

function removeStepDeep(steps: ProtocolStep[], stepId: string): ProtocolStep[] {
  // Find the step to get its pairId
  const pairId = findPairId(steps, stepId);
  const shouldRemove = (s: ProtocolStep) =>
    s.id === stepId || (pairId && s.pairId === pairId);

  const filtered = steps.filter((s) => !shouldRemove(s));
  return filtered.map((s) => {
    if (s.branches) {
      return {
        ...s,
        branches: s.branches.map((b) => ({
          ...b,
          steps: removeStepDeep(b.steps, stepId),
        })),
      };
    }
    return s;
  });
}

function findPairId(steps: ProtocolStep[], stepId: string): string | undefined {
  for (const s of steps) {
    if (s.id === stepId) return s.pairId;
    if (s.branches) {
      for (const b of s.branches) {
        const found = findPairId(b.steps, stepId);
        if (found) return found;
      }
    }
  }
  return undefined;
}

function addStepToBranch(
  steps: ProtocolStep[],
  choiceStepId: string,
  branchId: string,
  newStep: ProtocolStep,
): ProtocolStep[] {
  return steps.map((s) => {
    if (s.id === choiceStepId && s.branches) {
      return {
        ...s,
        branches: s.branches.map((b) =>
          b.id === branchId ? { ...b, steps: [...b.steps, newStep] } : b,
        ),
      };
    }
    if (s.branches) {
      return {
        ...s,
        branches: s.branches.map((b) => ({
          ...b,
          steps: addStepToBranch(b.steps, choiceStepId, branchId, newStep),
        })),
      };
    }
    return s;
  });
}

function isTerminated(steps: ProtocolStep[]): boolean {
  if (steps.length === 0) return false;
  const last = steps[steps.length - 1];
  if (last.type === "choice") return true;
  // Note: "recursion" (rec X.) is NOT terminal — it's a scope opener.
  // Only a rec *reference* (loop back to X) is terminal.
  if (last.type === "action" && last.isRecRef) return true;
  return false;
}

function collectRecVars(steps: ProtocolStep[]): string[] {
  const vars: string[] = [];
  for (const s of steps) {
    if (s.type === "recursion" && s.recVar) vars.push(s.recVar);
    if (s.branches) {
      for (const b of s.branches) {
        vars.push(...collectRecVars(b.steps));
      }
    }
  }
  return vars;
}

function collectSendLabels(steps: ProtocolStep[]): string[] {
  const labels: string[] = [];
  for (const s of steps) {
    if (
      s.type === "action" &&
      s.direction === "send" &&
      s.label &&
      !s.isRecRef
    ) {
      labels.push(s.label);
    }
    if (s.branches) {
      for (const b of s.branches) {
        labels.push(...collectSendLabels(b.steps));
      }
    }
  }
  return [...new Set(labels)];
}

function deriveReceiveOptions(sendLabels: string[]): string[] {
  const options: string[] = [];
  for (const label of sendLabels) {
    options.push(`${label}Result`);
    options.push(`${label}Error`);
  }
  return options;
}

// Check if a branch target is terminated
function isBranchTerminated(
  steps: ProtocolStep[],
  choiceStepId: string,
  branchId: string,
): boolean {
  for (const s of steps) {
    if (s.id === choiceStepId && s.branches) {
      const branch = s.branches.find((b) => b.id === branchId);
      return branch ? isTerminated(branch.steps) : false;
    }
    if (s.branches) {
      for (const b of s.branches) {
        const result = isBranchTerminated(b.steps, choiceStepId, branchId);
        if (result) return true;
      }
    }
  }
  return false;
}

// Replace a paired action with a choice, keeping its partner as an unpaired action
function convertPairToChoice(
  steps: ProtocolStep[],
  stepId: string,
  pairId: string,
  direction: Direction,
  branchLabels: string[],
): ProtocolStep[] {
  return steps.map((s) => {
    // The step being converted → becomes a choice
    if (s.id === stepId) {
      return {
        id: s.id,
        type: "choice" as const,
        direction,
        branches: branchLabels.map((label) => ({
          id: uid(),
          label,
          steps: [],
        })),
      };
    }
    // The partner step → just remove the pairId so it becomes standalone
    if (s.pairId === pairId && s.id !== stepId) {
      const { pairId: _, ...rest } = s;
      return rest;
    }
    if (s.branches) {
      return {
        ...s,
        branches: s.branches.map((b) => ({
          ...b,
          steps: convertPairToChoice(
            b.steps,
            stepId,
            pairId,
            direction,
            branchLabels,
          ),
        })),
      };
    }
    return s;
  });
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
  const [insertTarget, setInsertTarget] = useState<InsertTarget | null>(null);

  const protocol = useMemo(() => {
    if (steps.length === 0) return "end";
    return stepsToProtocol(steps);
  }, [steps]);

  const pythonSnippet = useMemo(
    () => generatePythonSnippet(protocol, tools),
    [protocol, tools],
  );

  const topTerminated = isTerminated(steps);

  // Where should palette clicks go?
  const targetTerminated = insertTarget
    ? isBranchTerminated(
        steps,
        insertTarget.choiceStepId,
        insertTarget.branchId,
      )
    : topTerminated;

  const addStepToTarget = useCallback(
    (step: ProtocolStep) => {
      if (insertTarget) {
        setSteps((prev) =>
          addStepToBranch(
            prev,
            insertTarget.choiceStepId,
            insertTarget.branchId,
            step,
          ),
        );
      } else {
        setSteps((prev) => [...prev, step]);
      }
    },
    [insertTarget],
  );

  const addToolAsSteps = useCallback(
    (tool: Tool) => {
      const pair = uid();
      const sendStep: ProtocolStep = {
        id: uid(),
        type: "action",
        direction: "send",
        label: tool.name,
        toolName: tool.name,
        pairId: pair,
      };
      const recvStep: ProtocolStep = {
        id: uid(),
        type: "action",
        direction: "receive",
        label: `${tool.name}Result`,
        toolName: tool.name,
        pairId: pair,
      };
      if (insertTarget) {
        setSteps((prev) => {
          let s = addStepToBranch(
            prev,
            insertTarget.choiceStepId,
            insertTarget.branchId,
            sendStep,
          );
          s = addStepToBranch(
            s,
            insertTarget.choiceStepId,
            insertTarget.branchId,
            recvStep,
          );
          return s;
        });
      } else {
        setSteps((prev) => [...prev, sendStep, recvStep]);
      }
    },
    [insertTarget],
  );

  const addChoice = useCallback(
    (direction: Direction) => {
      const step: ProtocolStep = {
        id: uid(),
        type: "choice",
        direction,
        branches: [
          { id: uid(), label: "BranchA", steps: [] },
          { id: uid(), label: "BranchB", steps: [] },
        ],
      };
      addStepToTarget(step);
    },
    [addStepToTarget],
  );

  const addRecursion = useCallback(() => {
    setSteps((prev) => {
      const varName = `X${collectRecVars(prev).length}`;
      const recStep: ProtocolStep = {
        id: uid(),
        type: "recursion",
        recVar: varName,
      };
      if (insertTarget) {
        return addStepToBranch(
          prev,
          insertTarget.choiceStepId,
          insertTarget.branchId,
          recStep,
        );
      }
      return [...prev, recStep];
    });
  }, [insertTarget]);

  const addRecRef = useCallback(
    (varName: string) => {
      const step: ProtocolStep = {
        id: uid(),
        type: "action",
        isRecRef: true,
        recVar: varName,
      };
      addStepToTarget(step);
    },
    [addStepToTarget],
  );

  const handleUpdateStep = useCallback(
    (stepId: string, updater: (step: ProtocolStep) => ProtocolStep) => {
      setSteps((prev) => updateStepDeep(prev, stepId, updater));
    },
    [],
  );

  const handleRemoveStep = useCallback((stepId: string) => {
    setSteps((prev) => removeStepDeep(prev, stepId));
  }, []);

  const handleConvertToChoice = useCallback(
    (
      stepId: string,
      pairId: string,
      direction: Direction,
      branchLabels: string[],
    ) => {
      setSteps((prev) =>
        convertPairToChoice(prev, stepId, pairId, direction, branchLabels),
      );
    },
    [],
  );

  const handleAddStepToBranch = useCallback(
    (choiceStepId: string, branchId: string, newStep: ProtocolStep) => {
      setSteps((prev) =>
        addStepToBranch(prev, choiceStepId, branchId, newStep),
      );
    },
    [],
  );

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
    setInsertTarget(null);
  }, []);

  const recVars = collectRecVars(steps);
  const sendLabels = collectSendLabels(steps);
  const receiveOptions = deriveReceiveOptions(sendLabels);

  // Find the target branch label for display
  const targetLabel = useMemo(() => {
    if (!insertTarget) return null;
    const findBranch = (steps: ProtocolStep[]): string | null => {
      for (const s of steps) {
        if (s.id === insertTarget.choiceStepId && s.branches) {
          const b = s.branches.find((b) => b.id === insertTarget.branchId);
          return b ? b.label : null;
        }
        if (s.branches) {
          for (const b of s.branches) {
            const found = findBranch(b.steps);
            if (found) return found;
          }
        }
      }
      return null;
    };
    return findBranch(steps);
  }, [insertTarget, steps]);

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

            {/* Insert target indicator */}
            {insertTarget && (
              <div className="flex items-center gap-2 px-2 py-1.5 rounded-md bg-blue-50 dark:bg-blue-950 border border-blue-200 dark:border-blue-800 text-xs">
                <Target className="w-3 h-3 text-blue-500" />
                <span className="text-blue-700 dark:text-blue-300">
                  Adding to: <strong>{targetLabel}</strong>
                </span>
                <button
                  onClick={() => setInsertTarget(null)}
                  className="ml-auto text-blue-400 hover:text-blue-600 text-xs underline"
                >
                  clear
                </button>
              </div>
            )}

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
                      onClick={() => !targetTerminated && addToolAsSteps(tool)}
                      className={`w-full text-left px-3 py-2 rounded-md text-sm border border-gray-200 dark:border-gray-700 transition-colors group ${targetTerminated ? "opacity-40 cursor-not-allowed" : "hover:border-blue-400 hover:bg-blue-50 dark:hover:bg-blue-950"}`}
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
                disabled={targetTerminated}
                onClick={() => {
                  const pair = uid();
                  const sendStep: ProtocolStep = {
                    id: uid(),
                    type: "action",
                    direction: "send",
                    label: "Action",
                    pairId: pair,
                  };
                  const recvStep: ProtocolStep = {
                    id: uid(),
                    type: "action",
                    direction: "receive",
                    label: "ActionResult",
                    pairId: pair,
                  };
                  addStepToTarget(sendStep);
                  addStepToTarget(recvStep);
                }}
              >
                <span className="font-mono mr-2">
                  <span className="text-green-600">!</span>
                  <span className="text-blue-600">?</span>
                </span>
                Send / Receive Pair
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="w-full justify-start"
                disabled={targetTerminated}
                onClick={() => addChoice("send")}
              >
                <span className="text-green-600 font-mono mr-2">!{"{}"}</span>
                Internal Choice
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="w-full justify-start"
                disabled={targetTerminated}
                onClick={() => addChoice("receive")}
              >
                <span className="text-blue-600 font-mono mr-2">?{"{}"}</span>
                External Choice
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="w-full justify-start"
                disabled={targetTerminated}
                onClick={() => addRecursion()}
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
                      disabled={targetTerminated}
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
                <StepList
                  steps={steps}
                  tools={tools}
                  recVars={recVars}
                  receiveOptions={receiveOptions}
                  insertTarget={insertTarget}
                  onSetInsertTarget={setInsertTarget}
                  onUpdateStep={handleUpdateStep}
                  onRemoveStep={handleRemoveStep}
                  onAddStepToBranch={handleAddStepToBranch}
                  onConvertToChoice={handleConvertToChoice}
                />

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

// ── Step List (groups paired !? steps) ─────────────────────

function StepList({
  steps,
  tools,
  recVars,
  receiveOptions,
  insertTarget,
  onSetInsertTarget,
  onUpdateStep,
  onRemoveStep,
  onAddStepToBranch,
  onConvertToChoice,
  depth = 0,
}: {
  steps: ProtocolStep[];
  tools: Tool[];
  recVars: string[];
  receiveOptions: string[];
  insertTarget: InsertTarget | null;
  onSetInsertTarget: (target: InsertTarget | null) => void;
  onUpdateStep: (
    stepId: string,
    updater: (s: ProtocolStep) => ProtocolStep,
  ) => void;
  onRemoveStep: (stepId: string) => void;
  onAddStepToBranch: (
    choiceStepId: string,
    branchId: string,
    newStep: ProtocolStep,
  ) => void;
  onConvertToChoice: (
    stepId: string,
    pairId: string,
    direction: Direction,
    branchLabels: string[],
  ) => void;
  depth?: number;
}) {
  const rendered = new Set<string>();
  const elements: JSX.Element[] = [];

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    if (rendered.has(step.id)) continue;
    rendered.add(step.id);

    // Check if this is a send with a paired receive following it
    if (
      step.type === "action" &&
      step.direction === "send" &&
      step.pairId &&
      i + 1 < steps.length &&
      steps[i + 1].pairId === step.pairId
    ) {
      const recvStep = steps[i + 1];
      rendered.add(recvStep.id);
      elements.push(
        <PairCard
          key={step.pairId}
          sendStep={step}
          recvStep={recvStep}
          tools={tools}
          receiveOptions={receiveOptions}
          onUpdateStep={onUpdateStep}
          onRemoveStep={onRemoveStep}
          onConvertToChoice={onConvertToChoice}
        />,
      );
    } else {
      elements.push(
        <StepCard
          key={step.id}
          step={step}
          tools={tools}
          recVars={recVars}
          receiveOptions={receiveOptions}
          insertTarget={insertTarget}
          onSetInsertTarget={onSetInsertTarget}
          onUpdateStep={onUpdateStep}
          onRemoveStep={onRemoveStep}
          onAddStepToBranch={onAddStepToBranch}
          onConvertToChoice={onConvertToChoice}
          depth={depth}
        />,
      );
    }
  }

  return <>{elements}</>;
}

// ── Pair Card (!? grouped) ─────────────────────────────────

function PairCard({
  sendStep,
  recvStep,
  tools,
  receiveOptions,
  onUpdateStep,
  onRemoveStep,
  onConvertToChoice,
}: {
  sendStep: ProtocolStep;
  recvStep: ProtocolStep;
  tools: Tool[];
  receiveOptions: string[];
  onUpdateStep: (
    stepId: string,
    updater: (s: ProtocolStep) => ProtocolStep,
  ) => void;
  onRemoveStep: (stepId: string) => void;
  onConvertToChoice: (
    stepId: string,
    pairId: string,
    direction: Direction,
    branchLabels: string[],
  ) => void;
}) {
  return (
    <div className="rounded-md border border-gray-300 dark:border-gray-600 overflow-hidden">
      {/* Send row */}
      <div className="flex items-center gap-2 px-3 py-2 bg-green-50 dark:bg-green-950 border-b border-gray-200 dark:border-gray-700">
        <GripVertical className="w-3 h-3 text-gray-400" />
        <span className="font-mono text-xs font-bold text-green-600 dark:text-green-400">
          !
        </span>
        {tools.length > 0 ? (
          <select
            value={sendStep.label || ""}
            onChange={(e) => {
              const newLabel = e.target.value;
              onUpdateStep(sendStep.id, (s) => ({ ...s, label: newLabel }));
              // Auto-update the paired receive label
              onUpdateStep(recvStep.id, (s) => ({
                ...s,
                label: `${newLabel}Result`,
              }));
            }}
            className="font-mono text-xs bg-transparent border-none outline-none flex-1 min-w-0 cursor-pointer"
          >
            <option value={sendStep.label || ""}>
              {sendStep.label || "Select tool..."}
            </option>
            {tools
              .filter((t) => t.name !== sendStep.label)
              .map((t) => (
                <option key={t.name} value={t.name}>
                  {t.name}
                </option>
              ))}
          </select>
        ) : (
          <input
            type="text"
            value={sendStep.label || ""}
            onChange={(e) => {
              const newLabel = e.target.value;
              onUpdateStep(sendStep.id, (s) => ({ ...s, label: newLabel }));
              onUpdateStep(recvStep.id, (s) => ({
                ...s,
                label: `${newLabel}Result`,
              }));
            }}
            className="font-mono text-xs bg-transparent border-none outline-none flex-1 min-w-0"
            placeholder="label"
          />
        )}
        <button
          onClick={() => {
            const label = sendStep.label || "Action";
            // Use other available tools as branch options
            const otherTools = tools
              .map((t) => t.name)
              .filter((n) => n !== label);
            const branches =
              otherTools.length > 0
                ? [label, ...otherTools.slice(0, 2)]
                : [label, `${label}Alt`];
            onConvertToChoice(sendStep.id, sendStep.pairId!, "send", branches);
          }}
          className="text-gray-400 hover:text-green-500"
          title="Convert to internal choice !{}"
        >
          <GitBranch className="w-3 h-3" />
        </button>
        <button
          onClick={() => onRemoveStep(sendStep.id)}
          className="text-gray-400 hover:text-red-500"
          title="Delete pair"
        >
          <Trash2 className="w-3 h-3" />
        </button>
      </div>
      {/* Receive row */}
      <div className="flex items-center gap-2 px-3 py-2 bg-blue-50 dark:bg-blue-950">
        <div className="w-3" />
        <span className="font-mono text-xs font-bold text-blue-600 dark:text-blue-400">
          ?
        </span>
        {receiveOptions.length > 0 ? (
          <select
            value={recvStep.label || ""}
            onChange={(e) =>
              onUpdateStep(recvStep.id, (s) => ({
                ...s,
                label: e.target.value,
              }))
            }
            className="font-mono text-xs bg-transparent border-none outline-none flex-1 min-w-0 cursor-pointer"
          >
            <option value={recvStep.label || ""}>
              {recvStep.label || "Select response..."}
            </option>
            {receiveOptions
              .filter((r) => r !== recvStep.label)
              .map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
          </select>
        ) : (
          <input
            type="text"
            value={recvStep.label || ""}
            onChange={(e) =>
              onUpdateStep(recvStep.id, (s) => ({
                ...s,
                label: e.target.value,
              }))
            }
            className="font-mono text-xs bg-transparent border-none outline-none flex-1 min-w-0"
            placeholder="response label"
          />
        )}
        <button
          onClick={() => {
            const sendLabel = sendStep.label || "Action";
            onConvertToChoice(recvStep.id, recvStep.pairId!, "receive", [
              `${sendLabel}Result`,
              `${sendLabel}Error`,
            ]);
          }}
          className="text-gray-400 hover:text-blue-500"
          title="Convert to external choice ?{}"
        >
          <GitBranch className="w-3 h-3" />
        </button>
        <span className="text-xs text-gray-400 italic">paired</span>
      </div>
    </div>
  );
}

// ── Step Card ──────────────────────────────────────────────

function StepCard({
  step,
  tools,
  recVars,
  receiveOptions,
  insertTarget,
  onSetInsertTarget,
  depth = 0,
  onUpdateStep,
  onRemoveStep,
  onAddStepToBranch,
  onConvertToChoice,
}: {
  step: ProtocolStep;
  tools: Tool[];
  recVars: string[];
  receiveOptions: string[];
  insertTarget: InsertTarget | null;
  onSetInsertTarget: (target: InsertTarget | null) => void;
  depth?: number;
  onUpdateStep: (
    stepId: string,
    updater: (step: ProtocolStep) => ProtocolStep,
  ) => void;
  onRemoveStep: (stepId: string) => void;
  onAddStepToBranch: (
    choiceStepId: string,
    branchId: string,
    newStep: ProtocolStep,
  ) => void;
  onConvertToChoice: (
    stepId: string,
    pairId: string,
    direction: Direction,
    branchLabels: string[],
  ) => void;
}) {
  if (step.type === "action" && step.isRecRef) {
    return (
      <div className="flex items-center gap-2 px-3 py-2 rounded-md bg-amber-50 dark:bg-amber-950 border border-amber-200 dark:border-amber-800">
        <GripVertical className="w-3 h-3 text-gray-400" />
        <span className="font-mono text-xs text-amber-700 dark:text-amber-300">
          ↻ loop → {step.recVar}
        </span>
        <div className="flex-1" />
        <button
          onClick={() => onRemoveStep(step.id)}
          className="text-gray-400 hover:text-red-500"
        >
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
        {isSend && tools.length > 0 ? (
          <select
            value={step.label || ""}
            onChange={(e) =>
              onUpdateStep(step.id, (s) => ({ ...s, label: e.target.value }))
            }
            className="font-mono text-xs bg-transparent border-none outline-none flex-1 min-w-0 cursor-pointer"
          >
            <option value={step.label || ""}>
              {step.label || "Select tool..."}
            </option>
            {tools
              .filter((t) => t.name !== step.label)
              .map((t) => (
                <option key={t.name} value={t.name}>
                  {t.name}
                </option>
              ))}
          </select>
        ) : !isSend && receiveOptions.length > 0 ? (
          <select
            value={step.label || ""}
            onChange={(e) =>
              onUpdateStep(step.id, (s) => ({ ...s, label: e.target.value }))
            }
            className="font-mono text-xs bg-transparent border-none outline-none flex-1 min-w-0 cursor-pointer"
          >
            <option value={step.label || ""}>
              {step.label || "Select response..."}
            </option>
            {receiveOptions
              .filter((r) => r !== step.label)
              .map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
          </select>
        ) : (
          <input
            type="text"
            value={step.label || ""}
            onChange={(e) =>
              onUpdateStep(step.id, (s) => ({ ...s, label: e.target.value }))
            }
            className="font-mono text-xs bg-transparent border-none outline-none flex-1 min-w-0"
            placeholder="label"
          />
        )}
        {step.toolName && (
          <span className="text-xs text-gray-400 truncate max-w-24">
            ({step.toolName})
          </span>
        )}
        <button
          onClick={() => onRemoveStep(step.id)}
          className="text-gray-400 hover:text-red-500"
        >
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
      <div className={`rounded-md border-2 ${borderClass}`}>
        <div className="flex items-center gap-2 px-3 py-2 bg-gray-50 dark:bg-gray-800 rounded-t-md">
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
            onClick={() =>
              onUpdateStep(step.id, (s) => ({
                ...s,
                branches: [
                  ...(s.branches || []),
                  {
                    id: uid(),
                    label: `Branch${String.fromCharCode(65 + (s.branches?.length || 0))}`,
                    steps: [],
                  },
                ],
              }))
            }
            className="text-gray-400 hover:text-blue-500"
          >
            <Plus className="w-3 h-3" />
          </button>
          <button
            onClick={() => onRemoveStep(step.id)}
            className="text-gray-400 hover:text-red-500"
          >
            <Trash2 className="w-3 h-3" />
          </button>
        </div>
        <div className="p-2 space-y-2">
          {step.branches?.map((branch) => (
            <BranchCard
              key={branch.id}
              branch={branch}
              choiceStep={step}
              tools={tools}
              recVars={recVars}
              receiveOptions={receiveOptions}
              insertTarget={insertTarget}
              onSetInsertTarget={onSetInsertTarget}
              depth={depth}
              onUpdateStep={onUpdateStep}
              onRemoveStep={onRemoveStep}
              onAddStepToBranch={onAddStepToBranch}
              onConvertToChoice={onConvertToChoice}
              onRemoveBranch={() => {
                if ((step.branches?.length ?? 0) > 2) {
                  onUpdateStep(step.id, (s) => ({
                    ...s,
                    branches: s.branches?.filter((b) => b.id !== branch.id),
                  }));
                }
              }}
              onUpdateBranchLabel={(label) =>
                onUpdateStep(step.id, (s) => ({
                  ...s,
                  branches: s.branches?.map((b) =>
                    b.id === branch.id ? { ...b, label } : b,
                  ),
                }))
              }
            />
          ))}
        </div>
        <div className="px-3 py-1 bg-gray-50 dark:bg-gray-800 rounded-b-md">
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
        <button
          onClick={() => onRemoveStep(step.id)}
          className="text-gray-400 hover:text-red-500"
        >
          <Trash2 className="w-3 h-3" />
        </button>
      </div>
    );
  }

  return null;
}

// ── Branch Card (with nested steps) ────────────────────────

function BranchCard({
  branch,
  choiceStep,
  tools,
  recVars,
  receiveOptions,
  insertTarget,
  onSetInsertTarget,
  depth,
  onUpdateStep,
  onRemoveStep,
  onAddStepToBranch,
  onConvertToChoice,
  onRemoveBranch,
  onUpdateBranchLabel,
}: {
  branch: ProtocolBranch;
  choiceStep: ProtocolStep;
  tools: Tool[];
  recVars: string[];
  receiveOptions: string[];
  insertTarget: InsertTarget | null;
  onSetInsertTarget: (target: InsertTarget | null) => void;
  depth: number;
  onUpdateStep: (
    stepId: string,
    updater: (step: ProtocolStep) => ProtocolStep,
  ) => void;
  onRemoveStep: (stepId: string) => void;
  onAddStepToBranch: (
    choiceStepId: string,
    branchId: string,
    newStep: ProtocolStep,
  ) => void;
  onConvertToChoice: (
    stepId: string,
    pairId: string,
    direction: Direction,
    branchLabels: string[],
  ) => void;
  onRemoveBranch: () => void;
  onUpdateBranchLabel: (label: string) => void;
}) {
  const [expanded, setExpanded] = useState(true);
  const branchTerminated = isTerminated(branch.steps);
  const isActive =
    insertTarget?.choiceStepId === choiceStep.id &&
    insertTarget?.branchId === branch.id;

  // Collect sibling branch labels to exclude from dropdown
  const siblingLabels = (choiceStep.branches || [])
    .filter((b) => b.id !== branch.id)
    .map((b) => b.label);

  return (
    <div
      className={`bg-white dark:bg-gray-900 rounded border-2 transition-colors ${
        isActive
          ? "border-blue-400 dark:border-blue-500"
          : "border-gray-200 dark:border-gray-700"
      }`}
    >
      {/* Branch header */}
      <div className="flex items-center gap-2 px-2 py-1.5">
        <button
          onClick={() => setExpanded(!expanded)}
          className="text-gray-400 hover:text-gray-600"
        >
          {expanded ? (
            <ChevronDown className="w-3 h-3" />
          ) : (
            <ChevronRight className="w-3 h-3" />
          )}
        </button>
        {(() => {
          const isExternal = choiceStep.direction === "receive";
          const allOptions = isExternal
            ? receiveOptions
            : tools.map((t) => t.name);
          // Filter out labels already used by sibling branches
          const options = allOptions.filter((o) => !siblingLabels.includes(o));
          if (options.length > 0 || allOptions.length > 0) {
            return (
              <select
                value={branch.label}
                onChange={(e) => onUpdateBranchLabel(e.target.value)}
                className="font-mono text-xs bg-transparent border-none outline-none flex-1 min-w-0 cursor-pointer"
              >
                <option value={branch.label}>{branch.label}</option>
                {options
                  .filter((o) => o !== branch.label)
                  .map((o) => (
                    <option key={o} value={o}>
                      {o}
                    </option>
                  ))}
              </select>
            );
          }
          return (
            <input
              type="text"
              value={branch.label}
              onChange={(e) => onUpdateBranchLabel(e.target.value)}
              className="font-mono text-xs bg-transparent border-none outline-none flex-1 min-w-0"
              placeholder="branch label"
            />
          );
        })()}
        <span className="text-xs text-gray-400">
          {branch.steps.length > 0 && `(${branch.steps.length})`}
        </span>
        {/* Target button — click to make palette add to this branch */}
        <button
          onClick={() =>
            isActive
              ? onSetInsertTarget(null)
              : onSetInsertTarget({
                  choiceStepId: choiceStep.id,
                  branchId: branch.id,
                })
          }
          className={`transition-colors ${
            isActive
              ? "text-blue-500"
              : "text-gray-300 hover:text-blue-400 dark:text-gray-600 dark:hover:text-blue-400"
          }`}
          title={
            isActive
              ? "Stop targeting this branch"
              : "Click to add from palette into this branch"
          }
        >
          <Target className="w-3 h-3" />
        </button>
        {(choiceStep.branches?.length ?? 0) > 2 && (
          <button
            onClick={onRemoveBranch}
            className="text-gray-400 hover:text-red-500"
          >
            <Trash2 className="w-3 h-3" />
          </button>
        )}
      </div>

      {/* Branch steps */}
      {expanded && (
        <div className="px-2 pb-2 space-y-1">
          {branch.steps.length > 0 && (
            <div
              className="space-y-1 pl-2 border-l-2 border-gray-200 dark:border-gray-700"
              style={{ marginLeft: 4 }}
            >
              <StepList
                steps={branch.steps}
                tools={tools}
                recVars={recVars}
                receiveOptions={receiveOptions}
                insertTarget={insertTarget}
                onSetInsertTarget={onSetInsertTarget}
                onUpdateStep={onUpdateStep}
                onRemoveStep={onRemoveStep}
                onAddStepToBranch={onAddStepToBranch}
                onConvertToChoice={onConvertToChoice}
                depth={depth + 1}
              />
            </div>
          )}

          {/* Branch status */}
          {branchTerminated ? (
            <p className="text-xs text-gray-400 px-2 py-0.5 italic">end</p>
          ) : (
            <p className="text-xs text-gray-400 px-2 py-0.5 italic">
              {isActive ? (
                <span className="text-blue-500">
                  Use the palette to add steps here
                </span>
              ) : (
                <>
                  Click <Target className="w-3 h-3 inline" /> to add steps from
                  palette
                </>
              )}
            </p>
          )}
        </div>
      )}
    </div>
  );
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
      (i + 3 >= src.length || !/[a-zA-Z0-9_\-]/.test(src[i + 3]))
    ) {
      tokens.push({
        text: "rec",
        cls: "text-amber-600 dark:text-amber-400 italic",
      });
      i += 3;
    } else if (
      src.slice(i, i + 3) === "end" &&
      (i + 3 >= src.length || !/[a-zA-Z0-9_\-]/.test(src[i + 3]))
    ) {
      tokens.push({ text: "end", cls: "text-gray-500 italic" });
      i += 3;
    } else if (/[a-zA-Z0-9_\-]/.test(src[i])) {
      const start = i;
      while (i < src.length && /[a-zA-Z0-9_\-]/.test(src[i])) i++;
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
  const { states, transitions, endStates } = useMemo(() => {
    try {
      return parseToFSM(protocol);
    } catch {
      return {
        states: new Set<number>(),
        transitions: [] as FSMTransition[],
        endStates: new Set<number>(),
      };
    }
  }, [protocol]);

  if (states.size === 0) {
    return (
      <p className="text-xs text-gray-400 italic">
        Add steps to see the state machine
      </p>
    );
  }

  // Group transitions by source state for visual branching
  const bySource = new Map<number, FSMTransition[]>();
  for (const t of transitions) {
    const arr = bySource.get(t.from) || [];
    arr.push(t);
    bySource.set(t.from, arr);
  }

  // Collect all states referenced in transitions
  const allStates = Array.from(states).sort((a, b) => a - b);

  return (
    <div className="space-y-1.5">
      {allStates.map((s) => {
        const outgoing = bySource.get(s);
        if (!outgoing || outgoing.length === 0) {
          // Terminal state
          if (endStates.has(s)) {
            return (
              <div key={s} className="flex items-center gap-1">
                <span className="inline-flex items-center justify-center px-2 py-0.5 rounded text-xs font-mono bg-white dark:bg-gray-900 border-2 border-gray-400 dark:border-gray-500">
                  S{s}
                </span>
                <span className="text-xs text-gray-400 italic ml-1">end</span>
              </div>
            );
          }
          return null;
        }

        const isBranching = outgoing.length > 1;

        return (
          <div key={s} className="flex items-start gap-1">
            <span className="inline-flex items-center justify-center px-2 py-0.5 rounded text-xs font-mono bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-600 mt-0.5">
              S{s}
            </span>
            <span className="text-xs text-gray-400 mt-1">→</span>
            <div
              className={
                isBranching
                  ? "flex flex-col gap-0.5"
                  : "flex items-center gap-1"
              }
            >
              {outgoing.map((t, idx) => (
                <div key={idx} className="flex items-center gap-1">
                  <span
                    className={`text-xs font-mono px-1.5 py-0.5 rounded ${
                      t.dir === "send"
                        ? "bg-green-100 dark:bg-green-900 text-green-700 dark:text-green-300"
                        : t.dir === "receive"
                          ? "bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300"
                          : "bg-amber-100 dark:bg-amber-900 text-amber-700 dark:text-amber-300"
                    }`}
                  >
                    {t.dir === "send" ? "!" : t.dir === "receive" ? "?" : "↻"}
                    {t.label}
                  </span>
                  <span className="text-xs text-gray-400">→</span>
                  <span className="inline-flex items-center justify-center px-1.5 py-0.5 rounded text-xs font-mono bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-600">
                    S{t.to}
                  </span>
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

type FSMTransition = { from: number; to: number; dir: string; label: string };

function parseToFSM(protocol: string): {
  states: Set<number>;
  transitions: FSMTransition[];
  endStates: Set<number>;
} {
  const states = new Set<number>([0]);
  const transitions: FSMTransition[] = [];
  const endStates = new Set<number>();
  let nextState = 1;
  let pos = 0;
  const src = protocol;
  const recVarStates = new Map<string, number>();

  const skipWS = () => {
    while (pos < src.length && " \t\n\r".includes(src[pos])) pos++;
  };

  const readIdent = () => {
    skipWS();
    const start = pos;
    while (pos < src.length && /[a-zA-Z0-9_\-]/.test(src[pos])) pos++;
    return src.slice(start, pos);
  };

  // Returns the state number after parsing, given the current state
  const parse = (currentState: number): number => {
    skipWS();
    if (pos >= src.length) {
      endStates.add(currentState);
      return currentState;
    }

    if (
      src.slice(pos, pos + 3) === "end" &&
      (pos + 3 >= src.length || !/[a-zA-Z0-9_\-]/.test(src[pos + 3]))
    ) {
      pos += 3;
      endStates.add(currentState);
      return currentState;
    }

    if (
      src.slice(pos, pos + 3) === "rec" &&
      (pos + 3 >= src.length || !/[a-zA-Z0-9_\-]/.test(src[pos + 3]))
    ) {
      pos += 3;
      const varName = readIdent();
      recVarStates.set(varName, currentState);
      skipWS();
      if (src[pos] === ".") pos++;
      return parse(currentState);
    }

    if (src[pos] === "!" || src[pos] === "?") {
      const dir = src[pos] === "!" ? "send" : "receive";
      pos++;
      skipWS();

      if (pos < src.length && src[pos] === "{") {
        // Choice: branches all leave from currentState
        pos++;
        const branchEndStates: number[] = [];

        while (pos < src.length && src[pos] !== "}") {
          skipWS();
          if (src[pos] === ",") {
            pos++;
            continue;
          }
          if (src[pos] === "}") break;

          const label = readIdent();
          if (!label) {
            pos++;
            continue;
          }

          const branchTarget = nextState++;
          states.add(branchTarget);
          transitions.push({
            from: currentState,
            to: branchTarget,
            dir,
            label,
          });

          skipWS();
          if (src[pos] === ".") {
            pos++;
            const branchEnd = parse(branchTarget);
            branchEndStates.push(branchEnd);
          } else {
            branchEndStates.push(branchTarget);
          }
          skipWS();
          if (src[pos] === ",") pos++;
        }
        if (src[pos] === "}") pos++;

        // After choice, no continuation at the same level (choice terminates)
        // Return the last branch end for chaining purposes, though choices shouldn't chain
        return branchEndStates.length > 0 ? branchEndStates[0] : currentState;
      } else {
        // Simple action
        const label = readIdent();
        if (label) {
          const targetState = nextState++;
          states.add(targetState);
          transitions.push({ from: currentState, to: targetState, dir, label });

          skipWS();
          if (src[pos] === ".") {
            pos++;
            return parse(targetState);
          }
          endStates.add(targetState);
          return targetState;
        }
      }
    } else {
      // Possibly a rec var reference
      const ident = readIdent();
      if (ident && recVarStates.has(ident)) {
        const loopTarget = recVarStates.get(ident)!;
        transitions.push({
          from: currentState,
          to: loopTarget,
          dir: "loop",
          label: ident,
        });
        return currentState;
      }
    }

    skipWS();
    if (src[pos] === ".") {
      pos++;
      return parse(currentState);
    }

    return currentState;
  };

  try {
    parse(0);
  } catch {
    // graceful fallback
  }

  return { states, transitions, endStates };
}

export default ProtocolBuilderTab;
