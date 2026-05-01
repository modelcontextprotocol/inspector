import { describe, it, expect, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import type { ElicitRequestFormParams } from "@modelcontextprotocol/sdk/types.js";
import { renderWithMantine, screen } from "../../../test/renderWithMantine";
import { ElicitationFormPanel } from "./ElicitationFormPanel";

const dbRequest: ElicitRequestFormParams = {
  message: "Please provide database connection details.",
  requestedSchema: {
    type: "object" as const,
    properties: {
      host: { type: "string" as const, title: "Host" },
      port: { type: "string" as const, title: "Port" },
    },
  },
};

const baseProps = {
  request: dbRequest,
  serverName: "postgres-server",
  values: {},
  onChange: vi.fn(),
  onSubmit: vi.fn(),
  onCancel: vi.fn(),
};

describe("ElicitationFormPanel", () => {
  it("renders the quoted request message", () => {
    renderWithMantine(<ElicitationFormPanel {...baseProps} />);
    expect(
      screen.getByText(/Please provide database connection details\./),
    ).toBeInTheDocument();
  });

  it("renders the warning with the server name", () => {
    renderWithMantine(<ElicitationFormPanel {...baseProps} />);
    expect(screen.getByText("Warning")).toBeInTheDocument();
    expect(screen.getByText(/postgres-server/)).toBeInTheDocument();
  });

  it("renders schema fields from the requested schema", () => {
    renderWithMantine(<ElicitationFormPanel {...baseProps} />);
    expect(screen.getByLabelText("Host")).toBeInTheDocument();
    expect(screen.getByLabelText("Port")).toBeInTheDocument();
  });

  it("renders Submit and Cancel buttons", () => {
    renderWithMantine(<ElicitationFormPanel {...baseProps} />);
    expect(screen.getByRole("button", { name: "Submit" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeInTheDocument();
  });

  it("invokes onSubmit when Submit is clicked", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    renderWithMantine(
      <ElicitationFormPanel {...baseProps} onSubmit={onSubmit} />,
    );
    await user.click(screen.getByRole("button", { name: "Submit" }));
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it("invokes onCancel when Cancel is clicked", async () => {
    const user = userEvent.setup();
    const onCancel = vi.fn();
    renderWithMantine(
      <ElicitationFormPanel {...baseProps} onCancel={onCancel} />,
    );
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("invokes onChange when a schema field is updated", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    renderWithMantine(
      <ElicitationFormPanel {...baseProps} onChange={onChange} />,
    );
    await user.type(screen.getByLabelText("Host"), "l");
    expect(onChange).toHaveBeenCalledWith({ host: "l" });
  });
});
