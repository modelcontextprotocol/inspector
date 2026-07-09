import { describe, it, expect } from "vitest";
import { OAuthMemoryStore } from "@inspector/core/auth/store.js";

describe("OAuthMemoryStore", () => {
  it("returns empty defaults for unknown server / issuer", () => {
    const store = new OAuthMemoryStore();
    expect(store.getState().getServerState("http://x")).toEqual({});
    expect(store.getState().getIdpSession("http://idp")).toEqual({});
  });

  it("merges partial updates immutably via setServerState / setIdpSession", () => {
    const store = new OAuthMemoryStore();
    const s = store.getState();
    s.setServerState("http://x", { scope: "read" });
    s.setServerState("http://x", { codeVerifier: "v" });
    expect(store.getState().getServerState("http://x")).toEqual({
      scope: "read",
      codeVerifier: "v",
    });
    s.setIdpSession("http://idp", { idToken: "t" });
    expect(store.getState().getIdpSession("http://idp")).toEqual({
      idToken: "t",
    });
  });

  it("clears a single server and a single idp session", () => {
    const store = new OAuthMemoryStore({
      servers: { "http://x": { scope: "read" } },
      idpSessions: { "http://idp": { idToken: "t" } },
    });
    store.getState().clearServerState("http://x");
    store.getState().clearIdpSession("http://idp");
    expect(store.getState().getServerState("http://x")).toEqual({});
    expect(store.getState().getIdpSession("http://idp")).toEqual({});
  });

  it("clears only enterprise-managed servers", () => {
    const store = new OAuthMemoryStore({
      servers: {
        "http://managed": { enterpriseManaged: true },
        "http://plain": { scope: "read" },
      },
      idpSessions: {},
    });
    store.getState().clearEnterpriseManagedResourceServers();
    expect(store.getState().getServerState("http://managed")).toEqual({});
    expect(store.getState().getServerState("http://plain")).toEqual({
      scope: "read",
    });
  });

  it("snapshot() returns a shallow copy of current state", () => {
    const store = new OAuthMemoryStore({
      servers: { "http://x": { scope: "read" } },
      idpSessions: {},
    });
    const snap = store.snapshot();
    expect(snap).toEqual({
      servers: { "http://x": { scope: "read" } },
      idpSessions: {},
    });
    // Mutating the store afterward must not change the earlier snapshot.
    store.getState().setServerState("http://y", { scope: "write" });
    expect(snap.servers["http://y"]).toBeUndefined();
  });

  it("replace() tolerates a snapshot missing servers or idpSessions", () => {
    // Exercises both `?? {}` fallbacks in replace().
    const noServers = new OAuthMemoryStore({
      idpSessions: { "http://idp": { idToken: "t" } },
    } as never);
    expect(noServers.snapshot()).toEqual({
      servers: {},
      idpSessions: { "http://idp": { idToken: "t" } },
    });
    const noSessions = new OAuthMemoryStore({
      servers: { "http://x": { scope: "read" } },
    } as never);
    expect(noSessions.snapshot()).toEqual({
      servers: { "http://x": { scope: "read" } },
      idpSessions: {},
    });
  });
});
