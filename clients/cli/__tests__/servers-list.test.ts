import { describe, it, expect, afterEach } from "vitest";
import { runCli } from "./helpers/cli-runner.js";
import {
  createSampleTestConfig,
  createTestConfig,
  deleteConfigFile,
} from "./helpers/fixtures.js";
import { expectCliSuccess } from "./helpers/assertions.js";
import {
  annotateServerEntriesWithSessions,
  listServerEntries,
  sanitizeServerConfig,
  sanitizeServerSettings,
  showServerEntry,
  summarizeServerConfig,
} from "../src/handlers/servers-list.js";
import type {
  InspectorServerSettings,
  MCPServerConfig,
} from "@inspector/core/mcp/types.js";
import { expectCliFailure } from "./helpers/assertions.js";
import {
  InMemorySecretStore,
  SECRET_FIELD_OAUTH_CLIENT_SECRET,
  envSecretField,
} from "@inspector/core/auth/node/secret-store.js";

describe("summarizeServerConfig", () => {
  it("summarises stdio, sse, and streamable-http configs", () => {
    expect(
      summarizeServerConfig({
        type: "stdio",
        command: "node",
        args: ["server.js"],
      }),
    ).toEqual({ type: "stdio", detail: "node server.js" });
    expect(
      summarizeServerConfig({
        type: "stdio",
        command: "node",
      }),
    ).toEqual({ type: "stdio", detail: "node" });
    expect(
      summarizeServerConfig({
        type: "sse",
        url: "http://localhost/sse",
      }),
    ).toEqual({ type: "sse", detail: "http://localhost/sse" });
    expect(
      summarizeServerConfig({
        type: "streamable-http",
        url: "http://localhost/mcp",
      } as MCPServerConfig),
    ).toEqual({ type: "streamable-http", detail: "http://localhost/mcp" });
    expect(
      summarizeServerConfig({
        type: "streamable-http",
      } as MCPServerConfig),
    ).toEqual({ type: "streamable-http", detail: "" });
  });
});

describe("annotateServerEntriesWithSessions", () => {
  const entries = [
    { name: "a", type: "stdio", detail: "node a" },
    { name: "b", type: "stdio", detail: "node b" },
  ];

  it("returns entries unchanged when there are no sessions", () => {
    expect(annotateServerEntriesWithSessions(entries, [])).toBe(entries);
  });

  it("marks matching entry names and MRU", () => {
    expect(
      annotateServerEntriesWithSessions(entries, [
        { name: "b", isMru: true },
        { name: "other" },
      ]),
    ).toEqual([
      { name: "a", type: "stdio", detail: "node a" },
      { name: "b", type: "stdio", detail: "node b", session: "b", isMru: true },
    ]);
  });

  it("omits isMru when the session is not MRU", () => {
    expect(
      annotateServerEntriesWithSessions(entries, [{ name: "a", isMru: false }]),
    ).toEqual([
      { name: "a", type: "stdio", detail: "node a", session: "a" },
      { name: "b", type: "stdio", detail: "node b" },
    ]);
  });
});

describe("listServerEntries / --method servers/list", () => {
  let configPath: string | undefined;

  afterEach(() => {
    if (configPath) {
      deleteConfigFile(configPath);
      configPath = undefined;
    }
  });

  it("lists catalog entries without connecting", async () => {
    configPath = createSampleTestConfig();
    const entries = await listServerEntries({ configPath });
    expect(entries.map((e) => e.name).sort()).toEqual([
      "test-http",
      "test-stdio",
    ]);
    expect(entries.find((e) => e.name === "test-stdio")?.type).toBe("stdio");
  });

  it("works via --method servers/list", async () => {
    configPath = createSampleTestConfig();
    const result = await runCli([
      "--config",
      configPath,
      "--method",
      "servers/list",
      "--format",
      "json",
    ]);
    expectCliSuccess(result);
    const body = JSON.parse(result.stdout) as {
      result: { servers: { name: string }[] };
    };
    expect(body.result.servers.map((s) => s.name).sort()).toEqual([
      "test-http",
      "test-stdio",
    ]);
  });
});

