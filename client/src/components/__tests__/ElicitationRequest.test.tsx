import { render, screen, fireEvent, act } from "@testing-library/react";
import "@testing-library/jest-dom";
import { describe, it, jest, beforeEach, afterEach } from "@jest/globals";
import ElicitationRequest from "../ElicitationRequest";
import { PendingElicitationRequest } from "../ElicitationTab";

jest.mock("../DynamicJsonForm", () => {
  return function MockDynamicJsonForm({
    value,
    onChange,
  }: {
    value: unknown;
    onChange: (value: unknown) => void;
  }) {
    return (
      <div data-testid="dynamic-json-form">
        <input
          data-testid="form-input"
          value={
            typeof value === "object" && value !== null
              ? JSON.stringify(value)
              : String(value || "")
          }
          onChange={(e) => {
            try {
              const parsed = JSON.parse(e.target.value);
              onChange(parsed);
            } catch {
              onChange(e.target.value);
            }
          }}
        />
      </div>
    );
  };
});

describe("ElicitationRequest", () => {
  const mockOnResolve = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  const createMockRequest = (
    overrides: Partial<PendingElicitationRequest> = {},
  ): PendingElicitationRequest => ({
    id: 1,
    request: {
      id: 1,
      message: "Please provide your information",
      requestedSchema: {
        type: "object",
        properties: {
          name: { type: "string", description: "Your name" },
          email: { type: "string", format: "email", description: "Your email" },
        },
        required: ["name"],
      },
    },
    ...overrides,
  });

  const renderElicitationRequest = (
    request: PendingElicitationRequest = createMockRequest(),
  ) => {
    return render(
      <ElicitationRequest request={request} onResolve={mockOnResolve} />,
    );
  };

  describe("Rendering", () => {
    it("should render the component", () => {
      renderElicitationRequest();
      expect(screen.getByTestId("elicitation-request")).toBeInTheDocument();
    });

    it("should display request message", () => {
      const message = "Please provide your GitHub username";
      renderElicitationRequest(
        createMockRequest({
          request: {
            id: 1,
            message,
            requestedSchema: {
              type: "object",
              properties: { name: { type: "string" } },
            },
          },
        }),
      );
      expect(screen.getByText(message)).toBeInTheDocument();
    });

    it("should render all three action buttons", () => {
      renderElicitationRequest();
      expect(
        screen.getByRole("button", { name: /cancel/i }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: /decline/i }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: /submit/i }),
      ).toBeInTheDocument();
    });

    it("should render DynamicJsonForm component", () => {
      renderElicitationRequest();
      expect(screen.getByTestId("dynamic-json-form")).toBeInTheDocument();
    });
  });

  describe("User Interactions", () => {
    it("should call onResolve with accept action when Submit button is clicked", async () => {
      renderElicitationRequest();

      const input = screen.getByTestId("form-input");
      await act(async () => {
        fireEvent.change(input, {
          target: {
            value: '{"name": "John Doe", "email": "john@example.com"}',
          },
        });
      });

      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: /submit/i }));
      });

      expect(mockOnResolve).toHaveBeenCalledWith(1, {
        action: "accept",
        content: { name: "John Doe", email: "john@example.com" },
      });
    });

    it("should call onResolve with decline action when Decline button is clicked", async () => {
      renderElicitationRequest();

      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: /decline/i }));
      });

      expect(mockOnResolve).toHaveBeenCalledWith(1, { action: "decline" });
    });

    it("should call onResolve with cancel action when Cancel button is clicked", async () => {
      renderElicitationRequest();

      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: /cancel/i }));
      });

      expect(mockOnResolve).toHaveBeenCalledWith(1, { action: "cancel" });
    });
  });

  describe("Form Validation", () => {
    it("should show validation error for missing required fields", async () => {
      renderElicitationRequest();

      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: /submit/i }));
      });

      expect(
        screen.getByText(/Required field missing: name/),
      ).toBeInTheDocument();
      expect(mockOnResolve).not.toHaveBeenCalledWith(
        1,
        expect.objectContaining({ action: "accept" }),
      );
    });

    it("should show validation error for invalid email format", async () => {
      renderElicitationRequest();

      const input = screen.getByTestId("form-input");
      await act(async () => {
        fireEvent.change(input, {
          target: { value: '{"name": "John", "email": "invalid-email"}' },
        });
      });

      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: /submit/i }));
      });

      expect(
        screen.getByText(/Invalid email format: email/),
      ).toBeInTheDocument();
      expect(mockOnResolve).not.toHaveBeenCalledWith(
        1,
        expect.objectContaining({ action: "accept" }),
      );
    });
  });
});
