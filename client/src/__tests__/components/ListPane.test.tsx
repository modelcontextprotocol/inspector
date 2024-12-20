import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import ListPane from "../../components/ListPane";

describe("ListPane", () => {
  type TestItem = {
    id: number;
    name: string;
  };

  const mockItems: TestItem[] = [
    { id: 1, name: "Item 1" },
    { id: 2, name: "Item 2" },
  ];

  const defaultProps = {
    items: mockItems,
    listItems: vi.fn(),
    clearItems: vi.fn(),
    setSelectedItem: vi.fn(),
    renderItem: (item: TestItem) => (
      <>
        <span className="flex-1">{item.name}</span>
        <span className="text-sm text-gray-500">ID: {item.id}</span>
      </>
    ),
    title: "Test Items",
    buttonText: "List Items",
  };

  it("renders title and buttons", () => {
    render(<ListPane {...defaultProps} />);
    expect(screen.getByText("Test Items")).toBeInTheDocument();
    expect(screen.getByText("List Items")).toBeInTheDocument();
    expect(screen.getByText("Clear")).toBeInTheDocument();
  });

  it("renders list of items using renderItem prop", () => {
    render(<ListPane {...defaultProps} />);
    expect(screen.getByText("Item 1")).toBeInTheDocument();
    expect(screen.getByText("Item 2")).toBeInTheDocument();
    expect(screen.getByText("ID: 1")).toBeInTheDocument();
    expect(screen.getByText("ID: 2")).toBeInTheDocument();
  });

  it("calls listItems when List Items button is clicked", () => {
    const listItems = vi.fn();
    render(<ListPane {...defaultProps} listItems={listItems} />);

    fireEvent.click(screen.getByText("List Items"));
    expect(listItems).toHaveBeenCalled();
  });

  it("calls clearItems when Clear button is clicked", () => {
    const clearItems = vi.fn();
    render(<ListPane {...defaultProps} clearItems={clearItems} />);

    fireEvent.click(screen.getByText("Clear"));
    expect(clearItems).toHaveBeenCalled();
  });

  it("calls setSelectedItem when an item is clicked", () => {
    const setSelectedItem = vi.fn();
    render(<ListPane {...defaultProps} setSelectedItem={setSelectedItem} />);

    fireEvent.click(screen.getByText("Item 1"));
    expect(setSelectedItem).toHaveBeenCalledWith(mockItems[0]);
  });

  it("disables Clear button when items array is empty", () => {
    render(<ListPane {...defaultProps} items={[]} />);
    expect(screen.getByText("Clear")).toBeDisabled();
  });

  it("disables List Items button when isButtonDisabled is true", () => {
    render(<ListPane {...defaultProps} isButtonDisabled={true} />);
    expect(screen.getByText("List Items")).toBeDisabled();
  });

  it("enables List Items button when isButtonDisabled is false", () => {
    render(<ListPane {...defaultProps} isButtonDisabled={false} />);
    expect(screen.getByText("List Items")).not.toBeDisabled();
  });
});
