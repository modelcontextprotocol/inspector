import { describe, it, expect, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import type { ResourceTemplate } from "@modelcontextprotocol/sdk/types.js";
import { renderWithMantine, screen } from "../../../test/renderWithMantine";
import { ResourceTemplatePanel } from "./ResourceTemplatePanel";

const singleVarTemplate: ResourceTemplate = {
  name: "User Profile",
  uriTemplate: "file:///users/{userId}/profile",
  description: "Fetch a user profile.",
};

const titledTemplate: ResourceTemplate = {
  name: "Table Row",
  title: "Database Row",
  uriTemplate: "db://tables/{tableName}/rows/{rowId}",
};

const annotatedTemplate: ResourceTemplate = {
  name: "Dynamic",
  uriTemplate: "resource://dynamic/{id}",
  annotations: { audience: ["user"], priority: 0.8 },
};

const noVarTemplate: ResourceTemplate = {
  name: "Static",
  uriTemplate: "file:///static.txt",
};

describe("ResourceTemplatePanel", () => {
  it("renders the template title (or name) and description", () => {
    renderWithMantine(
      <ResourceTemplatePanel
        template={singleVarTemplate}
        onReadResource={vi.fn()}
      />,
    );
    expect(screen.getByText("User Profile Template")).toBeInTheDocument();
    expect(screen.getByText("Fetch a user profile.")).toBeInTheDocument();
  });

  it("prefers the title over the name when present", () => {
    renderWithMantine(
      <ResourceTemplatePanel
        template={titledTemplate}
        onReadResource={vi.fn()}
      />,
    );
    expect(screen.getByText("Database Row Template")).toBeInTheDocument();
  });

  it("renders an input per template variable", () => {
    renderWithMantine(
      <ResourceTemplatePanel
        template={titledTemplate}
        onReadResource={vi.fn()}
      />,
    );
    expect(screen.getByLabelText("tableName")).toBeInTheDocument();
    expect(screen.getByLabelText("rowId")).toBeInTheDocument();
  });

  it("disables Read Resource until all variables are filled", async () => {
    const user = userEvent.setup();
    renderWithMantine(
      <ResourceTemplatePanel
        template={titledTemplate}
        onReadResource={vi.fn()}
      />,
    );
    const button = screen.getByRole("button", { name: "Read Resource" });
    expect(button).toBeDisabled();
    await user.type(screen.getByLabelText("tableName"), "users");
    expect(button).toBeDisabled();
    await user.type(screen.getByLabelText("rowId"), "42");
    expect(button).not.toBeDisabled();
  });

  it("invokes onReadResource with the resolved URI when submitted", async () => {
    const user = userEvent.setup();
    const onReadResource = vi.fn();
    renderWithMantine(
      <ResourceTemplatePanel
        template={singleVarTemplate}
        onReadResource={onReadResource}
      />,
    );
    await user.type(screen.getByLabelText("userId"), "alice");
    await user.click(screen.getByRole("button", { name: "Read Resource" }));
    expect(onReadResource).toHaveBeenCalledWith("file:///users/alice/profile");
  });

  it("updates the URI preview as variables change", async () => {
    const user = userEvent.setup();
    renderWithMantine(
      <ResourceTemplatePanel
        template={singleVarTemplate}
        onReadResource={vi.fn()}
      />,
    );
    expect(
      screen.getByText("file:///users/{userId}/profile"),
    ).toBeInTheDocument();
    await user.type(screen.getByLabelText("userId"), "bob");
    expect(screen.getByText("file:///users/bob/profile")).toBeInTheDocument();
  });

  it("renders annotation badges when present", () => {
    renderWithMantine(
      <ResourceTemplatePanel
        template={annotatedTemplate}
        onReadResource={vi.fn()}
      />,
    );
    expect(screen.getByText("audience: user")).toBeInTheDocument();
    expect(screen.getByText("priority: high")).toBeInTheDocument();
  });

  it("renders without description when not provided", () => {
    renderWithMantine(
      <ResourceTemplatePanel
        template={titledTemplate}
        onReadResource={vi.fn()}
      />,
    );
    expect(screen.queryByText("Fetch a user profile.")).not.toBeInTheDocument();
  });

  it("enables submission immediately when there are no variables", () => {
    renderWithMantine(
      <ResourceTemplatePanel
        template={noVarTemplate}
        onReadResource={vi.fn()}
      />,
    );
    expect(
      screen.getByRole("button", { name: "Read Resource" }),
    ).not.toBeDisabled();
  });
});
