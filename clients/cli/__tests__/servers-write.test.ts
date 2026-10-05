import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  InMemorySecretStore,
  SessionSecretStore,
} from "@inspector/core/auth/node/secret-store.js";
import { getDefaultMcpConfigPath } from "@inspector/core/storage/store-io.js";
import {
  addCatalogServer,
  editCatalogServer,
  isCatalogWriteMethod,
  removeCatalogServer,
  resolveWritableCatalogPath,
  runCatalogWrite,
} from "../src/handlers/servers-write.js";
import { runCli } from "./helpers/cli-runner.js";
import { expectCliFailure, expectCliSuccess } from "./helpers/assertions.js";

let dir: string;
let catalog: string;
let store: InMemorySecretStore;

function readCatalog(): Record<string, Record<string, unknown>> {
  return (
    JSON.parse(fs.readFileSync(catalog, "utf-8")) as {
      mcpServers: Record<string, Record<string, unknown>>;
    }
  ).mcpServers;
}

function writeCatalog(mcpServers: unknown): void {
  fs.writeFileSync(catalog, JSON.stringify({ mcpServers }, null, 2));
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "cli-servers-write-"));
  catalog = path.join(dir, "mcp.json");
  store = new InMemorySecretStore();
  // The route layer logs normalize/smuggle warnings through console.warn when
  // no file logger is wired; keep the test output clean.
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("isCatalogWriteMethod", () => {
  it("recognises only the three write methods", () => {
    expect(isCatalogWriteMethod("servers/add")).toBe(true);
    expect(isCatalogWriteMethod("servers/edit")).toBe(true);
    expect(isCatalogWriteMethod("servers/remove")).toBe(true);
    expect(isCatalogWriteMethod("servers/list")).toBe(false);
    expect(isCatalogWriteMethod(undefined)).toBe(false);
  });
});

describe("resolveWritableCatalogPath", () => {
  it("prefers --catalog, then MCP_CATALOG_PATH, then the default", () => {
    expect(resolveWritableCatalogPath({ catalog: catalog }, {})).toBe(catalog);
    expect(
      resolveWritableCatalogPath(
        { catalog: "  " },
        { MCP_CATALOG_PATH: catalog },
      ),
    ).toBe(catalog);
    expect(resolveWritableCatalogPath({}, {})).toBe(
      path.resolve(getDefaultMcpConfigPath()),
    );
  });

  it("resolves a relative path against the current directory", () => {
    expect(resolveWritableCatalogPath({ catalog: "rel.json" }, {})).toBe(
      path.resolve(process.cwd(), "rel.json"),
    );
  });

  it("refuses a read-only --config", () => {
    expect(() => resolveWritableCatalogPath({ config: catalog }, {})).toThrow(
      /read-only/,
    );
  });
});

describe("addCatalogServer", () => {
  it("adds a stdio entry with its env value split into the secret store", async () => {
    const result = await addCatalogServer({
      server: "demo",
      catalog,
      target: ["node", "server.js"],
      env: { API_KEY: "sekrit" },
      cwd: "/work",
      secretStore: store,
    });
    expect(result).toEqual({
      ok: true,
      action: "added",
      server: "demo",
      catalog,
    });
    expect(readCatalog()).toEqual({
      demo: {
        type: "stdio",
        command: "node",
        args: ["server.js"],
        env: { API_KEY: "" },
        cwd: "/work",
      },
    });
    expect(await store.get("demo", "env:API_KEY")).toBe("sekrit");
  });

  it("adds an HTTP entry with headers and a protocol era", async () => {
    await addCatalogServer({
      server: "web",
      catalog,
      serverUrl: "https://example.com/mcp",
      headers: { "X-Team": "a" },
      protocolEra: "modern",
      secretStore: store,
    });
    expect(readCatalog()).toEqual({
      web: {
        type: "streamable-http",
        url: "https://example.com/mcp",
        headers: { "X-Team": "a" },
        protocolEra: "modern",
      },
    });
  });

  it("sets only the protocol era when no headers are given", async () => {
    await addCatalogServer({
      server: "web",
      catalog,
      target: ["https://example.com/sse"],
      protocolEra: "auto",
      secretStore: store,
    });
    expect(readCatalog().web).toEqual({
      type: "sse",
      url: "https://example.com/sse",
      protocolEra: "auto",
    });
  });

  it("preserves the other entries in the file", async () => {
    writeCatalog({ keep: { type: "sse", url: "https://keep.example/sse" } });
    await addCatalogServer({
      server: "demo",
      catalog,
      target: ["node"],
      secretStore: store,
    });
    expect(Object.keys(readCatalog())).toEqual(["keep", "demo"]);
  });

  it("rejects a duplicate name with the route's message", async () => {
    writeCatalog({ demo: { type: "stdio", command: "node" } });
    await expect(
      addCatalogServer({
        server: "demo",
        catalog,
        target: ["node"],
        secretStore: store,
      }),
    ).rejects.toThrow("Server 'demo' already exists");
  });

  it("rejects an invalid name", async () => {
    await expect(
      addCatalogServer({
        server: "bad name",
        catalog,
        target: ["node"],
        secretStore: store,
      }),
    ).rejects.toThrow(/Invalid id/);
  });

  it("requires --server, a target, and no --rename", async () => {
    await expect(
      addCatalogServer({ catalog, target: ["node"], secretStore: store }),
    ).rejects.toThrow("servers/add requires --server <name>.");
    await expect(
      addCatalogServer({ server: "x", catalog, secretStore: store }),
    ).rejects.toThrow(/requires a command or URL/);
    await expect(
      addCatalogServer({
        server: "x",
        rename: "y",
        catalog,
        target: ["node"],
        secretStore: store,
      }),
    ).rejects.toThrow(/--rename is only valid/);
  });

  it("refuses -e values on a store that dies with the process", async () => {
    await expect(
      addCatalogServer({
        server: "demo",
        catalog,
        target: ["node"],
        env: { API_KEY: "sekrit" },
        secretStore: new SessionSecretStore(),
      }),
    ).rejects.toThrow(/MCP_INSPECTOR_SECRET_STORE/);
    expect(fs.existsSync(catalog)).toBe(false);
  });

  it("writes an entry without secrets on a session store", async () => {
    await addCatalogServer({
      server: "demo",
      catalog,
      target: ["node"],
      secretStore: new SessionSecretStore(),
    });
    expect(readCatalog().demo).toEqual({ type: "stdio", command: "node" });
  });
});

