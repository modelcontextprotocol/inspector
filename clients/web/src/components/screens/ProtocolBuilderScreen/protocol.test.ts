import { describe, it, expect, beforeEach } from "vitest";
import {
  addStepToBranch,
  collectRecVars,
  collectSendLabels,
  convertPairToChoice,
  deriveReceiveOptions,
  findBranchLabel,
  findPairId,
  generatePythonSnippet,
  isBranchTerminated,
  isTerminated,
  parseToFSM,
  removeStepDeep,
  resetUid,
  stepsToProtocol,
  uid,
  updateStepDeep,
  type ProtocolStep,
} from "./protocol";

beforeEach(() => {
  resetUid();
});

function send(label: string, opts: Partial<ProtocolStep> = {}): ProtocolStep {
  return { id: uid(), type: "action", direction: "send", label, ...opts };
}
function recv(label: string, opts: Partial<ProtocolStep> = {}): ProtocolStep {
  return { id: uid(), type: "action", direction: "receive", label, ...opts };
}

describe("uid", () => {
  it("returns sequential, unique ids", () => {
    expect(uid()).toBe("step-1");
    expect(uid()).toBe("step-2");
  });
});

describe("stepsToProtocol", () => {
  it("returns 'end' for an empty step list", () => {
    expect(stepsToProtocol([])).toBe("end");
  });

  it("renders a simple send/receive sequence", () => {
    const steps = [send("Search"), recv("SearchResult")];
    expect(stepsToProtocol(steps)).toBe("!Search.?SearchResult.end");
  });

  it("renders a rec-ref instead of an action label", () => {
    const steps: ProtocolStep[] = [
      { id: uid(), type: "action", isRecRef: true, recVar: "X" },
    ];
    expect(stepsToProtocol(steps)).toBe("X.end");
  });

  it("renders an internal choice with branches", () => {
    const choice: ProtocolStep = {
      id: uid(),
      type: "choice",
      direction: "send",
      branches: [
        { id: uid(), label: "Yes", steps: [send("Confirm")] },
        { id: uid(), label: "No", steps: [] },
      ],
    };
    expect(stepsToProtocol([choice])).toBe("!{Yes.!Confirm.end, No}.end");
  });

  it("renders an external choice", () => {
    const choice: ProtocolStep = {
      id: uid(),
      type: "choice",
      direction: "receive",
      branches: [
        { id: uid(), label: "Ok", steps: [] },
        { id: uid(), label: "Err", steps: [] },
      ],
    };
    expect(stepsToProtocol([choice])).toBe("?{Ok, Err}.end");
  });

  it("renders a recursion scope wrapping the tail", () => {
    const steps: ProtocolStep[] = [
      { id: uid(), type: "recursion", recVar: "X" },
      send("Ping"),
      recv("Pong"),
      { id: uid(), type: "action", isRecRef: true, recVar: "X" },
    ];
    expect(stepsToProtocol(steps)).toBe("rec X.!Ping.?Pong.X.end");
  });

  it("renders content before a recursion as part of the prefix", () => {
    const steps: ProtocolStep[] = [
      send("Init"),
      { id: uid(), type: "recursion", recVar: "X" },
      send("Ping"),
    ];
    expect(stepsToProtocol(steps)).toBe("!Init.rec X.!Ping.end");
  });

  it("treats an empty receive label as a missing label string", () => {
    const steps: ProtocolStep[] = [
      { id: uid(), type: "action", direction: "receive" },
    ];
    expect(stepsToProtocol(steps)).toBe("?.end");
  });
});

describe("generatePythonSnippet", () => {
  it("embeds the protocol DSL", () => {
    const snippet = generatePythonSnippet("!A.?B.end");
    expect(snippet).toContain('protocol = "!A.?B.end"');
    expect(snippet).toContain("ToolMiddleware");
  });
});

