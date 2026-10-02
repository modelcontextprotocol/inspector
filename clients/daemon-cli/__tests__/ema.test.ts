import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { CliExitCodeError } from "@inspector/cli/error-handler.js";
import {
  NodeOAuthStorage,
  resetNodeOAuthStorageCache,
} from "@inspector/core/auth/node/storage-node.js";

const runRunnerInteractiveOAuth = vi.fn();
const startIdpOidcAuthorization = vi.fn();
const completeIdpOidcAuthorization = vi.fn();

vi.mock("@inspector/core/auth/node/index.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@inspector/core/auth/node/index.js")>();
  return {
    ...actual,
    runRunnerInteractiveOAuth: (...args: unknown[]) =>
      runRunnerInteractiveOAuth(...args),
  };
});

vi.mock("@inspector/core/auth/ema/idpOidc.js", () => ({
  startIdpOidcAuthorization: (...args: unknown[]) =>
    startIdpOidcAuthorization(...args),
  completeIdpOidcAuthorization: (...args: unknown[]) =>
    completeIdpOidcAuthorization(...args),
}));

const ISSUER = "https://idp.example.com";

/** Unexpired unsigned JWT ({ exp } one hour out). */
function fakeIdToken(): string {
  const b64 = (obj: object) =>
    Buffer.from(JSON.stringify(obj)).toString("base64url");
  return `${b64({ alg: "none" })}.${b64({
    exp: Math.floor(Date.now() / 1000) + 3600,
  })}.sig`;
}

