import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import { describe, it } from "@jest/globals";
import { Combobox } from "../ui/combobox";

describe("combobox", () => {
  it("should render custom empty message", async () => {
    const customMessage = (
      <div data-testid="custom-empty">Custom empty message</div>
    );
    render(
      <Combobox
        value=""
        onChange={() => {}}
        onInputChange={() => {}}
        options={[]}
        emptyMessage={customMessage}
      />,
    );

    fireEvent.click(screen.getByRole("combobox"));

    expect(await screen.findByTestId("custom-empty")).toBeInTheDocument();
    expect(screen.getByText("Custom empty message")).toBeInTheDocument();
  });

  it("should render default empty message", async () => {
    render(
      <Combobox
        value=""
        onChange={() => {}}
        onInputChange={() => {}}
        options={[]}
      />,
    );

    fireEvent.click(screen.getByRole("combobox"));

    expect(await screen.findByText("No results found.")).toBeInTheDocument();
  });
});
