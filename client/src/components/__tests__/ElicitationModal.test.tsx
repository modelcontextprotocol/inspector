import { render, screen, fireEvent, act } from "@testing-library/react";
import "@testing-library/jest-dom";
import { describe, it, jest, beforeEach, afterEach } from "@jest/globals";
import ElicitationModal, { ElicitationRequest } from "../ElicitationModal";
import { JsonSchemaType } from "@/utils/jsonUtils";
import * as schemaUtils from "@/utils/schemaUtils";

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

jest.mock("@/components/ui/dialog", () => ({
  Dialog: ({
    children,
    open,
    onOpenChange,
  }: {
    children: React.ReactNode;
    open: boolean;
    onOpenChange: () => void;
  }) =>
    open ? (
      <div data-testid="dialog" onClick={onOpenChange}>
        {children}
      </div>
    ) : null,
  DialogContent: ({
    children,
    className,
  }: {
    children: React.ReactNode;
    className?: string;
  }) => (
    <div data-testid="dialog-content" className={className}>
      {children}
    </div>
  ),
  DialogHeader: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="dialog-header">{children}</div>
  ),
  DialogTitle: ({ children }: { children: React.ReactNode }) => (
    <h2 data-testid="dialog-title">{children}</h2>
  ),
  DialogDescription: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="dialog-description">{children}</div>
  ),
  DialogFooter: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="dialog-footer">{children}</div>
  ),
}));

jest.mock("@/components/ui/button", () => ({
  Button: ({
    children,
    onClick,
    variant,
    ...props
  }: {
    children: React.ReactNode;
    onClick?: () => void;
    variant?: string;
    [key: string]: unknown;
  }) => (
    <button
      onClick={onClick}
      data-testid={`button-${children?.toString().toLowerCase()}`}
      data-variant={variant}
      {...props}
    >
      {children}
    </button>
  ),
}));

jest.mock("@/utils/schemaUtils", () => ({
  generateDefaultValue: jest.fn((schema: JsonSchemaType) => {
    if (schema.type === "object" && schema.properties) {
      const defaults: Record<string, unknown> = {};
      Object.keys(schema.properties).forEach((key) => {
        const prop = schema.properties![key];
        if (prop.type === "string") defaults[key] = "";
        if (prop.type === "number") defaults[key] = 0;
        if (prop.type === "boolean") defaults[key] = false;
      });
      return defaults;
    }
    return {};
  }),
}));

