import { describe, it, expect } from "vitest";
import type {
  InspectorServerSettings,
  ServerEntry,
} from "@inspector/core/mcp/types.js";
import { renderWithMantine } from "../test/renderWithMantine";
import {
  useLastPersistedSettings,
  type LastPersistedSettings,
} from "./useLastPersistedSettings";

const settings = (
  overrides: Partial<InspectorServerSettings> = {},
): InspectorServerSettings => ({
  headers: [],
  env: [],
  metadata: {},
  connectionTimeout: 0,
  requestTimeout: 0,
  taskTtl: 0,
  autoRefreshOnListChanged: false,
  paginatedLists: false,
  maxFetchRequests: 0,
  roots: [],
  ...overrides,
});

/**
 * One `servers` entry, a fresh object per call — most of these tests turn on
 * object identity, so a shared fixture would defeat them. A list rebuilt from
 * fresh calls is what a successful `GET /api/servers` produces.
 */
const entry = (
  id: string,
  settingsNode?: InspectorServerSettings,
): ServerEntry => ({
  id,
  name: id,
  config: { type: "stdio", command: "node" },
  connection: { status: "disconnected" },
  settings: settingsNode,
});

interface Harness {
  api: LastPersistedSettings;
  /** Deliver a new server list, as a successful list read would. */
  setServers: (next: ServerEntry[]) => void;
}

/**
 * Hands the hook's API back to the test. The hook holds refs, so it has to be
 * read from inside a rendered component; `setServers` re-renders it with a new
 * list the way `useServers` does after a read.
 *
 * The returned object *delegates* rather than being the API from the first
 * render. `resolve` is keyed on the current `servers` (#2192) instead of on a
 * ref, so its identity changes with the list — handing back a snapshot would
 * give every test a `resolve` closed over the initial list, and `setServers`
 * would appear to do nothing.
 */
function harness(initial: ServerEntry[]): Harness {
  let latest: LastPersistedSettings | undefined;
  function Probe({ servers }: { servers: ServerEntry[] }) {
    latest = useLastPersistedSettings(servers);
    return null;
  }
  const { rerender } = renderWithMantine(<Probe servers={initial} />);
  if (!latest) throw new Error("hook did not render");
  const current = () => {
    if (!latest) throw new Error("hook did not render");
    return latest;
  };
  return {
    api: {
      begin: (serverId) => current().begin(serverId),
      resolve: (serverId) => current().resolve(serverId),
      lastWriteFailed: (serverId) => current().lastWriteFailed(serverId),
    },
    setServers: (next) => rerender(<Probe servers={next} />),
  };
}

