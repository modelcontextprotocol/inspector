/**
 * Tests that every `OAuthStorageBase` mutation names the sections it touched
 * when persisting (the clobber fix): per-server mutations name their server
 * URL, IdP mutations their issuer, and the enterprise-managed sweep the URLs
 * it deleted — captured *before* the clear, since the flags are gone after.
 * Also pins that the snapshot handed to the backend is taken when the queued
 * write actually runs, so a write that waited in the queue carries mutations
 * that landed in memory while it waited.
 */

import { describe, it, expect } from "vitest";
import {
  OAuthStorageBase,
  OAuthStorageCoordination,
} from "@inspector/core/auth/oauth-storage.js";
import { OAuthMemoryStore } from "@inspector/core/auth/store.js";
import { getOwnEntry } from "@inspector/core/storage/own-entry.js";
import type { IssuerBoundOAuthState } from "@inspector/core/auth/store.js";
import type {
  OAuthPersistBackend,
  OAuthPersistSections,
  OAuthPersistSnapshot,
} from "@inspector/core/auth/oauth-persist.js";
import type { OAuthTokens } from "@modelcontextprotocol/client";

interface RecordedWrite {
  snapshot: OAuthPersistSnapshot;
  sections: OAuthPersistSections | undefined;
}

function makeRecordingBackend(): {
  backend: OAuthPersistBackend;
  writes: RecordedWrite[];
} {
  const writes: RecordedWrite[] = [];
  return {
    writes,
    backend: {
      async read() {
        return null;
      },
      async write(snapshot, sections) {
        writes.push({ snapshot, sections });
      },
    },
  };
}

const TOKENS: OAuthTokens = { access_token: "at", token_type: "Bearer" };
const SERVER = "http://mcp.example/path";
const ISSUER = "https://as.example";