describe("ElicitationModal", () => {
  const mockResolve = jest.fn();
  const mockOnClose = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  const createMockRequest = (
    overrides: Partial<ElicitationRequest> = {},
  ): ElicitationRequest => ({
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
    resolve: mockResolve,
    ...overrides,
  });

  const renderElicitationModal = (
    request: ElicitationRequest | null = null,
  ) => {
    return render(
      <ElicitationModal
        request={request || createMockRequest()}
        onClose={mockOnClose}
      />,
    );
  };

  describe("Rendering", () => {
    it("should render null when no request is provided", () => {
      render(<ElicitationModal request={null} onClose={mockOnClose} />);
      expect(screen.queryByTestId("dialog")).not.toBeInTheDocument();
    });

    it("should render dialog when request is provided", () => {
      renderElicitationModal();
      expect(screen.getByTestId("dialog")).toBeInTheDocument();
      expect(screen.getByTestId("dialog-content")).toBeInTheDocument();
    });

    it("should display request message", () => {
      const message = "Please provide your GitHub username";
      renderElicitationModal(createMockRequest({ message }));
      expect(screen.getByText(message)).toBeInTheDocument();
    });

    it("should display schema title when provided", () => {
      const request = createMockRequest({
        requestedSchema: {
          type: "object",
          title: "User Information",
          properties: { name: { type: "string" } },
        },
      });
      renderElicitationModal(request);
      expect(screen.getByText("User Information")).toBeInTheDocument();
    });

    it("should display default title when schema title is not provided", () => {
      renderElicitationModal();
      expect(screen.getByText("Information Request")).toBeInTheDocument();
    });

    it("should display schema description when provided", () => {
      const description = "Please fill out your contact details";
      const request = createMockRequest({
        requestedSchema: {
          type: "object",
          description,
          properties: { name: { type: "string" } },
        },
      });
      renderElicitationModal(request);
      expect(screen.getByText(description)).toBeInTheDocument();
    });

    it("should render all three action buttons", () => {
      renderElicitationModal();
      expect(screen.getByTestId("button-cancel")).toBeInTheDocument();
      expect(screen.getByTestId("button-decline")).toBeInTheDocument();
      expect(screen.getByTestId("button-submit")).toBeInTheDocument();
    });

    it("should render DynamicJsonForm component", () => {
      renderElicitationModal();
      expect(screen.getByTestId("dynamic-json-form")).toBeInTheDocument();
    });
  });

  describe("User Interactions", () => {
    it("should call resolve with accept action when Submit button is clicked", async () => {
      renderElicitationModal();

      const input = screen.getByTestId("form-input");
      await act(async () => {
        fireEvent.change(input, {
          target: {
            value: '{"name": "John Doe", "email": "john@example.com"}',
          },
        });
      });

      await act(async () => {
        fireEvent.click(screen.getByTestId("button-submit"));
      });

      expect(mockResolve).toHaveBeenCalledWith({
        action: "accept",
        content: { name: "John Doe", email: "john@example.com" },
      });
      expect(mockOnClose).toHaveBeenCalled();
    });

    it("should call resolve with reject action when Decline button is clicked", async () => {
      renderElicitationModal();

      await act(async () => {
        fireEvent.click(screen.getByTestId("button-decline"));
      });

      expect(mockResolve).toHaveBeenCalledWith({ action: "reject" });
      expect(mockOnClose).toHaveBeenCalled();
    });

    it("should call resolve with cancel action when Cancel button is clicked", async () => {
      renderElicitationModal();

      await act(async () => {
        fireEvent.click(screen.getByTestId("button-cancel"));
      });

      expect(mockResolve).toHaveBeenCalledWith({ action: "cancel" });
      expect(mockOnClose).toHaveBeenCalled();
    });

    it("should call resolve with cancel action when dialog is closed", async () => {
      renderElicitationModal();

      await act(async () => {
        fireEvent.click(screen.getByTestId("dialog"));
      });

      expect(mockResolve).toHaveBeenCalledWith({ action: "cancel" });
      expect(mockOnClose).toHaveBeenCalled();
    });
  });

  describe("Form Validation", () => {
    it("should show validation error for missing required fields", async () => {
      renderElicitationModal();

      await act(async () => {
        fireEvent.click(screen.getByTestId("button-submit"));
      });

      expect(
        screen.getByText(/Required field missing: name/),
      ).toBeInTheDocument();
      expect(mockResolve).not.toHaveBeenCalledWith(
        expect.objectContaining({ action: "accept" }),
      );
    });

    it("should show validation error for invalid email format", async () => {
      renderElicitationModal();

      const input = screen.getByTestId("form-input");
      await act(async () => {
        fireEvent.change(input, {
          target: { value: '{"name": "John", "email": "invalid-email"}' },
        });
      });

      await act(async () => {
        fireEvent.click(screen.getByTestId("button-submit"));
      });

      expect(
        screen.getByText(/Invalid email format: email/),
      ).toBeInTheDocument();
      expect(mockResolve).not.toHaveBeenCalledWith(
        expect.objectContaining({ action: "accept" }),
      );
    });

    it("should clear validation error when form data changes", async () => {
      renderElicitationModal();

      await act(async () => {
        fireEvent.click(screen.getByTestId("button-submit"));
      });

      expect(screen.getByText(/Required field missing/)).toBeInTheDocument();

      const input = screen.getByTestId("form-input");
      await act(async () => {
        fireEvent.change(input, { target: { value: '{"name": "John"}' } });
      });

      expect(
        screen.queryByText(/Required field missing/),
      ).not.toBeInTheDocument();
    });

    it("should show AJV validation errors", async () => {
      const mockAjv = {
        compile: jest.fn(() => ({
          errors: [{ instancePath: "/name", message: "should be string" }],
        })),
        errorsText: jest.fn(() => "data/name should be string"),
      };

      jest.doMock("ajv", () => jest.fn(() => mockAjv));

      renderElicitationModal();

      const input = screen.getByTestId("form-input");
      await act(async () => {
        fireEvent.change(input, { target: { value: '{"name": "John"}' } });
      });

      await act(async () => {
        fireEvent.click(screen.getByTestId("button-submit"));
      });
    });
  });

  describe("Email Validation", () => {
    it("should accept valid email formats", async () => {
      const validEmails = [
        "test@example.com",
        "user.name@domain.co.uk",
        "user+tag@example.org",
      ];

      for (const email of validEmails) {
        renderElicitationModal();

        const input = screen.getByTestId("form-input");
        await act(async () => {
          fireEvent.change(input, {
            target: { value: `{"name": "John", "email": "${email}"}` },
          });
        });

        await act(async () => {
          fireEvent.click(screen.getByTestId("button-submit"));
        });

        expect(mockResolve).toHaveBeenCalledWith({
          action: "accept",
          content: { name: "John", email },
        });

        jest.clearAllMocks();
        document.body.innerHTML = "";
      }
    });

    it("should reject invalid email formats", async () => {
      const invalidEmails = [
        "invalid-email",
        "@example.com",
        "user@",
        "user.example.com",
      ];

      for (const email of invalidEmails) {
        renderElicitationModal();

        const input = screen.getByTestId("form-input");
        await act(async () => {
          fireEvent.change(input, {
            target: { value: `{"name": "John", "email": "${email}"}` },
          });
        });

        await act(async () => {
          fireEvent.click(screen.getByTestId("button-submit"));
        });

        expect(
          screen.getByText(/Invalid email format: email/),
        ).toBeInTheDocument();
        expect(mockResolve).not.toHaveBeenCalledWith(
          expect.objectContaining({ action: "accept" }),
        );

        jest.clearAllMocks();
        document.body.innerHTML = "";
      }
    });
  });

  describe("Schema Types", () => {
    it("should handle string schema", () => {
      const request = createMockRequest({
        requestedSchema: {
          type: "object",
          properties: {
            username: { type: "string", description: "Username" },
          },
        },
      });
      renderElicitationModal(request);
      expect(screen.getByTestId("dynamic-json-form")).toBeInTheDocument();
    });

    it("should handle number schema", () => {
      const request = createMockRequest({
        requestedSchema: {
          type: "object",
          properties: {
            age: { type: "number", minimum: 0, maximum: 120 },
          },
        },
      });
      renderElicitationModal(request);
      expect(screen.getByTestId("dynamic-json-form")).toBeInTheDocument();
    });

    it("should handle boolean schema", () => {
      const request = createMockRequest({
        requestedSchema: {
          type: "object",
          properties: {
            subscribe: {
              type: "boolean",
              description: "Subscribe to newsletter",
            },
          },
        },
      });
      renderElicitationModal(request);
      expect(screen.getByTestId("dynamic-json-form")).toBeInTheDocument();
    });

    it("should handle enum schema", () => {
      const request = createMockRequest({
        requestedSchema: {
          type: "object",
          properties: {
            country: {
              type: "string",
              enum: ["US", "UK", "CA"],
              enumNames: ["United States", "United Kingdom", "Canada"],
            },
          },
        },
      });
      renderElicitationModal(request);
      expect(screen.getByTestId("dynamic-json-form")).toBeInTheDocument();
    });
  });

  describe("Error Handling", () => {
    it("should handle validation errors gracefully", async () => {
      renderElicitationModal();

      await act(async () => {
        fireEvent.click(screen.getByTestId("button-submit"));
      });

      expect(screen.getByText(/Validation Error/)).toBeInTheDocument();
    });

    it("should handle JSON parsing errors in form validation", async () => {
      renderElicitationModal();

      const input = screen.getByTestId("form-input");
      await act(async () => {
        fireEvent.change(input, { target: { value: "invalid json" } });
      });

      await act(async () => {
        fireEvent.click(screen.getByTestId("button-submit"));
      });

      expect(mockResolve).not.toHaveBeenCalledWith(
        expect.objectContaining({ action: "accept" }),
      );
    });
  });

  describe("Default Values", () => {
    it("should generate default values when request changes", () => {
      const { rerender } = renderElicitationModal();

      const newRequest = createMockRequest({
        id: 2,
        requestedSchema: {
          type: "object",
          properties: {
            newField: { type: "string" },
          },
        },
      });

      rerender(<ElicitationModal request={newRequest} onClose={mockOnClose} />);

      expect(schemaUtils.generateDefaultValue).toHaveBeenCalledWith(
        newRequest.requestedSchema,
      );
    });
  });
});
