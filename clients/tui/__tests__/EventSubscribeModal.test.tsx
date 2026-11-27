import React from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { Box } from "ink";
import { render } from "./helpers/renderTui";
import type { EventType } from "@inspector/core/extension/events/schemas.js";

vi.mock("ink-form", () => import("./helpers/inkFormMock.js"));

import { EventSubscribeModal } from "../src/components/EventSubscribeModal.js";

const ESC = String.fromCharCode(27);

const eventType = (over: Partial<EventType> = {}): EventType => ({
  name: "deploy.completed",
  delivery: ["poll", "push"],
  inputSchema: {
    type: "object",
    properties: { region: { type: "string" } },
    required: ["region"],
  },
  ...over,
});

/** What the ink-form double submits on the next Enter (consumed once). */
function submitNext(value: Record<string, unknown>): void {
  (globalThis as Record<string, unknown>).__INK_FORM_SUBMIT_VALUE__ = value;
}

function renderModal(
  props: Partial<React.ComponentProps<typeof EventSubscribeModal>> = {},
) {
  const onSubscribe = vi.fn();
  const onClose = vi.fn();
  // Inside a sized parent, as App renders it: an absolutely positioned box
  // at the root is not laid out under ink-testing-library and draws nothing.
  const api = render(
    <Box width={100} height={30}>
      <EventSubscribeModal
        eventType={eventType()}
        width={100}
        height={30}
        onSubscribe={onSubscribe}
        onClose={onClose}
        {...props}
      />
    </Box>,
  );
  return { ...api, onSubscribe, onClose };
}

afterEach(() => {
  delete (globalThis as Record<string, unknown>).__INK_FORM_SUBMIT_VALUE__;
});

describe("EventSubscribeModal (#3032)", () => {
  it("subscribes with the chosen mode and arguments, then closes", async () => {
    const { stdin, lastFrame, onSubscribe, onClose } = renderModal();
    expect(lastFrame()).toContain("Subscribe: deploy.completed");
    submitNext({ delivery: "push", region: "us-west1" });
    stdin.write("\r");
    await vi.waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(onSubscribe).toHaveBeenCalledWith(
      expect.objectContaining({ name: "deploy.completed" }),
      "push",
      { region: "us-west1" },
    );
  });

  it("keeps the dialog open and says why when a required argument is missing", async () => {
    const { stdin, lastFrame, onSubscribe, onClose } = renderModal();
    submitNext({ delivery: "poll" });
    stdin.write("\r");
    await vi.waitFor(() =>
      expect(lastFrame()).toContain("Missing required argument: region"),
    );
    expect(onSubscribe).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("shows the engine's refusal and stays open", async () => {
    const { stdin, lastFrame, onClose } = renderModal({
      onSubscribe: () => {
        throw new Error("The server does not offer the Events extension");
      },
    });
    submitNext({ delivery: "poll", region: "eu" });
    stdin.write("\r");
    await vi.waitFor(() =>
      expect(lastFrame()).toContain(
        "The server does not offer the Events extension",
      ),
    );
    expect(onClose).not.toHaveBeenCalled();
  });

  it("explains a webhook-only type instead of offering a form", () => {
    const { lastFrame } = renderModal({
      eventType: eventType({ delivery: ["webhook"] }),
    });
    expect(lastFrame()).toContain("delivered by webhook only");
    expect(lastFrame()).not.toContain("MOCK_FORM");
  });

  it("closes on Esc, and pauses while another request owns the keyboard", async () => {
    const paused = renderModal({ inputActive: false });
    expect(paused.lastFrame()).toContain(
      "Paused while a server request is open",
    );
    paused.stdin.write(ESC);

    const { stdin, onClose } = renderModal();
    stdin.write(ESC);
    await vi.waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(paused.onClose).not.toHaveBeenCalled();
  });
});