describe("OAuthStorageBase sectioned persistence", () => {
  it("per-server mutations name their server URL", async () => {
    const { backend, writes } = makeRecordingBackend();
    const storage = new OAuthStorageBase(new OAuthMemoryStore(), backend);

    await storage.saveTokens(SERVER, TOKENS, { issuer: ISSUER });
    await storage.saveClientInformation(
      SERVER,
      { client_id: "c1" },
      { registrationKind: "dcr", issuer: ISSUER },
    );
    await storage.saveCodeVerifier(SERVER, "verifier");
    await storage.saveScope(SERVER, "read");
    await storage.saveDiscoveryState(SERVER, {
      authorizationServerUrl: ISSUER,
    });
    await storage.clearTokens(SERVER);
    await storage.clear(SERVER);

    expect(writes).toHaveLength(7);
    for (const write of writes) {
      expect(write.sections).toEqual({ servers: [SERVER] });
    }
    // `clear` deletes the entry — the snapshot no longer carries it, so a
    // merging backend propagates the deletion instead of resurrecting it.
    expect(writes[6]!.snapshot.servers[SERVER]).toBeUndefined();
  });

  it("takeRevocationSnapshot names the cleared server", async () => {
    const { backend, writes } = makeRecordingBackend();
    const storage = new OAuthStorageBase(new OAuthMemoryStore(), backend);
    await storage.saveTokens(SERVER, TOKENS, { issuer: ISSUER });

    const snapshot = await storage.takeRevocationSnapshot(SERVER);
    expect(snapshot.byIssuer[ISSUER]?.tokens).toEqual(TOKENS);
    const last = writes.at(-1)!;
    expect(last.sections).toEqual({ servers: [SERVER] });
    expect(last.snapshot.servers[SERVER]).toBeUndefined();
  });

  it("IdP session mutations name their issuer", async () => {
    const { backend, writes } = makeRecordingBackend();
    const storage = new OAuthStorageBase(new OAuthMemoryStore(), backend);

    await storage.saveIdpSession(ISSUER, { idToken: "id" });
    await storage.clearIdpSession(ISSUER);

    expect(writes.map((w) => w.sections)).toEqual([
      { idpSessions: [ISSUER] },
      { idpSessions: [ISSUER] },
    ]);
    expect(writes[1]!.snapshot.idpSessions[ISSUER]).toBeUndefined();
  });

  it("clearEnterpriseManagedResourceServers names the URLs it deleted", async () => {
    const { backend, writes } = makeRecordingBackend();
    const storage = new OAuthStorageBase(new OAuthMemoryStore(), backend);

    await storage.saveTokens("http://ema-1", TOKENS, {
      enterpriseManaged: true,
    });
    await storage.saveTokens("http://ema-2", TOKENS, {
      enterpriseManaged: true,
    });
    await storage.saveTokens("http://plain", TOKENS);

    await storage.clearEnterpriseManagedResourceServers();
    const last = writes.at(-1)!;
    // The EMA flags are gone from memory after the clear, so the write must
    // have captured the affected URLs beforehand to propagate the deletions.
    expect(last.sections).toEqual({
      servers: ["http://ema-1", "http://ema-2"],
    });
    expect(last.snapshot.servers["http://plain"]).toBeDefined();
    expect(last.snapshot.servers["http://ema-1"]).toBeUndefined();
  });

  it("takes the snapshot when the queued write runs, not when it was queued", async () => {
    const writes: RecordedWrite[] = [];
    let releaseFirst!: () => void;
    const firstWriteGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    let call = 0;
    const backend: OAuthPersistBackend = {
      async read() {
        return null;
      },
      async write(snapshot, sections) {
        call += 1;
        if (call === 1) {
          await firstWriteGate;
        }
        writes.push({ snapshot, sections });
      },
    };
    const storage = new OAuthStorageBase(new OAuthMemoryStore(), backend);

    const first = storage.saveScope(SERVER, "first");
    // Queued behind the gated first write; by the time it runs, the code
    // verifier below has already landed in memory, and its snapshot must
    // carry it (this is what lets a merge write the freshest value).
    const second = storage.saveScope(SERVER, "second");
    const third = storage.saveCodeVerifier(SERVER, "cv");
    releaseFirst();
    await Promise.all([first, second, third]);

    expect(writes).toHaveLength(3);
    expect(writes[1]!.snapshot.servers[SERVER]).toMatchObject({
      scope: "second",
      codeVerifier: "cv",
    });
  });

  it("issuer-agnostic clears keep a __proto__ issuer slot (own-property rebuild)", async () => {
    // `mapIssuerSlots` rebuilds `byIssuer`; a plain `byIssuer[key] =` would
    // hit the prototype setter for a persisted `__proto__` issuer, dropping
    // the slot — clearTokens would then erase that issuer's client
    // registration too, not just its tokens.
    const { backend } = makeRecordingBackend();
    const memory = new OAuthMemoryStore();
    const storage = new OAuthStorageBase(memory, backend);
    const byIssuer = JSON.parse(
      '{"__proto__": {"tokens": {"access_token": "at", "token_type": "Bearer"}, "clientInformation": {"client_id": "cid"}}}',
    ) as Record<string, IssuerBoundOAuthState>;
    memory.getState().setServerState(SERVER, { byIssuer });

    await storage.clearTokens(SERVER);

    const state = memory.getState().getServerState(SERVER);
    expect(Object.hasOwn(state.byIssuer!, "__proto__")).toBe(true);
    const slot = getOwnEntry(state.byIssuer, "__proto__");
    expect(slot?.tokens).toBeUndefined();
    expect(slot?.clientInformation).toEqual({ client_id: "cid" });
  });

  it("a failed load blocks mutations and is retried, never cached", async () => {
    // A tolerant load (or a permanently cached rejection) would let a store
    // outage hydrate empty state — and the next save's sectioned diff would
    // delete the credentials the outage hid. The load must fail closed and
    // retry once the backend recovers.
    let fail = true;
    const backend: OAuthPersistBackend = {
      async read() {
        // deliberately a bare string
        if (fail) throw "backend outage";
        return null;
      },
      async write() {},
    };
    const storage = new OAuthStorageBase(new OAuthMemoryStore(), backend);

    await expect(storage.saveTokens(SERVER, TOKENS)).rejects.toBe(
      "backend outage",
    );
    fail = false;
    await expect(storage.saveTokens(SERVER, TOKENS)).resolves.toBeUndefined();
    expect(await storage.getTokens(SERVER)).toEqual(TOKENS);
  });
});

