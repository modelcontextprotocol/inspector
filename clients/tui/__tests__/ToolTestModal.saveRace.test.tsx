import React from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render } from "./helpers/renderTui";
import type { InspectorClient } from "@inspector/core/mcp/index.js";
import type { Tool } from "@modelcontextprotocol/client";
import type { SaveStatus } from "../src/components/SaveResultBar.js";
import type { SavedResult } from "../src/utils/saveResult.js";

vi.mock("ink-scroll-view", () => import("./helpers/inkScrollViewMock.js"));
vi.mock("ink-form", () => import("./helpers/inkFormMock.js"));

// Each save resolves only when the test says so, so the two writes can be
// settled out of order deterministically.
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
vi.mock("../src/components/SaveResultBar.js", () => ({
  SaveResultBar: ({ status }: { status: SaveStatus | null }) => {
    statuses.push(status);
    return null;
  },
}));

import { ToolTestModal } from "../src/components/ToolTestModal.js";

// Double cast: the modal only calls `callTool`, and a full InspectorClient is
// a class with private state no structural fake can satisfy.
const client = (callTool: unknown) =>
  ({ callTool }) as unknown as InspectorClient;

const tick = async () => {
  for (let i = 0; i < 8; i++)
    await new Promise((resolve) => setTimeout(resolve, 4));
};

afterEach(() => {
  pending.length = 0;
  statuses.length = 0;
  delete (globalThis as Record<string, unknown>).__INK_FORM_SUBMIT_VALUE__;
});

describe("ToolTestModal save ordering (#2571)", () => {
  it("ignores a save that settles after a newer one started", async () => {
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
    await tick();
    api.stdin.write("\r");
    await tick();
    // Two saves in flight at once.
    for (let i = 0; i < 2; i++) {
      api.stdin.write("w");
      await tick();
      api.stdin.write("\r");
      await tick();
    }
    expect(pending).toHaveLength(2);
    // The newer one settles first, then the older, slower one fails.
    pending[1]!.resolve({ path: "/new.json", format: "json", bytes: 1 });
    await tick();
    pending[0]!.reject("stale failure");
    await tick();
    expect(statuses.at(-1)).toEqual({
      ok: true,
      message: "Saved json result to /new.json (1 bytes)",
    });
    api.unmount();
  });

  it("reports a non-Error rejection as text", async () => {
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
    await tick();
    api.stdin.write("\r");
    await tick();
    api.stdin.write("w");
    await tick();
    api.stdin.write("\r");
    await tick();
    pending[0]!.reject("plain string");
    await tick();
    expect(statuses.at(-1)).toEqual({ ok: false, message: "plain string" });
    api.unmount();
  });
});
