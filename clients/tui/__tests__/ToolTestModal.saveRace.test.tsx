import React from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render } from "./helpers/renderTui";
import type { InspectorClient } from "@inspector/core/mcp/index.js";
import type { Tool } from "@modelcontextprotocol/client";
import type {
  SavePrompt,
  SaveStatus,
} from "../src/components/SaveResultBar.js";
import type { SavedResult } from "../src/utils/saveResult.js";

vi.mock("ink-scroll-view", () => import("./helpers/inkScrollViewMock.js"));
vi.mock("ink-form", () => import("./helpers/inkFormMock.js"));

// Each save resolves only when the test says so, so a write can be held in
// flight deterministically.
const pending: Array<{
  resolve: (v: SavedResult) => void;
  reject: (e: unknown) => void;
}> = [];
vi.mock("../src/utils/saveResult.js", () => ({
  defaultResultFileName: () => "alpha-result.json",
  saveResultToFile: () =>
    new Promise<SavedResult>((resolve, reject) => {
      pending.push({ resolve, reject });
    }),
}));

// The modal's frame is empty under ink-testing-library (position="absolute"),
// so the status it hands the bar is captured from the bar's props instead.
const statuses: Array<SaveStatus | null> = [];
const prompts: Array<SavePrompt | null> = [];
vi.mock("../src/components/SaveResultBar.js", () => ({
  SaveResultBar: ({
    prompt,
    status,
  }: {
    prompt: SavePrompt | null;
    status: SaveStatus | null;
  }) => {
    prompts.push(prompt);
    statuses.push(status);
    return null;
  },
}));

import { ToolTestModal } from "../src/components/ToolTestModal.js";

// Double cast: the modal only calls `callTool`, and a full InspectorClient is
// a class with private state no structural fake can satisfy.
const client = (callTool: unknown) =>
  ({ callTool }) as unknown as InspectorClient;

// Condition waits rather than fixed sleeps: each step waits for the state it
// needs, bounded so a regression fails instead of hanging.
const waitUntil = async (predicate: () => boolean) => {
  for (let i = 0; i < 500 && !predicate(); i++)
    await new Promise((resolve) => setTimeout(resolve, 4));
  expect(predicate()).toBe(true);
};
const lastStatus = () => statuses.at(-1);
const promptOpen = () => prompts.at(-1) != null;

type Api = ReturnType<typeof render>;

// Submit the form and open the save prompt. `w` only opens it once the result
// view is up, so it is re-pressed — but only while no prompt is open, so a
// stray press can never be typed into the path.
const submitAndOpenPrompt = async (api: Api, callTool: () => unknown) => {
  // Enter is likewise re-pressed only until the call goes out, since the form
  // ignores it until its input handler has subscribed.
  await waitUntil(() => {
    if (vi.mocked(callTool).mock.calls.length === 0) api.stdin.write("\r");
    return vi.mocked(callTool).mock.calls.length > 0;
  });
  await waitUntil(() => {
    if (!promptOpen()) api.stdin.write("w");
    return promptOpen();
  });
};

const renderModal = () => {
  const callTool = vi.fn().mockResolvedValue({
    success: true,
    result: { content: [{ type: "text", text: "hello" }] },
  });
  const api = render(
    <ToolTestModal
      tool={{ name: "alpha", inputSchema: { type: "object" } } as Tool}
      inspectorClient={client(callTool)}
      width={80}
      height={24}
      onClose={vi.fn()}
    />,
  );
  return { api, callTool };
};

afterEach(() => {
  pending.length = 0;
  statuses.length = 0;
  prompts.length = 0;
  delete (globalThis as Record<string, unknown>).__INK_FORM_SUBMIT_VALUE__;
});

describe("ToolTestModal save serialization (#2571)", () => {
  it("shows progress, then a confirmation with the right byte unit", async () => {
    const { api, callTool } = renderModal();
    await submitAndOpenPrompt(api, callTool);
    api.stdin.write("\r");
    await waitUntil(() => pending.length === 1);
    await waitUntil(
      () => lastStatus()?.message === "Saving to alpha-result.json…",
    );
    pending[0]!.resolve({ path: "/a.json", format: "json", bytes: 1 });
    await waitUntil(
      () => lastStatus()?.message === "Saved json result to /a.json (1 byte)",
    );
    // A second save from the same view, reported with the plural unit.
    api.stdin.write("w");
    await waitUntil(promptOpen);
    api.stdin.write("\r");
    await waitUntil(() => pending.length === 2);
    pending[1]!.resolve({ path: "/a.json", format: "json", bytes: 2 });
    await waitUntil(
      () => lastStatus()?.message === "Saved json result to /a.json (2 bytes)",
    );
    api.unmount();
  });

  it("an older save settling does not replace the newer one's status", async () => {
    const { api, callTool } = renderModal();
    await submitAndOpenPrompt(api, callTool);
    api.stdin.write("\r");
    await waitUntil(() => pending.length === 1);
    api.stdin.write("w");
    await waitUntil(promptOpen);
    // Edit the path so the two saves are told apart in the status.
    for (const len of [16, 15, 14, 13]) {
      api.stdin.write("\b");
      await waitUntil(() => prompts.at(-1)?.path.length === len);
    }
    api.stdin.write("newer");
    await waitUntil(() => prompts.at(-1)?.path === "alpha-result.newer");
    api.stdin.write("\r");
    await waitUntil(() => pending.length === 2);
    await waitUntil(
      () => lastStatus()?.message === "Saving to alpha-result.newer…",
    );
    pending[0]!.resolve({ path: "/old.json", format: "json", bytes: 3 });
    // A negative assertion has no condition to wait on, so the stale
    // completion gets a few macrotasks to land (it would within one).
    for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 4));
    expect(lastStatus()?.message).toBe("Saving to alpha-result.newer…");
    pending[1]!.resolve({ path: "/new.json", format: "json", bytes: 2 });
    await waitUntil(
      () =>
        lastStatus()?.message === "Saved json result to /new.json (2 bytes)",
    );
    api.unmount();
  });

  it("reports a non-Error rejection as text", async () => {
    const { api, callTool } = renderModal();
    await submitAndOpenPrompt(api, callTool);
    api.stdin.write("\r");
    await waitUntil(() => pending.length === 1);
    pending[0]!.reject("plain string");
    await waitUntil(() => lastStatus()?.message === "plain string");
    expect(lastStatus()?.ok).toBe(false);
    api.unmount();
  });
});
