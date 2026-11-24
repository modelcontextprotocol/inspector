import { useState } from "react";
import { describe, it, expect, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import type { EventSubscriptionMode } from "@inspector/core/mcp/state/eventSubscriptionsState.js";
import { renderWithMantine, screen } from "../../../test/renderWithMantine";
import {
  EventDetailPanel,
  type EventDetailPanelProps,
} from "./EventDetailPanel";
import type { SubscribeTuning } from "../../../utils/eventsUtils";
import {
  allModesType,
  headerAnnotatedType,
  pollOnlyType,
  webhookOnlyType,
} from "../../../test/fixtures/events";

const baseProps: EventDetailPanelProps = {
  eventType: allModesType,
  formValues: {},
  onFormChange: vi.fn(),
  mode: "poll",
  onModeChange: vi.fn(),
  tuning: {},
  onTuningChange: vi.fn(),
  onSubscribe: vi.fn(),
};

/** Holds the mode and tuning the way the screen does. */
function Stateful(props: Partial<EventDetailPanelProps>) {
  const [mode, setMode] = useState<EventSubscriptionMode | undefined>(
    props.mode ?? "poll",
  );
  const [tuning, setTuning] = useState<SubscribeTuning>({});
  const [formValues, setFormValues] = useState<Record<string, unknown>>({});
  return (
    <>
      <EventDetailPanel
        {...baseProps}
        {...props}
        mode={mode}
        onModeChange={setMode}
        tuning={tuning}
        onTuningChange={setTuning}
        formValues={formValues}
        onFormChange={setFormValues}
      />
      <output data-testid="state">{JSON.stringify({ mode, tuning })}</output>
    </>
  );
}

function state() {
  return JSON.parse(screen.getByTestId("state").textContent ?? "{}");
}

describe("EventDetailPanel", () => {
  it("shows the type, its modes and its schemas as text", async () => {
    renderWithMantine(<EventDetailPanel {...baseProps} />);
    // The title, and again as the Mcp-Name header value.
    expect(screen.getAllByText("incident.created")).toHaveLength(2);
    expect(screen.getByText(/new incident is created/)).toBeInTheDocument();
    expect(screen.getByText("webhook")).toBeInTheDocument();
    await userEvent.click(
      screen.getByRole("button", { name: "Payload schema" }),
    );
    expect(screen.getByText(/"incidentId"/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Input schema" }));
    expect(screen.getByText(/"severity"/)).toBeInTheDocument();
  });

  it("says when a type has no payload schema", async () => {
    renderWithMantine(
      <EventDetailPanel {...baseProps} eventType={headerAnnotatedType} />,
    );
    await userEvent.click(
      screen.getByRole("button", { name: "Payload schema" }),
    );
    expect(screen.getByText(/occurrences are not validated/)).toBeVisible();
  });

  it("names the Mcp-Name header and every mirrored Mcp-Param header", () => {
    renderWithMantine(
      <EventDetailPanel {...baseProps} eventType={headerAnnotatedType} />,
    );
    expect(screen.getByText("Mcp-Name")).toBeInTheDocument();
    expect(screen.getAllByText("deploy.completed")).toHaveLength(2);
    expect(screen.getByText("Mcp-Param-Region")).toBeInTheDocument();
  });

  it("offers only the subscribable modes, and switches between them", async () => {
    renderWithMantine(<Stateful />);
    const group = screen.getByRole("radiogroup", { name: "Delivery mode" });
    expect(group).toHaveTextContent("Poll");
    expect(group).toHaveTextContent("Push");
    expect(group).not.toHaveTextContent(/webhook/i);
    // Poll tuning: maxEvents, not heartbeatMs.
    expect(screen.getByLabelText("maxEvents")).toBeInTheDocument();
    expect(screen.queryByLabelText("heartbeatMs")).not.toBeInTheDocument();
    await userEvent.click(screen.getByText("Push"));
    expect(state().mode).toBe("push");
    expect(screen.getByLabelText("heartbeatMs")).toBeInTheDocument();
    expect(screen.queryByLabelText("maxEvents")).not.toBeInTheDocument();
  });

  it("reports each tuning field as a whole number, or unset when cleared", async () => {
    renderWithMantine(<Stateful />);
    await userEvent.type(screen.getByLabelText("maxAgeMs"), "6000");
    await userEvent.type(screen.getByLabelText("maxEvents"), "5");
    expect(state().tuning).toEqual({ maxAgeMs: 6000, maxEvents: 5 });
    await userEvent.clear(screen.getByLabelText("maxEvents"));
    expect(state().tuning).toEqual({ maxAgeMs: 6000 });
    await userEvent.click(screen.getByText("Push"));
    await userEvent.type(screen.getByLabelText("heartbeatMs"), "15000");
    expect(state().tuning).toEqual({ maxAgeMs: 6000, heartbeatMs: 15000 });
  });

  it("subscribes, and gates the button on a mode and the required arguments", async () => {
    const onSubscribe = vi.fn();
    const { rerender } = renderWithMantine(
      <EventDetailPanel {...baseProps} onSubscribe={onSubscribe} />,
    );
    await userEvent.click(screen.getByRole("button", { name: "Subscribe" }));
    expect(onSubscribe).toHaveBeenCalledTimes(1);

    // `region` is required and empty.
    rerender(
      <EventDetailPanel
        {...baseProps}
        eventType={headerAnnotatedType}
        onSubscribe={onSubscribe}
      />,
    );
    expect(screen.getByRole("button", { name: "Subscribe" })).toBeDisabled();
  });

  it("refuses a restored maxEvents of 0", () => {
    renderWithMantine(
      <EventDetailPanel {...baseProps} tuning={{ maxEvents: 0 }} />,
    );
    expect(screen.getByRole("button", { name: "Subscribe" })).toBeDisabled();
  });

  it("explains a type with no subscribable mode", () => {
    renderWithMantine(
      <EventDetailPanel
        {...baseProps}
        eventType={webhookOnlyType}
        mode={undefined}
      />,
    );
    expect(
      screen.getByText(/no delivery mode the Inspector can/),
    ).toBeVisible();
    expect(screen.queryByRole("radiogroup")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Subscribe" })).toBeDisabled();
  });

  it("shows why the last subscribe was refused", () => {
    renderWithMantine(
      <EventDetailPanel
        {...baseProps}
        eventType={pollOnlyType}
        subscribeError="does not advertise push delivery"
      />,
    );
    expect(screen.getByText("Subscribe failed")).toBeInTheDocument();
    expect(
      screen.getByText("does not advertise push delivery"),
    ).toBeInTheDocument();
  });
});
