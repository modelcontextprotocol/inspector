import { describe, it, expect } from "vitest";
import type { ServerListEntry } from "@inspector/core/cli/handlers/servers-list.js";
import type { ConnectionInfo } from "../src/daemon/protocol.js";
import {
  buildAuthNameIndex,
  resolveFriendlyName,
} from "../src/connection/auth-names.js";

function entry(name: string, type: string, detail: string): ServerListEntry {
  return { name, type, detail };
}

function conn(name: string, serverIdentity: string): ConnectionInfo {
  return {
    name,
    serverIdentity,
    connectedAt: 0,
    lastAccessedAt: 0,
    isMru: false,
  };
}

describe("buildAuthNameIndex", () => {
  it("maps an http catalog entry both ways under the normalised URL", () => {
    const index = buildAuthNameIndex(
      [entry("hosted", "streamable-http", "https://api.example.com/mcp")],
      [],
    );
    // new URL(...).href normalises the key the store uses.
    expect([...index.urlToNames.keys()]).toEqual([
      "https://api.example.com/mcp",
    ]);
    expect(index.urlToNames.get("https://api.example.com/mcp")).toEqual([
      { name: "hosted", source: "catalog", isLive: false },
    ]);
    expect([...index.nameToUrls.get("hosted")!]).toEqual([
      "https://api.example.com/mcp",
    ]);
    expect(index.knownNames.has("hosted")).toBe(true);
  });

  it("records a stdio entry as a known name with no URL", () => {
    const index = buildAuthNameIndex(
      [entry("local", "stdio", "node server.js")],
      [],
    );
    expect(index.knownNames.has("local")).toBe(true);
    expect(index.nameToUrls.has("local")).toBe(false);
    expect(index.urlToNames.size).toBe(0);
  });

  it("marks a live connection and sorts live names first", () => {
    const url = "https://api.example.com/mcp";
    const index = buildAuthNameIndex(
      [entry("catalog-name", "streamable-http", url)],
      [conn("live-name", url)],
    );
    const refs = index.urlToNames.get(url)!;
    expect(refs[0]).toEqual({
      name: "live-name",
      source: "connection",
      isLive: true,
    });
    expect(refs[1]).toEqual({
      name: "catalog-name",
      source: "catalog",
      isLive: false,
    });
  });

  it("collapses a catalog+connection pair that shares a name and URL", () => {
    const url = "https://api.example.com/mcp";
    const index = buildAuthNameIndex(
      [entry("hosted", "streamable-http", url)],
      [conn("hosted", url)],
    );
    expect(index.urlToNames.get(url)).toEqual([
      { name: "hosted", source: "catalog", isLive: true },
    ]);
  });

  it("ignores a connection whose identity is not an http URL (stdio)", () => {
    const index = buildAuthNameIndex([], [conn("local", "node server.js")]);
    expect(index.knownNames.has("local")).toBe(true);
    expect(index.nameToUrls.has("local")).toBe(false);
  });
});

describe("resolveFriendlyName", () => {
  const url = "https://api.example.com/mcp";

  it("resolves a name that maps to exactly one URL", () => {
    const index = buildAuthNameIndex(
      [entry("hosted", "streamable-http", url)],
      [],
    );
    expect(resolveFriendlyName("hosted", index)).toEqual({ kind: "url", url });
  });

  it("treats two names for one URL as unambiguous (both resolve to it)", () => {
    const index = buildAuthNameIndex(
      [
        entry("hosted", "streamable-http", url),
        entry("hosted-alias", "streamable-http", url),
      ],
      [],
    );
    expect(resolveFriendlyName("hosted", index)).toEqual({ kind: "url", url });
    expect(resolveFriendlyName("hosted-alias", index)).toEqual({
      kind: "url",
      url,
    });
  });

  it("flags one name that maps to two different URLs as ambiguous", () => {
    const other = "https://other.example.com/mcp";
    const index = buildAuthNameIndex(
      [entry("shared", "streamable-http", url)],
      [conn("shared", other)],
    );
    expect(resolveFriendlyName("shared", index)).toEqual({
      kind: "ambiguous",
      name: "shared",
      urls: [url, other].sort(),
    });
  });

  it("reports a known stdio name as no-url", () => {
    const index = buildAuthNameIndex(
      [entry("local", "stdio", "node server.js")],
      [],
    );
    expect(resolveFriendlyName("local", index)).toEqual({
      kind: "no-url",
      name: "local",
    });
  });

  it("reports an unseen name as unknown", () => {
    const index = buildAuthNameIndex([], []);
    expect(resolveFriendlyName("nope", index)).toEqual({
      kind: "unknown",
      name: "nope",
    });
  });
});
