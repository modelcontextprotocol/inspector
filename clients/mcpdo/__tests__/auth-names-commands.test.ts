import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  CliExitCodeError,
  EXIT_CODES,
} from "@inspector/core/cli/error-handler.js";

const callDaemon = vi.fn();
const listServerEntries = vi.fn();
const listStoredAuth = vi.fn();
const clearStoredAuth = vi.fn();

// Stub only the three reaches of the auth commands; importOriginal keeps the
// rest (including the real normalizeServerUrl / buildAuthNameIndex) intact, so
// no real daemon socket, catalog read, or OAuth-store write happens in-process.
vi.mock("../src/daemon/index.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/daemon/index.js")>()),
  callDaemon: (...args: unknown[]) => callDaemon(...args),
}));

vi.mock(
  "@inspector/core/cli/handlers/servers-list.js",
  async (importOriginal) => ({
    ...(await importOriginal<
      typeof import("@inspector/core/cli/handlers/servers-list.js")
    >()),
    listServerEntries: (...args: unknown[]) => listServerEntries(...args),
  }),
);

vi.mock("../src/connection/stored-auth.js", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("../src/connection/stored-auth.js")
  >()),
  listStoredAuth: (...args: unknown[]) => listStoredAuth(...args),
  clearStoredAuth: (...args: unknown[]) => clearStoredAuth(...args),
}));

const { runMcp } = await import("./helpers/mcp-runner.js");

const URL_A = "https://api.example.com/mcp";
const URL_B = "https://other.example.com/mcp";

function daemonDown(): CliExitCodeError {
  return new CliExitCodeError(EXIT_CODES.UNREACHABLE, "no daemon", {
    code: "daemon_unreachable",
  });
}

beforeEach(() => {
  callDaemon.mockReset();
  listServerEntries.mockReset();
  listStoredAuth.mockReset();
  clearStoredAuth.mockReset();
  listServerEntries.mockResolvedValue([]);
  callDaemon.mockResolvedValue({ connections: [] });
  listStoredAuth.mockResolvedValue({
    oauthStatePath: "/state/oauth.json",
    servers: [],
  });
  clearStoredAuth.mockImplementation((url: string) => Promise.resolve({ url }));
});

describe("auth/list friendly-name annotation", () => {
  it("annotates a stored URL with its catalog name and live flag", async () => {
    listStoredAuth.mockResolvedValue({
      oauthStatePath: "/state/oauth.json",
      servers: [{ url: URL_A, hasTokens: true, hasRefreshToken: false }],
    });
    listServerEntries.mockResolvedValue([
      { name: "hosted", type: "streamable-http", detail: URL_A },
    ]);
    callDaemon.mockResolvedValue({
      connections: [
        {
          name: "hosted",
          serverIdentity: URL_A,
          connectedAt: 0,
          lastAccessedAt: 0,
          isMru: false,
        },
      ],
    });

    const result = await runMcp(["auth/list", "--format", "json"]);
    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.stdout.trim());
    expect(parsed.servers[0]).toMatchObject({
      url: URL_A,
      knownAs: ["hosted"],
      live: true,
    });
  });

  it("omits knownAs/live for a URL with no local name", async () => {
    listStoredAuth.mockResolvedValue({
      oauthStatePath: "/state/oauth.json",
      servers: [{ url: URL_A, hasTokens: false, hasRefreshToken: false }],
    });

    const result = await runMcp(["auth/list", "--format", "json"]);
    const parsed = JSON.parse(result.stdout.trim());
    expect(parsed.servers[0].knownAs).toBeUndefined();
    expect(parsed.servers[0].live).toBeUndefined();
  });

  it("labels an EMA IdP record and omits name annotation for it", async () => {
    listStoredAuth.mockResolvedValue({
      oauthStatePath: "/state/oauth.json",
      servers: [
        {
          url: "ema-idp:https://idp.example.com",
          hasTokens: false,
          hasRefreshToken: false,
        },
      ],
    });

    const result = await runMcp(["auth/list", "--format", "json"]);
    const parsed = JSON.parse(result.stdout.trim());
    expect(parsed.servers[0]).toMatchObject({
      url: "ema-idp:https://idp.example.com",
      idp: true,
      issuer: "https://idp.example.com",
    });
    expect(parsed.servers[0].knownAs).toBeUndefined();
  });

  it("falls back to catalog names only when the daemon is down", async () => {
    listStoredAuth.mockResolvedValue({
      oauthStatePath: "/state/oauth.json",
      servers: [{ url: URL_A, hasTokens: true, hasRefreshToken: true }],
    });
    listServerEntries.mockResolvedValue([
      { name: "hosted", type: "streamable-http", detail: URL_A },
    ]);
    callDaemon.mockRejectedValue(daemonDown());

    const result = await runMcp(["auth/list", "--format", "json"]);
    const parsed = JSON.parse(result.stdout.trim());
    expect(parsed.servers[0].knownAs).toEqual(["hosted"]);
    expect(parsed.servers[0].live).toBeUndefined();
  });
});

