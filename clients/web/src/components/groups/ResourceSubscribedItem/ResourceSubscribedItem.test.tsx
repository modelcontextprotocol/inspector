import { describe, it, expect, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import type { InspectorResourceSubscription } from "@inspector/core/mcp/types.js";
import { renderWithMantine, screen } from "../../../test/renderWithMantine";
import { ResourceSubscribedItem } from "./ResourceSubscribedItem";

const subscription: InspectorResourceSubscription = {
  resource: { uri: "file:///foo/bar/config.json", name: "config.json" },
  lastUpdated: new Date("2024-01-01T12:00:00Z"),
};

describe("ResourceSubscribedItem", () => {
  it("renders the last URI path segment, not the name or title", () => {
    renderWithMantine(
      <ResourceSubscribedItem
        subscription={{
          resource: {
            uri: "file:///foo/bar/config.json",
            name: "ignored-name",
            title: "Ignored Title",
          },
        }}
        onUnsubscribe={() => {}}
      />,
    );
    expect(screen.getByText("config.json")).toBeInTheDocument();
    expect(screen.queryByText("ignored-name")).not.toBeInTheDocument();
    expect(screen.queryByText("Ignored Title")).not.toBeInTheDocument();
  });

  it("falls back to the URI itself when it has no slash-separated segments", () => {
    renderWithMantine(
      <ResourceSubscribedItem
        subscription={{ resource: { uri: "opaque", name: "n" } }}
        onUnsubscribe={() => {}}
      />,
    );
    expect(screen.getByText("opaque")).toBeInTheDocument();
  });

  it("ignores trailing slashes when picking the last segment", () => {
    renderWithMantine(
      <ResourceSubscribedItem
        subscription={{ resource: { uri: "file:///foo/bar/", name: "n" } }}
        onUnsubscribe={() => {}}
      />,
    );
    expect(screen.getByText("bar")).toBeInTheDocument();
  });

  it("shows the full URI in a tooltip on hover", async () => {
    const user = userEvent.setup();
    renderWithMantine(
      <ResourceSubscribedItem
        subscription={subscription}
        onUnsubscribe={() => {}}
      />,
    );
    await user.hover(screen.getByText("config.json"));
    expect(
      await screen.findByText("file:///foo/bar/config.json"),
    ).toBeInTheDocument();
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