describe("useLastPersistedSettings", () => {
  it("reads the list entry when no write has landed for that server", () => {
    const onDisk = settings({ paginatedLists: true });
    const { api } = harness([entry("A", onDisk)]);
    expect(api.resolve("A")).toBe(onDisk);
  });

  it("returns nothing when the list has no settings and nothing landed", () => {
    const { api } = harness([entry("A")]);
    expect(api.resolve("A")).toBeUndefined();
  });

  it("returns the recorded write while the entry has not been re-read", () => {
    const { api } = harness([entry("A", settings())]);
    const written = settings({ paginatedLists: true });
    api.begin("A").landed(written);
    expect(api.resolve("A")).toBe(written);
  });

  it("ignores a record made for a different server", () => {
    const onDiskB = settings();
    const { api } = harness([entry("A"), entry("B", onDiskB)]);
    api.begin("A").landed(settings({ paginatedLists: true }));
    expect(api.resolve("B")).toBe(onDiskB);
  });

  it("keeps each server's record, so a save on B doesn't discard A's", () => {
    // The settings modal can be opened for any server, connected or not, so
    // this sequence is reachable: A's write lands while list reads are failing,
    // B is saved from the modal, and only then does a write on A fail. A single
    // slot would have lost A's baseline and reproduced #2089.
    const { api } = harness([entry("A", settings()), entry("B", settings())]);
    const writtenA = settings({ paginatedLists: true });
    api.begin("A").landed(writtenA);
    api.begin("B").landed(settings({ autoRefreshOnListChanged: true }));
    expect(api.resolve("A")).toBe(writtenA);
  });

  it("stops trusting the record once a fresh list read replaces the entry", () => {
    const { api, setServers } = harness([entry("A", settings())]);
    api.begin("A").landed(settings({ paginatedLists: true }));
    // A successful `GET /api/servers` rebuilds the list, so the entry is a new
    // object even when its values are unchanged. That is the signal the list
    // has caught up, and it is authoritative again from here.
    const fresh = settings();
    setServers([entry("A", fresh)]);
    expect(api.resolve("A")).toBe(fresh);
  });

  it("pairs the record with the entry as of completion, not of issue", () => {
    // A list read that lands while the write is in flight must not be mistaken
    // for one that happened after it. The pairing is taken in `landed`, so the
    // read below — which the write outlives — does not invalidate the record.
    const { api, setServers } = harness([entry("A", settings())]);
    const write = api.begin("A");
    setServers([entry("A", settings())]);
    const written = settings({ paginatedLists: true });
    write.landed(written);
    expect(api.resolve("A")).toBe(written);
  });

  it("keeps only the most recent write for a server", () => {
    const { api } = harness([entry("A", settings())]);
    api.begin("A").landed(settings({ paginatedLists: true }));
    const later = settings({ autoRefreshOnListChanged: true });
    api.begin("A").landed(later);
    expect(api.resolve("A")).toBe(later);
  });

  it("lets the later-issued write win however the two finish", () => {
    // `updateServerSettings` waits for a list read after its PUT, so an older
    // write with a slow read can complete last. Ordering by completion would
    // then record a value that a newer write has already replaced on disk, and
    // the next failed write would roll back to it.
    const { api } = harness([entry("A", settings())]);
    const first = api.begin("A");
    const second = api.begin("A");
    const newest = settings({ paginatedLists: true });
    second.landed(newest);
    first.landed(settings({ paginatedLists: false }));
    expect(api.resolve("A")).toBe(newest);
  });

  it("reports settled only for the last write issued", () => {
    // The flag is what tells a caller it is safe to re-apply the value to the
    // UI: while a later write is still in flight, that write will describe disk
    // when it reports, and re-applying now would fight it.
    const { api } = harness([entry("A", settings())]);
    const first = api.begin("A");
    expect(first.landed(settings({ paginatedLists: true }))).toBe(true);
    const second = api.begin("A");
    const third = api.begin("A");
    expect(second.landed(settings({ paginatedLists: false }))).toBe(false);
    expect(third.landed(settings({ paginatedLists: true }))).toBe(true);
    // A superseded straggler is neither recorded nor settled.
    expect(second.landed(settings({ paginatedLists: false }))).toBe(false);
  });

  it("treats an earlier write as settled once the later one has failed", () => {
    // The order that leaves the UI wrong: the later write fails first, rolling
    // the UI back to a baseline the earlier write then replaces on disk. Once
    // the failed write stops counting as in flight, the earlier one settles and
    // its caller can re-apply the value.
    const { api } = harness([entry("A", settings())]);
    const first = api.begin("A");
    const second = api.begin("A");
    second.failed();
    const written = settings({ paginatedLists: true });
    expect(first.landed(written)).toBe(true);
    expect(api.resolve("A")).toBe(written);
  });

  it("does not let a straggler resurrect a record a fresh read dropped", () => {
    // The high-water mark outlives the record, so an earlier write reporting
    // after `resolve` invalidated things cannot reinstate a superseded value.
    const { api, setServers } = harness([entry("A", settings())]);
    const first = api.begin("A");
    api.begin("A").landed(settings({ paginatedLists: true }));
    const fresh = settings();
    setServers([entry("A", fresh)]);
    expect(api.resolve("A")).toBe(fresh);
    first.landed(settings({ paginatedLists: false }));
    expect(api.resolve("A")).toBe(fresh);
  });

  it("reports a failed last write per server, ordered by issue", () => {
    // The settings modal's draft survives a rejected save, so its owner has to
    // know whether what the user last tried to save is on disk. A failure on B
    // says nothing about A, and a straggling failure from an older write does
    // not overrule a newer write that succeeded.
    const { api } = harness([entry("A", settings()), entry("B", settings())]);
    expect(api.lastWriteFailed("A")).toBe(false);

    const firstA = api.begin("A");
    const secondA = api.begin("A");
    secondA.landed(settings({ paginatedLists: true }));
    firstA.failed();
    expect(api.lastWriteFailed("A")).toBe(false);

    api.begin("B").failed();
    expect(api.lastWriteFailed("B")).toBe(true);
    expect(api.lastWriteFailed("A")).toBe(false);

    // …and a newer failure on A does count, until a newer write lands.
    api.begin("A").failed();
    expect(api.lastWriteFailed("A")).toBe(true);
    api.begin("A").landed(settings());
    expect(api.lastWriteFailed("A")).toBe(false);
  });

  it("returns nothing when the server has left the list entirely", () => {
    const { api, setServers } = harness([entry("A", settings())]);
    api.begin("A").landed(settings({ paginatedLists: true }));
    setServers([]);
    expect(api.resolve("A")).toBeUndefined();
  });
  it("answers from the list of the render it is called in", () => {
    // `useSettingsDraft` seeds its draft during render (#2192), so `resolve`
    // is called there. Reading the effect-mirrored `serversRef` would answer
    // from the *previous* commit's list on exactly the render where a
    // refreshed list arrives — which is the render that seeds the draft.
    const before = entry("A", settings({ paginatedLists: false }));
    const after = entry("A", settings({ paginatedLists: true }));
    const answers: Array<InspectorServerSettings | undefined> = [];

    function Probe({ servers }: { servers: ServerEntry[] }) {
      const api = useLastPersistedSettings(servers);
      answers.push(api.resolve("A"));
      return null;
    }

    const { rerender } = renderWithMantine(<Probe servers={[before]} />);
    expect(answers.at(-1)).toBe(before.settings);

    answers.length = 0;
    rerender(<Probe servers={[after]} />);

    expect(answers.length).toBeGreaterThan(0);
    for (const answer of answers) expect(answer).toBe(after.settings);
  });
});
