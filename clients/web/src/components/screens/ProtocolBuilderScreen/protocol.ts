// Pure helpers for the Protocol Builder screen. No React, no DOM — just types
// and functions that operate on the in-memory protocol tree, render it to the
// session-type DSL, and project a finite-state-machine view of that DSL.

export type Direction = "send" | "receive";

export interface ProtocolStep {
  id: string;
  type: "action" | "choice" | "recursion";
  direction?: Direction;
  label?: string;
  toolName?: string;
  branches?: ProtocolBranch[];
  recVar?: string;
  isRecRef?: boolean;
  pairId?: string;
}

export interface ProtocolBranch {
  id: string;
  label: string;
  steps: ProtocolStep[];
}

export interface InsertTarget {
  choiceStepId: string;
  branchId: string;
}

export interface FSMTransition {
  from: number;
  to: number;
  dir: "send" | "receive" | "loop";
  label: string;
}

export interface FSMResult {
  states: Set<number>;
  transitions: FSMTransition[];
  endStates: Set<number>;
}

let nextId = 0;
export function uid(): string {
  nextId += 1;
  return `step-${nextId}`;
}

// Reset the uid counter — only used in tests to keep IDs deterministic.
export function resetUid(): void {
  nextId = 0;
}

export function stepsToProtocol(steps: ProtocolStep[]): string {
  if (steps.length === 0) return "end";
  const parts: string[] = [];
  for (let i = 0; i < steps.length; i += 1) {
    const step = steps[i];
    if (step.type === "action") {
      if (step.isRecRef && step.recVar) {
        parts.push(step.recVar);
      } else {
        const prefix = step.direction === "send" ? "!" : "?";
        parts.push(`${prefix}${step.label ?? ""}`);
      }
    } else if (step.type === "choice" && step.branches) {
      const prefix = step.direction === "send" ? "!" : "?";
      const branchStrs = step.branches.map((b) => {
        const inner = stepsToProtocol(b.steps);
        return inner === "end" ? b.label : `${b.label}.${inner}`;
      });
      parts.push(`${prefix}{${branchStrs.join(", ")}}`);
    } else if (step.type === "recursion" && step.recVar) {
      // `rec X.` opens a scope that wraps everything that follows at this level.
      const tail = stepsToProtocol(steps.slice(i + 1));
      return `${parts.length > 0 ? `${parts.join(".")}.` : ""}rec ${step.recVar}.${tail}`;
    }
  }
  if (parts.length === 0) return "end";
  return `${parts.join(".")}.end`;
}

