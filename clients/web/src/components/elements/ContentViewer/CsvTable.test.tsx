import { describe, it, expect } from "vitest";
import { renderWithMantine, screen } from "../../../test/renderWithMantine";
import { CsvTable, MAX_ROWS } from "./CsvTable";

describe("CsvTable", () => {
  it("renders a table with headers and rows", () => {
    const csv = "name,age\nAlice,30\nBob,25";
    renderWithMantine(<CsvTable text={csv} />);
    expect(
      screen.getByRole("columnheader", { name: "name" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("columnheader", { name: "age" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("cell", { name: "Alice" })).toBeInTheDocument();
    expect(screen.getByRole("cell", { name: "25" })).toBeInTheDocument();
  });

  it("fills missing cells with empty strings", () => {
    const csv = "a,b,c\n1,2";
    const { container } = renderWithMantine(<CsvTable text={csv} />);
    const cells = container.querySelectorAll("tbody td");
    expect(cells).toHaveLength(3);
    expect(cells[2].textContent).toBe("");
  });

  it("caps rendered rows at MAX_ROWS and surfaces the truncation", () => {
    const total = MAX_ROWS + 50;
    const rows = Array.from({ length: total }, (_, i) => `r${i},${i}`);
    const csv = `name,n\n${rows.join("\n")}`;
    const { container } = renderWithMantine(<CsvTable text={csv} />);
    expect(container.querySelectorAll("tbody tr")).toHaveLength(MAX_ROWS);
    expect(
      screen.getByText(`Showing first ${MAX_ROWS} of ${total} rows`),
    ).toBeInTheDocument();
  });

  it("shows no truncation caption when all rows fit", () => {
    const csv = "name,age\nAlice,30\nBob,25";
    const { container } = renderWithMantine(<CsvTable text={csv} />);
    expect(container.querySelector("caption")).toBeNull();
  });

  it("falls back to a plain code block when there are no columns", () => {
    const { container } = renderWithMantine(<CsvTable text="" />);
    expect(container.querySelector("table")).toBeNull();
    expect(container.querySelector(".mantine-Code-root")).toBeInTheDocument();
  });

  it("falls back to a plain code block when there are no data rows", () => {
    // Header only, no data rows → not a useful table.
    const { container } = renderWithMantine(<CsvTable text="only_header" />);
    expect(container.querySelector("table")).toBeNull();
    expect(screen.getByText("only_header")).toBeInTheDocument();
  });
});