describe("editCatalogServer", () => {
  beforeEach(async () => {
    await addCatalogServer({
      server: "demo",
      catalog,
      target: ["node", "server.js"],
      env: { API_KEY: "sekrit" },
      headers: { "X-Team": "a" },
      secretStore: store,
    });
  });

  it("merges -e into the env and keeps untouched secrets", async () => {
    const result = await editCatalogServer({
      server: "demo",
      catalog,
      env: { OTHER: "1" },
      secretStore: store,
    });
    expect(result).toEqual({
      ok: true,
      action: "updated",
      server: "demo",
      catalog,
    });
    expect(readCatalog().demo).toEqual({
      type: "stdio",
      command: "node",
      args: ["server.js"],
      env: { API_KEY: "", OTHER: "" },
      headers: { "X-Team": "a" },
    });
    expect(await store.get("demo", "env:API_KEY")).toBe("sekrit");
    expect(await store.get("demo", "env:OTHER")).toBe("1");
  });

  it("sets --cwd on its own", async () => {
    await editCatalogServer({
      server: "demo",
      catalog,
      cwd: " /work ",
      secretStore: store,
    });
    expect(readCatalog().demo).toMatchObject({ cwd: "/work" });
  });

  it("replaces the transport when given a new target, keeping settings", async () => {
    await editCatalogServer({
      server: "demo",
      catalog,
      serverUrl: "https://example.com/sse",
      transport: "sse",
      secretStore: store,
    });
    expect(readCatalog().demo).toEqual({
      type: "sse",
      url: "https://example.com/sse",
      headers: { "X-Team": "a" },
    });
    // The env key is no longer part of the entry, so its secret is retired.
    expect(await store.get("demo", "env:API_KEY")).toBeNull();
  });

  it("replaces headers and sets the era, preserving the env", async () => {
    await editCatalogServer({
      server: "demo",
      catalog,
      headers: { "X-Other": "b" },
      protocolEra: "modern",
      secretStore: store,
    });
    expect(readCatalog().demo).toEqual({
      type: "stdio",
      command: "node",
      args: ["server.js"],
      env: { API_KEY: "" },
      headers: { "X-Other": "b" },
      protocolEra: "modern",
    });
    expect(await store.get("demo", "env:API_KEY")).toBe("sekrit");
  });

  it("renames, carrying the secrets to the new name", async () => {
    const result = await editCatalogServer({
      server: "demo",
      rename: "demo2",
      catalog,
      secretStore: store,
    });
    expect(result).toEqual({
      ok: true,
      action: "updated",
      server: "demo2",
      previousName: "demo",
      catalog,
    });
    expect(Object.keys(readCatalog())).toEqual(["demo2"]);
    expect(await store.get("demo2", "env:API_KEY")).toBe("sekrit");
    expect(await store.get("demo", "env:API_KEY")).toBeNull();
  });

  it("rejects a rename onto an existing name", async () => {
    await addCatalogServer({
      server: "other",
      catalog,
      target: ["node"],
      secretStore: store,
    });
    await expect(
      editCatalogServer({
        server: "demo",
        rename: "other",
        catalog,
        secretStore: store,
      }),
    ).rejects.toThrow("Server 'other' already exists");
  });

  it("requires something to change", async () => {
    await expect(
      editCatalogServer({
        server: "demo",
        rename: "demo",
        catalog,
        secretStore: store,
      }),
    ).rejects.toThrow(/needs something to change/);
  });

  it("requires --server", async () => {
    await expect(
      editCatalogServer({ catalog, cwd: "/x", secretStore: store }),
    ).rejects.toThrow("servers/edit requires --server <name>.");
  });

  it("rejects --transport without a new target", async () => {
    await expect(
      editCatalogServer({
        server: "demo",
        catalog,
        transport: "sse",
        cwd: "/x",
        secretStore: store,
      }),
    ).rejects.toThrow(/--transport on servers\/edit/);
  });

  it("reports an unknown name without touching a missing catalog", async () => {
    const missing = path.join(dir, "absent.json");
    await expect(
      editCatalogServer({
        server: "demo",
        catalog: missing,
        cwd: "/x",
        secretStore: store,
      }),
    ).rejects.toThrow(/Server 'demo' not found/);
    expect(fs.existsSync(missing)).toBe(false);
  });

  it("reports a name the route layer drops on read", async () => {
    fs.writeFileSync(
      catalog,
      '{"mcpServers":{"__proto__":{"type":"stdio","command":"node"}}}',
    );
    await expect(
      editCatalogServer({
        server: "__proto__",
        catalog,
        cwd: "/x",
        secretStore: store,
      }),
    ).rejects.toThrow(/Server '__proto__' not found/);
  });

  it("rejects -e / --cwd on a non-stdio entry", async () => {
    await addCatalogServer({
      server: "web",
      catalog,
      serverUrl: "https://example.com/mcp",
      secretStore: store,
    });
    await expect(
      editCatalogServer({
        server: "web",
        catalog,
        cwd: "/x",
        secretStore: store,
      }),
    ).rejects.toThrow(/apply to stdio servers; 'web' is streamable-http/);
  });

  it("refuses a rename on a session store", async () => {
    await expect(
      editCatalogServer({
        server: "demo",
        rename: "demo2",
        catalog,
        secretStore: new SessionSecretStore(),
      }),
    ).rejects.toThrow(/--rename needs a durable secret store/);
    expect(Object.keys(readCatalog())).toEqual(["demo"]);
  });

  it("allows a non-rename edit on a session store", async () => {
    await editCatalogServer({
      server: "demo",
      catalog,
      cwd: "/x",
      secretStore: new SessionSecretStore(),
    });
    expect(readCatalog().demo).toMatchObject({ cwd: "/x" });
  });

  it("refuses new -e values on a session store", async () => {
    await expect(
      editCatalogServer({
        server: "demo",
        catalog,
        env: { NEW: "v" },
        secretStore: new SessionSecretStore(),
      }),
    ).rejects.toThrow(/in-memory only/);
  });
});

