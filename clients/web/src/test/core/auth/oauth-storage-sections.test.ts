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
import { OAuthStorageBase } from "@inspector/core/auth/oauth-storage.js";
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
});
