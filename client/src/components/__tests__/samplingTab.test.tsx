import { render, screen } from "@testing-library/react";
import { Tabs } from "@/components/ui/tabs";
import SamplingTab, { PendingRequest } from "../SamplingTab";

describe("Sampling tab", () => {
  const mockOnApprove = jest.fn();
  const mockOnReject = jest.fn();

  const renderSamplingTab = (pendingRequests: PendingRequest[]) =>
    render(
      <Tabs defaultValue="sampling">
        <SamplingTab
          pendingRequests={pendingRequests}
          onApprove={mockOnApprove}
          onReject={mockOnReject}
        />
      </Tabs>,
    );

  it("should render 'No pending requests' when there are no pending requests", () => {
    renderSamplingTab([]);
    expect(
      screen.getByText(
        "When the server requests LLM sampling, requests will appear here for approval.",
      ),
    ).toBeTruthy();
    expect(screen.findByText("No pending requests")).toBeTruthy();
  });

  it("should render the correct number of requests", () => {
    renderSamplingTab(
      Array.from({ length: 5 }, (_, i) => ({
        id: i,
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
      })),
    );
    expect(screen.getAllByTestId("sampling-request").length).toBe(5);
  });
});
