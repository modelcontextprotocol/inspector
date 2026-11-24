import { describe, it, expect, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { renderWithMantine, screen } from "../../../test/renderWithMantine";
import {
  EventSubscriptionCard,
  type EventSubscriptionCardProps,
} from "./EventSubscriptionCard";
import {
  activePoll,
  activeWebhook,
  forbiddenPoll,
  reconnectingPush,
  rejectedWebhook,
  stoppedWebhook,
  terminatedPush,
  throttledWebhook,
  WEBHOOK_SECRET,
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

  describe("webhook (#3031)", () => {
    it("shows the callback, grant and delivery status; refreshes and unsubscribes", async () => {
      const onRefresh = vi.fn();
      const p = props({
        subscription: activeWebhook,
        webhookSecret: WEBHOOK_SECRET,
        onRefresh,
      });
      const { container } = renderWithMantine(<EventSubscriptionCard {...p} />);
      expect(screen.getByText("https://hooks.example.com/in")).toBeVisible();
      expect(screen.getByText("sub_a3f1c8e2b0d49f7e")).toBeVisible();
      expect(screen.getByText("60 min")).toBeVisible();
      expect(screen.getByText("2026-11-24T11:30:00.000Z")).toBeVisible();
      expect(screen.getByText("2026-11-24T11:25:00.000Z")).toBeVisible();
      expect(screen.getByText("2 successful subscribes")).toBeVisible();
      expect(
        screen.getByText(/^Suspended after repeated failures/),
      ).toBeVisible();
      expect(
        screen.getByText(/Last error: http_5xx — the endpoint answered/),
      ).toBeVisible();
      expect(screen.getByText(/0 gaps · 0 errors · 0/)).toBeVisible();
      expect(screen.queryByText(/duplicates/)).not.toBeInTheDocument();
      // Masked, with a copy control; the value is never in the DOM.
      expect(container.innerHTML).not.toContain(WEBHOOK_SECRET.slice(6));
      expect(
        screen.getByRole("button", { name: "Copy webhook secret" }),
      ).toBeInTheDocument();

      await userEvent.click(
        screen.getByRole("button", { name: "Refresh now" }),
      );
      expect(onRefresh).toHaveBeenCalledOnce();
      await userEvent.click(
        screen.getByRole("button", { name: "Unsubscribe" }),
      );
      expect(p.onStop).toHaveBeenCalledOnce();
    });

    it("shows a no-expiry grant, a gap and throttling", () => {
      renderWithMantine(
        <EventSubscriptionCard
          {...props({ subscription: throttledWebhook })}
        />,
      );
      expect(screen.getByText("no expiry")).toBeVisible();
      expect(screen.getByText("never (no expiry)")).toBeVisible();
      expect(screen.queryByText("Next refresh")).not.toBeInTheDocument();
      expect(
        screen.getByText(
          "1 successful subscribe · last response truncated (gap)",
        ),
      ).toBeVisible();
      expect(screen.getByText(/^Throttled: deliveries delayed/)).toBeVisible();
      // No secret was handed over, so no copy control and no refresh offered.
      expect(
        screen.queryByRole("button", { name: /Copy/ }),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: "Refresh now" }),
      ).not.toBeInTheDocument();
    });

    it("shows a stopped one's failed unsubscribe and the pending grant", () => {
      renderWithMantine(
        <EventSubscriptionCard {...props({ subscription: stoppedWebhook })} />,
      );
      expect(screen.getByText("not granted yet")).toBeVisible();
      expect(screen.getByText("server default")).toBeVisible();
      expect(screen.getByText(/No delivery status reported/)).toBeVisible();
      expect(
        screen.getByText("Unsubscribe failed: -32603: network down"),
      ).toBeVisible();
      expect(screen.getByRole("button", { name: "Resume" })).toBeVisible();
    });

    it("offers to retry a failed unsubscribe", async () => {
      const p = props({ subscription: stoppedWebhook });
      renderWithMantine(<EventSubscriptionCard {...p} />);
      await userEvent.click(
        screen.getByRole("button", { name: "Retry unsubscribe" }),
      );
      expect(p.onStop).toHaveBeenCalledOnce();
    });

    it.each([
      ["pending", "Unsubscribing…"],
      ["done", "Unsubscribed on the server."],
      ["gone", /Already gone on the server/],
    ] as const)("labels an unsubscribe that is %s", (status, label) => {
      renderWithMantine(
        <EventSubscriptionCard
          {...props({
            subscription: {
              ...stoppedWebhook,
              webhook: { ...stoppedWebhook.webhook!, unsubscribe: { status } },
            },
          })}
        />,
      );
      expect(screen.getByText(label)).toBeVisible();
    });

    it("labels a failed unsubscribe that carries no error", () => {
      renderWithMantine(
        <EventSubscriptionCard
          {...props({
            subscription: {
              ...stoppedWebhook,
              webhook: {
                ...stoppedWebhook.webhook!,
                unsubscribe: { status: "failed" },
              },
            },
          })}
        />,
      );
      expect(screen.getByText("Unsubscribe failed")).toBeVisible();
    });

    it("explains a CallbackEndpointError termination", () => {
      renderWithMantine(
        <EventSubscriptionCard {...props({ subscription: rejectedWebhook })} />,
      );
      expect(
        screen.getByText(
          /could not verify the callback endpoint \(challenge_failed\)/,
        ),
      ).toBeVisible();
      expect(
        screen.queryByRole("button", { name: "Resume" }),
      ).not.toBeInTheDocument();
    });

    it("explains a webhook's last error the webhook way", () => {
      renderWithMantine(
        <EventSubscriptionCard
          {...props({
            subscription: {
              ...activeWebhook,
              lastError: { code: -32024, message: "Forbidden" },
            },
          })}
        />,
      );
      expect(screen.getByText(/need an authenticated principal/)).toBeVisible();
    });
  });
});
