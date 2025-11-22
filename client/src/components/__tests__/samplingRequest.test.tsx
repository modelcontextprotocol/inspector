import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
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

const mockRequestWithTools: PendingRequest = {
  id: 2,
  request: {
    method: "sampling/createMessage",
    params: {
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: "List the files",
          },
        },
      ],
      maxTokens: 100,
      tools: [
        {
          name: "list_files",
          description: "List files in a directory",
          inputSchema: {
            type: "object",
            properties: {
              path: { type: "string", description: "Directory path" },
            },
            required: ["path"],
          },
        },
        {
          name: "read_file",
          description: "Read a file",
          inputSchema: {
            type: "object",
            properties: {
              path: { type: "string" },
            },
          },
        },
      ],
      toolChoice: { mode: "auto" },
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

  describe("Tool support", () => {
    it("should display available tools when request includes tools", () => {
      render(
        <SamplingRequest
          request={mockRequestWithTools}
          onApprove={mockOnApprove}
          onReject={mockOnReject}
        />,
      );

      // Should show tools count
      expect(screen.getByText(/Available Tools \(2\)/)).toBeInTheDocument();
      // Should show toolChoice mode
      expect(screen.getByText(/mode: auto/)).toBeInTheDocument();
    });

    it("should expand tools list when Show button is clicked", () => {
      render(
        <SamplingRequest
          request={mockRequestWithTools}
          onApprove={mockOnApprove}
          onReject={mockOnReject}
        />,
      );

      // Initially tools are collapsed
      expect(screen.queryByText("list_files")).not.toBeInTheDocument();

      // Click Show to expand
      fireEvent.click(screen.getByRole("button", { name: /Show/i }));

      // Now tools should be visible
      expect(screen.getByText("list_files")).toBeInTheDocument();
      expect(screen.getByText("read_file")).toBeInTheDocument();
      expect(screen.getByText("List files in a directory")).toBeInTheDocument();
    });

    it("should have stopReason dropdown with toolUse option", () => {
      render(
        <SamplingRequest
          request={mockRequest}
          onApprove={mockOnApprove}
          onReject={mockOnReject}
        />,
      );

      // Find the Stop Reason label
      expect(screen.getByText("Stop Reason")).toBeInTheDocument();
    });

    it("should have Add Block button for multiple content blocks", () => {
      render(
        <SamplingRequest
          request={mockRequest}
          onApprove={mockOnApprove}
          onReject={mockOnReject}
        />,
      );

      // Find the Add Block button
      expect(
        screen.getByRole("button", { name: /Add Block/i }),
      ).toBeInTheDocument();
    });

    it("should add a new content block when Add Block is clicked", () => {
      render(
        <SamplingRequest
          request={mockRequest}
          onApprove={mockOnApprove}
          onReject={mockOnReject}
        />,
      );

      // Initially one block
      expect(screen.getByText("Block 1")).toBeInTheDocument();
      expect(screen.queryByText("Block 2")).not.toBeInTheDocument();

      // Click Add Block
      fireEvent.click(screen.getByRole("button", { name: /Add Block/i }));

      // Now should have two blocks
      expect(screen.getByText("Block 1")).toBeInTheDocument();
      expect(screen.getByText("Block 2")).toBeInTheDocument();
    });

    it("should not show ToolsDisplay when request has no tools", () => {
      render(
        <SamplingRequest
          request={mockRequest}
          onApprove={mockOnApprove}
          onReject={mockOnReject}
        />,
      );

      // Should not show tools section
      expect(screen.queryByText(/Available Tools/)).not.toBeInTheDocument();
    });
  });
});
