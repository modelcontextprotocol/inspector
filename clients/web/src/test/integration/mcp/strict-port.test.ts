import { describe, it, expect, afterEach } from "vitest";
import { createServer, type Server } from "node:http";
import { writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import {
  createTestServerHttp,
  type TestServerHttp,
  createTestServerInfo,
  loadConfig,
  resolveConfig,
} from "@modelcontextprotocol/inspector-test-server";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Live coverage of `ServerConfig.strictPort` (#2280).
 *
 * Every other fixture walks to the next free port on `EADDRINUSE`, which is
 * right for them and wrong for one: `oauth-insecure-token-endpoint-http.json`
 * hard-codes its port inside an OAuth issuer string, so a relocated server would
 * announce 8092 while all its metadata still pointed at whatever unrelated
 * process holds 8091 — and would silently stop reproducing the refusal it
 * exists for. This asserts the walk still happens by default and does not
 * happen for that fixture, because "fails loudly" is only a safety property if
 * it actually fails.
 */
const configsDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../../../../test-servers/configs",
);

describe("strictPort (#2280)", () => {
  let squatter: Server | null = null;
  let server: TestServerHttp | null = null;

  afterEach(async () => {
    if (server) {
      try {
        await server.stop();
      } catch {
        // ignore
      }
      server = null;
    }
    if (squatter) {
      await new Promise<void>((resolve) => squatter!.close(() => resolve()));
      squatter = null;
    }
  });

  /** Hold a port so the next bind has to decide whether to walk. */
  const squat = async (): Promise<number> => {
    squatter = createServer((_req, res) => res.end());
    await new Promise<void>((resolve) =>
      squatter!.listen(0, "127.0.0.1", () => resolve()),
    );
    const address = squatter.address();
    if (typeof address !== "object" || address === null) {
      throw new Error("no port");
    }
    return address.port;
  };

  it("walks to another port by default", async () => {
    const taken = await squat();
    server = createTestServerHttp({
      serverInfo: createTestServerInfo("walks", "1.0.0"),
      serverType: "streamable-http",
      port: taken,
    });
    const bound = await server.start();
    expect(bound).not.toBe(taken);
  });

  it("refuses to relocate when strictPort is set", async () => {
    const taken = await squat();
    server = createTestServerHttp({
      serverInfo: createTestServerInfo("strict", "1.0.0"),
      serverType: "streamable-http",
      port: taken,
      strictPort: true,
    });
    await expect(server.start()).rejects.toMatchObject({
      code: "EADDRINUSE",
    });
    // Deliberately NOT nulled: `start()` installs the process-global test-server
    // control before it binds, and only `stop()` clears it. Dropping the
    // reference here would skip teardown and leave that global pointing at a
    // dead server for the rest of the worker.
  });

  it.each([undefined, 0])(
    "refuses to start with strictPort and port %j",
    async (port) => {
      // Nothing to be strict about. Falling through to an OS-assigned port
      // would let a misconfigured fixture look strict while relocating every
      // run — the failure the flag exists to prevent, now silent.
      server = createTestServerHttp({
        serverInfo: createTestServerInfo("misconfigured", "1.0.0"),
        serverType: "streamable-http",
        port,
        strictPort: true,
      });
      await expect(server.start()).rejects.toThrow(/integer in 1-65535/);
    },
  );

  it.each(["false", "true", 1, null])(
    "rejects a non-boolean strictPort in a config file: %j",
    (value) => {
      // Consumed as a plain truthiness check at bind time, so the string
      // "false" would read as *enabled* and silently disable the port walk —
      // the opposite of what the author wrote.
      const file = path.join(
        tmpdir(),
        `strict-port-${Date.now()}-${Math.random()}.json`,
      );
      writeFileSync(
        file,
        JSON.stringify({
          serverInfo: { name: "x", version: "1.0.0" },
          transport: { type: "streamable-http", port: 8099, strictPort: value },
        }),
      );
      try {
        expect(() => loadConfig(file)).toThrow(
          /transport.strictPort must be a boolean/,
        );
      } finally {
        rmSync(file, { force: true });
      }
    },
  );

  it.each([
    // Each of these is truthy or type-valid enough to pass a naive check, and
    // each fails SILENTLY: the fixture looks strict and relocates anyway.
    [
      { type: "streamable-http", port: "0", strictPort: true },
      /integer in 1-65535/,
    ],
    [
      { type: "streamable-http", port: "8091", strictPort: true },
      /integer in 1-65535/,
    ],
    [
      { type: "streamable-http", port: 0, strictPort: true },
      /integer in 1-65535/,
    ],
    [
      { type: "streamable-http", port: 8091.5, strictPort: true },
      /integer in 1-65535/,
    ],
    [
      { type: "streamable-http", port: 70000, strictPort: true },
      /integer in 1-65535/,
    ],
    [{ type: "streamable-http", strictPort: true }, /integer in 1-65535/],
    // No listener at all, and `resolveConfig` drops the flag.
    [{ type: "stdio", strictPort: true }, /requires an HTTP transport/],
  ])("rejects the unhonorable strictPort config %j", (transport, message) => {
    const file = path.join(
      tmpdir(),
      `strict-port-combo-${Date.now()}-${Math.random()}.json`,
    );
    writeFileSync(
      file,
      JSON.stringify({
        serverInfo: { name: "x", version: "1.0.0" },
        transport,
      }),
    );
    try {
      expect(() => loadConfig(file)).toThrow(message);
    } finally {
      rmSync(file, { force: true });
    }
  });

  it("still accepts the honorable combination", () => {
    const file = path.join(
      tmpdir(),
      `strict-port-ok-${Date.now()}-${Math.random()}.json`,
    );
    writeFileSync(
      file,
      JSON.stringify({
        serverInfo: { name: "x", version: "1.0.0" },
        transport: { type: "streamable-http", port: 8091, strictPort: true },
      }),
    );
    try {
      expect(resolveConfig(loadConfig(file)).strictPort).toBe(true);
    } finally {
      rmSync(file, { force: true });
    }
  });

  it("rejects a truthy-but-unbindable port at bind time too", async () => {
    // Defense in depth for a programmatic caller that bypasses `loadConfig`.
    // A string "0" is truthy, so a bare falsiness guard would pass it through
    // and Node would coerce it to the dynamic port 0.
    server = createTestServerHttp({
      serverInfo: createTestServerInfo("stringy", "1.0.0"),
      serverType: "streamable-http",
      port: "0" as unknown as number,
      strictPort: true,
    });
    await expect(server.start()).rejects.toThrow(/integer in 1-65535/);
    server = null;
  });

  it("is carried from the fixture's config file to the resolved server config", async () => {
    // The plumbing half: a flag the loader drops would leave the fixture
    // relocating again with nothing to show for it.
    const resolved = resolveConfig(
      loadConfig(
        path.join(configsDir, "oauth-insecure-token-endpoint-http.json"),
      ),
    );
    expect(resolved.strictPort).toBe(true);
    expect(resolved.port).toBe(8091);
    expect(resolved.oauth?.issuerUrl?.href).toContain("localhost.:8091");
  });
});
