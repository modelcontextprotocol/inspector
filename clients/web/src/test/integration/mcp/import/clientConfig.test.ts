import { describe, it, expect } from "vitest";
import {
  parseMcpServersConfig,
  parseVsCodeConfig,
  parseClientConfig,
} from "@inspector/core/mcp/import/clientConfig.js";

describe("parseMcpServersConfig", () => {
  it("parses a standard { mcpServers } file and normalizes types", () => {
    const raw = JSON.stringify({
      mcpServers: {
        local: { command: "npx", args: ["-y", "server-everything"] },
        remote: { type: "http", url: "https://example.com/mcp" },
        sse: { type: "sse", url: "https://example.com/sse" },
      },
    });
    const config = parseMcpServersConfig(raw);
    // Missing type defaults to stdio.
    expect(config.mcpServers.local.type).toBe("stdio");
    // "http" alias normalizes to streamable-http.
    expect(config.mcpServers.remote.type).toBe("streamable-http");
    expect(config.mcpServers.sse.type).toBe("sse");
  });

  it("preserves extension fields (env, cwd, headers) on entries", () => {
    const raw = JSON.stringify({
      mcpServers: {
        s: {
          command: "node",
          args: ["server.js"],
          env: { API_KEY: "abc" },
          cwd: "/srv/app",
        },
      },
    });
    const config = parseMcpServersConfig(raw);
    const entry = config.mcpServers.s;
    expect(entry.type).toBe("stdio");
    if (entry.type === "stdio") {
      expect(entry.env).toEqual({ API_KEY: "abc" });
      expect(entry.cwd).toBe("/srv/app");
    }
  });

  it("skips non-object server entries", () => {
    const raw = JSON.stringify({
      mcpServers: {
        good: { command: "node" },
        bad: null,
        alsoBad: 42,
        arr: [],
      },
    });
    const config = parseMcpServersConfig(raw);
    expect(Object.keys(config.mcpServers)).toEqual(["good"]);
  });

  it("throws on invalid JSON", () => {
    expect(() => parseMcpServersConfig("{not json")).toThrow(/Invalid JSON/);
  });

  it("throws when the top level is not an object", () => {
    expect(() => parseMcpServersConfig("[]")).toThrow(/top level/);
    expect(() => parseMcpServersConfig("42")).toThrow(/top level/);
  });

  it("throws when mcpServers is missing or not an object", () => {
    expect(() => parseMcpServersConfig("{}")).toThrow(/mcpServers/);
    expect(() => parseMcpServersConfig('{"mcpServers": []}')).toThrow(
      /mcpServers/,
    );
  });
});

describe("parseVsCodeConfig", () => {
  it("parses VS Code's top-level servers map", () => {
    const raw = JSON.stringify({
      servers: {
        gh: { type: "http", url: "https://api.example.com/mcp" },
        local: { command: "uvx", args: ["my-server"] },
      },
      inputs: [{ id: "token", type: "promptString" }],
    });
    const config = parseVsCodeConfig(raw);
    expect(config.mcpServers.gh.type).toBe("streamable-http");
    expect(config.mcpServers.local.type).toBe("stdio");
  });

  it("throws when there is no servers object", () => {
    expect(() => parseVsCodeConfig("{}")).toThrow(/servers/);
    expect(() => parseVsCodeConfig('{"servers": 1}')).toThrow(/servers/);
  });

  it("throws on invalid JSON", () => {
    expect(() => parseVsCodeConfig("nope")).toThrow(/Invalid JSON/);
  });
});

describe("parseClientConfig (unknown shape)", () => {
  it("parses the { mcpServers } shape", () => {
    const config = parseClientConfig(
      JSON.stringify({ mcpServers: { a: { command: "node" } } }),
    );
    expect(config.mcpServers.a.type).toBe("stdio");
  });

  it("falls back to the VS Code { servers } shape", () => {
    const config = parseClientConfig(
      JSON.stringify({ servers: { b: { command: "node" } } }),
    );
    expect(config.mcpServers.b.type).toBe("stdio");
  });

  it("surfaces the mcpServers error when neither shape matches", () => {
    expect(() => parseClientConfig("{}")).toThrow(/mcpServers/);
  });

  it("surfaces invalid JSON", () => {
    expect(() => parseClientConfig("nope")).toThrow(/Invalid JSON/);
  });
});
