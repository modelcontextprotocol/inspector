import { describe, it, expect } from "vitest";
import { createRemoteApp } from "@inspector/core/mcp/remote/node/server.js";

describe("createRemoteApp GET /api/config", () => {
  it("includes sandboxUrl in response when option is set", async () => {
    const sandboxUrl = "http://localhost:9123/sandbox";
    const { app } = createRemoteApp({
      dangerouslyOmitAuth: true,
      allowedOrigins: ["http://127.0.0.1:6274"],
      sandboxUrl,
      initialConfig: { defaultEnvironment: {} },
    });
    const res = await app.request(new Request("http://test/api/config"));
    expect(res.status).toBe(200);
    const data = (await res.json()) as { sandboxUrl?: string };
    expect(data.sandboxUrl).toBe(sandboxUrl);
  });

  it("omits sandboxUrl when option is not set", async () => {
    const { app } = createRemoteApp({
      dangerouslyOmitAuth: true,
      allowedOrigins: ["http://127.0.0.1:6274"],
      initialConfig: { defaultEnvironment: {} },
    });
    const res = await app.request(new Request("http://test/api/config"));
    expect(res.status).toBe(200);
    const data = (await res.json()) as { sandboxUrl?: string };
    expect(data).not.toHaveProperty("sandboxUrl");
  });

  it("uses initialConfig when provided instead of env", async () => {
    const { app } = createRemoteApp({
      dangerouslyOmitAuth: true,
      allowedOrigins: ["http://127.0.0.1:6274"],
      initialConfig: {
        defaultCommand: "my-server",
        defaultArgs: ["--foo"],
        defaultTransport: "stdio",
        defaultCwd: "/tmp",
        defaultEnvironment: { PATH: "/usr/bin" },
      },
    });
    const res = await app.request(new Request("http://test/api/config"));
    expect(res.status).toBe(200);
    const data = (await res.json()) as {
      defaultCommand?: string;
      defaultArgs?: string[];
      defaultTransport?: string;
      defaultCwd?: string;
      defaultEnvironment?: Record<string, string>;
    };
    expect(data.defaultCommand).toBe("my-server");
    expect(data.defaultArgs).toEqual(["--foo"]);
    expect(data.defaultTransport).toBe("stdio");
    expect(data.defaultCwd).toBe("/tmp");
    expect(data.defaultEnvironment).toEqual({ PATH: "/usr/bin" });
  });

  it("reports writable:true by default and writable:false when set", async () => {
    const writableApp = createRemoteApp({
      dangerouslyOmitAuth: true,
      initialConfig: { defaultEnvironment: {} },
    }).app;
    const writableRes = await writableApp.request(
      new Request("http://test/api/config"),
    );
    expect(
      ((await writableRes.json()) as { writable?: boolean }).writable,
    ).toBe(true);

    const readOnlyApp = createRemoteApp({
      dangerouslyOmitAuth: true,
      writable: false,
      initialConfig: { defaultEnvironment: {} },
    }).app;
    const readOnlyRes = await readOnlyApp.request(
      new Request("http://test/api/config"),
    );
    expect(
      ((await readOnlyRes.json()) as { writable?: boolean }).writable,
    ).toBe(false);
  });
});

describe("GET /api/config re-resolves secretStorage per request (#1950)", () => {
  it("serves the resolver's current answer, not the startup snapshot", async () => {
    // The descriptor states where a secret lands, and it changes while the
    // process runs — the first write under a newly-set passphrase encrypts a
    // pre-existing plaintext file. A value captured at boot would keep
    // telling every page load "still unencrypted" until a restart.
    let plaintext = true;
    const { app } = createRemoteApp({
      dangerouslyOmitAuth: true,
      initialConfig: {
        defaultEnvironment: {},
        secretStorage: {
          kind: "file",
          reason: "fallback",
          durable: true,
          plaintext: true,
          path: "/tmp/secrets.json",
        },
      },
      secretStorageResolver: async () => ({
        kind: "file",
        reason: "fallback",
        durable: true,
        plaintext,
        path: "/tmp/secrets.json",
      }),
    });

    const first = (await (
      await app.request(new Request("http://test/api/config"))
    ).json()) as { secretStorage?: { plaintext?: boolean } };
    expect(first.secretStorage?.plaintext).toBe(true);

    plaintext = false; // the upgrading write happens
    const second = (await (
      await app.request(new Request("http://test/api/config"))
    ).json()) as { secretStorage?: { plaintext?: boolean } };
    expect(second.secretStorage?.plaintext).toBe(false);
  });

  it("clears the field when the resolver says it is not known (round 9)", async () => {
    // The resolver's contract is that `undefined` means "not known right
    // now". Spreading it in conditionally left the *startup* descriptor
    // standing in its place, so a store that became undescribable kept
    // serving a stale, confident answer — the one thing this surface must
    // never do.
    const { app } = createRemoteApp({
      dangerouslyOmitAuth: true,
      initialConfig: {
        defaultEnvironment: {},
        secretStorage: {
          kind: "file",
          reason: "fallback",
          durable: true,
          plaintext: true,
          path: "/tmp/secrets.json",
        },
      },
      secretStorageResolver: async () => undefined,
    });

    const body = (await (
      await app.request(new Request("http://test/api/config"))
    ).json()) as { secretStorage?: unknown };
    expect(body.secretStorage).toBeUndefined();
  });

  it("falls back to the startup payload when no resolver is supplied", async () => {
    // Embedders and the test suite pass no resolver; they must keep the
    // previous behaviour rather than losing the field.
    const { app } = createRemoteApp({
      dangerouslyOmitAuth: true,
      initialConfig: {
        defaultEnvironment: {},
        secretStorage: { kind: "keyring", reason: "default", durable: true },
      },
    });
    const body = (await (
      await app.request(new Request("http://test/api/config"))
    ).json()) as { secretStorage?: { kind?: string } };
    expect(body.secretStorage?.kind).toBe("keyring");
  });
});
