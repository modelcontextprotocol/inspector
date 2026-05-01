import { describe, it, expect, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import type { InspectorServerJsonDraft } from "@inspector/core/mcp/types.js";
import { renderWithMantine, screen } from "../../../test/renderWithMantine";
import {
  ImportServerJsonPanel,
  type EnvVarInfo,
  type PackageInfo,
  type ValidationResult,
} from "./ImportServerJsonPanel";

const emptyDraft: InspectorServerJsonDraft = {
  rawText: "",
  envOverrides: {},
};

const baseHandlers = {
  onJsonChange: vi.fn(),
  onValidate: vi.fn(),
  onSelectPackage: vi.fn(),
  onEnvVarChange: vi.fn(),
  onServerNameChange: vi.fn(),
  onAddServer: vi.fn(),
  onCancel: vi.fn(),
};

describe("ImportServerJsonPanel", () => {
  it("renders the title and the action buttons", () => {
    renderWithMantine(
      <ImportServerJsonPanel
        {...baseHandlers}
        draft={emptyDraft}
        validation={[]}
        envVars={[]}
      />,
    );
    expect(
      screen.getByText("Import MCP Registry server.json"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Validate Again" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Add Server" }),
    ).toBeInTheDocument();
  });

  it("invokes onJsonChange when typing in the textarea", async () => {
    const user = userEvent.setup();
    const onJsonChange = vi.fn();
    renderWithMantine(
      <ImportServerJsonPanel
        {...baseHandlers}
        onJsonChange={onJsonChange}
        draft={emptyDraft}
        validation={[]}
        envVars={[]}
      />,
    );
    // The first textbox is the JSON textarea
    const allTextboxes = screen.getAllByRole("textbox");
    // userEvent.type treats `{` as a key-descriptor delimiter; escape with `{{`
    await user.type(allTextboxes[0], "x");
    expect(onJsonChange).toHaveBeenCalledWith("x");
  });

  it("invokes onValidate, onCancel, and onAddServer when their buttons are clicked", async () => {
    const user = userEvent.setup();
    const onValidate = vi.fn();
    const onCancel = vi.fn();
    const onAddServer = vi.fn();
    renderWithMantine(
      <ImportServerJsonPanel
        {...baseHandlers}
        onValidate={onValidate}
        onCancel={onCancel}
        onAddServer={onAddServer}
        draft={emptyDraft}
        validation={[]}
        envVars={[]}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Validate Again" }));
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    await user.click(screen.getByRole("button", { name: "Add Server" }));
    expect(onValidate).toHaveBeenCalledTimes(1);
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onAddServer).toHaveBeenCalledTimes(1);
  });

  it("renders all validation result types with messages", () => {
    const validation: ValidationResult[] = [
      { type: "success", message: "Valid format" },
      { type: "warning", message: "Missing optional field" },
      { type: "info", message: "1 package found" },
      { type: "error", message: "Invalid JSON" },
    ];
    renderWithMantine(
      <ImportServerJsonPanel
        {...baseHandlers}
        draft={emptyDraft}
        validation={validation}
        envVars={[]}
      />,
    );
    expect(screen.getByText("Valid format")).toBeInTheDocument();
    expect(screen.getByText("Missing optional field")).toBeInTheDocument();
    expect(screen.getByText("1 package found")).toBeInTheDocument();
    expect(screen.getByText("Invalid JSON")).toBeInTheDocument();
  });

  it("does not render the package selection block when fewer than 2 packages exist", () => {
    const packages: PackageInfo[] = [
      { registryType: "npm", identifier: "x", runtimeHint: "node" },
    ];
    renderWithMantine(
      <ImportServerJsonPanel
        {...baseHandlers}
        draft={emptyDraft}
        validation={[]}
        envVars={[]}
        packages={packages}
      />,
    );
    expect(screen.queryByText("Package Selection:")).not.toBeInTheDocument();
  });

  it("renders package selection radios and invokes onSelectPackage", async () => {
    const user = userEvent.setup();
    const onSelectPackage = vi.fn();
    const packages: PackageInfo[] = [
      { registryType: "npm", identifier: "@scope/server", runtimeHint: "node" },
      { registryType: "pip", identifier: "server-py", runtimeHint: "python3" },
    ];
    renderWithMantine(
      <ImportServerJsonPanel
        {...baseHandlers}
        onSelectPackage={onSelectPackage}
        draft={emptyDraft}
        validation={[]}
        envVars={[]}
        packages={packages}
      />,
    );
    expect(screen.getByText("Package Selection:")).toBeInTheDocument();
    expect(
      screen.getByLabelText("npm: @scope/server (node)"),
    ).toBeInTheDocument();
    await user.click(screen.getByLabelText("pip: server-py (python3)"));
    expect(onSelectPackage).toHaveBeenCalledWith(1);
  });

  it("renders environment variable inputs and invokes onEnvVarChange", async () => {
    const user = userEvent.setup();
    const onEnvVarChange = vi.fn();
    const envVars: EnvVarInfo[] = [
      {
        name: "API_KEY",
        description: "Authentication key",
        required: true,
        value: "",
      },
      { name: "DEBUG", required: false, value: "true" },
    ];
    renderWithMantine(
      <ImportServerJsonPanel
        {...baseHandlers}
        onEnvVarChange={onEnvVarChange}
        draft={emptyDraft}
        validation={[]}
        envVars={envVars}
      />,
    );
    expect(screen.getByText("Environment Variables:")).toBeInTheDocument();
    expect(screen.getByText("Authentication key")).toBeInTheDocument();
    const apiKeyInput = screen.getByLabelText(/API_KEY/);
    await user.type(apiKeyInput, "k");
    expect(onEnvVarChange).toHaveBeenCalledWith("API_KEY", "k");
  });

  it("invokes onServerNameChange when typing in the override field", async () => {
    const user = userEvent.setup();
    const onServerNameChange = vi.fn();
    renderWithMantine(
      <ImportServerJsonPanel
        {...baseHandlers}
        onServerNameChange={onServerNameChange}
        draft={emptyDraft}
        validation={[]}
        envVars={[]}
      />,
    );
    const nameInput = screen.getByLabelText(/Server Name/);
    await user.type(nameInput, "X");
    expect(onServerNameChange).toHaveBeenCalledWith("X");
  });

  it("renders the existing nameOverride value", () => {
    renderWithMantine(
      <ImportServerJsonPanel
        {...baseHandlers}
        draft={{ ...emptyDraft, nameOverride: "Custom Name" }}
        validation={[]}
        envVars={[]}
      />,
    );
    expect(screen.getByDisplayValue("Custom Name")).toBeInTheDocument();
  });
});