describe("removeCatalogServer", () => {
  it("removes the entry and its secrets", async () => {
    await addCatalogServer({
      server: "demo",
      catalog,
      target: ["node"],
      env: { API_KEY: "sekrit" },
      secretStore: store,
    });
    const result = await removeCatalogServer({
      server: "demo",
      catalog,
      secretStore: store,
    });
    expect(result).toEqual({
      ok: true,
      action: "removed",
      server: "demo",
      catalog,
    });
    expect(readCatalog()).toEqual({});
    expect(await store.get("demo", "env:API_KEY")).toBeNull();
  });

  it("reports an unknown name", async () => {
    writeCatalog({});
    await expect(
      removeCatalogServer({ server: "nope", catalog, secretStore: store }),
    ).rejects.toThrow(/Server 'nope' not found/);
  });

  it("treats a file without an mcpServers map as empty", async () => {
    fs.writeFileSync(catalog, "{}");
    await expect(
      removeCatalogServer({ server: "nope", catalog, secretStore: store }),
    ).rejects.toThrow(/not found/);
    fs.writeFileSync(catalog, '{"mcpServers":null}');
    await expect(
      removeCatalogServer({ server: "nope", catalog, secretStore: store }),
    ).rejects.toThrow(/not found/);
  });

  it("rejects every flag it would otherwise ignore", async () => {
    await expect(
      removeCatalogServer({
        server: "demo",
        catalog,
        target: ["node"],
        transport: "stdio",
        env: { A: "1" },
        cwd: "/x",
        headers: { A: "1" },
        protocolEra: "modern",
        rename: "x",
        secretStore: store,
      }),
    ).rejects.toThrow(
      "servers/remove takes only --server <name>; remove a command/URL, --transport, -e, --cwd, --header, --protocol-era, --rename.",
    );
  });

  it("requires --server", async () => {
    await expect(
      removeCatalogServer({ catalog, secretStore: store }),
    ).rejects.toThrow("servers/remove requires --server <name>.");
  });
});