describe("shared load/persist coordination", () => {
  const STALE: OAuthTokens = { access_token: "stale", token_type: "Bearer" };

  /** A persisted snapshot holding `tokens` for SERVER, built the real way. */
  async function snapshotWithTokens(
    tokens: OAuthTokens,
  ): Promise<OAuthPersistSnapshot> {
    const memory = new OAuthMemoryStore();
    const scratch = new OAuthStorageBase(memory, {
      async read() {
        return null;
      },
      async write() {},
    });
    await scratch.saveTokens(SERVER, tokens, { issuer: ISSUER });
    return memory.snapshot();
  }

  it("a second instance sharing memory must not replace() a live mutation with stale disk state", async () => {
    // The Node storage caches one OAuthMemoryStore per state-file path but
    // callers can construct several NodeOAuthStorage instances over it (CLI
    // connect + --relogin do). With a per-instance load latch, the second
    // instance's first load() re-reads disk and replace()s the shared memory
    // — silently reverting a mutation the first instance had already
    // reported as saved. Sharing OAuthStorageCoordination pins load-once and
    // one persist queue per shared memory.
    const disk = await snapshotWithTokens(STALE);
    let reads = 0;
    const writes: RecordedWrite[] = [];
    const backend: OAuthPersistBackend = {
      async read() {
        reads += 1;
        return disk;
      },
      async write(snapshot, sections) {
        writes.push({ snapshot, sections });
      },
    };

    const memory = new OAuthMemoryStore();
    const coordination = new OAuthStorageCoordination();
    const first = new OAuthStorageBase(memory, backend, coordination);
    await first.saveTokens(SERVER, TOKENS, { issuer: ISSUER });

    const second = new OAuthStorageBase(memory, backend, coordination);
    await second.load();

    expect(reads).toBe(1);
    expect(await second.getTokens(SERVER)).toEqual({
      ...TOKENS,
      issuer: ISSUER,
    });

    // The mutation also survives into the next queued persist.
    await second.saveScope(SERVER, "s");
    const last = writes[writes.length - 1]!;
    expect(JSON.stringify(last.snapshot)).toContain(TOKENS.access_token);
    expect(JSON.stringify(last.snapshot)).not.toContain(STALE.access_token);
  });

  it("concurrent first loads on two instances share one backend read", async () => {
    let reads = 0;
    let release!: (snapshot: OAuthPersistSnapshot | null) => void;
    const gate = new Promise<OAuthPersistSnapshot | null>((resolve) => {
      release = resolve;
    });
    const backend: OAuthPersistBackend = {
      async read() {
        reads += 1;
        return gate;
      },
      async write() {},
    };

    const memory = new OAuthMemoryStore();
    const coordination = new OAuthStorageCoordination();
    const first = new OAuthStorageBase(memory, backend, coordination);
    const second = new OAuthStorageBase(memory, backend, coordination);

    const loads = Promise.all([first.load(), second.load()]);
    release(await snapshotWithTokens(STALE));
    await loads;

    expect(reads).toBe(1);
    expect(await first.getTokens(SERVER)).toEqual({
      ...STALE,
      issuer: ISSUER,
    });
    expect(await second.getTokens(SERVER)).toEqual({
      ...STALE,
      issuer: ISSUER,
    });
  });
});
