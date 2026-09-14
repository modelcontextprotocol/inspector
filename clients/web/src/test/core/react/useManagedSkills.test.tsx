import { describe, it, expect, beforeEach } from "vitest";
import { act, renderHook } from "@testing-library/react";
import type { SkillEntry } from "@inspector/core/mcp/skillsSchemas";
import { FakeInspectorClient } from "@inspector/core/mcp/__tests__/fakeInspectorClient";
import { ManagedSkillsState } from "@inspector/core/mcp/state/managedSkillsState";
import { useManagedSkills } from "@inspector/core/react/useManagedSkills";

function skill(name: string): SkillEntry {
  return {
    uri: `skill://${name}/SKILL.md`,
    frontmatter: { name, description: `${name} skill` },
    resources: [],
  };
}

describe("useManagedSkills", () => {
  let client: FakeInspectorClient;
  let state: ManagedSkillsState;

  beforeEach(() => {
    client = new FakeInspectorClient({ status: "connected" });
    client.skillsExtension = { directoryRead: false };
    state = new ManagedSkillsState(client);
  });

  it("reports the store's current snapshot on first render", async () => {
    client.skillPages = [{ skills: [skill("a"), skill("b")] }];
    await state.refresh();

    const { result } = renderHook(() => useManagedSkills(client, state));
    expect(result.current.skills.map((s) => s.frontmatter.name)).toEqual([
      "a",
      "b",
    ]);
    expect(result.current.pageCount).toBe(1);
    expect(result.current.error).toBeNull();
  });

  it("degrades to empty values when no store is attached", async () => {
    const { result } = renderHook(() => useManagedSkills(client, null));
    expect(result.current.skills).toEqual([]);
    expect(result.current.pageCount).toBe(0);
    expect(result.current.error).toBeNull();
    // The refresh is still callable and simply resolves to the empty list.
    await expect(result.current.refresh()).resolves.toEqual([]);
  });

  it("updates when the store dispatches", async () => {
    const { result } = renderHook(() => useManagedSkills(client, state));
    expect(result.current.skills).toEqual([]);

    client.skillPages = [
      { skills: [skill("a")], nextCursor: "1" },
      { skills: [skill("b")] },
    ];
    await act(async () => {
      await state.refresh();
    });
    expect(result.current.skills).toHaveLength(2);
    expect(result.current.pageCount).toBe(2);
  });

  it("holds the snapshot identity stable across renders with no dispatch", async () => {
    client.skillPages = [{ skills: [skill("a")] }];
    await state.refresh();
    const { result, rerender } = renderHook(() =>
      useManagedSkills(client, state),
    );
    const first = result.current.skills;
    rerender();
    // `getSkills()` returns a fresh copy per call, so an uncached snapshot
    // would hand back a new array every render and defeat every downstream memo.
    expect(result.current.skills).toBe(first);
  });

  it("surfaces the store's error", async () => {
    client.listSkills.mockRejectedValueOnce(new Error("boom"));
    const { result } = renderHook(() => useManagedSkills(client, state));
    await act(async () => {
      await state.refresh().catch(() => {});
    });
    expect(result.current.error?.message).toBe("boom");
  });

  it("refresh drives the store", async () => {
    const { result } = renderHook(() => useManagedSkills(client, state));
    client.skillPages = [{ skills: [skill("a")] }];
    await act(async () => {
      await result.current.refresh();
    });
    expect(result.current.skills).toHaveLength(1);
  });

  it("swaps to another server's store in the same render", async () => {
    const other = new FakeInspectorClient({ status: "connected" });
    other.skillsExtension = { directoryRead: false };
    const otherState = new ManagedSkillsState(other);
    other.skillPages = [{ skills: [skill("z")] }];
    await otherState.refresh();

    client.skillPages = [{ skills: [skill("a")] }];
    await state.refresh();

    const { result, rerender } = renderHook(
      ({ s }: { s: ManagedSkillsState }) => useManagedSkills(client, s),
      { initialProps: { s: state } },
    );
    expect(result.current.skills[0].frontmatter.name).toBe("a");
    rerender({ s: otherState });
    // Read during render, so the swap lands in the same frame — no frame of
    // the previous server's skills.
    expect(result.current.skills[0].frontmatter.name).toBe("z");
  });
});
