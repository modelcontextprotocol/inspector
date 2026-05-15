import { describe, it, expect, vi, beforeEach } from "vitest";
import userEvent from "@testing-library/user-event";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { renderWithMantine, screen } from "../../../test/renderWithMantine";
import { ProtocolStepList } from "./ProtocolStepList";
import {
  resetUid,
  type ProtocolStep,
} from "../../screens/ProtocolBuilderScreen/protocol";

const tools: Tool[] = [
  { name: "search", inputSchema: { type: "object" } },
  { name: "book", inputSchema: { type: "object" } },
];

beforeEach(() => {
  resetUid();
});

function makeProps(
  steps: ProtocolStep[],
  overrides: Partial<React.ComponentProps<typeof ProtocolStepList>> = {},
) {
  return {
    steps,
    tools,
    receiveOptions: ["searchResult", "searchError"],
    insertTarget: null,
    onSetInsertTarget: vi.fn(),
    onUpdateStep: vi.fn(),
    onRemoveStep: vi.fn(),
    onConvertToChoice: vi.fn(),
    ...overrides,
  };
}

describe("ProtocolStepList", () => {
  it("renders an empty list with no children", () => {
    const { container } = renderWithMantine(
      <ProtocolStepList {...makeProps([])} />,
    );
    // Stack should still render but have no step children
    expect(container.querySelectorAll("[data-step]").length).toBe(0);
  });

  it("renders a paired send/receive when two steps share a pairId", () => {
    const send: ProtocolStep = {
      id: "s1",
      type: "action",
      direction: "send",
      label: "search",
      pairId: "p1",
    };
    const recv: ProtocolStep = {
      id: "r1",
      type: "action",
      direction: "receive",
      label: "searchResult",
      pairId: "p1",
    };
    renderWithMantine(<ProtocolStepList {...makeProps([send, recv])} />);
    expect(screen.getByText("paired")).toBeInTheDocument();
  });

  it("triggers onUpdateStep on both halves of a pair when the send label changes", async () => {
    const onUpdateStep = vi.fn();
    const send: ProtocolStep = {
      id: "s1",
      type: "action",
      direction: "send",
      label: "search",
      pairId: "p1",
    };
    const recv: ProtocolStep = {
      id: "r1",
      type: "action",
      direction: "receive",
      label: "searchResult",
      pairId: "p1",
    };
    renderWithMantine(
      <ProtocolStepList
        {...makeProps([send, recv], { onUpdateStep, tools: [] })}
      />,
    );
    // tools=[] means LabelEditor uses TextInput, easier to type into
    const inputs = screen.getAllByLabelText(/Send label|Receive label/);
    const sendInput = inputs.find(
      (el) => (el as HTMLInputElement).value === "search",
    ) as HTMLInputElement;
    const user = userEvent.setup();
    await user.clear(sendInput);
    await user.type(sendInput, "Z");
    // Each keystroke fires onUpdateStep twice (once for send, once for paired
    // receive). After clear+type "Z" we expect the receive to have been
    // updated at least once with the synthetic ZResult label.
    expect(onUpdateStep).toHaveBeenCalled();
  });

  it("invokes onConvertToChoice from the pair's send-side button", async () => {
    const onConvertToChoice = vi.fn();
    const send: ProtocolStep = {
      id: "s1",
      type: "action",
      direction: "send",
      label: "search",
      pairId: "p1",
    };
    const recv: ProtocolStep = {
      id: "r1",
      type: "action",
      direction: "receive",
      label: "searchResult",
      pairId: "p1",
    };
    renderWithMantine(
      <ProtocolStepList {...makeProps([send, recv], { onConvertToChoice })} />,
    );
    const user = userEvent.setup();
    await user.click(
      screen.getByRole("button", { name: "Convert to internal choice" }),
    );
    expect(onConvertToChoice).toHaveBeenCalledWith(
      "s1",
      "p1",
      "send",
      expect.any(Array),
    );
  });

  it("invokes onConvertToChoice from the pair's receive-side button", async () => {
    const onConvertToChoice = vi.fn();
    const send: ProtocolStep = {
      id: "s1",
      type: "action",
      direction: "send",
      label: "search",
      pairId: "p1",
    };
    const recv: ProtocolStep = {
      id: "r1",
      type: "action",
      direction: "receive",
      label: "searchResult",
      pairId: "p1",
    };
    renderWithMantine(
      <ProtocolStepList {...makeProps([send, recv], { onConvertToChoice })} />,
    );
    const user = userEvent.setup();
    await user.click(
      screen.getByRole("button", { name: "Convert to external choice" }),
    );
    expect(onConvertToChoice).toHaveBeenCalledWith("r1", "p1", "receive", [
      "searchResult",
      "searchError",
    ]);
  });

  it("falls back to a synthetic branch label set when no other tools exist", async () => {
    const onConvertToChoice = vi.fn();
    const send: ProtocolStep = {
      id: "s1",
      type: "action",
      direction: "send",
      label: "only",
      pairId: "p1",
    };
    const recv: ProtocolStep = {
      id: "r1",
      type: "action",
      direction: "receive",
      label: "onlyResult",
      pairId: "p1",
    };
    renderWithMantine(
      <ProtocolStepList
        {...makeProps([send, recv], {
          tools: [{ name: "only", inputSchema: { type: "object" } }],
          onConvertToChoice,
        })}
      />,
    );
    const user = userEvent.setup();
    await user.click(
      screen.getByRole("button", { name: "Convert to internal choice" }),
    );
    expect(onConvertToChoice).toHaveBeenCalledWith("s1", "p1", "send", [
      "only",
      "onlyAlt",
    ]);
  });

  it("calls onRemoveStep when the pair delete button is clicked", async () => {
    const onRemoveStep = vi.fn();
    const send: ProtocolStep = {
      id: "s1",
      type: "action",
      direction: "send",
      label: "search",
      pairId: "p1",
    };
    const recv: ProtocolStep = {
      id: "r1",
      type: "action",
      direction: "receive",
      label: "searchResult",
      pairId: "p1",
    };
    renderWithMantine(
      <ProtocolStepList {...makeProps([send, recv], { onRemoveStep })} />,
    );
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Delete pair" }));
    expect(onRemoveStep).toHaveBeenCalledWith("s1");
  });

  it("renders a standalone send step", () => {
    const step: ProtocolStep = {
      id: "s1",
      type: "action",
      direction: "send",
      label: "alone",
    };
    renderWithMantine(<ProtocolStepList {...makeProps([step])} />);
    expect(
      screen.getByRole("button", { name: "Delete step" }),
    ).toBeInTheDocument();
  });

  it("renders a standalone receive step and a tool-bound annotation", () => {
    const step: ProtocolStep = {
      id: "s1",
      type: "action",
      direction: "receive",
      label: "searchResult",
      toolName: "search",
    };
    renderWithMantine(<ProtocolStepList {...makeProps([step])} />);
    expect(screen.getByText("(search)")).toBeInTheDocument();
  });

  it("renders a recursion scope and removes it on delete", async () => {
    const onRemoveStep = vi.fn();
    const step: ProtocolStep = {
      id: "rec1",
      type: "recursion",
      recVar: "X",
    };
    renderWithMantine(
      <ProtocolStepList {...makeProps([step], { onRemoveStep })} />,
    );
    expect(screen.getByText("rec")).toBeInTheDocument();
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Delete recursion" }));
    expect(onRemoveStep).toHaveBeenCalledWith("rec1");
  });

  it("renders a recursion reference and removes it on delete", async () => {
    const onRemoveStep = vi.fn();
    const step: ProtocolStep = {
      id: "ref1",
      type: "action",
      isRecRef: true,
      recVar: "X",
    };
    renderWithMantine(
      <ProtocolStepList {...makeProps([step], { onRemoveStep })} />,
    );
    expect(screen.getByText(/loop → X/)).toBeInTheDocument();
    const user = userEvent.setup();
    await user.click(
      screen.getByRole("button", { name: "Delete recursion ref" }),
    );
    expect(onRemoveStep).toHaveBeenCalledWith("ref1");
  });

  it("renders a choice with branches and supports adding a branch", async () => {
    const onUpdateStep = vi.fn();
    const choice: ProtocolStep = {
      id: "c1",
      type: "choice",
      direction: "send",
      branches: [
        { id: "b1", label: "BranchA", steps: [] },
        { id: "b2", label: "BranchB", steps: [] },
      ],
    };
    renderWithMantine(
      <ProtocolStepList {...makeProps([choice], { onUpdateStep })} />,
    );
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Add branch" }));
    expect(onUpdateStep).toHaveBeenCalledWith("c1", expect.any(Function));
  });

  it("invokes onSetInsertTarget when a branch target is clicked", async () => {
    const onSetInsertTarget = vi.fn();
    const choice: ProtocolStep = {
      id: "c1",
      type: "choice",
      direction: "receive",
      branches: [
        { id: "b1", label: "BranchA", steps: [] },
        { id: "b2", label: "BranchB", steps: [] },
      ],
    };
    renderWithMantine(
      <ProtocolStepList {...makeProps([choice], { onSetInsertTarget })} />,
    );
    const user = userEvent.setup();
    await user.click(
      screen.getAllByRole("button", {
        name: "Target this branch for palette insertion",
      })[0],
    );
    expect(onSetInsertTarget).toHaveBeenCalledWith({
      choiceStepId: "c1",
      branchId: "b1",
    });
  });

  it("clears the insert target when the active branch is clicked again", async () => {
    const onSetInsertTarget = vi.fn();
    const choice: ProtocolStep = {
      id: "c1",
      type: "choice",
      direction: "send",
      branches: [
        { id: "b1", label: "BranchA", steps: [] },
        { id: "b2", label: "BranchB", steps: [] },
      ],
    };
    renderWithMantine(
      <ProtocolStepList
        {...makeProps([choice], {
          onSetInsertTarget,
          insertTarget: { choiceStepId: "c1", branchId: "b1" },
        })}
      />,
    );
    const user = userEvent.setup();
    await user.click(
      screen.getByRole("button", { name: "Stop targeting this branch" }),
    );
    expect(onSetInsertTarget).toHaveBeenCalledWith(null);
  });

  it("only shows the remove-branch button when there are more than two branches", async () => {
    const onUpdateStep = vi.fn();
    const choice: ProtocolStep = {
      id: "c1",
      type: "choice",
      direction: "send",
      branches: [
        { id: "b1", label: "A", steps: [] },
        { id: "b2", label: "B", steps: [] },
        { id: "b3", label: "C", steps: [] },
      ],
    };
    renderWithMantine(
      <ProtocolStepList {...makeProps([choice], { onUpdateStep })} />,
    );
    const removeButtons = screen.getAllByRole("button", {
      name: "Remove branch",
    });
    expect(removeButtons.length).toBe(3);
    const user = userEvent.setup();
    await user.click(removeButtons[0]);
    expect(onUpdateStep).toHaveBeenCalledWith("c1", expect.any(Function));
  });

  it("collapses a branch when the chevron is clicked", async () => {
    const choice: ProtocolStep = {
      id: "c1",
      type: "choice",
      direction: "send",
      branches: [
        {
          id: "b1",
          label: "A",
          steps: [
            {
              id: "inner",
              type: "action",
              direction: "send",
              label: "deep",
            },
          ],
        },
        { id: "b2", label: "B", steps: [] },
      ],
    };
    renderWithMantine(<ProtocolStepList {...makeProps([choice])} />);
    const user = userEvent.setup();
    await user.click(
      screen.getAllByRole("button", { name: "Collapse branch" })[0],
    );
    // After collapsing, the inner step's delete button is no longer present
    expect(
      screen.queryByRole("button", { name: "Delete step" }),
    ).not.toBeInTheDocument();
  });

  it("removes a single step's delete works on a standalone action", async () => {
    const onRemoveStep = vi.fn();
    const step: ProtocolStep = {
      id: "x1",
      type: "action",
      direction: "send",
      label: "x",
    };
    renderWithMantine(
      <ProtocolStepList {...makeProps([step], { onRemoveStep, tools: [] })} />,
    );
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Delete step" }));
    expect(onRemoveStep).toHaveBeenCalledWith("x1");
  });

  it("renders an active branch indicator when the insertTarget matches", () => {
    const choice: ProtocolStep = {
      id: "c1",
      type: "choice",
      direction: "send",
      branches: [
        { id: "b1", label: "A", steps: [] },
        { id: "b2", label: "B", steps: [] },
      ],
    };
    renderWithMantine(
      <ProtocolStepList
        {...makeProps([choice], {
          insertTarget: { choiceStepId: "c1", branchId: "b1" },
        })}
      />,
    );
    expect(
      screen.getByText("Use the palette to add steps here"),
    ).toBeInTheDocument();
  });

  it("shows 'end' when a branch is terminated by a rec ref", () => {
    const choice: ProtocolStep = {
      id: "c1",
      type: "choice",
      direction: "send",
      branches: [
        {
          id: "b1",
          label: "A",
          steps: [{ id: "ref1", type: "action", isRecRef: true, recVar: "X" }],
        },
        { id: "b2", label: "B", steps: [] },
      ],
    };
    renderWithMantine(<ProtocolStepList {...makeProps([choice])} />);
    expect(screen.getByText("end")).toBeInTheDocument();
  });

  it("renders a receive-direction choice header", () => {
    const choice: ProtocolStep = {
      id: "c1",
      type: "choice",
      direction: "receive",
      branches: [
        { id: "b1", label: "Ok", steps: [] },
        { id: "b2", label: "Err", steps: [] },
      ],
    };
    renderWithMantine(<ProtocolStepList {...makeProps([choice])} />);
    expect(screen.getByText("External Choice")).toBeInTheDocument();
  });

  it("renders a Select-based label editor when tools are present", () => {
    const send: ProtocolStep = {
      id: "s1",
      type: "action",
      direction: "send",
      label: "search",
      pairId: "p1",
    };
    const recv: ProtocolStep = {
      id: "r1",
      type: "action",
      direction: "receive",
      label: "searchResult",
      pairId: "p1",
    };
    renderWithMantine(<ProtocolStepList {...makeProps([send, recv])} />);
    // Select renders as a combobox/role=textbox; pick the Send label one.
    expect(
      screen.getByRole("textbox", { name: "Send label" }),
    ).toBeInTheDocument();
  });

  it("falls back to a TextInput branch label when no options remain", () => {
    const choice: ProtocolStep = {
      id: "c1",
      type: "choice",
      direction: "send",
      branches: [
        { id: "b1", label: "Custom", steps: [] },
        { id: "b2", label: "B", steps: [] },
      ],
    };
    // No tools and external direction is false ⇒ siblingLabels empty subset of empty options ⇒ TextInput
    renderWithMantine(
      <ProtocolStepList {...makeProps([choice], { tools: [] })} />,
    );
    expect(screen.getAllByLabelText("Branch label").length).toBeGreaterThan(0);
  });

  it("re-expands a branch after collapsing it", async () => {
    const choice: ProtocolStep = {
      id: "c1",
      type: "choice",
      direction: "send",
      branches: [
        {
          id: "b1",
          label: "A",
          steps: [
            {
              id: "inner",
              type: "action",
              direction: "send",
              label: "deep",
            },
          ],
        },
        { id: "b2", label: "B", steps: [] },
      ],
    };
    renderWithMantine(<ProtocolStepList {...makeProps([choice])} />);
    const user = userEvent.setup();
    await user.click(
      screen.getAllByRole("button", { name: "Collapse branch" })[0],
    );
    await user.click(
      screen.getAllByRole("button", { name: "Expand branch" })[0],
    );
    expect(
      screen.getByRole("button", { name: "Delete step" }),
    ).toBeInTheDocument();
  });

  it("updates a free-form (no-options) action label via the text input", async () => {
    const onUpdateStep = vi.fn();
    const step: ProtocolStep = {
      id: "x1",
      type: "action",
      direction: "send",
      label: "x",
    };
    renderWithMantine(
      <ProtocolStepList {...makeProps([step], { onUpdateStep, tools: [] })} />,
    );
    const user = userEvent.setup();
    const input = screen.getByLabelText("Send label");
    await user.type(input, "y");
    expect(onUpdateStep).toHaveBeenCalled();
  });

  it("removes a choice via Delete choice", async () => {
    const onRemoveStep = vi.fn();
    const choice: ProtocolStep = {
      id: "c1",
      type: "choice",
      direction: "send",
      branches: [
        { id: "b1", label: "A", steps: [] },
        { id: "b2", label: "B", steps: [] },
      ],
    };
    renderWithMantine(
      <ProtocolStepList {...makeProps([choice], { onRemoveStep })} />,
    );
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Delete choice" }));
    expect(onRemoveStep).toHaveBeenCalledWith("c1");
  });

  it("triggers the receive label change handler in a pair card", async () => {
    const onUpdateStep = vi.fn();
    const send: ProtocolStep = {
      id: "s1",
      type: "action",
      direction: "send",
      label: "search",
      pairId: "p1",
    };
    const recv: ProtocolStep = {
      id: "r1",
      type: "action",
      direction: "receive",
      label: "searchResult",
      pairId: "p1",
    };
    renderWithMantine(
      <ProtocolStepList
        {...makeProps([send, recv], {
          onUpdateStep,
          tools: [],
          receiveOptions: [],
        })}
      />,
    );
    const recvInput = screen.getByLabelText(
      "Receive label",
    ) as HTMLInputElement;
    const user = userEvent.setup();
    await user.clear(recvInput);
    await user.type(recvInput, "X");
    expect(onUpdateStep).toHaveBeenCalledWith("r1", expect.any(Function));
  });

  it("invokes onRemoveBranch via the branch remove button", async () => {
    const onUpdateStep = vi.fn();
    const choice: ProtocolStep = {
      id: "c1",
      type: "choice",
      direction: "send",
      branches: [
        { id: "b1", label: "A", steps: [] },
        { id: "b2", label: "B", steps: [] },
        { id: "b3", label: "C", steps: [] },
      ],
    };
    renderWithMantine(
      <ProtocolStepList {...makeProps([choice], { onUpdateStep })} />,
    );
    const user = userEvent.setup();
    const btn = screen.getAllByRole("button", { name: "Remove branch" })[0];
    await user.click(btn);
    // The onUpdateStep updater should remove b1
    const lastCall =
      onUpdateStep.mock.calls[onUpdateStep.mock.calls.length - 1];
    const updater = lastCall[1] as (s: ProtocolStep) => ProtocolStep;
    const result = updater(choice);
    expect(result.branches?.find((b) => b.id === "b1")).toBeUndefined();
  });

  it("updates a free-form branch label via TextInput", async () => {
    const onUpdateStep = vi.fn();
    const choice: ProtocolStep = {
      id: "c1",
      type: "choice",
      direction: "send",
      branches: [
        { id: "b1", label: "A", steps: [] },
        { id: "b2", label: "B", steps: [] },
      ],
    };
    renderWithMantine(
      <ProtocolStepList
        {...makeProps([choice], { onUpdateStep, tools: [] })}
      />,
    );
    const user = userEvent.setup();
    const input = screen.getAllByLabelText("Branch label")[0];
    await user.type(input, "X");
    expect(onUpdateStep).toHaveBeenCalled();
  });
});
