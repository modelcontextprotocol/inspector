import React from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render } from "./helpers/renderTui";
import type { InspectorClient } from "@inspector/core/mcp/index.js";
import type { SamplingCreateMessage } from "@inspector/core/mcp/samplingCreateMessage.js";
import type { ElicitationCreateMessage } from "@inspector/core/mcp/elicitationCreateMessage.js";
import type { PendingRequestOrigin } from "@inspector/core/mcp/types.js";

vi.mock("ink-form", () => import("./helpers/inkFormMock.js"));
vi.mock("ink-scroll-view", () => import("./helpers/inkScrollViewMock.js"));
const openUrl = vi.hoisted(() =>
  vi.fn<(url: string, onFailure?: (message: string) => void) => Promise<void>>(
    async () => {},
  ),
);
vi.mock("../src/utils/openUrl.js", () => ({ openUrl }));

import { PendingRequestModal } from "../src/components/PendingRequestModal.js";

// The modal renders position="absolute", which ink-testing-library draws as
// an EMPTY frame (see RootsModal.test.tsx), so these tests assert on what the
// fake queue entries were asked to do rather than on lastFrame().

const tick = async () => {
  for (let i = 0; i < 8; i++)
    await new Promise((resolve) => setTimeout(resolve, 4));
};
const ESC = String.fromCharCode(27);
const PAGE_UP = `${ESC}[5~`;
const PAGE_DOWN = `${ESC}[6~`;

const setSubmitValue = (value: Record<string, unknown>) => {
  (globalThis as Record<string, unknown>).__INK_FORM_SUBMIT_VALUE__ = value;
};

afterEach(() => {
  delete (globalThis as Record<string, unknown>).__INK_FORM_SUBMIT_VALUE__;
  openUrl.mockClear();
});

interface FakeEntry {
  id: string;
  origin: PendingRequestOrigin;
  taskId?: string;
  request: { params: Record<string, unknown> };
  respond: ReturnType<typeof vi.fn>;
  reject: ReturnType<typeof vi.fn>;
}

function entry(
  id: string,
  params: Record<string, unknown>,
  extra: Partial<FakeEntry> = {},
): FakeEntry {
  return {
    id,
    origin: "server-request",
    request: { params },
    respond: vi.fn(async () => {}),
    reject: vi.fn(async () => {}),
    ...extra,
  };
}

// The modal reads only id/origin/taskId/request and calls respond/reject, so
// a structural fake stands in for core's classes, whose private settle state
// a test cannot construct without a live client.
const asSamples = (entries: FakeEntry[]) =>
  entries as unknown as SamplingCreateMessage[];
const asElicitations = (entries: FakeEntry[]) =>
  entries as unknown as ElicitationCreateMessage[];

const samplingParams = {
  maxTokens: 50,
  messages: [{ role: "user", content: { type: "text", text: "Hello?" } }],
};
const formParams = {
  message: "Who are you?",
  requestedSchema: {
    type: "object",
    properties: { name: { type: "string" } },
    required: ["name"],
  },
};
const urlParams = {
  mode: "url",
  message: "Sign in",
  url: "https://example.com/login",
  elicitationId: "e1",
};

function mount({
  samples = [],
  elicitations = [],
  client = null,
}: {
  samples?: FakeEntry[];
  elicitations?: FakeEntry[];
  client?: InspectorClient | null;
}) {
  return render(
    <PendingRequestModal
      pendingSamples={asSamples(samples)}
      pendingElicitations={asElicitations(elicitations)}
      inspectorClient={client}
      width={100}
      height={40}
    />,
  );
}

