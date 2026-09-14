import { describe, it, expect } from "vitest";
import { act } from "react";
import type { ServerEntry } from "@inspector/core/mcp/types.js";
import { renderWithMantine } from "../test/renderWithMantine";
import {
  usePaginatedListsOverride,
  type PaginatedListsOverride,
} from "./usePaginatedListsOverride";

/**
 * One `servers` entry, a fresh object per call — every test here turns on
 * object identity, so a shared fixture would defeat them. A list rebuilt from
 * fresh calls is what a successful `GET /api/servers` produces.
 */
const entry = (id: string): ServerEntry => ({
  id,
  name: id,
  config: { type: "stdio", command: "node" },
  connection: { status: "disconnected" },
});

interface Harness {
  /** The hook's API as of the latest render. */
  api: () => PaginatedListsOverride;
  /** Deliver a new server list, as a successful list read would. */
  setServers: (next: ServerEntry[]) => void;
}

function harness(initial: ServerEntry[]): Harness {
  let latest: PaginatedListsOverride | undefined;
  function Probe({ servers }: { servers: ServerEntry[] }) {
    latest = usePaginatedListsOverride(servers);
    return null;
  }
  const { rerender } = renderWithMantine(<Probe servers={initial} />);
  return {
    api: () => {
      if (!latest) throw new Error("hook did not render");
      return latest;
    },
    setServers: (next) => {
      act(() => rerender(<Probe servers={next} />));
    },
  };
}

describe("usePaginatedListsOverride", () => {
  it("reports no override before anything is recorded", () => {
    const { api } = harness([entry("A")]);
    expect(api().valueFor("A")).toBeUndefined();
  });

  it("reports nothing for an undefined server id", () => {
    // No server is active before the first connect, and the composition root
    // asks for the display value on every render regardless.
    const { api } = harness([entry("A")]);
    act(() => api().record("A", true));
    expect(api().valueFor(undefined)).toBeUndefined();
  });

  it("returns what was recorded for that server", () => {
    const { api } = harness([entry("A")]);
    act(() => api().record("A", true));
    expect(api().valueFor("A")).toBe(true);
  });

  it("does not apply one server's override to another", () => {
    // The override is the *display* value, and the settings modal can be saved
    // for a server that is not the connected one — so a record made for B must
    // not change what A renders.
    const { api } = harness([entry("A"), entry("B")]);
    act(() => api().record("B", true));
    expect(api().valueFor("A")).toBeUndefined();
    expect(api().valueFor("B")).toBe(true);
  });

  it("survives a server switch away and back (#2095)", () => {
    // Nothing about the list changes here — only which server is being asked
    // about, which is all a switch is. The previous app-wide slot was cleared
    // on every change of the active entry, which is what dropped A's value.
    const { api } = harness([entry("A"), entry("B")]);
    act(() => api().record("A", true));
    expect(api().valueFor("B")).toBeUndefined();
    expect(api().valueFor("A")).toBe(true);
  });

  it("keeps a record for each server", () => {
    const { api } = harness([entry("A"), entry("B")]);
    act(() => api().record("A", true));
    act(() => api().record("B", false));
    expect(api().valueFor("A")).toBe(true);
    expect(api().valueFor("B")).toBe(false);
  });

  it("replaces its own record for the same server", () => {
    const { api } = harness([entry("A")]);
    act(() => api().record("A", true));
    act(() => api().record("A", false));
    expect(api().valueFor("A")).toBe(false);
  });

  it("stops applying once a fresh list read replaces that entry", () => {
    const { api, setServers } = harness([entry("A")]);
    act(() => api().record("A", true));
    // A successful `GET /api/servers` rebuilds the list, so the entry is a new
    // object even when the values are unchanged — which is exactly the case
    // that has to supersede the override, since an edit made outside the
    // Inspector can report back the value the override replaced.
    setServers([entry("A")]);
    expect(api().valueFor("A")).toBeUndefined();
  });

  it("keeps a record whose own entry was not re-read", () => {
    // A read that rebuilds B says nothing about A. In practice the list is
    // rebuilt wholesale, but the check is per entry and must not be widened to
    // "any list change" — a reorder replaces the array while keeping every
    // entry object, and is not evidence of a fresher read.
    const a = entry("A");
    const { api, setServers } = harness([a, entry("B")]);
    act(() => api().record("A", true));
    setServers([entry("B"), a]);
    expect(api().valueFor("A")).toBe(true);
  });

  it("records against the list as it stands when the record is written", () => {
    // A rollback records from a continuation that may be several renders old;
    // pairing with the list captured then would make the record look superseded
    // the moment it was written.
    const { api, setServers } = harness([entry("A")]);
    const stale = api();
    setServers([entry("A")]);
    act(() => stale.record("A", true));
    expect(api().valueFor("A")).toBe(true);
  });

  it("drops superseded records rather than accumulating them", () => {
    // Housekeeping, asserted through the only surface it has: a record dropped
    // on the way past cannot come back, so re-reading after the entry is
    // restored to the list still reports nothing.
    const a = entry("A");
    const { api, setServers } = harness([a, entry("B")]);
    act(() => api().record("A", true));
    setServers([entry("A"), entry("B")]);
    act(() => api().record("B", true));
    setServers([a, entry("B")]);
    expect(api().valueFor("A")).toBeUndefined();
  });
});
