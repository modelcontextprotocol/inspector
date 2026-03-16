import { render, screen, fireEvent, act } from "@testing-library/react";
import "@testing-library/jest-dom";
import { describe, it, beforeEach, jest } from "@jest/globals";
import ListPane from "../ListPane";

describe("ListPane", () => {
  const mockItems = [
    { id: 1, name: "Tool 1", description: "First tool" },
    { id: 2, name: "Tool 2", description: "Second tool" },
    { id: 3, name: "Another Tool", description: "Third tool" },
    { id: 4, name: "Extra Tool", description: "Fourth tool" },
  ];

  const defaultProps = {
    items: mockItems,
    listItems: jest.fn(),
    setSelectedItem: jest.fn(),
    renderItem: (item: (typeof mockItems)[0]) => <div>{item.name}</div>,
    title: "List tools",
    buttonText: "Load Tools",
  };

  const renderListPane = (props = {}) => {
    return render(<ListPane {...defaultProps} {...props} />);
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("Rendering", () => {
    it("should render with title and button", () => {
      renderListPane();

      expect(screen.getByText("List tools")).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: "Load Tools" }),
      ).toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: "Clear" }),
      ).not.toBeInTheDocument();
    });

    it("should render Clear button when clearItems prop is provided", () => {
      renderListPane({ clearItems: jest.fn() });
      expect(screen.getByRole("button", { name: "Clear" })).toBeInTheDocument();
    });

    it("should render items when provided", () => {
      renderListPane();

      expect(screen.getByText("Tool 1")).toBeInTheDocument();
      expect(screen.getByText("Tool 2")).toBeInTheDocument();
      expect(screen.getByText("Another Tool")).toBeInTheDocument();
    });

    it("should render empty state when no items", () => {
      renderListPane({ items: [] });

      expect(screen.queryByText("Tool 1")).not.toBeInTheDocument();
      expect(screen.queryByText("Tool 2")).not.toBeInTheDocument();
    });

    it("should render custom item content", () => {
      const customRenderItem = (item: (typeof mockItems)[0]) => (
        <div>
          <span>{item.name}</span>
          <small>{item.description}</small>
        </div>
      );

      renderListPane({ renderItem: customRenderItem });

      expect(screen.getByText("Tool 1")).toBeInTheDocument();
      expect(screen.getByText("First tool")).toBeInTheDocument();
    });
  });

  describe("Search Functionality", () => {
    it("should show search input when items > 3", () => {
      renderListPane();

      const searchInput = screen.getByPlaceholderText("Search...");
      expect(searchInput).toBeInTheDocument();
    });

    it("should hide search input when items <= 3", () => {
      renderListPane({ items: mockItems.slice(0, 3) });

      const searchInput = screen.queryByPlaceholderText("Search...");
      expect(searchInput).not.toBeInTheDocument();
    });

    it("should filter items based on search query", async () => {
      renderListPane();

      const searchInput = screen.getByPlaceholderText("Search...");
      await act(async () => {
        fireEvent.change(searchInput, { target: { value: "Tool" } });
      });

      expect(screen.getByText("Tool 1")).toBeInTheDocument();
      expect(screen.getByText("Tool 2")).toBeInTheDocument();
      expect(screen.getByText("Another Tool")).toBeInTheDocument();

      await act(async () => {
        fireEvent.change(searchInput, { target: { value: "Another" } });
      });

      expect(screen.queryByText("Tool 1")).not.toBeInTheDocument();
      expect(screen.queryByText("Tool 2")).not.toBeInTheDocument();
      expect(screen.getByText("Another Tool")).toBeInTheDocument();
    });

    it("should show 'No items found matching \"NonExistent\"' when search has no results", async () => {
      renderListPane();

      const searchInput = screen.getByPlaceholderText("Search...");

      await act(async () => {
        fireEvent.change(searchInput, { target: { value: "NonExistent" } });
      });

      expect(
        screen.getByText('No items found matching "NonExistent"'),
      ).toBeInTheDocument();
      expect(screen.queryByText("Tool 1")).not.toBeInTheDocument();
    });

    it("should search through all item properties (description)", async () => {
      renderListPane();

      const searchInput = screen.getByPlaceholderText("Search...");
      await act(async () => {
        fireEvent.change(searchInput, { target: { value: "First tool" } });
      });

      expect(screen.getByText("Tool 1")).toBeInTheDocument();
      expect(screen.queryByText("Tool 2")).not.toBeInTheDocument();
    });
  });
});
