import { describe, expect, it } from "vitest";
import { oauthClearKey } from "./oauthClearKey";

describe("oauthClearKey", () => {
  // #2217 — the whole point: two entries against one URL share one OAuth blob,
  // so they must share one clear identity even though their ids differ.
  it("keys two entries with the same URL identically", () => {
    const config = {
      type: "streamable-http",
      url: "https://mcp.example/mcp",
    } as const;
    expect(oauthClearKey(config, "a")).toBe(oauthClearKey(config, "b"));
  });

  it("separates entries pointing at different URLs", () => {
    expect(
      oauthClearKey({ type: "sse", url: "https://one.example/mcp" }, "a"),
    ).not.toBe(
      oauthClearKey({ type: "sse", url: "https://two.example/mcp" }, "a"),
    );
  });

  it("falls back to the entry id when there is no OAuth server URL", () => {
    const stdio = { type: "stdio", command: "node" } as const;
    expect(oauthClearKey(stdio, "a")).toBe("id:a");
    expect(oauthClearKey(stdio, "a")).not.toBe(oauthClearKey(stdio, "b"));
  });

  // The prefix is what keeps a stdio entry named "url:…" from colliding with a
  // URL-keyed one — an id is user-supplied and a URL is not a reserved shape.
  it("cannot collide a URL key with an id key", () => {
    expect(
      oauthClearKey({ type: "stdio", command: "node" }, "url:https://x/mcp"),
    ).not.toBe(
      oauthClearKey({ type: "sse", url: "https://x/mcp" }, "anything"),
    );
  });
});