describe("showServerEntry / servers/show", () => {
  let configPath: string | undefined;

  afterEach(() => {
    if (configPath) {
      deleteConfigFile(configPath);
      configPath = undefined;
    }
  });

  it("redacts env values, init headers, and sensitive settings fields", () => {
    expect(
      sanitizeServerConfig({
        type: "stdio",
        command: "node",
        env: { SECRET: "value", HELLO: "world" },
      }),
    ).toEqual({
      type: "stdio",
      command: "node",
      env: { SECRET: "[redacted]", HELLO: "[redacted]" },
    });

    expect(
      sanitizeServerConfig({
        type: "streamable-http",
        url: "https://example.com/mcp",
        requestInit: {
          headers: {
            Authorization: "Bearer secret",
            Cookie: "session=abc",
            "X-Auth": "t",
            "Proxy-Authorization": "Basic x",
            "X-Custom": "ok",
          },
        },
        eventSourceInit: {
          headers: {
            "X-Api-Key": "k",
            Accept: "text/event-stream",
          },
        },
      } as MCPServerConfig),
    ).toMatchObject({
      requestInit: {
        headers: {
          Authorization: "[redacted]",
          Cookie: "[redacted]",
          "X-Auth": "[redacted]",
          "Proxy-Authorization": "[redacted]",
          "X-Custom": "ok",
        },
      },
      eventSourceInit: {
        headers: {
          "X-Api-Key": "[redacted]",
          Accept: "text/event-stream",
        },
      },
    });

    expect(
      sanitizeServerConfig({
        type: "streamable-http",
        url: "https://example.com/mcp",
        requestInit: {
          headers: [
            ["Authorization", "Bearer secret"],
            ["X-Custom", "ok"],
          ],
        },
      } as MCPServerConfig),
    ).toMatchObject({
      requestInit: {
        headers: [
          ["Authorization", "[redacted]"],
          ["X-Custom", "ok"],
        ],
      },
    });

    const settings: InspectorServerSettings = {
      headers: [
        { key: "Authorization", value: "Bearer x" },
        { key: "X-Custom", value: "ok" },
      ],
      metadata: {
        Authorization: "Bearer meta",
        "X-Custom": "ok",
        // A structured value under a sensitive key: the redaction must replace
        // the whole value, not walk into it (#1910).
        "X-Api-Key": { primary: "sk-live-1", fallback: "sk-live-2" },
        nested: { keep: true },
        // A secret buried under a non-sensitive key. A top-level-only check
        // would print `accessToken` in full.
        trace: {
          id: "t-1",
          accessToken: "sk-live-3",
          deeper: { refresh_token: "sk-live-4", ok: 1 },
        },
        // Objects inside an array are reached too.
        attempts: [{ password: "hunter2" }, { attempt: 2 }],
      },
      env: [
        { key: "TOKEN", value: "secret" },
        { key: "", value: "still-secret" },
      ],
      connectionTimeout: 0,
      requestTimeout: 0,
      taskTtl: 60_000,
      maxFetchRequests: 100,
      roots: [],
      oauthClientSecret: "shh",
      oauthClientId: "cid",
    };
    const sanitized = sanitizeServerSettings(settings);
    expect(sanitized.oauthClientSecret).toBe("[redacted]");
    expect(sanitized.oauthClientId).toBe("cid");
    expect(sanitized.headers).toEqual([
      { key: "Authorization", value: "[redacted]" },
      { key: "X-Custom", value: "ok" },
    ]);
    expect(sanitized.metadata).toEqual({
      Authorization: "[redacted]",
      "X-Custom": "ok",
      "X-Api-Key": "[redacted]",
      // A structured value under a non-sensitive key survives intact...
      nested: { keep: true },
      // ...but a sensitive key nested inside one does not.
      trace: {
        id: "t-1",
        accessToken: "[redacted]",
        deeper: { refresh_token: "[redacted]", ok: 1 },
      },
      attempts: [{ password: "[redacted]" }, { attempt: 2 }],
    });
    expect(sanitized.env).toEqual([
      { key: "TOKEN", value: "[redacted]" },
      { key: "", value: "[redacted]" },
    ]);
  });

  it("shows one resolved entry without connecting", async () => {
    configPath = createSampleTestConfig();
    const entry = await showServerEntry("test-stdio", {
      configPath,
      secretStore: new InMemorySecretStore(),
    });
    expect(entry.name).toBe("test-stdio");
    expect(entry.type).toBe("stdio");
    expect(entry.config).toMatchObject({
      type: "stdio",
      command: expect.any(String),
    });
    expect(entry.config.env).toEqual({ HELLO: "[redacted]" });
  });

  it("redacts secrets rehydrated from an injected secret store", async () => {
    configPath = createTestConfig({
      mcpServers: {
        "secret-stdio": {
          type: "stdio",
          command: "node",
          env: { HELLO: "" },
        },
        "secret-http": {
          type: "streamable-http",
          url: "https://example.com/mcp",
          // Disk keeps clientId only; secret lives in the store.
          oauth: { clientId: "cid" },
        } as MCPServerConfig,
      },
    });
    const secretStore = new InMemorySecretStore();
    await secretStore.set(
      "secret-stdio",
      envSecretField("HELLO"),
      "top-secret-env",
    );
    await secretStore.set(
      "secret-http",
      SECRET_FIELD_OAUTH_CLIENT_SECRET,
      "top-secret-oauth",
    );

    const stdio = await showServerEntry("secret-stdio", {
      configPath,
      secretStore,
    });
    expect(stdio.config.env).toEqual({ HELLO: "[redacted]" });
    expect(JSON.stringify(stdio)).not.toContain("top-secret-env");

    const http = await showServerEntry("secret-http", {
      configPath,
      secretStore,
    });
    expect(http.settings?.oauthClientSecret).toBe("[redacted]");
    expect(http.settings?.oauthClientId).toBe("cid");
    expect(JSON.stringify(http)).not.toContain("top-secret-oauth");
  });

  it("works via --method servers/show --server", async () => {
    configPath = createSampleTestConfig();
    const result = await runCli([
      "--config",
      configPath,
      "--method",
      "servers/show",
      "--server",
      "test-http",
      "--format",
      "json",
    ]);
    expectCliSuccess(result);
    const body = JSON.parse(result.stdout) as {
      result: { name: string; type: string };
    };
    expect(body.result.name).toBe("test-http");
    expect(body.result.type).toBe("streamable-http");
  });

  it("rejects servers/show without --server", async () => {
    configPath = createSampleTestConfig();
    const result = await runCli([
      "--config",
      configPath,
      "--method",
      "servers/show",
    ]);
    expectCliFailure(result);
    expect(result.stderr).toMatch(/--server/);
  });

  it("rejects unknown server names", async () => {
    configPath = createSampleTestConfig();
    await expect(
      showServerEntry("nope", {
        configPath,
        secretStore: new InMemorySecretStore(),
      }),
    ).rejects.toThrow(/not found/);
  });
});
