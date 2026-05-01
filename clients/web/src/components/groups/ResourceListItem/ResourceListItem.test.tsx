import { describe, it, expect, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import type { Resource } from "@modelcontextprotocol/sdk/types.js";
import { renderWithMantine, screen } from "../../../test/renderWithMantine";
import { ResourceListItem } from "./ResourceListItem";

const baseResource: Resource = { uri: "file:///x", name: "config.json" };

describe("ResourceListItem", () => {
  it("renders the resource name", () => {
    renderWithMantine(
      <ResourceListItem
        resource={baseResource}
        selected={false}
        onClick={() => {}}
      />,
    );
    expect(screen.getByText("config.json")).toBeInTheDocument();
  });

  it("prefers the resource title", () => {
    renderWithMantine(
      <ResourceListItem
        resource={{ ...baseResource, title: "Configuration" }}
        selected={false}
        onClick={() => {}}
      />,
    );
    expect(screen.getByText("Configuration")).toBeInTheDocument();
  });

  it("renders annotation badges when annotations are present", () => {
    renderWithMantine(
      <ResourceListItem
        resource={{
          ...baseResource,
          annotations: { audience: ["user"], priority: 0.9 },
        }}
        selected={false}
        onClick={() => {}}
      />,
    );
    expect(screen.getByText("audience: user")).toBeInTheDocument();
    expect(screen.getByText("priority: high")).toBeInTheDocument();
  });

  it("hides badges when only an empty audience annotation exists", () => {
    renderWithMantine(
      <ResourceListItem
        resource={{ ...baseResource, annotations: { audience: [] } }}
        selected={false}
        onClick={() => {}}
      />,
    );
    expect(screen.queryByText(/audience/)).not.toBeInTheDocument();
  });

  it("invokes onClick when the row is clicked", async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    renderWithMantine(
      <ResourceListItem
        resource={baseResource}
        selected={false}
        onClick={onClick}
      />,
    );
    await user.click(screen.getByRole("button"));
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});
