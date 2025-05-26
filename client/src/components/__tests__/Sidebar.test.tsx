import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import { describe, it, beforeEach, jest } from "@jest/globals";
import Sidebar from "../Sidebar";
import { TooltipProvider } from "@/components/ui/tooltip";

// Mock theme hook
jest.mock("../../lib/hooks/useTheme", () => ({
  __esModule: true,
  default: () => ["light", jest.fn()],
}));

describe("Sidebar Navigation", () => {
  const defaultProps = {
    currentPage: "resources",
    onPageChange: jest.fn(),
    serverCapabilities: {
      resources: { subscribe: true, listChanged: true },
      prompts: { listChanged: true },
      tools: { listChanged: true },
    },
    pendingSampleRequests: [],
  };

  const renderSidebar = (props = {}) => {
    return render(
      <TooltipProvider>
        <Sidebar {...defaultProps} {...props} />
      </TooltipProvider>,
    );
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("Basic Navigation", () => {
    it("should render all navigation tabs", () => {
      renderSidebar();

      expect(screen.getByText("Resources")).toBeInTheDocument();
      expect(screen.getByText("Prompts")).toBeInTheDocument();
      expect(screen.getByText("Tools")).toBeInTheDocument();
      expect(screen.getByText("Chat")).toBeInTheDocument();
      expect(screen.getByText("Ping")).toBeInTheDocument();
      expect(screen.getByText("Sampling")).toBeInTheDocument();
      expect(screen.getByText("Roots")).toBeInTheDocument();
      expect(screen.getByText("Auth")).toBeInTheDocument();
      expect(screen.getByText("Settings")).toBeInTheDocument();
    });

    it("should call onPageChange when a tab is clicked", () => {
      const onPageChange = jest.fn();
      renderSidebar({ onPageChange });

      const promptsTab = screen.getByText("Prompts");
      fireEvent.click(promptsTab);

      expect(onPageChange).toHaveBeenCalledWith("prompts");
    });

    it("should highlight the current page", () => {
      renderSidebar({ currentPage: "tools" });

      const toolsTab = screen.getByText("Tools").closest("button");
      expect(toolsTab).toHaveClass("bg-primary");
    });

    it("should disable tabs when server capabilities are not available", () => {
      renderSidebar({
        serverCapabilities: {
          resources: null,
          prompts: null,
          tools: null,
        },
      });

      const resourcesTab = screen.getByText("Resources").closest("button");
      const promptsTab = screen.getByText("Prompts").closest("button");
      const toolsTab = screen.getByText("Tools").closest("button");

      expect(resourcesTab).toBeDisabled();
      expect(promptsTab).toBeDisabled();
      expect(toolsTab).toBeDisabled();
    });

    it("should show badge for pending sample requests", () => {
      renderSidebar({
        pendingSampleRequests: [{ id: 1 }, { id: 2 }, { id: 3 }],
      });

      const badge = screen.getByText("3");
      expect(badge).toBeInTheDocument();
      expect(badge).toHaveClass("bg-red-500");
    });

    it("should render theme selector", () => {
      renderSidebar();

      expect(screen.getByText("Theme")).toBeInTheDocument();
      expect(screen.getByRole("combobox")).toBeInTheDocument();
    });
  });
});
