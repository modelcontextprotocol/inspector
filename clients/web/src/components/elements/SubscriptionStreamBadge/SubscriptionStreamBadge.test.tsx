import { describe, it, expect } from "vitest";
import { renderWithMantine, screen } from "../../../test/renderWithMantine";
import { SubscriptionStreamBadge } from "./SubscriptionStreamBadge";
import { subscriptionStreamPresentation } from "./subscriptionStreamUtils";

describe("subscriptionStreamPresentation", () => {
  it("maps each status to a color and label", () => {
    expect(subscriptionStreamPresentation("connecting")).toMatchObject({
      color: "blue",
      label: "Connecting…",
    });
    expect(subscriptionStreamPresentation("acknowledged")).toMatchObject({
      color: "green",
      label: "Listening",
    });
    expect(subscriptionStreamPresentation("reconnecting")).toMatchObject({
      color: "yellow",
      label: "Reconnecting…",
    });
    expect(subscriptionStreamPresentation("ended")).toMatchObject({
      color: "gray",
      label: "Stream ended",
    });
  });

  it("explains the listen stream in every tooltip", () => {
    for (const status of [
      "connecting",
      "acknowledged",
      "reconnecting",
      "ended",
    ] as const) {
      expect(subscriptionStreamPresentation(status).tooltip).toContain(
        "subscriptions/listen stream",
      );
    }
  });
});

describe("SubscriptionStreamBadge", () => {
  it("renders a labelled badge by default", () => {
    renderWithMantine(<SubscriptionStreamBadge status="acknowledged" />);
    expect(screen.getByText("Listening")).toBeInTheDocument();
  });

  it("renders a labelled reconnecting badge", () => {
    renderWithMantine(<SubscriptionStreamBadge status="reconnecting" />);
    expect(screen.getByText("Reconnecting…")).toBeInTheDocument();
  });

  it("renders a labelled ended badge", () => {
    renderWithMantine(<SubscriptionStreamBadge status="ended" />);
    expect(screen.getByText("Stream ended")).toBeInTheDocument();
  });
});
