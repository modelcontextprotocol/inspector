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

// Validation results, package selection, env vars, and the name override are
// only shown once content has been pasted/loaded, so tests for those sections
// use a draft with non-empty rawText.
const draftWithContent: InspectorServerJsonDraft = {
  rawText: '{"name":"x"}',
  envOverrides: {},
};

const baseHandlers = {
  onJsonChange: vi.fn(),
  onSelectPackage: vi.fn(),
  onEnvVarChange: vi.fn(),
  onServerNameChange: vi.fn(),
  onAddServer: vi.fn(),
};

describe("ImportServerJsonPanel", () => {
  it("renders the Add Server action", () => {
    renderWithMantine(
      <ImportServerJsonPanel
        {...baseHandlers}
        draft={emptyDraft}
        validation={[]}
        envVars={[]}
      />,
    );
    expect(
      screen.getByRole("button", { name: "Add Server" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Cancel" }),
    ).not.toBeInTheDocument();
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

  it("disables the Add Server button when addDisabled is set", () => {
    renderWithMantine(
      <ImportServerJsonPanel
        {...baseHandlers}
        addDisabled
        draft={emptyDraft}
        validation={[]}
        envVars={[]}
      />,
    );
    expect(screen.getByRole("button", { name: "Add Server" })).toBeDisabled();
  });

  it("renders the File Contents control with the highlight background", () => {
    renderWithMantine(
      <ImportServerJsonPanel
        {...baseHandlers}
        fileContentsHighlight
        draft={emptyDraft}
        validation={[]}
        envVars={[]}
      />,
    );
    expect(
      screen.getByRole("button", { name: "File Contents" }),
    ).toBeInTheDocument();
  });

  it("invokes onAddServer when the Add Server button is clicked", async () => {
    const user = userEvent.setup();
    const onAddServer = vi.fn();
    renderWithMantine(
      <ImportServerJsonPanel
        {...baseHandlers}
        onAddServer={onAddServer}
        draft={emptyDraft}
        validation={[]}
        envVars={[]}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Add Server" }));
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
        draft={draftWithContent}
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
        draft={draftWithContent}
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
        draft={draftWithContent}
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
        draft={draftWithContent}
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
        draft={draftWithContent}
        validation={[]}
        envVars={[]}
      />,
    );
    const nameInput = screen.getByLabelText(/Server Name/);
    await user.type(nameInput, "X");
    expect(onServerNameChange).toHaveBeenCalledWith("X");
  });

  it("clears the paste textarea, env-var, and name-override fields via Clear buttons", async () => {
    const user = userEvent.setup();
    const onJsonChange = vi.fn();
    const onEnvVarChange = vi.fn();
    const onServerNameChange = vi.fn();
    const envVars: EnvVarInfo[] = [
      { name: "DEBUG", required: false, value: "true" },
    ];
    renderWithMantine(
      <ImportServerJsonPanel
        {...baseHandlers}
        onJsonChange={onJsonChange}
        onEnvVarChange={onEnvVarChange}
        onServerNameChange={onServerNameChange}
        draft={{
          rawText: "{}",
          envOverrides: {},
          nameOverride: "Custom Name",
        }}
        validation={[]}
        envVars={envVars}
      />,
    );
    // DOM order: paste textarea, env-var input, name-override input.
    const clearButtons = screen.getAllByRole("button", { name: "Clear" });
    expect(clearButtons).toHaveLength(3);
    await user.click(clearButtons[0]);
    expect(onJsonChange).toHaveBeenCalledWith("");
    await user.click(clearButtons[1]);
    expect(onEnvVarChange).toHaveBeenCalledWith("DEBUG", "");
    await user.click(clearButtons[2]);
    expect(onServerNameChange).toHaveBeenCalledWith("");
  });

  it("does not render the file picker when onPickFile is absent", () => {
    renderWithMantine(
      <ImportServerJsonPanel
        {...baseHandlers}
        draft={emptyDraft}
        validation={[]}
        envVars={[]}
      />,
    );
    expect(
      screen.queryByRole("button", { name: /Choose file/ }),
    ).not.toBeInTheDocument();
  });

  it("renders a file picker and invokes onPickFile on upload", async () => {
    const user = userEvent.setup();
    const onPickFile = vi.fn();
    renderWithMantine(
      <ImportServerJsonPanel
        {...baseHandlers}
        onPickFile={onPickFile}
        draft={emptyDraft}
        validation={[]}
        envVars={[]}
      />,
    );
    expect(
      screen.getByRole("button", { name: /Choose file/ }),
    ).toBeInTheDocument();
    const file = new File(["{}"], "server.json", {
      type: "application/json",
    });
    const input = document.querySelector(
      'input[type="file"]',
    ) as HTMLInputElement;
    await user.upload(input, file);
    expect(onPickFile).toHaveBeenCalledTimes(1);
  });

  it("renders the existing nameOverride value", () => {
    renderWithMantine(
      <ImportServerJsonPanel
        {...baseHandlers}
        draft={{ ...draftWithContent, nameOverride: "Custom Name" }}
        validation={[]}
        envVars={[]}
      />,
    );
    expect(screen.getByDisplayValue("Custom Name")).toBeInTheDocument();
  });

  it("hides validation results and the name override until content is present", () => {
    const validation: ValidationResult[] = [
      { type: "info", message: "Paste server.json content to validate." },
    ];
    const { rerender } = renderWithMantine(
      <ImportServerJsonPanel
        {...baseHandlers}
        draft={emptyDraft}
        validation={validation}
        envVars={[]}
      />,
    );
    // Empty draft: gated sections hidden.
    expect(screen.queryByText("Validation Results")).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/Server Name/)).not.toBeInTheDocument();

    // Once content is present, they appear.
    rerender(
      <ImportServerJsonPanel
        {...baseHandlers}
        draft={draftWithContent}
        validation={validation}
        envVars={[]}
      />,
    );
    expect(screen.getByText("Validation Results")).toBeInTheDocument();
    expect(screen.getByLabelText(/Server Name/)).toBeInTheDocument();
  });
});
