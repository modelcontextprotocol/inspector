import { describe, it, expect, beforeEach } from "vitest";
import type { SkillEntry } from "@inspector/core/mcp/skillsSchemas";
import {
  ManagedSkillsState,
  REPEATED_CURSOR_MESSAGE,
} from "@inspector/core/mcp/state/managedSkillsState";
import { FakeInspectorClient } from "@inspector/core/mcp/__tests__/fakeInspectorClient";

function skill(name: string): SkillEntry {
  return {
    uri: `skill://${name}/SKILL.md`,
    frontmatter: { name, description: `${name} skill` },
    resources: [],
  };
}

function waitFor<T>(
  state: ManagedSkillsState,
  event: "skillsChange" | "errorChange" | "paginationChange",
): Promise<T> {
  return new Promise((resolve) => {
    state.addEventListener(
      event,
      // The union of detail types across the three events is wider than any one
      // caller wants, so the resolve is typed at the call site.
      (e) => resolve(e.detail as T),
      { once: true },
    );
  });
}

describe("ManagedSkillsState", () => {
  let client: FakeInspectorClient;
  let state: ManagedSkillsState;

  beforeEach(() => {
    client = new FakeInspectorClient();
    client.skillsExtension = { directoryRead: false };
    state = new ManagedSkillsState(client);
  });

  it("starts empty and returns defensive copies", () => {
    expect(state.getSkills()).toEqual([]);
    expect(state.getSkills()).not.toBe(state.getSkills());
    expect(state.getPagination()).toEqual({ pageCount: 0 });
    expect(state.getError()).toBeNull();
  });

  it("refresh no-ops while disconnected", async () => {
    await state.refresh();
    expect(client.listSkills).not.toHaveBeenCalled();
  });

  it("returns an empty list without calling the server when the extension is absent", async () => {
    // Calling `skills/list` against a server that never declared the extension
    // gets -32601 and spams the console for a question already answered.
    client.setStatus("connected");
    client.skillsExtension = undefined;
    await state.refresh();
    expect(client.listSkills).not.toHaveBeenCalled();
    expect(state.getSkills()).toEqual([]);
  });

  it("walks every page and reports how many it took", async () => {
    client.setStatus("connected");
    client.skillPages = [
      { skills: [skill("a"), skill("b")], nextCursor: "2" },
      { skills: [skill("c")], nextCursor: undefined },
    ];
    const skills = await state.refresh();
    expect(skills.map((s) => s.frontmatter.name)).toEqual(["a", "b", "c"]);
    expect(state.getPagination()).toEqual({ pageCount: 2 });
    expect(client.listSkills).toHaveBeenCalledTimes(2);
  });

  it("dispatches skillsChange and paginationChange on a successful walk", async () => {
    client.setStatus("connected");
    client.skillPages = [{ skills: [skill("a")] }];
    const skillsEvent = waitFor<SkillEntry[]>(state, "skillsChange");
    const paginationEvent = waitFor<{ pageCount: number }>(
      state,
      "paginationChange",
    );
    await state.refresh();
    expect(await skillsEvent).toHaveLength(1);
    expect(await paginationEvent).toEqual({ pageCount: 1 });
  });

  it("loads on connect", async () => {
    client.skillPages = [{ skills: [skill("a")] }];
    const skillsEvent = waitFor<SkillEntry[]>(state, "skillsChange");
    await client.connect();
    expect(await skillsEvent).toHaveLength(1);
  });

  it("stops and reports when the server repeats a cursor", async () => {
    client.setStatus("connected");
    // A server stuck on one cursor would otherwise walk forever, so the guard
    // is what keeps a server bug from becoming a hang.
    client.listSkills.mockResolvedValue({
      skills: [skill("a")],
      nextCursor: "same",
    });
    await expect(state.refresh()).rejects.toThrow(REPEATED_CURSOR_MESSAGE);
    expect(state.getError()?.message).toBe(REPEATED_CURSOR_MESSAGE);
  });

  it("records a failure as observable state and re-throws it", async () => {
    client.setStatus("connected");
    const failure = new Error("boom");
    client.listSkills.mockRejectedValueOnce(failure);
    const errorEvent = waitFor<Error | null>(state, "errorChange");
    await expect(state.refresh()).rejects.toThrow("boom");
    expect(await errorEvent).toBe(failure);
    expect(state.getError()).toBe(failure);
  });

  it("wraps a non-Error rejection", async () => {
    client.setStatus("connected");
    client.listSkills.mockRejectedValueOnce("just a string");
    await expect(state.refresh()).rejects.toBeDefined();
    expect(state.getError()?.message).toBe("just a string");
  });

  it("clears the error once a later walk succeeds", async () => {
    client.setStatus("connected");
    client.listSkills.mockRejectedValueOnce(new Error("boom"));
    await expect(state.refresh()).rejects.toThrow();
    client.skillPages = [{ skills: [skill("a")] }];
    await state.refresh();
    expect(state.getError()).toBeNull();
  });

  it("swallows the connect-time load's rejection rather than leaking it", async () => {
    // Nobody awaits the connect-time load, so an unhandled rejection would
    // fail an unrelated test file. The failure still lands on `getError`.
    client.listSkills.mockRejectedValueOnce(new Error("connect boom"));
    const errorEvent = waitFor<Error | null>(state, "errorChange");
    await client.connect();
    expect((await errorEvent)?.message).toBe("connect boom");
  });

  it("makes a second refresh a no-op while one is in flight", async () => {
    client.setStatus("connected");
    let release: (() => void) | undefined;
    client.listSkills.mockImplementationOnce(
      async () =>
        new Promise((resolve) => {
          release = () => resolve({ skills: [skill("a")] });
        }),
    );
    const first = state.refresh();
    const second = await state.refresh();
    expect(second).toEqual([]);
    expect(client.listSkills).toHaveBeenCalledTimes(1);
    release?.();
    await first;
    expect(state.getSkills()).toHaveLength(1);
  });

  it("clears the list and the error on disconnect", async () => {
    client.setStatus("connected");
    client.skillPages = [{ skills: [skill("a")] }];
    await state.refresh();
    await client.disconnect();
    expect(state.getSkills()).toEqual([]);
    expect(state.getPagination()).toEqual({ pageCount: 0 });
    expect(state.getError()).toBeNull();
  });

  it("destroy unsubscribes so a later connect does not refetch", async () => {
    state.destroy();
    await client.connect();
    expect(client.listSkills).not.toHaveBeenCalled();
    // Idempotent.
    state.destroy();
  });
});