describe("runCatalogWrite", () => {
  it("dispatches each method", async () => {
    await runCatalogWrite("servers/add", {
      server: "demo",
      catalog,
      target: ["node"],
      secretStore: store,
    });
    await runCatalogWrite("servers/edit", {
      server: "demo",
      catalog,
      cwd: "/x",
      secretStore: store,
    });
    expect(readCatalog().demo).toMatchObject({ cwd: "/x" });
    await runCatalogWrite("servers/remove", {
      server: "demo",
      catalog,
      secretStore: store,
    });
    expect(readCatalog()).toEqual({});
  });
});

describe("--method servers/add|edit|remove", () => {
  // A file store under the temp dir keeps the in-process CLI off the host
  // keychain while still being durable, which `-e` requires.
  const env = (): Record<string, string> => ({
    MCP_INSPECTOR_SECRET_STORE: "file",
    MCP_INSPECTOR_SECRET_FILE: path.join(dir, "secrets.json"),
  });

  it("adds, edits, and removes through the CLI", async () => {
    const added = await runCli(
      [
        "node",
        "server.js",
        "--catalog",
        catalog,
        "--method",
        "servers/add",
        "--server",
        "demo",
        "-e",
        "API_KEY=sekrit",
        "--format",
        "json",
      ],
      { env: env() },
    );
    expectCliSuccess(added);
    expect(JSON.parse(added.stdout)).toEqual({
      result: { ok: true, action: "added", server: "demo", catalog },
    });

    const edited = await runCli(
      [
        "--catalog",
        catalog,
        "--method",
        "servers/edit",
        "--server",
        "demo",
        "--rename",
        "demo2",
        "--header",
        "X-Team: a",
      ],
      { env: env() },
    );
    expectCliSuccess(edited);
    expect(JSON.parse(edited.stdout)).toMatchObject({
      action: "updated",
      server: "demo2",
      previousName: "demo",
    });
    expect(readCatalog()).toEqual({
      demo2: {
        type: "stdio",
        command: "node",
        args: ["server.js"],
        env: { API_KEY: "" },
        headers: { "X-Team": "a" },
      },
    });

    const removed = await runCli(
      ["--catalog", catalog, "--method", "servers/remove", "--server", "demo2"],
      { env: env() },
    );
    expectCliSuccess(removed);
    expect(readCatalog()).toEqual({});
  });

  it("honours MCP_CATALOG_PATH even alongside a target", async () => {
    const result = await runCli(
      [
        "--method",
        "servers/add",
        "--server",
        "web",
        "--server-url",
        "https://example.com/mcp",
      ],
      { env: { ...env(), MCP_CATALOG_PATH: catalog } },
    );
    expectCliSuccess(result);
    expect(readCatalog().web).toEqual({
      type: "streamable-http",
      url: "https://example.com/mcp",
    });
  });

  it("refuses --config", async () => {
    const result = await runCli(
      ["node", "--config", catalog, "--method", "servers/add", "--server", "x"],
      { env: env() },
    );
    expectCliFailure(result);
    expect(result.stderr).toMatch(/read-only/);
  });

  it("rejects --rename outside servers/edit", async () => {
    const result = await runCli([
      "--catalog",
      catalog,
      "--method",
      "servers/list",
      "--rename",
      "x",
    ]);
    expectCliFailure(result);
    expect(result.stderr).toMatch(/--rename is only valid/);
  });

  it("rejects --relogin and --advertise-apps with a write method", async () => {
    const relogin = await runCli([
      "--catalog",
      catalog,
      "--method",
      "servers/remove",
      "--server",
      "x",
      "--relogin",
    ]);
    expectCliFailure(relogin);
    expect(relogin.stderr).toMatch(/--relogin cannot be combined/);
    const advertise = await runCli([
      "--catalog",
      catalog,
      "--method",
      "servers/remove",
      "--server",
      "x",
      "--advertise-apps",
    ]);
    expectCliFailure(advertise);
    expect(advertise.stderr).toMatch(/--advertise-apps requires/);
  });

  it("lists the write methods among the supported ones", async () => {
    const result = await runCli(["--catalog", catalog, "--method", "nope"]);
    expectCliFailure(result);
    expect(result.stderr).toMatch(
      /servers\/add, servers\/edit, servers\/remove/,
    );
  });
});