describe("mcpdo ema helpers", () => {
  let dir: string;
  let savedEnv: Record<string, string | undefined>;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-conn-ema-"));
    savedEnv = {
      MCP_CLIENT_CONFIG_PATH: process.env.MCP_CLIENT_CONFIG_PATH,
      MCP_INSPECTOR_OAUTH_STATE_PATH:
        process.env.MCP_INSPECTOR_OAUTH_STATE_PATH,
    };
    process.env.MCP_CLIENT_CONFIG_PATH = path.join(dir, "client.json");
    process.env.MCP_INSPECTOR_OAUTH_STATE_PATH = path.join(dir, "oauth.json");
    resetNodeOAuthStorageCache();
    runRunnerInteractiveOAuth.mockReset();
    startIdpOidcAuthorization.mockReset();
    completeIdpOidcAuthorization.mockReset();
  });

  afterEach(() => {
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    resetNodeOAuthStorageCache();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  function writeClientConfig(config: unknown): void {
    fs.writeFileSync(
      process.env.MCP_CLIENT_CONFIG_PATH!,
      JSON.stringify(config),
    );
  }

  function emaClientConfig(enabled?: boolean): unknown {
    return {
      enterpriseManagedAuth: {
        ...(enabled !== undefined && { enabled }),
        idp: {
          issuer: ISSUER,
          clientId: "idp-client",
          clientSecret: "idp-secret",
        },
      },
    };
  }

  async function seedIdpSession(): Promise<void> {
    const storage = new NodeOAuthStorage();
    await storage.saveIdpSession(ISSUER, {
      idToken: fakeIdToken(),
      idTokenExpiresAt: Date.now() + 3600_000,
    });
  }

  it("getEmaStatus reports unconfigured when client.json has no EMA block", async () => {
    const { getEmaStatus } = await import("../src/connection/ema.js");
    const status = await getEmaStatus();
    expect(status.configured).toBe(false);
    expect(status.enabled).toBe(false);
    expect(status.loginState).toBe("unconfigured");
    expect(status.clientConfigPath).toBe(process.env.MCP_CLIENT_CONFIG_PATH);
  });

  it("getEmaStatus reports configured+enabled with no IdP session as 'none'", async () => {
    writeClientConfig(emaClientConfig());
    const { getEmaStatus } = await import("../src/connection/ema.js");
    const status = await getEmaStatus();
    expect(status.configured).toBe(true);
    expect(status.enabled).toBe(true);
    expect(status.issuer).toBe(ISSUER);
    expect(status.clientId).toBe("idp-client");
    expect(status.loginState).toBe("none");
  });

  it("getEmaStatus reports a disabled config (still shows issuer + connection state)", async () => {
    writeClientConfig(emaClientConfig(false));
    await seedIdpSession();
    const { getEmaStatus } = await import("../src/connection/ema.js");
    const status = await getEmaStatus();
    expect(status.configured).toBe(true);
    expect(status.enabled).toBe(false);
    expect(status.loginState).toBe("logged_in");
  });

  it("emaLogin fails with actionable guidance when EMA is not configured", async () => {
    const { emaLogin } = await import("../src/connection/ema.js");
    await expect(emaLogin()).rejects.toThrow(
      /not configured.*client settings/is,
    );
    await expect(emaLogin()).rejects.toThrow(
      process.env.MCP_CLIENT_CONFIG_PATH!,
    );
  });

  it("emaLogin fails with actionable guidance when EMA is disabled", async () => {
    writeClientConfig(emaClientConfig(false));
    const { emaLogin } = await import("../src/connection/ema.js");
    await expect(emaLogin()).rejects.toThrow(/disabled/i);
  });

  it("emaLogout fails when EMA is not configured", async () => {
    const { emaLogout } = await import("../src/connection/ema.js");
    await expect(emaLogout()).rejects.toThrow(CliExitCodeError);
  });

  it("emaLogout works even when EMA is disabled, and clears the IdP session", async () => {
    writeClientConfig(emaClientConfig(false));
    await seedIdpSession();
    const { emaLogout, getEmaStatus } =
      await import("../src/connection/ema.js");
    const result = await emaLogout();
    expect(result.issuer).toBe(ISSUER);
    expect((await getEmaStatus()).loginState).toBe("none");
  });

  it("emaLogin short-circuits when already signed in", async () => {
    writeClientConfig(emaClientConfig());
    await seedIdpSession();
    const { emaLogin } = await import("../src/connection/ema.js");
    const result = await emaLogin();
    expect(result).toEqual({
      issuer: ISSUER,
      loginState: "logged_in",
      alreadyLoggedIn: true,
    });
    expect(runRunnerInteractiveOAuth).not.toHaveBeenCalled();
  });

  it("emaLogin runs the IdP flow via the runner adapter and reports the new connection", async () => {
    writeClientConfig(emaClientConfig());
    let stderr = "";
    const originalWrite = process.stderr.write;
    process.stderr.write = ((chunk: unknown, ...rest: unknown[]) => {
      stderr += typeof chunk === "string" ? chunk : String(chunk);
      const cb = rest.find((r) => typeof r === "function") as
        | (() => void)
        | undefined;
      cb?.();
      return true;
    }) as typeof process.stderr.write;

    startIdpOidcAuthorization.mockResolvedValue({
      authorizationUrl: new URL("https://idp.example.com/authorize?x=1"),
    });
    completeIdpOidcAuthorization.mockImplementation(async () => {
      await seedIdpSession();
      return { idToken: fakeIdToken() };
    });
    runRunnerInteractiveOAuth.mockImplementation(
      async (options: {
        client: {
          authenticate: () => Promise<URL | undefined>;
          completeOAuthFlow: (code: string, iss?: string) => Promise<void>;
        };
        redirectUrlProvider: { redirectUrl: string };
      }) => {
        // Mirror the real runner: bind the loopback redirect before leg 1.
        options.redirectUrlProvider.redirectUrl =
          "http://127.0.0.1:45678/oauth/callback";
        const url = await options.client.authenticate();
        expect(url?.href).toContain("idp.example.com/authorize");
        await options.client.completeOAuthFlow("code-1", ISSUER);
        return { kind: "success" };
      },
    );

    try {
      const { emaLogin } = await import("../src/connection/ema.js");
      const result = await emaLogin();
      expect(result).toEqual({
        issuer: ISSUER,
        loginState: "logged_in",
        alreadyLoggedIn: false,
      });
    } finally {
      process.stderr.write = originalWrite;
    }

    expect(startIdpOidcAuthorization).toHaveBeenCalledWith(
      expect.objectContaining({
        redirectUrl: "http://127.0.0.1:45678/oauth/callback",
      }),
    );
    expect(completeIdpOidcAuthorization).toHaveBeenCalledWith(
      expect.objectContaining({ authorizationCode: "code-1", iss: ISSUER }),
    );
    // Agent-attended wording: vitest's stderr is not a TTY, so the printed
    // line must direct an agent to relay the IdP link to the human user.
    expect(stderr).toContain(
      "The user needs to sign in to the enterprise identity provider",
    );
  });

  it("emaLogin --relogin clears the existing connection and re-runs the flow", async () => {
    writeClientConfig(emaClientConfig());
    await seedIdpSession();
    startIdpOidcAuthorization.mockResolvedValue({
      authorizationUrl: new URL("https://idp.example.com/authorize"),
    });
    completeIdpOidcAuthorization.mockImplementation(async () => {
      await seedIdpSession();
      return { idToken: fakeIdToken() };
    });
    runRunnerInteractiveOAuth.mockImplementation(
      async (options: {
        client: {
          authenticate: () => Promise<URL | undefined>;
          completeOAuthFlow: (code: string) => Promise<void>;
        };
        redirectUrlProvider: { redirectUrl: string };
      }) => {
        // The pre-existing connection must already be gone before leg 1 runs.
        const storage = new NodeOAuthStorage();
        expect(await storage.getIdpSession(ISSUER)).toBeUndefined();
        await options.client.authenticate();
        await options.client.completeOAuthFlow("code-2");
        return { kind: "success" };
      },
    );

    const { emaLogin } = await import("../src/connection/ema.js");
    const result = await emaLogin({ relogin: true });
    expect(result.alreadyLoggedIn).toBe(false);
    expect(result.loginState).toBe("logged_in");
    expect(runRunnerInteractiveOAuth).toHaveBeenCalledOnce();
  });

  it("mcpdoEmaGuidance names both configuration routes", async () => {
    const { mcpdoEmaGuidance } = await import("../src/connection/ema.js");
    expect(mcpdoEmaGuidance("not_configured")).toMatch(
      /Client Settings.*enterpriseManagedAuth/is,
    );
    expect(mcpdoEmaGuidance("disabled")).toContain("enabled");
  });
});
