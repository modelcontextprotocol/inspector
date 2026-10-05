import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render } from "./helpers/renderTui";
import type { Resource } from "@modelcontextprotocol/client";
import type { InspectorClient } from "@inspector/core/mcp/index.js";
import type {
  InspectorResourceSubscription,
  MessageEntry,
  ResourceSubscriptionStreamState,
} from "@inspector/core/mcp/types.js";
import { INACTIVE_SUBSCRIPTION_STREAM_STATE } from "@inspector/core/mcp/types.js";
import { AuthRecoveryRequiredError } from "@inspector/core/auth/challenge.js";

const CHALLENGE = { reason: "insufficient_scope" as const };

vi.mock("ink-scroll-view", () => import("./helpers/inkScrollViewMock.js"));

import { SubscriptionsTab } from "../src/components/SubscriptionsTab.js";

const tick = async () => {
  for (let i = 0; i < 8; i++)
    await new Promise((resolve) => setTimeout(resolve, 4));
};
const ESC = String.fromCharCode(27);
const UP = `${ESC}[A`;
const DOWN = `${ESC}[B`;
const PAGE_UP = `${ESC}[5~`;
const PAGE_DOWN = `${ESC}[6~`;

const resA: Resource = { uri: "file:///a", name: "alpha" };
const resB: Resource = { uri: "file:///b", name: "" };

const updated = (id: string, uri: string): MessageEntry => ({
  id,
  timestamp: new Date(Date.UTC(2026, 0, 1, 12, 0, 0)),
  direction: "notification",
  message: {
    jsonrpc: "2.0",
    method: "notifications/resources/updated",
    params: { uri },
  },
});

interface FakeOps {
  subscribeToResource: ReturnType<typeof vi.fn>;
  unsubscribeFromResource: ReturnType<typeof vi.fn>;
}

const fakeClient = (over: Partial<FakeOps> = {}): FakeOps & InspectorClient =>
  ({
    subscribeToResource: vi.fn(async () => {}),
    unsubscribeFromResource: vi.fn(async () => {}),
    ...over,
  }) as unknown as FakeOps & InspectorClient;

function renderTab(
  props: Partial<React.ComponentProps<typeof SubscriptionsTab>> = {},
) {
  const client = fakeClient();
  const api = render(
    <SubscriptionsTab
      resources={[resA, resB]}
      subscriptions={[]}
      streamState={INACTIVE_SUBSCRIPTION_STREAM_STATE}
      messages={[]}
      inspectorClient={client}
      width={100}
      height={30}
      focusedPane="list"
      {...props}
    />,
  );
  return { ...api, client };
}

const subscribedA: InspectorResourceSubscription[] = [
  { resource: resA, lastUpdated: new Date(Date.UTC(2026, 0, 1, 12, 0, 0)) },
];

