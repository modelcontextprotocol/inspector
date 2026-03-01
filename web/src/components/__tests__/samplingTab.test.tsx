/**
 * Unit tests for SamplingTab: when pending requests are passed in,
 * they are rendered and Approve/Reject call the correct callbacks.
 * Mirrors the behavior asserted in client's App.samplingNavigation.test.tsx
 * and shared's inspectorClient.test.ts (sampling event + respond/reject).
 */
import { fireEvent, render, screen } from "@testing-library/react";
import SamplingTab from "../SamplingTab";
import { Tabs } from "../ui/tabs";
import type {
  CreateMessageRequest,
  CreateMessageResult,
} from "@modelcontextprotocol/sdk/types.js";

function renderSamplingTab(props: React.ComponentProps<typeof SamplingTab>) {
  return render(
    <Tabs value="sampling">
      <SamplingTab {...props} />
    </Tabs>,
  );
}

vi.mock("../SamplingRequest", () => ({
  default: ({
    request,
    onApprove,
    onReject,
  }: {
    request: { id: number };
    onApprove: (id: number, result: CreateMessageResult) => void;
    onReject: (id: number) => void;
  }) => (
    <div data-testid="sampling-request">
      <span>request-{request.id}</span>
      <button
        type="button"
        onClick={() =>
          onApprove(request.id, {
            model: "m",
            stopReason: "endTurn",
            role: "assistant",
            content: { type: "text", text: "" },
          })
        }
      >
        Approve
      </button>
      <button type="button" onClick={() => onReject(request.id)}>
        Reject
      </button>
    </div>
  ),
}));

const sampleRequest: CreateMessageRequest = {
  method: "sampling/createMessage",
  params: { messages: [], maxTokens: 1 },
};

describe("SamplingTab", () => {
  it("renders pending requests and Approve calls onApprove with id and result", () => {
    const onApprove = vi.fn();
    const onReject = vi.fn();
    renderSamplingTab({
      pendingRequests: [{ id: 1, request: sampleRequest }],
      onApprove,
      onReject,
    });

    expect(screen.getByTestId("sampling-request")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Approve/i }));

    expect(onApprove).toHaveBeenCalledWith(
      1,
      expect.objectContaining({ model: "m", role: "assistant" }),
    );
    expect(onReject).not.toHaveBeenCalled();
  });

  it("Reject calls onReject with id", () => {
    const onApprove = vi.fn();
    const onReject = vi.fn();
    renderSamplingTab({
      pendingRequests: [{ id: 2, request: sampleRequest }],
      onApprove,
      onReject,
    });

    fireEvent.click(screen.getByRole("button", { name: /Reject/i }));

    expect(onReject).toHaveBeenCalledWith(2);
    expect(onApprove).not.toHaveBeenCalled();
  });
});
