import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import userEvent from "@testing-library/user-event";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { renderWithMantine, screen } from "../../../test/renderWithMantine";
import { ProtocolBuilderScreen } from "./ProtocolBuilderScreen";
import { resetUid } from "./protocol";

const tools: Tool[] = [
  { name: "search", inputSchema: { type: "object" } },
  { name: "book", inputSchema: { type: "object" } },
];

const baseProps = {
  tools,
  listChanged: false,
  onRefreshTools: vi.fn(),
};

beforeEach(() => {
  resetUid();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("ProtocolBuilderScreen", () => {
  it("renders the empty drop hint when no steps have been added", () => {
    renderWithMantine(<ProtocolBuilderScreen {...baseProps} />);
    expect(
      screen.getByText(
        "Click tools or constructs on the left to build your protocol",
      ),
    ).toBeInTheDocument();
  });

  it("renders all available MCP tools in the palette", () => {
    renderWithMantine(<ProtocolBuilderScreen {...baseProps} />);
    expect(screen.getByText("search")).toBeInTheDocument();
    expect(screen.getByText("book")).toBeInTheDocument();
    expect(screen.getByText("Available Tools (2)")).toBeInTheDocument();
  });

  it("adds a paired send/receive when a tool is clicked", async () => {
    const user = userEvent.setup();
    renderWithMantine(<ProtocolBuilderScreen {...baseProps} />);
    await user.click(screen.getByRole("button", { name: /search/ }));
    expect(screen.getAllByDisplayValue("search").length).toBeGreaterThan(0);
    expect(screen.getAllByDisplayValue("searchResult").length).toBeGreaterThan(
      0,
    );
  });

  it("offers a List Tools button when the tools list is empty", async () => {
    const user = userEvent.setup();
    const onRefreshTools = vi.fn();
    renderWithMantine(
      <ProtocolBuilderScreen
        {...baseProps}
        tools={[]}
        onRefreshTools={onRefreshTools}
      />,
    );
    await user.click(screen.getByRole("button", { name: "List Tools" }));
    expect(onRefreshTools).toHaveBeenCalled();
  });

  it("adds an internal choice and renders its branch labels", async () => {
    const user = userEvent.setup();
    renderWithMantine(<ProtocolBuilderScreen {...baseProps} />);
    await user.click(screen.getByRole("button", { name: /Internal Choice/ }));
    // The palette button and the choice header both read "Internal Choice"
    expect(screen.getAllByText("Internal Choice").length).toBeGreaterThan(1);
    expect(
      screen.getAllByDisplayValue(/BranchA|BranchB/).length,
    ).toBeGreaterThan(0);
  });

  it("adds an external choice", async () => {
    const user = userEvent.setup();
    renderWithMantine(<ProtocolBuilderScreen {...baseProps} />);
    await user.click(screen.getByRole("button", { name: /External Choice/ }));
    expect(screen.getAllByText("External Choice").length).toBeGreaterThan(1);
  });

  it("adds a recursion scope and exposes a loop-back palette button", async () => {
    const user = userEvent.setup();
    renderWithMantine(<ProtocolBuilderScreen {...baseProps} />);
    await user.click(screen.getByRole("button", { name: /^rec Recursion$/ }));
    expect(
      screen.getByRole("button", { name: /Loop back to X0/ }),
    ).toBeInTheDocument();
  });

  it("adds a generic send/receive pair", async () => {
    const user = userEvent.setup();
    renderWithMantine(<ProtocolBuilderScreen {...baseProps} />);
    await user.click(
      screen.getByRole("button", { name: /Send \/ Receive Pair/ }),
    );
    expect(screen.getAllByDisplayValue("Action").length).toBeGreaterThan(0);
    expect(screen.getAllByDisplayValue("ActionResult").length).toBeGreaterThan(
      0,
    );
  });

  it("clears all steps when Clear is clicked", async () => {
    const user = userEvent.setup();
    renderWithMantine(<ProtocolBuilderScreen {...baseProps} />);
    await user.click(
      screen.getByRole("button", { name: /Send \/ Receive Pair/ }),
    );
    await user.click(screen.getByRole("button", { name: /^Clear$/ }));
    expect(
      screen.getByText(
        "Click tools or constructs on the left to build your protocol",
      ),
    ).toBeInTheDocument();
  });

  it("copies the DSL to the clipboard and flashes 'Copied!'", async () => {
    const writeText = vi
      .spyOn(navigator.clipboard, "writeText")
      .mockResolvedValue(undefined);
    const user = userEvent.setup();
    renderWithMantine(<ProtocolBuilderScreen {...baseProps} />);
    await user.click(screen.getByRole("button", { name: /search/ }));
    const copyDsl = screen.getAllByRole("button", { name: /^Copy$/ })[0];
    await user.click(copyDsl);
    expect(writeText).toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Copied!" })).toBeInTheDocument();
  });

  it("copies the Python snippet via the second copy button", async () => {
    const writeText = vi
      .spyOn(navigator.clipboard, "writeText")
      .mockResolvedValue(undefined);
    const user = userEvent.setup();
    renderWithMantine(<ProtocolBuilderScreen {...baseProps} />);
    const copyButtons = screen.getAllByRole("button", { name: /^Copy$/ });
    await user.click(copyButtons[1]);
    expect(writeText).toHaveBeenCalled();
  });

  it("loops back via a loop-back palette button after recursion is added", async () => {
    const user = userEvent.setup();
    renderWithMantine(<ProtocolBuilderScreen {...baseProps} />);
    await user.click(screen.getByRole("button", { name: /^rec Recursion$/ }));
    await user.click(screen.getByRole("button", { name: /Loop back to X0/ }));
    expect(screen.getByText(/loop → X0/)).toBeInTheDocument();
  });

  it("removes a step via its delete button", async () => {
    const user = userEvent.setup();
    renderWithMantine(<ProtocolBuilderScreen {...baseProps} />);
    await user.click(
      screen.getByRole("button", { name: /Send \/ Receive Pair/ }),
    );
    await user.click(screen.getByRole("button", { name: "Delete pair" }));
    expect(
      screen.getByText(
        "Click tools or constructs on the left to build your protocol",
      ),
    ).toBeInTheDocument();
  });

  it("converts a paired send into an internal choice via the pair button", async () => {
    const user = userEvent.setup();
    renderWithMantine(<ProtocolBuilderScreen {...baseProps} />);
    await user.click(screen.getByRole("button", { name: /search/ }));
    await user.click(
      screen.getByRole("button", { name: "Convert to internal choice" }),
    );
    expect(screen.getAllByText("Internal Choice").length).toBeGreaterThan(1);
  });

  it("adds an internal choice and adds steps to a branch via insert target", async () => {
    const user = userEvent.setup();
    renderWithMantine(<ProtocolBuilderScreen {...baseProps} />);
    await user.click(screen.getByRole("button", { name: /Internal Choice/ }));
    await user.click(
      screen.getAllByRole("button", {
        name: "Target this branch for palette insertion",
      })[0],
    );
    // Insert-target banner shown
    expect(screen.getByText(/Adding to:/)).toBeInTheDocument();
    // Adding a tool now goes into the targeted branch
    await user.click(screen.getByRole("button", { name: /search/ }));
    expect(screen.getAllByDisplayValue("search").length).toBeGreaterThan(0);
  });

  it("clears the insert target via the banner's clear button", async () => {
    const user = userEvent.setup();
    renderWithMantine(<ProtocolBuilderScreen {...baseProps} />);
    await user.click(screen.getByRole("button", { name: /Internal Choice/ }));
    await user.click(
      screen.getAllByRole("button", {
        name: "Target this branch for palette insertion",
      })[0],
    );
    await user.click(
      screen.getByRole("button", { name: "Clear insert target" }),
    );
    expect(screen.queryByText(/Adding to:/)).not.toBeInTheDocument();
  });

  it("adds a recursion inside a targeted branch", async () => {
    const user = userEvent.setup();
    renderWithMantine(<ProtocolBuilderScreen {...baseProps} />);
    await user.click(screen.getByRole("button", { name: /Internal Choice/ }));
    await user.click(
      screen.getAllByRole("button", {
        name: "Target this branch for palette insertion",
      })[0],
    );
    await user.click(screen.getByRole("button", { name: /^rec Recursion$/ }));
    // Loop-back palette button now appears for the new rec var
    expect(
      screen.getByRole("button", { name: /Loop back to X0/ }),
    ).toBeInTheDocument();
  });

  it("updates a step label by typing into its text input", async () => {
    const user = userEvent.setup();
    // tools=[] forces TextInput rather than Select for the label editor
    renderWithMantine(<ProtocolBuilderScreen {...baseProps} tools={[]} />);
    await user.click(
      screen.getByRole("button", { name: /Send \/ Receive Pair/ }),
    );
    const sendInput = screen.getByLabelText("Send label") as HTMLInputElement;
    await user.clear(sendInput);
    await user.type(sendInput, "Z");
    expect(sendInput.value).toBe("Z");
  });

  it("triggers a download with the protocol contents", async () => {
    const user = userEvent.setup();
    const createUrl = vi
      .spyOn(URL, "createObjectURL")
      .mockReturnValue("blob:mock");
    const revokeUrl = vi.spyOn(URL, "revokeObjectURL").mockReturnValue();
    const click = vi.fn();
    vi.spyOn(document, "createElement").mockImplementation((tag) => {
      if (tag === "a") {
        const anchor = {
          href: "",
          download: "",
          click,
        } as unknown as HTMLAnchorElement;
        return anchor;
      }
      return document.implementation.createHTMLDocument().createElement(tag);
    });
    renderWithMantine(<ProtocolBuilderScreen {...baseProps} />);
    await user.click(
      screen.getByRole("button", { name: /Download Python File/ }),
    );
    expect(createUrl).toHaveBeenCalled();
    expect(click).toHaveBeenCalled();
    expect(revokeUrl).toHaveBeenCalledWith("blob:mock");
  });
});