describe("auth/clear by friendly name", () => {
  it("resolves a catalog name to its URL and clears it", async () => {
    listServerEntries.mockResolvedValue([
      { name: "hosted", type: "streamable-http", detail: URL_A },
    ]);

    const result = await runMcp(["auth/clear", "hosted", "--format", "json"]);
    expect(clearStoredAuth).toHaveBeenCalledWith(URL_A);
    expect(JSON.parse(result.stdout.trim())).toEqual({
      url: URL_A,
      clearedByName: "hosted",
    });
  });

  it("keeps the URL argument path unchanged", async () => {
    const result = await runMcp(["auth/clear", URL_A, "--format", "json"]);
    expect(clearStoredAuth).toHaveBeenCalledWith(URL_A);
    expect(JSON.parse(result.stdout.trim())).toEqual({ url: URL_A });
  });

  it("clears a non-http store key (EMA IdP) by its exact key", async () => {
    // The `ema-idp:<issuer>` key auth/list shows verbatim does not start with
    // https://, so it must still route to the direct store-key path rather than
    // the friendly-name resolver (which would reject it as an unknown name).
    const idpKey = "ema-idp:https://idp.example.com";
    listStoredAuth.mockResolvedValue({
      oauthStatePath: "/state/oauth.json",
      servers: [{ url: idpKey, hasTokens: false, hasRefreshToken: false }],
    });

    const result = await runMcp(["auth/clear", idpKey, "--format", "json"]);
    expect(clearStoredAuth).toHaveBeenCalledWith(idpKey);
    expect(JSON.parse(result.stdout.trim())).toEqual({ url: idpKey });
  });

  it("clears an EMA IdP entry by its bare issuer URL", async () => {
    // auth/list renders the IdP login by its issuer URL (prefix hidden), so
    // auth/clear must map that issuer back to the prefixed store key.
    const idpKey = "ema-idp:https://idp.example.com";
    listStoredAuth.mockResolvedValue({
      oauthStatePath: "/state/oauth.json",
      servers: [{ url: idpKey, hasTokens: false, hasRefreshToken: false }],
    });

    const result = await runMcp([
      "auth/clear",
      "https://idp.example.com",
      "--format",
      "json",
    ]);
    expect(clearStoredAuth).toHaveBeenCalledWith(idpKey);
    expect(JSON.parse(result.stdout.trim())).toEqual({ url: idpKey });
  });

  it("errors for a known stdio name (no stored auth)", async () => {
    listServerEntries.mockResolvedValue([
      { name: "local", type: "stdio", detail: "node server.js" },
    ]);

    const result = await runMcp(["auth/clear", "local"]);
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("stdio server");
    expect(clearStoredAuth).not.toHaveBeenCalled();
  });

  it("errors when a name maps to two different URLs", async () => {
    listServerEntries.mockResolvedValue([
      { name: "shared", type: "streamable-http", detail: URL_A },
    ]);
    callDaemon.mockResolvedValue({
      connections: [
        {
          name: "shared",
          serverIdentity: URL_B,
          connectedAt: 0,
          lastAccessedAt: 0,
          isMru: false,
        },
      ],
    });

    const result = await runMcp(["auth/clear", "shared"]);
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("multiple server URLs");
    expect(clearStoredAuth).not.toHaveBeenCalled();
  });

  it("errors for an unknown name", async () => {
    const result = await runMcp(["auth/clear", "nope"]);
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("No server named 'nope'");
    expect(clearStoredAuth).not.toHaveBeenCalled();
  });
});
