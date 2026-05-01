import { describe, it, expect, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import type { InspectorResourceSubscription } from "@inspector/core/mcp/types.js";
import { renderWithMantine, screen } from "../../../test/renderWithMantine";
import { ResourceSubscribedItem } from "./ResourceSubscribedItem";

const subscription: InspectorResourceSubscription = {
  resource: { uri: "file:///x", name: "x" },
  lastUpdated: new Date("2024-01-01T12:00:00Z"),
};

describe("ResourceSubscribedItem", () => {
  it("renders the resource name", () => {
    renderWithMantine(
      <ResourceSubscribedItem
        subscription={{ resource: subscription.resource }}
        onUnsubscribe={() => {}}
      />,
    );
    expect(screen.getByText("x")).toBeInTheDocument();
  });

  it("prefers the resource title over the name", () => {
    renderWithMantine(
      <ResourceSubscribedItem
        subscription={{
          resource: { ...subscription.resource, title: "Display X" },
        }}
        onUnsubscribe={() => {}}
      />,
    );
    expect(screen.getByText("Display X")).toBeInTheDocument();
  });

  it("renders the last updated timestamp when present", () => {
    renderWithMantine(
      <ResourceSubscribedItem
        subscription={subscription}
        onUnsubscribe={() => {}}
      />,
    );
    expect(
      screen.getByText(subscription.lastUpdated!.toLocaleString()),
    ).toBeInTheDocument();
  });

  it("invokes onUnsubscribe when the button is clicked", async () => {
    const user = userEvent.setup();
    const onUnsubscribe = vi.fn();
    renderWithMantine(
      <ResourceSubscribedItem
        subscription={subscription}
        onUnsubscribe={onUnsubscribe}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Unsubscribe" }));
    expect(onUnsubscribe).toHaveBeenCalledTimes(1);
  });
});
