import { describe, it, expect } from "vitest";
import {
  parseOAuthPersistBlob,
  serializeOAuthPersistBlob,
} from "@inspector/core/auth/oauth-persist.js";

describe("parseOAuthPersistBlob", () => {
  it("returns null for empty input", () => {
    expect(parseOAuthPersistBlob(null)).toBeNull();
  });

  it("reads plain JSON with servers and idpSessions", () => {
    const snapshot = {
      servers: {
        "http://example.com": { codeVerifier: "v1" },
      },
      idpSessions: {
        "https://idp.example": { idToken: "token" },
      },
    };
    expect(parseOAuthPersistBlob(JSON.stringify(snapshot))).toEqual(snapshot);
  });

  it("accepts an already-parsed object without re-serializing", () => {
    const snapshot = {
      servers: {
        "http://example.com": { codeVerifier: "v1" },
      },
      idpSessions: {},
    };
    expect(parseOAuthPersistBlob(snapshot)).toEqual(snapshot);
  });

  it("promotes legacy persist envelope state to the top level", () => {
    const legacy = {
      state: {
        servers: {
          "http://example.com": {
            tokens: { access_token: "t", token_type: "Bearer" },
          },
        },
        idpSessions: {},
      },
      version: 0,
    };
    expect(parseOAuthPersistBlob(JSON.stringify(legacy))).toEqual({
      servers: legacy.state.servers,
      idpSessions: {},
    });
  });
});

describe("serializeOAuthPersistBlob", () => {
  it("writes plain JSON without a state/version envelope", () => {
    const snapshot = {
      servers: { "http://example.com": { scope: "read" } },
      idpSessions: {},
    };
    const raw = serializeOAuthPersistBlob(snapshot);
    expect(JSON.parse(raw)).toEqual(snapshot);
    expect(raw).not.toContain('"version"');
    expect(raw).not.toMatch(/"state"\s*:/);
  });
});
