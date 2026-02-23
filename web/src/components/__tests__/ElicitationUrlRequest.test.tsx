import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import ElicitationUrlRequest from "../ElicitationUrlRequest";
import { PendingUrlElicitationRequest } from "../ElicitationTab";

describe("ElicitationUrlRequest", () => {
  const mockOnResolve = vi.fn();

  const createMockRequest = (
    overrides: Partial<PendingUrlElicitationRequest> = {},
  ): PendingUrlElicitationRequest => ({
    id: 1,
    elicitationId: "url-elicitation-1",
    request: {
      mode: "url",
      id: 1,
      message: "Please open this URL to complete the flow",
      url: "https://example.com/complete",
      elicitationId: "url-elicitation-1",
    },
    ...overrides,
  });

  beforeEach(() => {
    vi.clearAllMocks();
    Object.assign(navigator, {
      clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
    });
  });

  it("should render message and URL", () => {
    const request = createMockRequest();
    render(
      <ElicitationUrlRequest request={request} onResolve={mockOnResolve} />,
    );
    expect(
      screen.getByText("Please open this URL to complete the flow"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("https://example.com/complete"),
    ).toBeInTheDocument();
  });

  it("should render all action buttons", () => {
    render(
      <ElicitationUrlRequest
        request={createMockRequest()}
        onResolve={mockOnResolve}
      />,
    );
    expect(
      screen.getByRole("button", { name: /accept and open url/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /^accept$/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /decline/i }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /cancel/i })).toBeInTheDocument();
    expect(screen.getByTestId("copy-url-button")).toBeInTheDocument();
  });

  it("should call onResolve with accept when Accept and open URL is clicked", () => {
    const openSpy = vi.spyOn(window, "open").mockImplementation(() => null);
    render(
      <ElicitationUrlRequest
        request={createMockRequest()}
        onResolve={mockOnResolve}
      />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: /accept and open url/i }),
    );
    expect(openSpy).toHaveBeenCalledWith(
      "https://example.com/complete",
      "_blank",
      "noopener,noreferrer",
    );
    expect(mockOnResolve).toHaveBeenCalledWith(1, { action: "accept" });
    openSpy.mockRestore();
  });

  it("should call onResolve with accept when Accept is clicked", () => {
    render(
      <ElicitationUrlRequest
        request={createMockRequest()}
        onResolve={mockOnResolve}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /^accept$/i }));
    expect(mockOnResolve).toHaveBeenCalledWith(1, { action: "accept" });
  });

  it("should call onResolve with decline when Decline is clicked", () => {
    render(
      <ElicitationUrlRequest
        request={createMockRequest()}
        onResolve={mockOnResolve}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /decline/i }));
    expect(mockOnResolve).toHaveBeenCalledWith(1, { action: "decline" });
  });

  it("should call onResolve with cancel when Cancel is clicked", () => {
    render(
      <ElicitationUrlRequest
        request={createMockRequest()}
        onResolve={mockOnResolve}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));
    expect(mockOnResolve).toHaveBeenCalledWith(1, { action: "cancel" });
  });

  it("should show security warning for non-HTTPS URL", () => {
    render(
      <ElicitationUrlRequest
        request={createMockRequest({
          request: {
            mode: "url",
            id: 1,
            message: "Open",
            url: "http://example.com",
            elicitationId: "e1",
          },
        })}
        onResolve={mockOnResolve}
      />,
    );
    expect(screen.getByTestId("url-warnings")).toBeInTheDocument();
    expect(screen.getByText(/URL does not use HTTPS/i)).toBeInTheDocument();
  });

  it("should show security warning for invalid URL", () => {
    render(
      <ElicitationUrlRequest
        request={createMockRequest({
          request: {
            mode: "url",
            id: 1,
            message: "Open",
            url: "not-a-valid-url",
            elicitationId: "e1",
          },
        })}
        onResolve={mockOnResolve}
      />,
    );
    expect(screen.getByTestId("url-warnings")).toBeInTheDocument();
    expect(screen.getByText(/URL is not a valid link/i)).toBeInTheDocument();
  });

  it("should show security warning for URL with non-ASCII characters", () => {
    render(
      <ElicitationUrlRequest
        request={createMockRequest({
          request: {
            mode: "url",
            id: 1,
            message: "Open",
            url: "https://example.com/путь",
            elicitationId: "e1",
          },
        })}
        onResolve={mockOnResolve}
      />,
    );
    expect(screen.getByTestId("url-warnings")).toBeInTheDocument();
    expect(
      screen.getByText(/non-ASCII characters.*homograph/i),
    ).toBeInTheDocument();
  });

  it("should not show warnings for valid HTTPS URL with ASCII", () => {
    render(
      <ElicitationUrlRequest
        request={createMockRequest()}
        onResolve={mockOnResolve}
      />,
    );
    expect(screen.queryByTestId("url-warnings")).not.toBeInTheDocument();
  });

  it("should copy URL to clipboard when Copy URL is clicked", async () => {
    render(
      <ElicitationUrlRequest
        request={createMockRequest()}
        onResolve={mockOnResolve}
      />,
    );
    fireEvent.click(screen.getByTestId("copy-url-button"));
    await screen.findByText("Copied!");
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
      "https://example.com/complete",
    );
  });
});
