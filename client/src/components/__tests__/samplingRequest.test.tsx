import { render, screen, fireEvent } from "@testing-library/react";
import SamplingRequest from "../SamplingRequest";
import { PendingRequest } from "../SamplingTab";

const mockRequest: PendingRequest = {
  id: 1,
  request: {
    method: "sampling/createMessage",
    params: {
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: "What files are in the current directory?",
          },
        },
      ],
      systemPrompt: "You are a helpful file system assistant.",
      includeContext: "thisServer",
      maxTokens: 100,
    },
  },
};

describe("Form to handle sampling response", () => {
  const mockOnApprove = jest.fn();
  const mockOnReject = jest.fn();

  afterEach(() => {
    jest.clearAllMocks();
  });

  it("should call onApprove with correct text content when Approve button is clicked", () => {
    render(
      <SamplingRequest
        request={mockRequest}
        onApprove={mockOnApprove}
        onReject={mockOnReject}
      />,
    );

    // Click the Approve button
    fireEvent.click(screen.getByRole("button", { name: /approve/i }));

    // Assert that onApprove is called with the correct arguments
    expect(mockOnApprove).toHaveBeenCalledWith(mockRequest.id, {
      model: "stub-model",
      stopReason: "endTurn",
      role: "assistant",
      content: {
        type: "text",
        text: "",
      },
    });
  });

  it("should call onReject with correct request id when Reject button is clicked", () => {
    render(
      <SamplingRequest
        request={mockRequest}
        onApprove={mockOnApprove}
        onReject={mockOnReject}
      />,
    );

    // Click the Approve button
    fireEvent.click(screen.getByRole("button", { name: /Reject/i }));

    // Assert that onApprove is called with the correct arguments
    expect(mockOnReject).toHaveBeenCalledWith(mockRequest.id);
  });
});
