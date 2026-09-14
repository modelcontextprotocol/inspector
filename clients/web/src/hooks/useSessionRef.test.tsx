import { describe, it, expect } from "vitest";
import { InspectorClient } from "@inspector/core/mcp/index.js";
import type { ServerEntry } from "@inspector/core/mcp/types.js";
import { renderWithMantine } from "../test/renderWithMantine";
import {
  useSessionRef,
  type SessionRef,
  type SessionValues,
} from "./useSessionRef";

const entry = (id: string, name = id): ServerEntry => ({
  id,
  name,
  config: { type: "stdio", command: "node" },
  connection: { status: "disconnected" },
});

/**
 * A distinct client identity per call. `Object.create` does not run the
 * constructor, so this is a real `InspectorClient` prototype chain with no
 * transport or environment behind it — which is all that is needed here: the
 * hook only stores the reference, and every assertion compares identity rather
 * than reading a property off it.
 */
const client = (): InspectorClient =>
  Object.create(InspectorClient.prototype) as InspectorClient;

const values = (over: Partial<SessionValues> = {}): SessionValues => ({
  activeServerId: undefined,
  servers: [],
  inspectorClient: null,
  ...over,
});

interface Harness {
  ref: () => SessionRef;
  /** Re-render with a new set of session values, as App.tsx does each render. */
  update: (next: SessionValues) => void;
}

function harness(initial: SessionValues): Harness {
  let latest: SessionRef | undefined;
  function Probe({ v }: { v: SessionValues }) {
    latest = useSessionRef(v);
    return null;
  }
  const { rerender } = renderWithMantine(<Probe v={initial} />);
  return {
    ref: () => {
      if (!latest) throw new Error("hook did not render");
      return latest;
    },
    update: (next) => rerender(<Probe v={next} />),
  };
}

describe("useSessionRef", () => {
  it("seeds the snapshot from the first render's values", () => {
    const servers = [entry("a")];
    const c = client();
    const h = harness(
      values({ activeServerId: "a", servers, inspectorClient: c }),
    );
    const snapshot = h.ref().current;
    expect(snapshot.activeServerId).toBe("a");
    expect(snapshot.servers).toBe(servers);
    expect(snapshot.inspectorClient).toBe(c);
    // Seeded null and left alone: the two pending-OAuth slots are written by
    // their owner, `useOAuthRecovery`, not supplied to this hook (#2153).
    expect(snapshot.pendingStepUp).toBeNull();
    expect(snapshot.pendingReauth).toBeNull();
  });

  it("keeps one stable ref identity across renders", () => {
    const h = harness(values());
    const first = h.ref();
    h.update(values({ activeServerId: "a", servers: [entry("a")] }));
    expect(h.ref()).toBe(first);
  });

  it("mirrors every field on a later render", () => {
    const h = harness(values());
    const servers = [entry("a"), entry("b")];
    const c = client();
    h.update(
      values({
        activeServerId: "b",
        servers,
        inspectorClient: c,
      }),
    );
    expect(h.ref().current).toMatchObject({
      activeServerId: "b",
      servers,
      inspectorClient: c,
    });
  });

  it("leaves the owner-written pending slots alone across renders", () => {
    const h = harness(values({ activeServerId: "a", servers: [entry("a")] }));
    // Stands in for `useOAuthRecovery`'s own mirror effect.
    h.ref().current.pendingStepUp = {
      serverId: "a",
      challenge: { reason: "unauthorized" },
      authorizationUrl: new URL("https://as.example/authorize"),
      source: "tool",
    };
    h.update(values({ activeServerId: "a", servers: [entry("a")] }));
    expect(h.ref().current.pendingStepUp?.serverId).toBe("a");
  });

  it("clears a value that becomes null or undefined", () => {
    const h = harness(
      values({
        activeServerId: "a",
        servers: [entry("a")],
        inspectorClient: client(),
      }),
    );
    h.update(values());
    expect(h.ref().current).toMatchObject({
      activeServerId: undefined,
      servers: [],
      inspectorClient: null,
    });
  });

  describe("activeServerName", () => {
    it("stays undefined when no server was ever active", () => {
      // It is derived in the sync effect rather than seeded, so it is blank
      // until a render actually resolves an active entry.
      const h = harness(values({ servers: [entry("a", "Alpha")] }));
      expect(h.ref().current.activeServerName).toBeUndefined();
    });

    it("is populated by the mount's own sync effect", () => {
      const h = harness(
        values({ activeServerId: "a", servers: [entry("a", "Alpha")] }),
      );
      expect(h.ref().current.activeServerName).toBe("Alpha");
    });

    it("tracks the active server's name", () => {
      const h = harness(values());
      h.update(values({ activeServerId: "a", servers: [entry("a", "Alpha")] }));
      expect(h.ref().current.activeServerName).toBe("Alpha");
      h.update(
        values({
          activeServerId: "b",
          servers: [entry("a", "Alpha"), entry("b", "Beta")],
        }),
      );
      expect(h.ref().current.activeServerName).toBe("Beta");
    });

    it("keeps the last active name when the active server goes away", () => {
      // The case the stickiness exists for: a transport crash clears
      // `activeServerId` before the failure toast is raised, and the name is
      // the only surviving handle on which server died.
      const h = harness(values());
      h.update(values({ activeServerId: "a", servers: [entry("a", "Alpha")] }));
      h.update(values({ servers: [entry("a", "Alpha")] }));
      expect(h.ref().current.activeServerName).toBe("Alpha");
      expect(h.ref().current.activeServerId).toBeUndefined();
    });

    it("keeps the last active name when the id names no entry", () => {
      const h = harness(values());
      h.update(values({ activeServerId: "a", servers: [entry("a", "Alpha")] }));
      h.update(values({ activeServerId: "gone", servers: [] }));
      expect(h.ref().current.activeServerName).toBe("Alpha");
    });

    it("follows a rename of the active server", () => {
      const h = harness(values());
      h.update(values({ activeServerId: "a", servers: [entry("a", "Alpha")] }));
      h.update(
        values({ activeServerId: "a", servers: [entry("a", "Renamed")] }),
      );
      expect(h.ref().current.activeServerName).toBe("Renamed");
    });
  });
});
