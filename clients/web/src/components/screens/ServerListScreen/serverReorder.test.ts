import { describe, it, expect, vi } from "vitest";
import type { DragEndEvent } from "@dnd-kit/core";
import type { ServerEntry } from "@inspector/core/mcp/types.js";
import {
  buildReorderAnnouncements,
  makeServerDragEndHandler,
} from "./serverReorder";

const entry = (id: string, name: string): ServerEntry => ({
  id,
  name,
  config: { type: "stdio", command: "echo" },
  connection: { status: "disconnected" },
});

const servers: ServerEntry[] = [
  entry("a", "Alpha"),
  entry("b", "Beta"),
  entry("c", "Gamma"),
];

// Minimal stand-ins for dnd-kit's active/over/event descriptors — the handlers
// only read `.id`, so we cast through `unknown` rather than constructing the
// full (sensor-populated) event shape.
const ref = (id: string) => ({ id });
const endEvent = (activeId: string, overId: string | null): DragEndEvent =>
  ({
    active: ref(activeId),
    over: overId === null ? null : ref(overId),
  }) as unknown as DragEndEvent;

describe("makeServerDragEndHandler", () => {
  it("calls onReorder with the reordered ids when the card moved", () => {
    const onReorder = vi.fn();
    makeServerDragEndHandler(servers, onReorder)(endEvent("a", "c"));
    expect(onReorder).toHaveBeenCalledWith(["b", "c", "a"]);
  });

  it("does nothing when dropped on itself", () => {
    const onReorder = vi.fn();
    makeServerDragEndHandler(servers, onReorder)(endEvent("a", "a"));
    expect(onReorder).not.toHaveBeenCalled();
  });

  it("does nothing when there is no drop target", () => {
    const onReorder = vi.fn();
    makeServerDragEndHandler(servers, onReorder)(endEvent("a", null));
    expect(onReorder).not.toHaveBeenCalled();
  });

  it("tolerates an absent onReorder callback (no throw)", () => {
    expect(() =>
      makeServerDragEndHandler(servers, undefined)(endEvent("a", "b")),
    ).not.toThrow();
  });
});

describe("buildReorderAnnouncements", () => {
  const a = buildReorderAnnouncements(servers);

  it("narrates pick-up with name and 1-based position", () => {
    expect(a.onDragStart({ active: ref("b") } as never)).toBe(
      "Picked up server Beta. It is in position 2 of 3.",
    );
  });

  it("narrates a move over a target", () => {
    expect(a.onDragOver?.({ active: ref("a"), over: ref("c") } as never)).toBe(
      "Server Alpha moved to position 3 of 3.",
    );
  });

  it("returns undefined for onDragOver when there is no target", () => {
    expect(
      a.onDragOver?.({ active: ref("a"), over: null } as never),
    ).toBeUndefined();
  });

  it("narrates a drop on a target", () => {
    expect(a.onDragEnd?.({ active: ref("a"), over: ref("b") } as never)).toBe(
      "Server Alpha dropped at position 2 of 3.",
    );
  });

  it("narrates a drop with no target", () => {
    expect(a.onDragEnd?.({ active: ref("a"), over: null } as never)).toBe(
      "Server Alpha dropped.",
    );
  });

  it("narrates a cancellation", () => {
    expect(a.onDragCancel?.({ active: ref("c") } as never)).toBe(
      "Reorder cancelled. Server Gamma returned to its original position.",
    );
  });

  it("falls back to the id when the server is unknown", () => {
    expect(a.onDragStart({ active: ref("missing") } as never)).toBe(
      "Picked up server missing. It is in position 0 of 3.",
    );
  });
});