describe("updateStepDeep", () => {
  it("updates a step at the top level", () => {
    const a = send("A");
    const result = updateStepDeep([a], a.id, (s) => ({ ...s, label: "Z" }));
    expect(result[0].label).toBe("Z");
  });

  it("updates a step nested inside a branch", () => {
    const inner = send("X");
    const choice: ProtocolStep = {
      id: uid(),
      type: "choice",
      direction: "send",
      branches: [{ id: uid(), label: "B", steps: [inner] }],
    };
    const result = updateStepDeep([choice], inner.id, (s) => ({
      ...s,
      label: "Y",
    }));
    expect(result[0].branches?.[0].steps[0].label).toBe("Y");
  });

  it("returns the same step when not the target and no branches", () => {
    const a = send("A");
    const result = updateStepDeep([a], "missing", (s) => s);
    expect(result[0]).toBe(a);
  });
});

describe("findPairId / removeStepDeep", () => {
  it("finds the pair id of a step", () => {
    const pair = "p1";
    const a = send("A", { pairId: pair });
    const b = recv("AResult", { pairId: pair });
    expect(findPairId([a, b], a.id)).toBe(pair);
  });

  it("returns undefined for a missing step", () => {
    expect(findPairId([send("A")], "missing")).toBeUndefined();
  });

  it("finds a pair id nested in a branch", () => {
    const inner = send("Inner", { pairId: "pX" });
    const choice: ProtocolStep = {
      id: uid(),
      type: "choice",
      direction: "send",
      branches: [{ id: uid(), label: "B", steps: [inner] }],
    };
    expect(findPairId([choice], inner.id)).toBe("pX");
  });

  it("removes both halves of a pair", () => {
    const pair = "p1";
    const a = send("A", { pairId: pair });
    const b = recv("AResult", { pairId: pair });
    const c = send("C");
    const result = removeStepDeep([a, b, c], a.id);
    expect(result).toEqual([c]);
  });

  it("removes a single unpaired step", () => {
    const a = send("A");
    const b = send("B");
    const result = removeStepDeep([a, b], a.id);
    expect(result.map((s) => s.label)).toEqual(["B"]);
  });

  it("recurses into branches when removing", () => {
    const inner = send("X");
    const choice: ProtocolStep = {
      id: uid(),
      type: "choice",
      direction: "send",
      branches: [{ id: uid(), label: "B", steps: [inner] }],
    };
    const result = removeStepDeep([choice], inner.id);
    expect(result[0].branches?.[0].steps).toEqual([]);
  });
});

describe("addStepToBranch", () => {
  it("appends a step to a branch by id", () => {
    const choice: ProtocolStep = {
      id: uid(),
      type: "choice",
      direction: "send",
      branches: [{ id: "b1", label: "B", steps: [] }],
    };
    const newStep = send("X");
    const result = addStepToBranch([choice], choice.id, "b1", newStep);
    expect(result[0].branches?.[0].steps[0]).toBe(newStep);
  });

  it("recurses into nested branches", () => {
    const innerChoice: ProtocolStep = {
      id: "inner",
      type: "choice",
      direction: "send",
      branches: [{ id: "ib", label: "IB", steps: [] }],
    };
    const outer: ProtocolStep = {
      id: "outer",
      type: "choice",
      direction: "send",
      branches: [{ id: "ob", label: "OB", steps: [innerChoice] }],
    };
    const newStep = send("X");
    const result = addStepToBranch([outer], "inner", "ib", newStep);
    const ib = result[0].branches?.[0].steps[0].branches?.[0];
    expect(ib?.steps[0]).toBe(newStep);
  });

  it("leaves unrelated steps untouched", () => {
    const a = send("A");
    expect(addStepToBranch([a], "x", "y", send("Z"))[0]).toBe(a);
  });
});

