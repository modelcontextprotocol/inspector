/**
 * Unit tests for the pure OAuth secret split/join helpers and the
 * MCP_INSPECTOR_PERSIST_TOKENS policy (core/auth/node/oauth-secrets.ts).
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import {
  PERSIST_TOKENS_ENV,
  getPersistTokensPolicy,
  resetPersistTokensPolicyWarnings,
  oauthSecretServerId,
  oauthIdpSecretServerId,
  issuerTokensField,
  issuerClientSecretField,
  issuerRegistrationTokenField,
  LEGACY_TOKENS_FIELD,
  LEGACY_CLIENT_SECRET_FIELD,
  LEGACY_REGISTRATION_TOKEN_FIELD,
  PREREG_CLIENT_SECRET_FIELD,
  PREREG_REGISTRATION_TOKEN_FIELD,
  IDP_SESSION_FIELD,
  splitServerOAuthState,
  joinServerOAuthState,
  splitIdpSession,
  joinIdpSession,
  serverSecretFields,
  snapshotHasPlaintextSecrets,
} from "@inspector/core/auth/node/oauth-secrets.js";
import type { ServerOAuthState } from "@inspector/core/auth/store.js";
import type { OAuthPersistSnapshot } from "@inspector/core/auth/oauth-persist.js";

const TOKENS = {
  access_token: "at",
  token_type: "Bearer",
  refresh_token: "rt",
} as const;

afterEach(() => {
  resetPersistTokensPolicyWarnings();
  vi.restoreAllMocks();
});

describe("getPersistTokensPolicy", () => {
  it("defaults to 'all' when unset or empty", () => {
    expect(getPersistTokensPolicy({})).toBe("all");
    expect(getPersistTokensPolicy({ [PERSIST_TOKENS_ENV]: "" })).toBe("all");
  });

  it("accepts the three valid values", () => {
    for (const v of ["all", "access", "none"] as const) {
      expect(getPersistTokensPolicy({ [PERSIST_TOKENS_ENV]: v })).toBe(v);
    }
  });

  it("treats an invalid value as 'all' and warns once per value", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const env = { [PERSIST_TOKENS_ENV]: "nope" };
    expect(getPersistTokensPolicy(env)).toBe("all");
    expect(getPersistTokensPolicy(env)).toBe("all");
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]![0]).toContain(PERSIST_TOKENS_ENV);
    // A different invalid value warns again; the reset seam clears the memory.
    expect(getPersistTokensPolicy({ [PERSIST_TOKENS_ENV]: "other" })).toBe(
      "all",
    );
    expect(warn).toHaveBeenCalledTimes(2);
    resetPersistTokensPolicyWarnings();
    expect(getPersistTokensPolicy(env)).toBe("all");
    expect(warn).toHaveBeenCalledTimes(3);
  });
});

describe("id and field schemes", () => {
  it("namespaces store ids and issuer fields", () => {
    expect(oauthSecretServerId("https://s.example/mcp")).toBe(
      "oauth+https%3A%2F%2Fs.example%2Fmcp",
    );
    expect(oauthIdpSecretServerId("https://idp.example")).toBe(
      "oauth-idp+https%3A%2F%2Fidp.example",
    );
    expect(issuerTokensField("https://as.example")).toBe(
      "tokens:https://as.example",
    );
    expect(issuerClientSecretField("https://as.example")).toBe(
      "client-secret:https://as.example",
    );
  });

  it("store ids are colon-free and prefix-unambiguous", () => {
    // Accounts are `serverId:field` and the keyring's deleteAllForServer
    // parses at the FIRST colon — a colon inside the id would make purges
    // never match (tokens left in the OS keychain forever).
    expect(oauthSecretServerId("https://s.example:8443/mcp")).not.toContain(
      ":",
    );
    expect(oauthIdpSecretServerId("https://idp.example:8443")).not.toContain(
      ":",
    );
    // A raw-URL id would be a prefix of its port-qualified sibling, letting
    // prefix-matching stores purge the wrong server's secrets.
    const plain = `${oauthSecretServerId("https://a.example")}:`;
    const withPort = `${oauthSecretServerId("https://a.example:8080")}:tokens`;
    expect(withPort.startsWith(plain)).toBe(false);
  });
});

describe("splitServerOAuthState", () => {
  it("moves legacy tokens and client secrets to the store, keeps residue", () => {
    const state: ServerOAuthState = {
      scope: "read",
      codeVerifier: "cv",
      tokens: { ...TOKENS },
      clientInformation: { client_id: "cid", client_secret: "cs" },
      preregisteredClientInformation: {
        client_id: "pre",
        client_secret: "pre-cs",
      },
    };
    const { residue, secrets } = splitServerOAuthState(state, "all");
    expect(residue.tokens).toBeUndefined();
    expect(residue.scope).toBe("read");
    expect(residue.codeVerifier).toBe("cv");
    expect(residue.clientInformation).toEqual({ client_id: "cid" });
    expect(residue.preregisteredClientInformation).toEqual({
      client_id: "pre",
    });
    expect(JSON.parse(secrets[LEGACY_TOKENS_FIELD]!)).toEqual(TOKENS);
    expect(secrets[LEGACY_CLIENT_SECRET_FIELD]).toBe("cs");
    expect(secrets[PREREG_CLIENT_SECRET_FIELD]).toBe("pre-cs");
    // Input untouched.
    expect(state.tokens).toEqual(TOKENS);
    expect(state.clientInformation!.client_secret).toBe("cs");
  });

  it("splits per-issuer slots under their issuer-suffixed fields", () => {
    const issuer = "https://as.example";
    const state: ServerOAuthState = {
      activeIssuer: issuer,
      byIssuer: {
        [issuer]: {
          tokens: { ...TOKENS },
          clientInformation: { client_id: "cid", client_secret: "cs" },
        },
      },
    };
    const { residue, secrets } = splitServerOAuthState(state, "all");
    expect(residue.byIssuer![issuer]!.tokens).toBeUndefined();
    expect(residue.byIssuer![issuer]!.clientInformation).toEqual({
      client_id: "cid",
    });
    expect(JSON.parse(secrets[issuerTokensField(issuer)]!)).toEqual(TOKENS);
    expect(secrets[issuerClientSecretField(issuer)]).toBe("cs");
  });

  it("policy 'access' strips refresh tokens; 'none' drops tokens entirely", () => {
    const state: ServerOAuthState = {
      tokens: { ...TOKENS },
      clientInformation: { client_id: "cid", client_secret: "cs" },
    };
    const access = splitServerOAuthState(state, "access");
    expect(JSON.parse(access.secrets[LEGACY_TOKENS_FIELD]!)).toEqual({
      access_token: "at",
      token_type: "Bearer",
    });
    const none = splitServerOAuthState(state, "none");
    expect(none.secrets[LEGACY_TOKENS_FIELD]).toBeUndefined();
    // Client secrets are registration credentials, not acquired tokens —
    // the policy does not affect them.
    expect(none.secrets[LEGACY_CLIENT_SECRET_FIELD]).toBe("cs");
  });

  it("passes a secretless state through with no secrets", () => {
    const state: ServerOAuthState = {
      scope: "read",
      clientInformation: { client_id: "public-only" },
    };
    const { residue, secrets } = splitServerOAuthState(state, "all");
    expect(residue).toEqual(state);
    expect(secrets).toEqual({});
  });
});

describe("joinServerOAuthState", () => {
  it("rejoins tokens and client secrets, store wins over plaintext", () => {
    const issuer = "https://as.example";
    const residue: ServerOAuthState = {
      tokens: { access_token: "stale", token_type: "Bearer" },
      clientInformation: { client_id: "cid" },
      preregisteredClientInformation: { client_id: "pre" },
      byIssuer: {
        [issuer]: { clientInformation: { client_id: "icid" } },
      },
    };
    const joined = joinServerOAuthState(residue, {
      [LEGACY_TOKENS_FIELD]: JSON.stringify(TOKENS),
      [LEGACY_CLIENT_SECRET_FIELD]: "cs",
      [PREREG_CLIENT_SECRET_FIELD]: "pre-cs",
      [issuerTokensField(issuer)]: JSON.stringify(TOKENS),
      [issuerClientSecretField(issuer)]: "ics",
    });
    expect(joined.tokens).toEqual(TOKENS);
    expect(joined.clientInformation).toEqual({
      client_id: "cid",
      client_secret: "cs",
    });
    expect(joined.preregisteredClientInformation).toEqual({
      client_id: "pre",
      client_secret: "pre-cs",
    });
    expect(joined.byIssuer![issuer]).toEqual({
      clientInformation: { client_id: "icid", client_secret: "ics" },
      tokens: TOKENS,
    });
  });

  it("ignores orphaned secrets whose residue slot was cleared", () => {
    const joined = joinServerOAuthState(
      { scope: "read" },
      {
        [LEGACY_CLIENT_SECRET_FIELD]: "orphan",
        [PREREG_CLIENT_SECRET_FIELD]: "orphan",
      },
    );
    expect(joined).toEqual({ scope: "read" });
  });

  it("treats a corrupt stored-tokens entry as absent", () => {
    const issuer = "https://as.example";
    const joined = joinServerOAuthState(
      { byIssuer: { [issuer]: {} } },
      {
        [LEGACY_TOKENS_FIELD]: "not json",
        [issuerTokensField(issuer)]: JSON.stringify({ no_access_token: 1 }),
      },
    );
    expect(joined.tokens).toBeUndefined();
    expect(joined.byIssuer![issuer]!.tokens).toBeUndefined();
  });
});

describe("splitIdpSession / joinIdpSession", () => {
  const session = {
    idToken: "idt",
    refreshToken: "rt",
    idTokenExpiresAt: 123,
  };

  it("moves tokens to the store and keeps the expiry in the residue", () => {
    const { residue, secrets } = splitIdpSession(session, "all");
    expect(residue).toEqual({ idTokenExpiresAt: 123 });
    expect(JSON.parse(secrets[IDP_SESSION_FIELD]!)).toEqual({
      idToken: "idt",
      refreshToken: "rt",
    });
  });

  it("policy 'access' keeps the id token but drops the refresh token", () => {
    const { secrets } = splitIdpSession(session, "access");
    expect(JSON.parse(secrets[IDP_SESSION_FIELD]!)).toEqual({
      idToken: "idt",
    });
  });

  it("policy 'none' stores nothing", () => {
    expect(splitIdpSession(session, "none").secrets).toEqual({});
  });

  it("stores nothing for a session with no tokens", () => {
    expect(splitIdpSession({ idTokenExpiresAt: 5 }, "all").secrets).toEqual({});
  });

  it("rejoins, and tolerates absent or corrupt store entries", () => {
    const residue = { idTokenExpiresAt: 123 };
    expect(
      joinIdpSession(residue, {
        [IDP_SESSION_FIELD]: JSON.stringify({
          idToken: "idt",
          refreshToken: "rt",
        }),
      }),
    ).toEqual(session);
    expect(joinIdpSession(residue, {})).toEqual(residue);
    expect(joinIdpSession(residue, { [IDP_SESSION_FIELD]: "corrupt" })).toEqual(
      residue,
    );
    expect(joinIdpSession(residue, { [IDP_SESSION_FIELD]: "42" })).toEqual(
      residue,
    );
  });
});

describe("serverSecretFields", () => {
  it("always includes the legacy/prereg fields, plus per-issuer pairs", () => {
    expect(serverSecretFields(undefined).sort()).toEqual(
      [
        LEGACY_TOKENS_FIELD,
        LEGACY_CLIENT_SECRET_FIELD,
        LEGACY_REGISTRATION_TOKEN_FIELD,
        PREREG_CLIENT_SECRET_FIELD,
        PREREG_REGISTRATION_TOKEN_FIELD,
      ].sort(),
    );
    const issuer = "https://as.example";
    expect(serverSecretFields({ byIssuer: { [issuer]: {} } })).toContain(
      issuerTokensField(issuer),
    );
    expect(serverSecretFields({ byIssuer: { [issuer]: {} } })).toContain(
      issuerClientSecretField(issuer),
    );
    expect(serverSecretFields({ byIssuer: { [issuer]: {} } })).toContain(
      issuerRegistrationTokenField(issuer),
    );
  });
});

describe("snapshotHasPlaintextSecrets", () => {
  const empty: OAuthPersistSnapshot = { servers: {}, idpSessions: {} };

  it("detects each plaintext slot", () => {
    const cases: OAuthPersistSnapshot[] = [
      { servers: { s: { tokens: { ...TOKENS } } }, idpSessions: {} },
      {
        servers: {
          s: { clientInformation: { client_id: "c", client_secret: "x" } },
        },
        idpSessions: {},
      },
      {
        servers: {
          s: {
            preregisteredClientInformation: {
              client_id: "c",
              client_secret: "x",
            },
          },
        },
        idpSessions: {},
      },
      {
        servers: { s: { byIssuer: { i: { tokens: { ...TOKENS } } } } },
        idpSessions: {},
      },
      {
        servers: {
          s: {
            byIssuer: {
              i: { clientInformation: { client_id: "c", client_secret: "x" } },
            },
          },
        },
        idpSessions: {},
      },
      { servers: {}, idpSessions: { i: { idToken: "t" } } },
      { servers: {}, idpSessions: { i: { refreshToken: "t" } } },
    ];
    for (const snapshot of cases) {
      expect(snapshotHasPlaintextSecrets(snapshot)).toBe(true);
    }
  });

  it("is false for residue-only snapshots", () => {
    expect(snapshotHasPlaintextSecrets(empty)).toBe(false);
    expect(
      snapshotHasPlaintextSecrets({
        servers: {
          s: {
            scope: "read",
            clientInformation: { client_id: "public" },
            byIssuer: { i: { clientInformation: { client_id: "public" } } },
          },
        },
        idpSessions: { i: { idTokenExpiresAt: 1 } },
      }),
    ).toBe(false);
  });
});

describe("registration_access_token split (RFC 7592)", () => {
  // The DCR management credential rides inside clientInformation because DCR
  // responses are saved whole. It is bearer-grade (maskSecrets.ts) and must
  // never remain in the oauth.json residue — including when there is no
  // client_secret alongside it, the shape that used to slip through.
  const issuer = "https://as.example";

  it("splits and rejoins per-issuer, with and without client_secret", () => {
    const state: ServerOAuthState = {
      byIssuer: {
        [issuer]: {
          clientInformation: {
            client_id: "cid",
            registration_access_token: "rat",
          },
        },
      },
    };
    const { residue, secrets } = splitServerOAuthState(state, "all");
    expect(secrets[issuerRegistrationTokenField(issuer)]).toBe("rat");
    expect(residue.byIssuer![issuer]!.clientInformation).toEqual({
      client_id: "cid",
    });

    const joined = joinServerOAuthState(residue, secrets);
    expect(joined.byIssuer![issuer]!.clientInformation).toEqual({
      client_id: "cid",
      registration_access_token: "rat",
    });
  });

  it("splits both bearer keys from one legacy clientInformation", () => {
    const state: ServerOAuthState = {
      clientInformation: {
        client_id: "cid",
        client_secret: "cs",
        registration_access_token: "rat",
      },
    };
    const { residue, secrets } = splitServerOAuthState(state, "all");
    expect(secrets[LEGACY_CLIENT_SECRET_FIELD]).toBe("cs");
    expect(secrets[LEGACY_REGISTRATION_TOKEN_FIELD]).toBe("rat");
    expect(residue.clientInformation).toEqual({ client_id: "cid" });

    const joined = joinServerOAuthState(residue, secrets);
    expect(joined.clientInformation).toEqual(state.clientInformation);
  });

  it("splits and rejoins the preregistered client's token", () => {
    const state: ServerOAuthState = {
      preregisteredClientInformation: {
        client_id: "cid",
        registration_access_token: "rat",
      },
    };
    const { residue, secrets } = splitServerOAuthState(state, "all");
    expect(secrets[PREREG_REGISTRATION_TOKEN_FIELD]).toBe("rat");
    expect(residue.preregisteredClientInformation).toEqual({
      client_id: "cid",
    });
    const joined = joinServerOAuthState(residue, secrets);
    expect(joined.preregisteredClientInformation).toEqual(
      state.preregisteredClientInformation,
    );
  });

  it("a plaintext registration token alone marks the snapshot for migration", () => {
    const snapshot: OAuthPersistSnapshot = {
      servers: {
        "https://api.example/mcp": {
          clientInformation: {
            client_id: "cid",
            registration_access_token: "rat",
          },
        },
      },
      idpSessions: {},
    };
    expect(snapshotHasPlaintextSecrets(snapshot)).toBe(true);
  });
});
