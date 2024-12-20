import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import RootsTab from "../../components/RootsTab";
import { Tabs } from "@/components/ui/tabs";
import type { Root } from "@modelcontextprotocol/sdk/types.js";

describe("RootsTab", () => {
  const mockRoots: Root[] = [
    { uri: "file:///test/path1", name: "test1" },
    { uri: "file:///test/path2", name: "test2" },
  ];

  const defaultProps = {
    roots: mockRoots,
    setRoots: vi.fn(),
    onRootsChange: vi.fn(),
  };

  const renderWithTabs = (component: React.ReactElement) => {
    return render(<Tabs defaultValue="roots">{component}</Tabs>);
  };

  it("renders list of roots", () => {
    renderWithTabs(<RootsTab {...defaultProps} />);
    expect(screen.getByDisplayValue("file:///test/path1")).toBeInTheDocument();
    expect(screen.getByDisplayValue("file:///test/path2")).toBeInTheDocument();
  });

  it("adds a new root when Add Root button is clicked", () => {
    const setRoots = vi.fn();
    renderWithTabs(<RootsTab {...defaultProps} setRoots={setRoots} />);

    fireEvent.click(screen.getByText("Add Root"));

    expect(setRoots).toHaveBeenCalled();
    const updateFn = setRoots.mock.calls[0][0];
    const result = updateFn(mockRoots);
    expect(result).toEqual([...mockRoots, { uri: "file://", name: "" }]);
  });

  it("removes a root when remove button is clicked", () => {
    const setRoots = vi.fn();
    renderWithTabs(<RootsTab {...defaultProps} setRoots={setRoots} />);

    const removeButtons = screen.getAllByRole("button", {
      name: /remove root/i,
    });
    fireEvent.click(removeButtons[0]);

    expect(setRoots).toHaveBeenCalled();
    const updateFn = setRoots.mock.calls[0][0];
    const result = updateFn(mockRoots);
    expect(result).toEqual([mockRoots[1]]);
  });

  it("updates root URI when input changes", () => {
    const setRoots = vi.fn();
    renderWithTabs(<RootsTab {...defaultProps} setRoots={setRoots} />);

    const firstInput = screen.getByDisplayValue("file:///test/path1");
    fireEvent.change(firstInput, { target: { value: "file:///new/path" } });

    expect(setRoots).toHaveBeenCalled();
    const updateFn = setRoots.mock.calls[0][0];
    const result = updateFn(mockRoots);
    expect(result[0].uri).toBe("file:///new/path");
    expect(result[1]).toEqual(mockRoots[1]);
  });

  it("calls onRootsChange when Save Changes is clicked", () => {
    const onRootsChange = vi.fn();
    renderWithTabs(
      <RootsTab {...defaultProps} onRootsChange={onRootsChange} />,
    );

    fireEvent.click(screen.getByText("Save Changes"));

    expect(onRootsChange).toHaveBeenCalled();
  });
});
