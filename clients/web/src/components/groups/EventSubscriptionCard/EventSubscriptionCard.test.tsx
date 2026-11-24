import { describe, it, expect, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { renderWithMantine, screen } from "../../../test/renderWithMantine";
import {
  EventSubscriptionCard,
  type EventSubscriptionCardProps,
} from "./EventSubscriptionCard";
import {
  activePoll,
  forbiddenPoll,
  reconnectingPush,
  terminatedPush,
} from "../../../test/fixtures/events";

function props(
  overrides: Partial<EventSubscriptionCardProps> = {},
): EventSubscriptionCardProps {
  return {
    subscription: activePoll,
    logFiltered: false,
    onStop: vi.fn(),
    onResume: vi.fn(),
    onRemove: vi.fn(),
    onToggleLogFilter: vi.fn(),
    ...overrides,
  };
}

describe("EventSubscriptionCard", () => {
  it("shows a live poll's state, cursor, interval and tallies, and stops", async () => {
    const p = props();
    renderWithMantine(<EventSubscriptionCard {...p} />);
    expect(screen.getByText("email.received")).toBeInTheDocument();
    expect(screen.getByText("poll")).toBeInTheDocument();
    expect(screen.getByText("active")).toBeInTheDocument();
    expect(screen.getByText("no arguments")).toBeInTheDocument();
    expect(screen.getByText("c-42")).toBeInTheDocument();
    expect(screen.getByText("Next poll")).toBeInTheDocument();
    expect(screen.getByText("5 s")).toBeInTheDocument();
    expect(screen.getByText(/3 events · 1 gaps/)).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Resume" }),
    ).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Stop" }));
    expect(p.onStop).toHaveBeenCalled();
  });

  it("shows a reconnecting push's heartbeat, null cursor and last error", () => {
    renderWithMantine(
      <EventSubscriptionCard {...props({ subscription: reconnectingPush })} />,
    );
    expect(screen.getByText("reconnecting")).toBeInTheDocument();
    expect(screen.getByText('{"severity":"P1"}')).toBeInTheDocument();
    expect(screen.getByText("none (from now)")).toBeInTheDocument();
    expect(screen.getByText("Heartbeat")).toBeInTheDocument();
    expect(screen.getByText("30 s")).toBeInTheDocument();
    expect(
      screen.getByText("Last error: -32603: stream dropped"),
    ).toBeInTheDocument();
  });

  it("offers resume and remove after a resumable termination", async () => {
    const p = props({ subscription: terminatedPush });
    renderWithMantine(<EventSubscriptionCard {...p} />);
    expect(
      screen.getByText(
        /Terminated \(removed, event types re-listed\): -32023 NotFound: Event type removed/,
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Stop" }),
    ).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Resume" }));
    await userEvent.click(screen.getByRole("button", { name: "Remove" }));
    expect(p.onResume).toHaveBeenCalled();
    expect(p.onRemove).toHaveBeenCalled();
  });

  it("offers only remove after a forbidden termination", () => {
    renderWithMantine(
      <EventSubscriptionCard {...props({ subscription: forbiddenPoll })} />,
    );
    expect(screen.getByText(/forbidden, no re-list/)).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Resume" }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Remove" })).toBeInTheDocument();
  });

  it("toggles the log filter and says which way it points", async () => {
    const p = props();
    const { rerender } = renderWithMantine(<EventSubscriptionCard {...p} />);
    await userEvent.click(
      screen.getByRole("button", { name: "Only this in log" }),
    );
    expect(p.onToggleLogFilter).toHaveBeenCalled();
    rerender(<EventSubscriptionCard {...p} logFiltered />);
    expect(
      screen.getByRole("button", { name: "Show all events" }),
    ).toHaveAttribute("aria-pressed", "true");
  });
});