describe("PendingRequestModal", () => {
  it("renders nothing with an empty queue", () => {
    const { lastFrame } = mount({});
    expect(lastFrame()).toBe("");
  });

  describe("sampling", () => {
    it("approves with the submitted response, once", async () => {
      const sample = entry("s1", samplingParams);
      const { stdin } = mount({ samples: [sample] });
      await tick();
      setSubmitValue({ text: "Hi!", model: "m", stopReason: "endTurn" });
      stdin.write("\r");
      await tick();
      stdin.write("\r");
      await tick();
      expect(sample.respond).toHaveBeenCalledTimes(1);
      expect(sample.respond).toHaveBeenCalledWith({
        role: "assistant",
        model: "m",
        stopReason: "endTurn",
        content: { type: "text", text: "Hi!" },
      });
    });

    it("rejects after Esc then r", async () => {
      const sample = entry("s1", samplingParams);
      const { stdin } = mount({ samples: [sample] });
      await tick();
      stdin.write(ESC);
      await tick();
      stdin.write("r");
      await tick();
      expect(sample.reject).toHaveBeenCalledWith(
        new Error("Sampling request rejected by user."),
      );
      expect(sample.respond).not.toHaveBeenCalled();
    });

    it("backs out of the reject prompt on any other key", async () => {
      const sample = entry("s1", samplingParams);
      const { stdin } = mount({ samples: [sample] });
      await tick();
      stdin.write(ESC);
      await tick();
      stdin.write("x");
      await tick();
      stdin.write("r");
      await tick();
      expect(sample.reject).not.toHaveBeenCalled();
    });

    it("scrolls the request and survives a failed settle", async () => {
      const sample = entry("s1", samplingParams, {
        origin: "input-required",
        respond: vi.fn(async () => {
          throw new Error("already resolved");
        }),
      });
      const other = entry("s2", samplingParams);
      const { stdin } = mount({ samples: [sample, other] });
      await tick();
      stdin.write(PAGE_DOWN);
      stdin.write(PAGE_UP);
      await tick();
      stdin.write("\r");
      await tick();
      expect(sample.respond).toHaveBeenCalledTimes(1);
      expect(other.respond).not.toHaveBeenCalled();
    });

    it("does not submit on the Enter that backs out of the reject prompt", async () => {
      const sample = entry("s1", samplingParams);
      const { stdin } = mount({ samples: [sample] });
      await tick();
      stdin.write(ESC);
      await tick();
      stdin.write("\r");
      await tick();
      expect(sample.respond).not.toHaveBeenCalled();
      expect(sample.reject).not.toHaveBeenCalled();
      stdin.write("\r");
      await tick();
      expect(sample.respond).toHaveBeenCalledTimes(1);
    });

    it("is shown ahead of a queued elicitation", async () => {
      const sample = entry("s1", samplingParams);
      const elicitation = entry("e1", formParams);
      const { stdin } = mount({
        samples: [sample],
        elicitations: [elicitation],
      });
      await tick();
      stdin.write("\r");
      await tick();
      expect(sample.respond).toHaveBeenCalled();
      expect(elicitation.respond).not.toHaveBeenCalled();
    });
  });

  describe("form elicitation", () => {
    it("accepts with the submitted content", async () => {
      const elicitation = entry("e1", formParams);
      const { stdin } = mount({ elicitations: [elicitation] });
      await tick();
      setSubmitValue({ name: "Ada" });
      stdin.write("\r");
      await tick();
      expect(elicitation.respond).toHaveBeenCalledWith({
        action: "accept",
        content: { name: "Ada" },
      });
    });

    it("holds a submission that leaves a required field empty", async () => {
      const elicitation = entry("e1", {
        ...formParams,
        requestedSchema: {
          type: "object",
          properties: { a: { type: "string" }, b: { type: "string" } },
          required: ["a", "b"],
        },
      });
      const { stdin } = mount({ elicitations: [elicitation] });
      await tick();
      stdin.write("\r");
      await tick();
      setSubmitValue({ a: "x" });
      stdin.write("\r");
      await tick();
      expect(elicitation.respond).not.toHaveBeenCalled();
    });

    it("declines after Esc then d", async () => {
      const elicitation = entry("e1", formParams);
      const { stdin } = mount({ elicitations: [elicitation] });
      await tick();
      stdin.write(ESC);
      await tick();
      stdin.write("d");
      await tick();
      expect(elicitation.respond).toHaveBeenCalledWith({ action: "decline" });
    });

    it("cancels after Esc then c, and backs out on any other key", async () => {
      const elicitation = entry("e1", formParams, {
        respond: vi.fn(async () => {
          throw new Error("boom");
        }),
      });
      const { stdin } = mount({ elicitations: [elicitation] });
      await tick();
      stdin.write(ESC);
      await tick();
      stdin.write("x");
      await tick();
      stdin.write("c");
      await tick();
      expect(elicitation.respond).not.toHaveBeenCalled();
      stdin.write(ESC);
      await tick();
      stdin.write("c");
      await tick();
      expect(elicitation.respond).toHaveBeenCalledWith({ action: "cancel" });
    });

    it("does not accept on the Enter that backs out of the dismiss prompt", async () => {
      const elicitation = entry("e1", formParams);
      const { stdin } = mount({ elicitations: [elicitation] });
      await tick();
      stdin.write(ESC);
      await tick();
      setSubmitValue({ name: "Ada" });
      stdin.write("\r");
      await tick();
      expect(elicitation.respond).not.toHaveBeenCalled();
    });

    it("lets a failed task cancel be retried", async () => {
      const elicitation = entry("e1", formParams, {
        origin: "task-input-required",
        taskId: "task-9",
      });
      const cancelRequestorTask = vi
        .fn<(taskId: string) => Promise<void>>()
        .mockRejectedValueOnce(new Error("network down"))
        .mockResolvedValueOnce(undefined);
      // Only cancelRequestorTask is reached on this path.
      const client = { cancelRequestorTask } as unknown as InspectorClient;
      const { stdin } = mount({ elicitations: [elicitation], client });
      await tick();
      for (let i = 0; i < 2; i++) {
        stdin.write(ESC);
        await tick();
        stdin.write("c");
        await tick();
      }
      expect(cancelRequestorTask).toHaveBeenCalledTimes(2);
    });

    it("cancels the task behind a task-input-required request", async () => {
      const elicitation = entry("e1", formParams, {
        origin: "task-input-required",
        taskId: "task-9",
      });
      const cancelRequestorTask = vi.fn(async () => {});
      // Only cancelRequestorTask is reached on this path.
      const client = { cancelRequestorTask } as unknown as InspectorClient;
      const { stdin } = mount({ elicitations: [elicitation], client });
      await tick();
      stdin.write(ESC);
      await tick();
      stdin.write("c");
      await tick();
      expect(cancelRequestorTask).toHaveBeenCalledWith("task-9");
      expect(elicitation.respond).not.toHaveBeenCalled();
    });

    it("answers a task request without a task id directly", async () => {
      const elicitation = entry("e1", formParams, {
        origin: "task-input-required",
      });
      const { stdin } = mount({ elicitations: [elicitation] });
      await tick();
      stdin.write(ESC);
      await tick();
      stdin.write("c");
      await tick();
      expect(elicitation.respond).toHaveBeenCalledWith({ action: "cancel" });
    });
  });

  describe("URL elicitation", () => {
    it("opens the URL on o and accepts on Enter", async () => {
      const elicitation = entry("e1", urlParams);
      const { stdin } = mount({
        elicitations: [elicitation, entry("e2", urlParams)],
      });
      await tick();
      stdin.write("o");
      await tick();
      expect(openUrl).toHaveBeenCalledWith(
        "https://example.com/login",
        expect.any(Function),
      );
      // The failure callback lands on the status line without throwing.
      openUrl.mock.calls[0]![1]!("Could not open a browser");
      await tick();
      stdin.write("\r");
      await tick();
      expect(elicitation.respond).toHaveBeenCalledWith({ action: "accept" });
    });

    it("refuses to open a non-http URL", async () => {
      const elicitation = entry("e1", { ...urlParams, url: "file:///x" });
      const { stdin } = mount({ elicitations: [elicitation] });
      await tick();
      stdin.write("o");
      await tick();
      expect(openUrl).not.toHaveBeenCalled();
    });

    it.each([
      ["d", "decline"],
      ["c", "cancel"],
      [ESC, "cancel"],
    ])("settles on %j as %s", async (key, action) => {
      const elicitation = entry("e1", urlParams);
      const { stdin } = mount({ elicitations: [elicitation] });
      await tick();
      stdin.write(key);
      await tick();
      expect(elicitation.respond).toHaveBeenCalledWith({ action });
    });

    it("ignores unrelated keys", async () => {
      const elicitation = entry("e1", urlParams);
      const { stdin } = mount({ elicitations: [elicitation] });
      await tick();
      stdin.write("z");
      await tick();
      expect(elicitation.respond).not.toHaveBeenCalled();
    });
  });
});
