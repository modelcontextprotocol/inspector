import { describe, it, expect } from "vitest";
import { screen } from "@testing-library/react";
import type { MalformedListItem } from "@inspector/core/mcp";
import { renderWithMantine } from "../../../test/renderWithMantine";
import { MalformedItemsWarning } from "./MalformedItemsWarning";

const TEMPLATE_ENTRY: MalformedListItem = {
  method: "resources/templates/list",
  index: 1,
  label: "array_annotations",
  reason: "annotations: Invalid input: expected object, received array",
};

const TOOL_ENTRY: MalformedListItem = {
  method: "tools/list",
  index: 0,
  label: "get_weather",
  reason: "inputSchema: Invalid input: expected object, received string",
};

describe("MalformedItemsWarning", () => {
  it("names the dropped entry and why it was dropped", () => {
    renderWithMantine(
      <MalformedItemsWarning
        items={[TEMPLATE_ENTRY]}
        method="resources/templates/list"
        what="resource templates"
      />,
    );

    expect(screen.getByText("1 malformed entry dropped")).toBeInTheDocument();
    expect(screen.getByText("array_annotations")).toBeInTheDocument();
    expect(screen.getByText(TEMPLATE_ENTRY.reason)).toBeInTheDocument();
  });

  it("renders nothing when the server was conforming", () => {
    renderWithMantine(
      <MalformedItemsWarning
        items={[]}
        method="resources/templates/list"
        what="resource templates"
      />,
    );
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("ignores entries belonging to another list method", () => {
    // Every panel receives the whole set and selects its own — a tools failure
    // must not surface above the templates list.
    renderWithMantine(
      <MalformedItemsWarning
        items={[TOOL_ENTRY]}
        method="resources/templates/list"
        what="resource templates"
      />,
    );
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.queryByText("get_weather")).not.toBeInTheDocument();
  });

  it("pluralizes the count and lists every entry", () => {
    renderWithMantine(
      <MalformedItemsWarning
        items={[
          TOOL_ENTRY,
          { ...TOOL_ENTRY, index: 4, label: "add", reason: "name: bad" },
          TEMPLATE_ENTRY,
        ]}
        method="tools/list"
        what="tools"
      />,
    );

    expect(screen.getByText("2 malformed entries dropped")).toBeInTheDocument();
    expect(screen.getByText("get_weather")).toBeInTheDocument();
    expect(screen.getByText("add")).toBeInTheDocument();
    // The template entry belongs to the other panel.
    expect(screen.queryByText("array_annotations")).not.toBeInTheDocument();
  });

  it("falls back to the position when the entry had no usable name", () => {
    renderWithMantine(
      <MalformedItemsWarning
        items={[
          {
            method: "prompts/list",
            index: 2,
            reason: "Invalid input: expected object, received null",
          },
        ]}
        method="prompts/list"
        what="prompts"
      />,
    );
    expect(screen.getByText("entry 2")).toBeInTheDocument();
  });
});
