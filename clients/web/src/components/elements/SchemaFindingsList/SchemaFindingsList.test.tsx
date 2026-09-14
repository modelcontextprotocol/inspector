import { useState } from "react";
import { describe, it, expect, vi } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Tool } from "@modelcontextprotocol/client";
import { lintToolSchemas } from "@inspector/core/json/schemaLint.js";
import { renderWithMantine } from "../../../test/renderWithMantine";
import { SchemaFindingsList } from "./SchemaFindingsList";

function findingsFor(tool: Partial<Tool>) {
  return lintToolSchemas({ name: "info", ...tool } as Tool);
}

/**
 * Expanded is the default in these tests, so the assertions read against the
 * findings themselves; the collapsed default belongs to the *caller*
 * (`useSchemaFindingsExpanded`), which has its own tests. `onExpandedChange`
 * is required, so a noop keeps the uncontrolled cases honest about it.
 */
function renderExpanded(findings: ReturnType<typeof findingsFor>) {
  return renderWithMantine(
    <SchemaFindingsList
      findings={findings}
      expanded
      onExpandedChange={vi.fn()}
    />,
  );
}

/** Drives the controlled `expanded` prop the way `ToolDetailPanel` does. */
function Controlled({
  findings,
  initial,
}: {
  findings: ReturnType<typeof findingsFor>;
  initial: boolean;
}) {
  const [expanded, setExpanded] = useState(initial);
  return (
    <SchemaFindingsList
      findings={findings}
      expanded={expanded}
      onExpandedChange={setExpanded}
    />
  );
}

describe("SchemaFindingsList", () => {
  it("renders nothing when there are no findings", () => {
    renderWithMantine(
      <SchemaFindingsList findings={[]} expanded onExpandedChange={vi.fn()} />,
    );
    expect(screen.queryByTestId("schema-findings")).not.toBeInTheDocument();
  });

  it("shows the path, severity, issue and fix for an error finding", () => {
    renderExpanded(
      findingsFor({
        outputSchema: { type: "object", properties: { data: true } },
      } as Partial<Tool>),
    );
    expect(screen.getByText("Schema portability")).toBeInTheDocument();
    expect(screen.getByText("1 error(s), 0 warning(s)")).toBeInTheDocument();
    expect(screen.getByText("error")).toBeInTheDocument();
    expect(
      screen.getByText("outputSchema.properties.data"),
    ).toBeInTheDocument();
    expect(screen.getByText(/Bare `true`/)).toBeInTheDocument();
    expect(screen.getByText(/^Fix: /)).toBeInTheDocument();
  });

  it("labels a warning finding as such", () => {
    renderExpanded(
      findingsFor({
        inputSchema: {
          type: "object",
          properties: { a: { type: ["null", "boolean"] } },
        },
      } as Partial<Tool>),
    );
    expect(screen.getByText("warning")).toBeInTheDocument();
    expect(screen.queryByText("error")).not.toBeInTheDocument();
  });

  it("renders one block per finding", () => {
    renderExpanded(
      findingsFor({
        inputSchema: { type: "object", properties: { a: true, b: true } },
      } as Partial<Tool>),
    );
    expect(screen.getByText("2 error(s), 0 warning(s)")).toBeInTheDocument();
    expect(screen.getAllByText("error")).toHaveLength(2);
  });

  // The point of #2205: the counts have to survive collapsing, or the closed
  // state hides the fact that the tool has findings at all.
  it("keeps the severity counts visible while collapsed", () => {
    renderWithMantine(
      <SchemaFindingsList
        findings={findingsFor({
          inputSchema: {
            type: "object",
            properties: { a: true, b: { type: ["null", "boolean"] } },
          },
        } as Partial<Tool>)}
        expanded={false}
        onExpandedChange={vi.fn()}
      />,
    );
    expect(screen.getByText("Schema portability")).toBeVisible();
    expect(screen.getByText("1 error(s), 1 warning(s)")).toBeVisible();
    expect(screen.getByText(/Bare `true`/)).not.toBeVisible();
  });

  it("reports its state on the toggle and reveals the findings when opened", async () => {
    const user = userEvent.setup();
    renderWithMantine(
      <Controlled
        findings={findingsFor({
          outputSchema: { type: "object", properties: { data: true } },
        } as Partial<Tool>)}
        initial={false}
      />,
    );

    const toggle = screen.getByRole("button", { name: /Schema portability/ });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByText(/Bare `true`/)).not.toBeVisible();

    await user.click(toggle);

    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText(/Bare `true`/)).toBeVisible();
  });

  it("collapses again on a second click", async () => {
    const user = userEvent.setup();
    renderWithMantine(
      <Controlled
        findings={findingsFor({
          outputSchema: { type: "object", properties: { data: true } },
        } as Partial<Tool>)}
        initial
      />,
    );

    const toggle = screen.getByRole("button", { name: /Schema portability/ });
    expect(toggle).toHaveAttribute("aria-expanded", "true");

    await user.click(toggle);

    expect(toggle).toHaveAttribute("aria-expanded", "false");
  });

  it("points the toggle at the region it reveals", () => {
    renderExpanded(
      findingsFor({
        outputSchema: { type: "object", properties: { data: true } },
      } as Partial<Tool>),
    );
    const toggle = screen.getByRole("button", { name: /Schema portability/ });
    const regionId = toggle.getAttribute("aria-controls");
    expect(regionId).toBeTruthy();
    expect(document.getElementById(regionId as string)).toBeInTheDocument();
  });
});
