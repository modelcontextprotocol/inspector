import { describe, it, expect, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import type { Root } from "@modelcontextprotocol/sdk/types.js";
import { renderWithMantine, screen } from "../../../test/renderWithMantine";
import { RootsTable } from "./RootsTable";

const sampleRoots: Root[] = [
  { name: "Project Source", uri: "file:///home/user/project/src" },
  { name: "Configuration", uri: "file:///home/user/project/config" },
];

const baseProps = {
  roots: sampleRoots,
  newRootDraft: { name: "", uri: "" },
  onRemoveRoot: vi.fn(),
  onNewRootDraftChange: vi.fn(),
  onAddRoot: vi.fn(),
  onBrowse: vi.fn(),
};

describe("RootsTable", () => {
  it("renders the title, hint, and warning alert", () => {
    renderWithMantine(<RootsTable {...baseProps} />);
    expect(screen.getByText("Roots Configuration")).toBeInTheDocument();
    expect(
      screen.getByText("Filesystem roots exposed to the connected server:"),
    ).toBeInTheDocument();
    expect(screen.getByText("Warning")).toBeInTheDocument();
  });

  it("renders the roots table with provided roots", () => {
    renderWithMantine(<RootsTable {...baseProps} />);
    expect(screen.getByText("Project Source")).toBeInTheDocument();
    expect(
      screen.getByText("file:///home/user/project/src"),
    ).toBeInTheDocument();
    expect(screen.getByText("Configuration")).toBeInTheDocument();
  });

  it("does not render the table when roots is empty", () => {
    renderWithMantine(<RootsTable {...baseProps} roots={[]} />);
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("invokes onRemoveRoot when an X icon is clicked", async () => {
    const user = userEvent.setup();
    const onRemoveRoot = vi.fn();
    renderWithMantine(
      <RootsTable {...baseProps} onRemoveRoot={onRemoveRoot} />,
    );
    const removes = screen.getAllByRole("button", { name: "X" });
    await user.click(removes[0]);
    expect(onRemoveRoot).toHaveBeenCalledWith("file:///home/user/project/src");
  });

  it("invokes onAddRoot when the + Add Root button is clicked", async () => {
    const user = userEvent.setup();
    const onAddRoot = vi.fn();
    renderWithMantine(<RootsTable {...baseProps} onAddRoot={onAddRoot} />);
    await user.click(screen.getByRole("button", { name: "+ Add Root" }));
    expect(onAddRoot).toHaveBeenCalledTimes(1);
  });

  it("invokes onAddRoot when the bottom Add button is clicked", async () => {
    const user = userEvent.setup();
    const onAddRoot = vi.fn();
    renderWithMantine(<RootsTable {...baseProps} onAddRoot={onAddRoot} />);
    await user.click(screen.getByRole("button", { name: "Add" }));
    expect(onAddRoot).toHaveBeenCalledTimes(1);
  });

  it("invokes onBrowse when Browse is clicked", async () => {
    const user = userEvent.setup();
    const onBrowse = vi.fn();
    renderWithMantine(<RootsTable {...baseProps} onBrowse={onBrowse} />);
    await user.click(screen.getByRole("button", { name: "Browse" }));
    expect(onBrowse).toHaveBeenCalledTimes(1);
  });

  it("invokes onNewRootDraftChange when typing into the Name input", async () => {
    const user = userEvent.setup();
    const onNewRootDraftChange = vi.fn();
    renderWithMantine(
      <RootsTable {...baseProps} onNewRootDraftChange={onNewRootDraftChange} />,
    );
    await user.type(screen.getByLabelText("Name"), "x");
    expect(onNewRootDraftChange).toHaveBeenCalledWith({ name: "x", uri: "" });
  });

  it("invokes onNewRootDraftChange when typing into the URI input", async () => {
    const user = userEvent.setup();
    const onNewRootDraftChange = vi.fn();
    renderWithMantine(
      <RootsTable {...baseProps} onNewRootDraftChange={onNewRootDraftChange} />,
    );
    await user.type(screen.getByLabelText("URI"), "y");
    expect(onNewRootDraftChange).toHaveBeenCalledWith({ name: "", uri: "y" });
  });

  it("renders the current draft values in the inputs", () => {
    renderWithMantine(
      <RootsTable
        {...baseProps}
        newRootDraft={{ name: "Test", uri: "file:///t" }}
      />,
    );
    expect(screen.getByDisplayValue("Test")).toBeInTheDocument();
    expect(screen.getByDisplayValue("file:///t")).toBeInTheDocument();
  });
});
