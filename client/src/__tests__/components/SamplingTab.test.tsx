import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import SamplingTab from "../../components/SamplingTab";
import { Tabs } from "@/components/ui/tabs";
import type { CreateMessageRequest } from "@modelcontextprotocol/sdk/types.js";

describe("SamplingTab", () => {
  const mockRequest: CreateMessageRequest = {
    model: "test-model",
    role: "user",
    content: {
      type: "text",
      text: "Test message",
    },
  };

  const mockPendingRequests = [
    { id: 1, request: mockRequest },
    {
      id: 2,
      request: {
        ...mockRequest,
        content: { type: "text", text: "Another test" },
      },
    },
  ];

  const defaultProps = {
    pendingRequests: mockPendingRequests,
    onApprove: vi.fn(),
    onReject: vi.fn(),
  };

  const renderWithTabs = (component: React.ReactElement) => {
    return render(<Tabs defaultValue="sampling">{component}</Tabs>);
  };

  it("renders empty state when no requests", () => {
    renderWithTabs(<SamplingTab {...defaultProps} pendingRequests={[]} />);
    expect(screen.getByText("No pending requests")).toBeInTheDocument();
  });

  it("renders list of pending requests", () => {
    renderWithTabs(<SamplingTab {...defaultProps} />);
    expect(screen.getByText(/Test message/)).toBeInTheDocument();
    expect(screen.getByText(/Another test/)).toBeInTheDocument();
  });

  it("shows request details in JSON format", () => {
    renderWithTabs(<SamplingTab {...defaultProps} />);
    const requestJson = screen.getAllByText((content) =>
      content.includes('"model": "test-model"'),
    );
    expect(requestJson).toHaveLength(2);
  });

  it("calls onApprove with stub response when Approve is clicked", () => {
    const onApprove = vi.fn();
    renderWithTabs(<SamplingTab {...defaultProps} onApprove={onApprove} />);

    const approveButtons = screen.getAllByText("Approve");
    fireEvent.click(approveButtons[0]);

    expect(onApprove).toHaveBeenCalledWith(1, {
      model: "stub-model",
      stopReason: "endTurn",
      role: "assistant",
      content: {
        type: "text",
        text: "This is a stub response.",
      },
    });
  });

  it("calls onReject when Reject is clicked", () => {
    const onReject = vi.fn();
    renderWithTabs(<SamplingTab {...defaultProps} onReject={onReject} />);

    const rejectButtons = screen.getAllByText("Reject");
    fireEvent.click(rejectButtons[0]);

    expect(onReject).toHaveBeenCalledWith(1);
  });

  it("shows informational alert about sampling requests", () => {
    renderWithTabs(<SamplingTab {...defaultProps} />);
    expect(
      screen.getByText(/When the server requests LLM sampling/),
    ).toBeInTheDocument();
  });
});
