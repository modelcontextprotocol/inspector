import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

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

import {
  NodeOAuthStorage,
  resetNodeOAuthStorageCache,
} from "@inspector/core/auth/node/storage-node.js";
import { pendingAuthMarkerPath } from "../src/connection/auth-helper.js";
import {
  EMA_LOGIN_HELPER_COMMAND,
  emaLoginMarkerKey,
  runEmaLoginHelper,
  startPendingEmaLogin,
} from "../src/connection/ema-login-helper.js";

const ISSUER = "https://idp.example.com";

/** Unexpired unsigned JWT ({ exp } one hour out). */
function fakeIdToken(): string {
  const b64 = (obj: object) =>
    Buffer.from(JSON.stringify(obj)).toString("base64url");
  return `${b64({ alg: "none" })}.${b64({
    exp: Math.floor(Date.now() / 1000) + 3600,
  })}.sig`;
}

describe("ema-login-helper", () => {
  let dir: string;
  let savedEnv: Record<string, string | undefined>;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-ema-login-helper-"));
    savedEnv = {
      MCP_CLIENT_CONFIG_PATH: process.env.MCP_CLIENT_CONFIG_PATH,
      MCP_INSPECTOR_OAUTH_STATE_PATH:
        process.env.MCP_INSPECTOR_OAUTH_STATE_PATH,
      MCP_INSPECTOR_DAEMON_DIR: process.env.MCP_INSPECTOR_DAEMON_DIR,
    };
    process.env.MCP_CLIENT_CONFIG_PATH = path.join(dir, "client.json");
    process.env.MCP_INSPECTOR_OAUTH_STATE_PATH = path.join(dir, "oauth.json");
    process.env.MCP_INSPECTOR_DAEMON_DIR = dir;
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

  function writeClientConfig(): void {
    fs.writeFileSync(
      process.env.MCP_CLIENT_CONFIG_PATH!,
      JSON.stringify({
        enterpriseManagedAuth: {
          idp: {
            issuer: ISSUER,
            clientId: "idp-client",
            clientSecret: "idp-secret",
          },
        },
      }),
    );
  }

  async function seedIdpSession(): Promise<void> {
    const storage = new NodeOAuthStorage();
    await storage.saveIdpSession(ISSUER, {
      idToken: fakeIdToken(),
      idTokenExpiresAt: Date.now() + 3600_000,
    });
  }

  function writeHelperScript(body: string): string {
    const script = path.join(dir, "fake-ema-helper.mjs");
    fs.writeFileSync(script, body);
    return script;
  }

  /** Fake helper emitting one auth_url event after confirming its argv. */
  function urlEmittingScript(url: string): string {
    return writeHelperScript(`
      process.stdin.resume();
      process.stdin.on("end", () => {
        if (process.argv[2] !== ${JSON.stringify(EMA_LOGIN_HELPER_COMMAND)}) {
          process.exit(9);
        }
        process.stdout.write(
          JSON.stringify({ event: "auth_url", url: ${JSON.stringify(url)} }) + "\\n",
        );
      });
    `);
  }

  it("emaLoginMarkerKey namespaces the issuer", () => {
    expect(emaLoginMarkerKey(ISSUER)).toBe(`ema-idp:${ISSUER}`);
  });

  describe("startPendingEmaLogin", () => {
    it("fails with mcpdo guidance when EMA is not configured", async () => {
      await expect(startPendingEmaLogin()).rejects.toThrow(
        /not configured.*client settings/is,
      );
    });

    it("short-circuits when already signed in without spawning a helper", async () => {
      writeClientConfig();
      await seedIdpSession();
      const result = await startPendingEmaLogin({
        // Would fail loudly if a spawn were attempted.
        helperArgv1: path.join(dir, "does-not-exist.mjs"),
      });
      expect(result).toEqual({
        issuer: ISSUER,
        loginState: "logged_in",
        alreadyLoggedIn: true,
      });
    });

    it("parks the login on a detached helper and returns its URL", async () => {
      writeClientConfig();
      const result = await startPendingEmaLogin({
        helperArgv1: urlEmittingScript("https://idp.example.com/authorize?s=1"),
      });
      expect(result).toMatchObject({
        issuer: ISSUER,
        loginState: "none",
        alreadyLoggedIn: false,
        pendingLogin: true,
        authUrl: "https://idp.example.com/authorize?s=1",
      });
    });

    it("--relogin clears the existing IdP session before parking", async () => {
      writeClientConfig();
      await seedIdpSession();
      const result = await startPendingEmaLogin({
        relogin: true,
        helperArgv1: urlEmittingScript("https://idp.example.com/authorize?s=2"),
      });
      expect(result).toMatchObject({
        loginState: "none",
        alreadyLoggedIn: false,
        pendingLogin: true,
        authUrl: "https://idp.example.com/authorize?s=2",
      });
    });

    it("reuses a live pending-login marker instead of spawning", async () => {
      writeClientConfig();
      fs.writeFileSync(
        pendingAuthMarkerPath(emaLoginMarkerKey(ISSUER)),
        JSON.stringify({
          url: "https://idp.example.com/authorize?s=reuse",
          pid: process.pid,
          expiresAt: Date.now() + 60_000,
        }),
        { mode: 0o600 },
      );
      const result = await startPendingEmaLogin({
        // Would fail loudly if a spawn were attempted.
        helperArgv1: path.join(dir, "does-not-exist.mjs"),
      });
      expect(result.authUrl).toBe("https://idp.example.com/authorize?s=reuse");
    });
  });

  describe("runEmaLoginHelper", () => {
    let stdout: string;
    let originalStdoutWrite: typeof process.stdout.write;

    beforeEach(() => {
      stdout = "";
      originalStdoutWrite = process.stdout.write;
      process.stdout.write = ((chunk: unknown, ...rest: unknown[]) => {
        stdout += typeof chunk === "string" ? chunk : String(chunk);
        const cb = rest.find((r) => typeof r === "function") as
          | (() => void)
          | undefined;
        cb?.();
        return true;
      }) as typeof process.stdout.write;
    });

    afterEach(() => {
      process.stdout.write = originalStdoutWrite;
    });

    function events(): Array<Record<string, unknown>> {
      return stdout
        .split("\n")
        .filter((line) => line.trim() !== "")
        .map((line) => JSON.parse(line) as Record<string, unknown>);
    }

    it("publishes the marker, emits auth_url + done, and cleans up", async () => {
      writeClientConfig();
      const markerPath = pendingAuthMarkerPath(emaLoginMarkerKey(ISSUER));
      startIdpOidcAuthorization.mockResolvedValue({
        authorizationUrl: new URL("https://idp.example.com/authorize?x=1"),
      });
      completeIdpOidcAuthorization.mockImplementation(async () => {
        // Mid-flow: the marker must already be on disk for repeat callers.
        expect(fs.existsSync(markerPath)).toBe(true);
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
          options.redirectUrlProvider.redirectUrl =
            "http://127.0.0.1:45678/oauth/callback";
          const url = await options.client.authenticate();
          expect(url?.href).toContain("idp.example.com/authorize");
          await options.client.completeOAuthFlow("code-1", ISSUER);
          return { kind: "success" };
        },
      );

      await runEmaLoginHelper();
      // The EPIPE guard on stdout must swallow late write errors.
      process.stdout.emit("error", new Error("EPIPE"));

      expect(events()).toEqual([
        { event: "auth_url", url: "https://idp.example.com/authorize?x=1" },
        { event: "done" },
      ]);
      // Own marker removed on exit.
      expect(fs.existsSync(markerPath)).toBe(false);
      expect(startIdpOidcAuthorization).toHaveBeenCalledWith(
        expect.objectContaining({
          redirectUrl: "http://127.0.0.1:45678/oauth/callback",
        }),
      );
    });

    it("emits an error event and rethrows when EMA is not configured", async () => {
      await expect(runEmaLoginHelper()).rejects.toThrow(/not configured/i);
      expect(events()).toEqual([
        {
          event: "error",
          message: expect.stringContaining("not configured") as string,
        },
      ]);
    });

    it("stringifies a non-Error flow failure in the error event", async () => {
      writeClientConfig();
      runRunnerInteractiveOAuth.mockRejectedValueOnce("string boom");
      await expect(runEmaLoginHelper()).rejects.toBe("string boom");
      expect(events()).toEqual([{ event: "error", message: "string boom" }]);
    });

    it("survives a gone parent (stdout writes that throw)", async () => {
      writeClientConfig();
      process.stdout.write = (() => {
        throw new Error("EPIPE");
      }) as unknown as typeof process.stdout.write;
      startIdpOidcAuthorization.mockResolvedValue({
        authorizationUrl: new URL("https://idp.example.com/authorize?x=2"),
      });
      completeIdpOidcAuthorization.mockImplementation(async () => {
        await seedIdpSession();
        return { idToken: fakeIdToken() };
      });
      runRunnerInteractiveOAuth.mockImplementation(
        async (options: {
          client: { authenticate: () => Promise<URL | undefined> };
        }) => {
          await options.client.authenticate();
          return { kind: "success" };
        },
      );
      await expect(runEmaLoginHelper()).resolves.toBeUndefined();
    });
  });
});