export function generatePythonSnippet(protocol: string): string {
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
        # "tool_name": tool_fn,
    },
)`;
}

export function updateStepDeep(
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

export function findPairId(
  steps: ProtocolStep[],
  stepId: string,
): string | undefined {
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

export function removeStepDeep(
  steps: ProtocolStep[],
  stepId: string,
): ProtocolStep[] {
  // Removing one half of an `!?` pair drops both — keeps the UI invariant
  // that paired steps always appear together (or not at all).
  const pairId = findPairId(steps, stepId);
  const shouldRemove = (s: ProtocolStep): boolean =>
    s.id === stepId || (pairId !== undefined && s.pairId === pairId);

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

export function addStepToBranch(
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

export function isTerminated(steps: ProtocolStep[]): boolean {
  if (steps.length === 0) return false;
  const last = steps[steps.length - 1];
  if (last.type === "choice") return true;
  // `rec X.` opens a scope; only a *reference* (loop back to X) terminates.
  if (last.type === "action" && last.isRecRef) return true;
  return false;
}

export function collectRecVars(steps: ProtocolStep[]): string[] {
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

export function collectSendLabels(steps: ProtocolStep[]): string[] {
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

export function deriveReceiveOptions(sendLabels: string[]): string[] {
  const options: string[] = [];
  for (const label of sendLabels) {
    options.push(`${label}Result`);
    options.push(`${label}Error`);
  }
  return options;
}

export function isBranchTerminated(
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
        if (isBranchTerminated(b.steps, choiceStepId, branchId)) return true;
      }
    }
  }
  return false;
}

export function findBranchLabel(
  steps: ProtocolStep[],
  target: InsertTarget,
): string | null {
  for (const s of steps) {
    if (s.id === target.choiceStepId && s.branches) {
      const b = s.branches.find((br) => br.id === target.branchId);
      return b ? b.label : null;
    }
    if (s.branches) {
      for (const b of s.branches) {
        const found = findBranchLabel(b.steps, target);
        if (found) return found;
      }
    }
  }
  return null;
}

// Convert a paired action into a choice. The other half of the pair loses its
// pairId and stays in place as an unpaired action — it's no longer part of a
// pair, but the user's existing label survives.
export function convertPairToChoice(
  steps: ProtocolStep[],
  stepId: string,
  pairId: string,
  direction: Direction,
  branchLabels: string[],
): ProtocolStep[] {
  return steps.map((s) => {
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
    if (s.pairId === pairId && s.id !== stepId) {
      const next: ProtocolStep = { ...s };
      delete next.pairId;
      return next;
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

// Parse the DSL string back into an FSM. Used for the state-machine preview
// in the output panel — purely for visualization, not for runtime monitoring.
export function parseToFSM(protocol: string): FSMResult {
  const states = new Set<number>([0]);
  const transitions: FSMTransition[] = [];
  const endStates = new Set<number>();
  let nextState = 1;
  let pos = 0;
  const src = protocol;
  const recVarStates = new Map<string, number>();

  const skipWS = (): void => {
    while (pos < src.length && " \t\n\r".includes(src[pos])) pos += 1;
  };

  const readIdent = (): string => {
    skipWS();
    const start = pos;
    while (pos < src.length && /[a-zA-Z0-9_-]/.test(src[pos])) pos += 1;
    return src.slice(start, pos);
  };

  const isWordEnd = (i: number): boolean =>
    i >= src.length || !/[a-zA-Z0-9_-]/.test(src[i]);

  const parse = (currentState: number): number => {
    skipWS();
    if (pos >= src.length) {
      endStates.add(currentState);
      return currentState;
    }

    if (src.slice(pos, pos + 3) === "end" && isWordEnd(pos + 3)) {
      pos += 3;
      endStates.add(currentState);
      return currentState;
    }

    if (src.slice(pos, pos + 3) === "rec" && isWordEnd(pos + 3)) {
      pos += 3;
      const varName = readIdent();
      recVarStates.set(varName, currentState);
      skipWS();
      if (src[pos] === ".") pos += 1;
      return parse(currentState);
    }

    if (src[pos] === "!" || src[pos] === "?") {
      const dir: "send" | "receive" = src[pos] === "!" ? "send" : "receive";
      pos += 1;
      skipWS();

      if (pos < src.length && src[pos] === "{") {
        pos += 1;
        const branchEndStates: number[] = [];
        while (pos < src.length && src[pos] !== "}") {
          skipWS();
          if (src[pos] === ",") {
            pos += 1;
            continue;
          }
          if (src[pos] === "}") break;
          const label = readIdent();
          if (!label) {
            pos += 1;
            continue;
          }
          const branchTarget = nextState;
          nextState += 1;
          states.add(branchTarget);
          transitions.push({
            from: currentState,
            to: branchTarget,
            dir,
            label,
          });
          skipWS();
          if (src[pos] === ".") {
            pos += 1;
            branchEndStates.push(parse(branchTarget));
          } else {
            branchEndStates.push(branchTarget);
          }
          skipWS();
          if (src[pos] === ",") pos += 1;
        }
        if (src[pos] === "}") pos += 1;
        return branchEndStates.length > 0 ? branchEndStates[0] : currentState;
      }

      const label = readIdent();
      if (label) {
        const targetState = nextState;
        nextState += 1;
        states.add(targetState);
        transitions.push({ from: currentState, to: targetState, dir, label });
        skipWS();
        if (src[pos] === ".") {
          pos += 1;
          return parse(targetState);
        }
        endStates.add(targetState);
        return targetState;
      }
    } else {
      const ident = readIdent();
      const loopTarget = ident ? recVarStates.get(ident) : undefined;
      if (loopTarget !== undefined) {
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
      pos += 1;
      return parse(currentState);
    }
    return currentState;
  };

  parse(0);
  return { states, transitions, endStates };
}
