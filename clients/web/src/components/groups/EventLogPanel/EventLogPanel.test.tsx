import { describe, it, expect, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { renderWithMantine, screen } from "../../../test/renderWithMantine";
import { EventLogPanel } from "./EventLogPanel";
import {
  eventLog,
  subscriptions,
  terminatedPush,
} from "../../../test/fixtures/events";

describe("EventLogPanel", () => {
  it("renders every entry kind, newest first", () => {
    renderWithMantine(
      <EventLogPanel
        entries={eventLog}
        subscriptions={subscriptions}
        onClear={vi.fn()}
      />,
    );
    const kinds = screen
      .getAllByTestId("event-log-entry")
      .map((e) => e.getAttribute("data-kind"));
    expect(kinds).toEqual([
      "event",
      "terminated",
      "reconnect",
      "error",
      "gap",
      "event",
      "event",
    ]);
    expect(screen.getByText("Occurrences (7)")).toBeInTheDocument();
    expect(screen.getByText(/Resuming from cursor c-42/)).toBeInTheDocument();
    expect(
      screen.getByText("-32025 ResourceExhausted: Too many streams"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Reconnecting: no heartbeat for 90 s"),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/removed: -32023 NotFound: Event type removed/),
    ).toHaveTextContent(/Resume is offered/);
    expect(screen.getByText(/cursor c-41/)).toBeInTheDocument();
  });

  it("renders a payload as inert text, never as markup", () => {
    renderWithMantine(
      <EventLogPanel
        entries={eventLog}
        subscriptions={subscriptions}
        onClear={vi.fn()}
      />,
    );
    // The fixture's subject is `<b>not bold</b>`: it must arrive as text.
    expect(screen.getByText(/<b>not bold<\/b>/)).toBeInTheDocument();
    expect(document.querySelector("b")).toBeNull();
  });

  it("badges payload validation: invalid, valid, or no schema", async () => {
    renderWithMantine(
      <EventLogPanel
        entries={eventLog}
        subscriptions={subscriptions}
        onClear={vi.fn()}
      />,
    );
    expect(screen.getByText("payload valid")).toBeInTheDocument();
    // The entry whose subscription is gone has no schema to check against.
    expect(screen.getByText("no payload schema")).toBeInTheDocument();
    await userEvent.hover(screen.getByText("payload invalid"));
    expect(
      await screen.findByText("data must have required property 'from'"),
    ).toBeInTheDocument();
  });

  it("does not offer a resume on a termination that has none", () => {
    renderWithMantine(
      <EventLogPanel
        entries={eventLog.filter((e) => e.kind === "terminated")}
        subscriptions={[
          {
            ...terminatedPush,
            termination: {
              ...terminatedPush.termination!,
              canResubscribe: false,
            },
          },
        ]}
        filteredTo="deploy.completed (push)"
        onClear={vi.fn()}
      />,
    );
    expect(
      screen.getByText("Occurrences — deploy.completed (push) (1)"),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Resume is offered/)).not.toBeInTheDocument();
  });

  it("clears, and says when there is nothing yet", async () => {
    const onClear = vi.fn();
    const { rerender } = renderWithMantine(
      <EventLogPanel entries={eventLog} subscriptions={[]} onClear={onClear} />,
    );
    await userEvent.click(screen.getByRole("button", { name: "Clear" }));
    expect(onClear).toHaveBeenCalled();
    rerender(
      <EventLogPanel entries={[]} subscriptions={[]} onClear={onClear} />,
    );
    expect(screen.getByText("No occurrences yet.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Clear" })).toBeDisabled();
  });
});