describe("SubscriptionsTab", () => {
  it("shows an empty state", () => {
    const { lastFrame } = renderTab({ resources: [] });
    const frame = lastFrame() ?? "";
    expect(frame).toContain("Subscriptions (0/0)");
    expect(frame).toContain("No resources to subscribe to");
    expect(frame).toContain("Resource updates");
    expect(frame).toContain("No resources/updated notifications yet");
    expect(frame).not.toContain("Enter to subscribe");
  });

  it("lists resources with subscription state and the update feed", () => {
    const { lastFrame } = renderTab({
      subscriptions: subscribedA,
      messages: [updated("m1", "file:///a"), updated("m2", "file:///b")],
    });
    const frame = lastFrame() ?? "";
    expect(frame).toContain("Subscriptions (1/2)");
    expect(frame).toContain("● alpha");
    // A resource with an empty name falls back to its URI.
    expect(frame).toContain("○ file:///b");
    expect(frame).toContain("Subscribed");
    expect(frame).toContain("last updated");
    expect(frame).toContain("Updates (2):");
    expect(frame).toContain("Enter to unsubscribe");
  });

  it("subscribes on Enter", async () => {
    const { stdin, client } = renderTab();
    stdin.write("\r");
    await tick();
    expect(client.subscribeToResource).toHaveBeenCalledWith("file:///a");
  });

  it("unsubscribes on Enter when subscribed", async () => {
    const { stdin, client } = renderTab({ subscriptions: subscribedA });
    stdin.write("\r");
    await tick();
    expect(client.unsubscribeFromResource).toHaveBeenCalledWith("file:///a");
  });

  it("shows a pending toggle and ignores a second Enter until it settles", async () => {
    let release: () => void = () => {};
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    const client = fakeClient({ subscribeToResource: vi.fn(() => pending) });
    const { stdin, lastFrame } = renderTab({ inspectorClient: client });
    stdin.write("\r");
    await tick();
    expect(lastFrame()).toContain("Updating subscription…");
    stdin.write("\r");
    await tick();
    expect(client.subscribeToResource).toHaveBeenCalledTimes(1);
    release();
    await tick();
    expect(lastFrame()).not.toContain("Updating subscription…");
  });

  it("surfaces a subscribe failure", async () => {
    const client = fakeClient({
      subscribeToResource: vi.fn(async () => {
        throw new Error("Server does not support resource subscriptions");
      }),
    });
    const { stdin, lastFrame } = renderTab({ inspectorClient: client });
    stdin.write("\r");
    await tick();
    expect(lastFrame()).toContain("does not support resource subscriptions");
  });

  it("surfaces a non-Error failure", async () => {
    const client = fakeClient({
      subscribeToResource: vi.fn(() => Promise.reject("nope")),
    });
    const { stdin, lastFrame } = renderTab({ inspectorClient: client });
    stdin.write("\r");
    await tick();
    expect(lastFrame()).toContain("nope");
  });

  it("hands auth recovery to the caller, and tolerates no handler", async () => {
    const recovery = new AuthRecoveryRequiredError(
      new URL("https://auth.example/start"),
      CHALLENGE,
    );
    const client = fakeClient({
      subscribeToResource: vi.fn(async () => {
        throw recovery;
      }),
    });
    const onAuthRecoveryRequired = vi.fn();
    const first = renderTab({
      inspectorClient: client,
      onAuthRecoveryRequired,
    });
    first.stdin.write("\r");
    await tick();
    expect(onAuthRecoveryRequired).toHaveBeenCalledWith(recovery);
    first.unmount();

    const second = renderTab({ inspectorClient: client });
    second.stdin.write("\r");
    await tick();
    expect(second.lastFrame()).toContain("Not subscribed");
  });

  it("does nothing without a client", async () => {
    const { stdin, lastFrame } = renderTab({ inspectorClient: null });
    stdin.write("\r");
    await tick();
    expect(lastFrame()).toContain("Not subscribed");
  });

  it("navigates the list and highlights the selection's updates", async () => {
    const { stdin, lastFrame } = renderTab({
      messages: [updated("m1", "file:///b")],
    });
    stdin.write(DOWN);
    await tick();
    expect(lastFrame()).toContain("URI: file:///b");
    stdin.write(DOWN); // at the end
    await tick();
    stdin.write(UP);
    await tick();
    expect(lastFrame()).toContain("URI: file:///a");
    stdin.write(UP); // at the top
    await tick();
    expect(lastFrame()).toContain("URI: file:///a");
  });

  it("scrolls the details pane", async () => {
    const { stdin, lastFrame } = renderTab({ focusedPane: "details" });
    for (const k of [UP, DOWN, PAGE_UP, PAGE_DOWN, "z"]) {
      stdin.write(k);
      await tick();
    }
    expect(lastFrame()).toContain("URI: file:///a");
  });

  it("shows the modern listen stream and an unhonored URI", () => {
    const streamState: ResourceSubscriptionStreamState = {
      active: true,
      status: "acknowledged",
      honoredUris: [],
    };
    const { lastFrame } = renderTab({
      subscriptions: subscribedA,
      streamState,
    });
    const frame = lastFrame() ?? "";
    expect(frame).toContain("Listen stream: acknowledged");
    expect(frame).toContain("did not honor");
  });

  it("does not flag a URI the server honored", () => {
    const { lastFrame } = renderTab({
      subscriptions: [{ resource: resA }],
      streamState: {
        active: true,
        status: "reconnecting",
        honoredUris: ["file:///a"],
      },
    });
    const frame = lastFrame() ?? "";
    expect(frame).toContain("Listen stream: reconnecting");
    expect(frame).not.toContain("did not honor");
    expect(frame).not.toContain("last updated");
  });

  it("ignores keys while a modal is open", async () => {
    const { stdin, client } = renderTab({ modalOpen: true });
    stdin.write("\r");
    await tick();
    expect(client.subscribeToResource).not.toHaveBeenCalled();
  });
});
