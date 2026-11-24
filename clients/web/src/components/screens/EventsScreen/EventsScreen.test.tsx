import { useState } from "react";
import { describe, it, expect, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import {
  renderWithMantine,
  screen,
  within,
} from "../../../test/renderWithMantine";
import {
  EventsScreen,
  type EventsScreenProps,
  type EventsUiState,
} from "./EventsScreen";
import { EMPTY_EVENTS_UI } from "../screenUiState";
import { noopPagination } from "../../../test/fixtures/pagination";
import {
  activePoll,
  activeWebhook,
  WEBHOOK_SECRET,
  eventLog,
  eventTypes,
  subscriptions,
  terminatedPush,
} from "../../../test/fixtures/events";

function baseProps(): EventsScreenProps {
  return {
    eventTypes,
    listChanged: false,
    pagination: noopPagination,
    subscriptions,
    log: eventLog,
    ui: EMPTY_EVENTS_UI,
    onUiChange: vi.fn(),
    onRefreshList: vi.fn(),
    onSubscribe: vi.fn(),
    onStopSubscription: vi.fn(),
    onResumeSubscription: vi.fn(),
    onRemoveSubscription: vi.fn(),
    onClearLog: vi.fn(),
  };
}

/** Holds the lifted ui the way App does, and records every change. */
function Stateful(
  props: Partial<EventsScreenProps> & { initialUi?: EventsUiState },
) {
  const [ui, setUi] = useState<EventsUiState>(
    props.initialUi ?? EMPTY_EVENTS_UI,
  );
  return (
    <>
      <EventsScreen
        {...baseProps()}
        {...props}
        ui={ui}
        onUiChange={(next) => {
          setUi(next);
          props.onUiChange?.(next);
        }}
      />
      <output data-testid="ui">{JSON.stringify(ui)}</output>
    </>
  );
}

function ui(): EventsUiState {
  return JSON.parse(screen.getByTestId("ui").textContent ?? "{}");
}

describe("EventsScreen", () => {
  it("publishes its readiness contract and starts on a placeholder", () => {
    renderWithMantine(<EventsScreen {...baseProps()} />);
    const root = screen.getByTestId("events-screen");
    expect(root).toHaveAttribute("data-event-count", "4");
    expect(root).toHaveAttribute("data-subscription-count", "3");
    expect(root).toHaveAttribute("data-log-count", "7");
    expect(
      screen.getByText("Select an event type to subscribe"),
    ).toBeInTheDocument();
    expect(screen.getByText("Subscriptions (3)")).toBeInTheDocument();
  });

  it("says when there are no subscriptions", () => {
    renderWithMantine(
      <EventsScreen {...baseProps()} subscriptions={[]} log={[]} />,
    );
    expect(screen.getByText("No subscriptions yet.")).toBeInTheDocument();
  });

  it("selects a type with its schema defaults, and searches", async () => {
    const withDefault = {
      ...eventTypes[0]!,
      inputSchema: {
        type: "object",
        properties: { from: { type: "string", default: "me@example.com" } },
      },
    };
    renderWithMantine(
      <Stateful eventTypes={[withDefault, ...eventTypes.slice(1)]} />,
    );
    await userEvent.click(
      screen.getByRole("button", { name: "email.received" }),
    );
    expect(ui().selectedEventName).toBe("email.received");
    expect(ui().formValues).toEqual({ from: "me@example.com" });
    await userEvent.type(
      screen.getByPlaceholderText("Search events..."),
      "inc",
    );
    expect(ui().search).toBe("inc");
  });

  it("subscribes with converted arguments and the mode's tuning", async () => {
    const onSubscribe = vi.fn();
    renderWithMantine(
      <Stateful
        onSubscribe={onSubscribe}
        initialUi={{
          ...EMPTY_EVENTS_UI,
          selectedEventName: "incident.created",
          formValues: { service: "api", severity: "" },
          mode: "push",
          tuning: { maxAgeMs: 1000, maxEvents: 3, heartbeatMs: 5000 },
        }}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "Subscribe" }));
    expect(onSubscribe).toHaveBeenCalledWith(
      expect.objectContaining({ name: "incident.created" }),
      {
        mode: "push",
        arguments: { service: "api" },
        maxAgeMs: 1000,
        heartbeatMs: 5000,
      },
    );
  });

  it("lifts the form, mode and tuning edits", async () => {
    renderWithMantine(
      <Stateful
        initialUi={{
          ...EMPTY_EVENTS_UI,
          selectedEventName: "incident.created",
        }}
      />,
    );
    await userEvent.type(screen.getByRole("textbox", { name: "service" }), "x");
    expect(ui().formValues).toEqual({ service: "x" });
    await userEvent.click(screen.getByText("Push"));
    expect(ui().mode).toBe("push");
    await userEvent.type(screen.getByLabelText("maxAgeMs"), "9");
    expect(ui().tuning).toEqual({ maxAgeMs: 9 });
  });

  it("shows a refused subscribe, and clears it on the next selection", async () => {
    const onSubscribe = vi.fn(() => {
      throw new Error("not offered");
    });
    renderWithMantine(
      <Stateful
        onSubscribe={onSubscribe}
        initialUi={{ ...EMPTY_EVENTS_UI, selectedEventName: "email.received" }}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "Subscribe" }));
    expect(screen.getByText("not offered")).toBeInTheDocument();
    await userEvent.click(
      screen.getByRole("button", { name: "incident.created" }),
    );
    expect(screen.queryByText("not offered")).not.toBeInTheDocument();
  });

  it("reports a non-Error refusal as text", async () => {
    const onSubscribe = vi.fn(() => {
      throw "plain refusal";
    });
    renderWithMantine(
      <Stateful
        onSubscribe={onSubscribe}
        initialUi={{ ...EMPTY_EVENTS_UI, selectedEventName: "email.received" }}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "Subscribe" }));
    expect(screen.getByText("plain refusal")).toBeInTheDocument();
  });

  it("stops, resumes and removes subscriptions", async () => {
    const p = baseProps();
    renderWithMantine(<EventsScreen {...p} />);
    const cards = screen.getAllByTestId("event-subscription");
    await userEvent.click(
      within(cards[0]!).getByRole("button", { name: "Stop" }),
    );
    expect(p.onStopSubscription).toHaveBeenCalledWith(activePoll.id);
    await userEvent.click(
      within(cards[2]!).getByRole("button", { name: "Resume" }),
    );
    expect(p.onResumeSubscription).toHaveBeenCalledWith(terminatedPush.id);
    await userEvent.click(
      within(cards[2]!).getByRole("button", { name: "Remove" }),
    );
    expect(p.onRemoveSubscription).toHaveBeenCalledWith(terminatedPush.id);
    expect(p.onUiChange).not.toHaveBeenCalled();
  });

  it("shows a refused resume beside the form", async () => {
    renderWithMantine(
      <Stateful
        onResumeSubscription={() => {
          throw new Error("cannot be resumed");
        }}
        initialUi={{ ...EMPTY_EVENTS_UI, selectedEventName: "email.received" }}
      />,
    );
    const cards = screen.getAllByTestId("event-subscription");
    await userEvent.click(
      within(cards[2]!).getByRole("button", { name: "Resume" }),
    );
    expect(screen.getByText("cannot be resumed")).toBeInTheDocument();
  });

  it("narrows the log to one subscription, widens it, and drops a removed filter", async () => {
    renderWithMantine(<Stateful />);
    const cards = () => screen.getAllByTestId("event-subscription");
    await userEvent.click(
      within(cards()[2]!).getByRole("button", { name: "Only this in log" }),
    );
    expect(ui().logFilter).toBe(terminatedPush.id);
    expect(screen.getAllByTestId("event-log-entry")).toHaveLength(1);
    expect(
      screen.getByText("Occurrences — deploy.completed (push) (1)"),
    ).toBeInTheDocument();
    await userEvent.click(
      within(cards()[2]!).getByRole("button", { name: "Show all events" }),
    );
    expect(ui().logFilter).toBeUndefined();
    expect(screen.getAllByTestId("event-log-entry")).toHaveLength(7);

    await userEvent.click(
      within(cards()[2]!).getByRole("button", { name: "Only this in log" }),
    );
    await userEvent.click(
      within(cards()[2]!).getByRole("button", { name: "Remove" }),
    );
    expect(ui().logFilter).toBeUndefined();
  });

  it("clears the log", async () => {
    const p = baseProps();
    renderWithMantine(<EventsScreen {...p} />);
    await userEvent.click(screen.getByRole("button", { name: "Clear" }));
    expect(p.onClearLog).toHaveBeenCalled();
  });

  describe("webhook (#3031)", () => {
    it("subscribes with the callback, the TTL and the App-held secret", async () => {
      const onSubscribe = vi.fn();
      const onRegenerate = vi.fn();
      renderWithMantine(
        <Stateful
          onSubscribe={onSubscribe}
          webhookSecret={WEBHOOK_SECRET}
          onRegenerateWebhookSecret={onRegenerate}
          initialUi={{
            ...EMPTY_EVENTS_UI,
            selectedEventName: "incident.created",
            mode: "webhook",
            tuning: {
              callbackUrl: "https://hooks.example.com/in",
              ttlMs: 60000,
            },
          }}
        />,
      );
      await userEvent.click(screen.getByRole("button", { name: "Regenerate" }));
      expect(onRegenerate).toHaveBeenCalledOnce();
      await userEvent.click(screen.getByRole("button", { name: "Subscribe" }));
      expect(onSubscribe).toHaveBeenCalledWith(
        expect.objectContaining({ name: "incident.created" }),
        {
          mode: "webhook",
          arguments: {},
          webhook: {
            url: "https://hooks.example.com/in",
            secret: WEBHOOK_SECRET,
            ttlMs: 60000,
          },
        },
      );
      // The secret is never part of the lifted (sessionStorage-bound) state.
      expect(JSON.stringify(ui())).not.toContain(WEBHOOK_SECRET);
    });

    it("hands each webhook card its secret and refresh, and no other card", async () => {
      const getWebhookSecret = vi.fn(() => WEBHOOK_SECRET);
      const onRefreshWebhook = vi.fn();
      renderWithMantine(
        <Stateful
          subscriptions={[activePoll, activeWebhook]}
          getWebhookSecret={getWebhookSecret}
          onRefreshWebhook={onRefreshWebhook}
        />,
      );
      expect(getWebhookSecret).toHaveBeenCalledWith(activeWebhook.id);
      expect(getWebhookSecret).not.toHaveBeenCalledWith(activePoll.id);
      expect(
        screen.getAllByRole("button", { name: "Copy webhook secret" }),
      ).toHaveLength(1);
      await userEvent.click(
        screen.getByRole("button", { name: "Refresh now" }),
      );
      expect(onRefreshWebhook).toHaveBeenCalledWith(activeWebhook.id);
    });
  });
});
