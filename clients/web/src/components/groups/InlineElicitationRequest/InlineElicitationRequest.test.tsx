import { describe, it, expect, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import type { ElicitRequest } from "@modelcontextprotocol/client";
import { renderWithMantine, screen } from "../../../test/renderWithMantine";
import { InlineElicitationRequest } from "./InlineElicitationRequest";

const formRequest = {
  message: "Please provide your database connection details.",
  requestedSchema: {
    type: "object" as const,
    properties: {
      host: { type: "string" as const, title: "Host" },
      port: { type: "string" as const, title: "Port" },
    },
  },
} satisfies ElicitRequest["params"];

const urlRequest: ElicitRequest["params"] = {
  mode: "url",
  message: "Please authenticate via the external URL.",
  url: "https://example.com/auth/callback?session=abc123",
  elicitationId: "elicit-abc-123",
};

const baseProps = {
  queuePosition: "1 of 1",
  onChange: vi.fn(),
  onSubmit: vi.fn(),
  onCancel: vi.fn(),
};

describe("InlineElicitationRequest", () => {
  it("renders the form badge, message, and queue position in form mode", () => {
    renderWithMantine(
      <InlineElicitationRequest
        {...baseProps}
        request={formRequest}
        values={{}}
      />,
    );
    expect(screen.getByText("elicitation/create (form)")).toBeInTheDocument();
    expect(screen.getByText(formRequest.message)).toBeInTheDocument();
    expect(screen.getByText("1 of 1")).toBeInTheDocument();
    // Default origin is a legacy server request — no MRTR note.
    expect(screen.queryByText("input_required")).not.toBeInTheDocument();
  });

  it("shows the MRTR note for a modern input_required round", () => {
    renderWithMantine(
      <InlineElicitationRequest
        {...baseProps}
        request={formRequest}
        values={{}}
        origin="input-required"
      />,
    );
    expect(screen.getByText("input_required")).toBeInTheDocument();
    expect(screen.getByText(/sent back as a retry/i)).toBeInTheDocument();
  });

  it("renders schema fields and a Submit button in form mode", () => {
    renderWithMantine(
      <InlineElicitationRequest
        {...baseProps}
        request={formRequest}
        values={{}}
      />,
    );
    expect(screen.getByText("Host")).toBeInTheDocument();
    expect(screen.getByText("Port")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Submit" })).toBeInTheDocument();
  });

  it("invokes onSubmit when Submit is clicked", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    renderWithMantine(
      <InlineElicitationRequest
        {...baseProps}
        request={formRequest}
        values={{}}
        onSubmit={onSubmit}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Submit" }));
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it("invokes onCancel when Cancel is clicked", async () => {
    const user = userEvent.setup();
    const onCancel = vi.fn();
    renderWithMantine(
      <InlineElicitationRequest
        {...baseProps}
        request={formRequest}
        values={{}}
        onCancel={onCancel}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("invokes onChange when a schema field changes", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    renderWithMantine(
      <InlineElicitationRequest
        {...baseProps}
        request={formRequest}
        values={{}}
        onChange={onChange}
      />,
    );
    await user.type(screen.getByLabelText("Host"), "x");
    expect(onChange).toHaveBeenCalled();
  });

  it("renders the URL badge and url in url mode", () => {
    renderWithMantine(
      <InlineElicitationRequest {...baseProps} request={urlRequest} />,
    );
    expect(screen.getByText("elicitation/create (url)")).toBeInTheDocument();
    expect(screen.getByText(urlRequest.url)).toBeInTheDocument();
  });

  it("does not render Submit button in url mode", () => {
    renderWithMantine(
      <InlineElicitationRequest {...baseProps} request={urlRequest} />,
    );
    expect(
      screen.queryByRole("button", { name: "Submit" }),
    ).not.toBeInTheDocument();
  });

  it("shows the waiting indicator when isWaiting is true", () => {
    renderWithMantine(
      <InlineElicitationRequest
        {...baseProps}
        request={urlRequest}
        isWaiting
      />,
    );
    expect(screen.getByText("Waiting...")).toBeInTheDocument();
  });

  it("hides the waiting indicator when isWaiting is false", () => {
    renderWithMantine(
      <InlineElicitationRequest
        {...baseProps}
        request={urlRequest}
        isWaiting={false}
      />,
    );
    expect(screen.queryByText("Waiting...")).not.toBeInTheDocument();
  });

  it("uses an empty values object when values prop is undefined", () => {
    renderWithMantine(
      <InlineElicitationRequest {...baseProps} request={formRequest} />,
    );
    expect(screen.getByText("Host")).toBeInTheDocument();
  });

  // #2020: this inline form had no submit gate at all — neither the missing
  // required answer that `ElicitationFormPanel` already checked, nor text a
  // field could not turn into a value (which never reaches `values`).
  describe("submit gating (#2020)", () => {
    const requiredRequest = {
      message: "Please provide your name.",
      requestedSchema: {
        type: "object" as const,
        properties: { name: { type: "string" as const, title: "Name" } },
        required: ["name"],
      },
    } satisfies ElicitRequest["params"];

    const numberRequest = {
      message: "Please provide the port.",
      requestedSchema: {
        type: "object" as const,
        properties: { port: { type: "number" as const, title: "Port number" } },
      },
    } satisfies ElicitRequest["params"];

    it("disables Submit while a required answer is missing", () => {
      renderWithMantine(
        <InlineElicitationRequest
          {...baseProps}
          request={requiredRequest}
          values={{}}
        />,
      );
      expect(screen.getByRole("button", { name: "Submit" })).toBeDisabled();
    });

    it("enables Submit once the required answer is given", () => {
      renderWithMantine(
        <InlineElicitationRequest
          {...baseProps}
          request={requiredRequest}
          values={{ name: "Ada" }}
        />,
      );
      expect(screen.getByRole("button", { name: "Submit" })).toBeEnabled();
    });

    it("disables Submit while a field holds text it cannot send", async () => {
      const user = userEvent.setup();
      renderWithMantine(
        <InlineElicitationRequest
          {...baseProps}
          request={numberRequest}
          values={{}}
        />,
      );
      const submit = screen.getByRole("button", { name: "Submit" });
      expect(submit).toBeEnabled();

      // Past MAX_SAFE_INTEGER the field reports no value rather than a rounded
      // one, so the answer would go out without the property.
      const input = screen.getByLabelText(/Port number/);
      await user.type(input, "90071992547409910");
      expect(submit).toBeDisabled();

      await user.clear(input);
      expect(submit).toBeEnabled();
    });
  });
});