describe("isTerminated / isBranchTerminated", () => {
  it("returns false for an empty list", () => {
    expect(isTerminated([])).toBe(false);
  });

  it("returns true when the last step is a choice", () => {
    const choice: ProtocolStep = {
      id: uid(),
      type: "choice",
      direction: "send",
      branches: [],
    };
    expect(isTerminated([choice])).toBe(true);
  });

  it("returns true when the last step is a rec ref", () => {
    const ref: ProtocolStep = {
      id: uid(),
      type: "action",
      isRecRef: true,
      recVar: "X",
    };
    expect(isTerminated([ref])).toBe(true);
  });

  it("returns false when the last step is a plain action", () => {
    expect(isTerminated([send("A")])).toBe(false);
  });

  it("returns false when the last step is a recursion scope opener", () => {
    const recOpen: ProtocolStep = {
      id: uid(),
      type: "recursion",
      recVar: "X",
    };
    expect(isTerminated([recOpen])).toBe(false);
  });

  it("checks a branch by id", () => {
    const choice: ProtocolStep = {
      id: "c",
      type: "choice",
      direction: "send",
      branches: [
        {
          id: "b1",
          label: "B",
          steps: [{ id: uid(), type: "action", isRecRef: true, recVar: "X" }],
        },
        { id: "b2", label: "B2", steps: [send("A")] },
      ],
    };
    expect(isBranchTerminated([choice], "c", "b1")).toBe(true);
    expect(isBranchTerminated([choice], "c", "b2")).toBe(false);
  });

  it("returns false when the choice or branch is missing", () => {
    expect(isBranchTerminated([send("A")], "x", "y")).toBe(false);
  });

  it("recurses into nested branches", () => {
    const inner: ProtocolStep = {
      id: "inner",
      type: "choice",
      direction: "send",
      branches: [{ id: "ib", label: "IB", steps: [send("Ok")] }],
    };
    const outer: ProtocolStep = {
      id: "outer",
      type: "choice",
      direction: "send",
      branches: [{ id: "ob", label: "OB", steps: [inner] }],
    };
    expect(isBranchTerminated([outer], "inner", "ib")).toBe(false);
  });
});

describe("collectRecVars / collectSendLabels / deriveReceiveOptions", () => {
  it("collects recursion variables from nested branches", () => {
    const innerRec: ProtocolStep = {
      id: uid(),
      type: "recursion",
      recVar: "Y",
    };
    const choice: ProtocolStep = {
      id: uid(),
      type: "choice",
      direction: "send",
      branches: [{ id: uid(), label: "B", steps: [innerRec] }],
    };
    const outerRec: ProtocolStep = {
      id: uid(),
      type: "recursion",
      recVar: "X",
    };
    expect(collectRecVars([outerRec, choice])).toEqual(["X", "Y"]);
  });

  it("collects unique send labels excluding rec refs", () => {
    const ref: ProtocolStep = {
      id: uid(),
      type: "action",
      isRecRef: true,
      recVar: "X",
    };
    const steps = [send("A"), send("A"), recv("AResult"), ref];
    expect(collectSendLabels(steps)).toEqual(["A"]);
  });

  it("collects send labels nested in branches", () => {
    const choice: ProtocolStep = {
      id: uid(),
      type: "choice",
      direction: "send",
      branches: [{ id: uid(), label: "B", steps: [send("Inner")] }],
    };
    expect(collectSendLabels([choice])).toEqual(["Inner"]);
  });

  it("derives receive options from send labels", () => {
    expect(deriveReceiveOptions(["Search"])).toEqual([
      "SearchResult",
      "SearchError",
    ]);
  });
});

describe("findBranchLabel", () => {
  it("returns the matching branch label", () => {
    const choice: ProtocolStep = {
      id: "c",
      type: "choice",
      direction: "send",
      branches: [{ id: "b", label: "Hit", steps: [] }],
    };
    expect(
      findBranchLabel([choice], { choiceStepId: "c", branchId: "b" }),
    ).toBe("Hit");
  });

  it("returns null when the target is missing", () => {
    expect(
      findBranchLabel([send("A")], { choiceStepId: "x", branchId: "y" }),
    ).toBeNull();
  });

  it("returns null when the choice exists but the branch does not", () => {
    const choice: ProtocolStep = {
      id: "c",
      type: "choice",
      direction: "send",
      branches: [{ id: "b", label: "Hit", steps: [] }],
    };
    expect(
      findBranchLabel([choice], { choiceStepId: "c", branchId: "missing" }),
    ).toBeNull();
  });

  it("recurses into nested branches", () => {
    const inner: ProtocolStep = {
      id: "inner",
      type: "choice",
      direction: "send",
      branches: [{ id: "ib", label: "Deep", steps: [] }],
    };
    const outer: ProtocolStep = {
      id: "outer",
      type: "choice",
      direction: "send",
      branches: [{ id: "ob", label: "Outer", steps: [inner] }],
    };
    expect(
      findBranchLabel([outer], { choiceStepId: "inner", branchId: "ib" }),
    ).toBe("Deep");
  });
});

