import { render, screen } from "@testing-library/react";
import { Tabs } from "@/components/ui/tabs";
import ElicitationTab, { PendingElicitationRequest } from "../ElicitationTab";

describe("Elicitation tab", () => {
  const mockOnResolve = jest.fn();

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
    expect(screen.findByText("No pending requests")).toBeTruthy();
  });

  it("should render the correct number of requests", () => {
    renderElicitationTab(
      Array.from({ length: 3 }, (_, i) => ({
        id: i,
        request: {
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

  it("should render a URL-mode elicitation request", () => {
    renderElicitationTab([
      {
        id: 1,
        request: {
          id: 1,
          mode: "url",
          message: "Please authenticate",
          url: "https://example.com/auth",
          elicitationId: "elicit-456",
        },
      },
    ]);
    expect(screen.getAllByTestId("elicitation-request").length).toBe(1);
    expect(screen.getByText("Please authenticate")).toBeTruthy();
    expect(screen.getByRole("button", { name: /open url/i })).toBeTruthy();
  });
});
