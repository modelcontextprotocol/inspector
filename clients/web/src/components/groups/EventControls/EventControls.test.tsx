import { useState } from "react";
import { describe, it, expect, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { renderWithMantine, screen } from "../../../test/renderWithMantine";
import { EventControls, type EventControlsProps } from "./EventControls";
import { noopPagination } from "../../../test/fixtures/pagination";
import { eventTypes, pollOnlyType } from "../../../test/fixtures/events";

const excluded = [
  {
    eventType: { ...pollOnlyType, name: "invalid.header" },
    reason: "x-mcp-header value is not an RFC 9110 token",
  },
];

const baseProps: EventControlsProps = {
  eventTypes,
  listChanged: false,
  onRefreshList: vi.fn(),
  pagination: noopPagination,
  onSearchChange: vi.fn(),
  onSelectEventType: vi.fn(),
};

function Controlled(props: Partial<EventControlsProps>) {
  const [searchText, setSearchText] = useState("");
  return (
    <EventControls
      {...baseProps}
      {...props}
      searchText={searchText}
      onSearchChange={setSearchText}
    />
  );
}

describe("EventControls", () => {
  it("lists every event type sorted, with the server's count", () => {
    renderWithMantine(<EventControls {...baseProps} />);
    expect(screen.getByRole("heading", { name: "Events (4)" })).toBeVisible();
    const names = screen
      .getAllByRole("button", { name: /\./ })
      .map((b) => b.getAttribute("aria-label"));
    expect(names).toEqual([
      "deploy.completed",
      "email.received",
      "incident.created",
      "payment.settled",
    ]);
  });

  it("selects a type, but not the one already selected", async () => {
    const onSelectEventType = vi.fn();
    renderWithMantine(
      <EventControls
        {...baseProps}
        selectedName="email.received"
        onSelectEventType={onSelectEventType}
      />,
    );
    await userEvent.click(
      screen.getByRole("button", { name: "email.received" }),
    );
    expect(onSelectEventType).not.toHaveBeenCalled();
    await userEvent.click(
      screen.getByRole("button", { name: "incident.created" }),
    );
    expect(onSelectEventType).toHaveBeenCalledWith("incident.created");
  });

  it("filters the list and the exclusions, and clears the search", async () => {
    renderWithMantine(<Controlled excludedEventTypes={excluded} />);
    expect(screen.getByText("invalid.header")).toBeInTheDocument();
    await userEvent.type(
      screen.getByPlaceholderText("Search events..."),
      "deploy",
    );
    expect(
      screen.getByRole("button", { name: "deploy.completed" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "email.received" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("invalid.header")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /clear/i }));
    expect(screen.getByPlaceholderText("Search events...")).toHaveValue("");
  });

  it("shows the reason an excluded type was left out", async () => {
    renderWithMantine(
      <EventControls {...baseProps} excludedEventTypes={excluded} />,
    );
    await userEvent.hover(screen.getByText("invalid.header"));
    expect(
      await screen.findByText(/not an RFC 9110 token/),
    ).toBeInTheDocument();
  });

  it("withholds the count before the first load and on a failure", async () => {
    const onRefreshList = vi.fn();
    const { rerender } = renderWithMantine(
      <EventControls
        {...baseProps}
        pagination={{ ...noopPagination, loaded: false }}
      />,
    );
    expect(screen.getByRole("heading", { name: "Events" })).toBeVisible();
    rerender(
      <EventControls
        {...baseProps}
        loadError={new Error("list failed")}
        onRefreshList={onRefreshList}
        listChanged
      />,
    );
    expect(screen.getByRole("heading", { name: "Events" })).toBeVisible();
    expect(screen.getByText("list failed")).toBeInTheDocument();
  });
});