describe("convertPairToChoice", () => {
  it("converts the targeted step to a choice and unpairs its partner", () => {
    const pair = "p1";
    const a = send("A", { pairId: pair });
    const b = recv("AResult", { pairId: pair });
    const result = convertPairToChoice([a, b], a.id, pair, "send", ["X", "Y"]);
    expect(result[0].type).toBe("choice");
    expect(result[0].branches?.map((br) => br.label)).toEqual(["X", "Y"]);
    expect(result[1].pairId).toBeUndefined();
  });

  it("recurses into branches", () => {
    const pair = "p1";
    const inner = send("A", { pairId: pair });
    const partner = recv("AResult", { pairId: pair });
    const choice: ProtocolStep = {
      id: uid(),
      type: "choice",
      direction: "send",
      branches: [{ id: uid(), label: "B", steps: [inner, partner] }],
    };
    const result = convertPairToChoice([choice], inner.id, pair, "send", ["X"]);
    expect(result[0].branches?.[0].steps[0].type).toBe("choice");
  });

  it("leaves unrelated steps untouched", () => {
    const c = send("C");
    expect(convertPairToChoice([c], "missing", "p", "send", ["A"])[0]).toBe(c);
  });
});

describe("parseToFSM", () => {
  it("returns just the start state for an empty protocol", () => {
    const fsm = parseToFSM("");
    expect(fsm.states.has(0)).toBe(true);
    expect(fsm.endStates.has(0)).toBe(true);
  });

  it("treats a literal 'end' as a terminal state", () => {
    const fsm = parseToFSM("end");
    expect(fsm.endStates.has(0)).toBe(true);
  });

  it("creates a transition for a single send", () => {
    const fsm = parseToFSM("!A.end");
    expect(fsm.transitions).toEqual([
      { from: 0, to: 1, dir: "send", label: "A" },
    ]);
    expect(fsm.endStates.has(1)).toBe(true);
  });

  it("creates a transition for a single receive", () => {
    const fsm = parseToFSM("?B.end");
    expect(fsm.transitions[0].dir).toBe("receive");
  });

  it("emits one outgoing edge per branch in a choice", () => {
    const fsm = parseToFSM("!{Yes.!Done.end, No.end}");
    const fromStart = fsm.transitions.filter((t) => t.from === 0);
    expect(fromStart.map((t) => t.label).sort()).toEqual(["No", "Yes"]);
  });

  it("emits a loop transition for a rec reference", () => {
    const fsm = parseToFSM("rec X.!Ping.?Pong.X");
    const loop = fsm.transitions.find((t) => t.dir === "loop");
    expect(loop?.label).toBe("X");
    expect(loop?.to).toBe(0);
  });

  it("ignores stray identifiers that aren't bound recursion vars", () => {
    const fsm = parseToFSM("Bogus");
    expect(fsm.transitions).toEqual([]);
  });

  it("handles a choice with no labels gracefully", () => {
    const fsm = parseToFSM("!{}");
    expect(fsm.transitions).toEqual([]);
  });

  it("handles a choice with only commas / whitespace", () => {
    const fsm = parseToFSM("!{ , , }");
    expect(fsm.transitions).toEqual([]);
  });

  it("handles a send/receive prefix with no following label", () => {
    const fsm = parseToFSM("!");
    expect(fsm.transitions).toEqual([]);
  });

  it("handles trailing dots without crashing", () => {
    const fsm = parseToFSM("!A.");
    expect(fsm.transitions[0]).toEqual({
      from: 0,
      to: 1,
      dir: "send",
      label: "A",
    });
  });
});
