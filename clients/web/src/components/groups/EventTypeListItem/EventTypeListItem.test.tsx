import { describe, it, expect, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { renderWithMantine, screen } from "../../../test/renderWithMantine";
import { EventTypeListItem } from "./EventTypeListItem";
import { allModesType, webhookOnlyType } from "../../../test/fixtures/events";

describe("EventTypeListItem", () => {
  it("shows the name, description and a badge per delivery mode", () => {
    renderWithMantine(
      <EventTypeListItem
        eventType={allModesType}
        selected={false}
        onClick={vi.fn()}
      />,
    );
    expect(screen.getByText("incident.created")).toBeInTheDocument();
    expect(screen.getByText(/new incident is created/)).toBeInTheDocument();
    for (const mode of ["poll", "push", "webhook"]) {
      expect(screen.getByText(mode)).toBeInTheDocument();
    }
  });

  it("omits the description when there is none, and reports clicks", async () => {
    const onClick = vi.fn();
    renderWithMantine(
      <EventTypeListItem
        eventType={webhookOnlyType}
        selected
        onClick={onClick}
      />,
    );
    await userEvent.click(
      screen.getByRole("button", { name: "payment.settled" }),
    );
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});
