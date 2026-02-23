import { render, screen } from "@testing-library/react";
import { Tabs } from "@/components/ui/tabs";
import ElicitationTab, { PendingElicitationRequest } from "../ElicitationTab";

describe("Elicitation tab", () => {
  const mockOnResolve = vi.fn();

  const renderElicitationTab = (pendingRequests: PendingElicitationRequest[]) =>
    render(
      <Tabs defaultValue="elicitations">
        <ElicitationTab
          pendingRequests={pendingRequests}
          onResolve={mockOnResolve}
        />
      </Tabs>,
    );

  it("should render 'No pending requests' when there are no pending requests", () => {
    renderElicitationTab([]);
    expect(
      screen.getByText(
        "When the server requests information from the user, requests will appear here for response.",
      ),
    ).toBeTruthy();
    expect(screen.getByText("No pending requests")).toBeInTheDocument();
  });

  it("should render the correct number of form requests", () => {
    renderElicitationTab(
      Array.from({ length: 3 }, (_, i) => ({
        id: i,
        elicitationId: `elicitation-${i}`,
        request: {
          mode: "form" as const,
          id: i,
          message: `Please provide information ${i}`,
          requestedSchema: {
            type: "object",
            properties: {
              name: {
                type: "string",
                description: "Your name",
              },
            },
            required: ["name"],
          },
        },
      })),
    );
    expect(screen.getAllByTestId("elicitation-request").length).toBe(3);
  });

  it("should render URL elicitation requests with ElicitationUrlRequest", () => {
    renderElicitationTab([
      {
        id: 0,
        elicitationId: "url-elicitation-1",
        request: {
          mode: "url",
          id: 0,
          message: "Open this URL to complete",
          url: "https://example.com/complete",
          elicitationId: "url-elicitation-1",
        },
      },
    ]);
    expect(screen.getByTestId("elicitation-url-request")).toBeInTheDocument();
    expect(screen.getByText("Open this URL to complete")).toBeInTheDocument();
    expect(
      screen.getByText("https://example.com/complete"),
    ).toBeInTheDocument();
  });

  it("should render mix of form and URL requests", () => {
    renderElicitationTab([
      {
        id: 0,
        elicitationId: "form-1",
        request: {
          mode: "form",
          id: 0,
          message: "Form request",
          requestedSchema: {
            type: "object",
            properties: { x: { type: "string" } },
          },
        },
      },
      {
        id: 1,
        elicitationId: "url-1",
        request: {
          mode: "url",
          id: 1,
          message: "URL request",
          url: "https://example.com",
          elicitationId: "url-1",
        },
      },
    ]);
    expect(screen.getByTestId("elicitation-request")).toBeInTheDocument();
    expect(screen.getByTestId("elicitation-url-request")).toBeInTheDocument();
  });
});
