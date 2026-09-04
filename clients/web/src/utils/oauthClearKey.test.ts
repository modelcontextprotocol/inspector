import { describe, expect, it } from "vitest";
import { oauthClearKey, resolveOAuthClearIdentity } from "./oauthClearKey";

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

describe("resolveOAuthClearIdentity", () => {
  const http = (url: string) => ({ type: "streamable-http", url }) as const;
  const X = http("https://x.example/mcp");
  const Y = http("https://y.example/mcp");

  const resolve = (
    over: Partial<Parameters<typeof resolveOAuthClearIdentity>[0]> = {},
  ) =>
    resolveOAuthClearIdentity({
      server: { id: "A", config: X },
      activeServerId: "A",
      activeClientConfig: X,
      activeEntryConfig: X,
      ...over,
    });

  it("treats the active entry as affecting the session", () => {
    const id = resolve();
    expect(id.isActive).toBe(true);
    expect(id.sharesActiveOAuthKey).toBe(false);
    expect(id.affectsActiveSession).toBe(true);
  });

  it("treats an unrelated entry as affecting nothing", () => {
    const id = resolve({ server: { id: "B", config: Y } });
    expect(id.affectsActiveSession).toBe(false);
    expect(id.inFlightKey).toBe("url:https://y.example/mcp");
  });

  // The #2217 case: distinct ids, one blob.
  it("treats a different entry with the session's URL as affecting the session", () => {
    const id = resolve({ server: { id: "B", config: X } });
    expect(id.isActive).toBe(false);
    expect(id.sharesActiveOAuthKey).toBe(true);
    expect(id.affectsActiveSession).toBe(true);
  });

  // Copilot: a card can be edited while connected, and the catalog write does
  // not rebuild the client — so the entry reads Y while the live session is
  // still authorized against X. Reading the entry would miss entry B at X.
  it("follows the live client's URL, not the edited catalog entry's", () => {
    const edited = resolve({
      server: { id: "B", config: X },
      activeClientConfig: X,
      activeEntryConfig: Y,
    });
    expect(edited.sharesActiveOAuthKey).toBe(true);
    // And an entry at the entry's *new* URL is not the session's credentials.
    const notShared = resolve({
      server: { id: "B", config: Y },
      activeClientConfig: X,
      activeEntryConfig: Y,
    });
    expect(notShared.sharesActiveOAuthKey).toBe(false);
  });

  // The lock has to name the storage operation actually performed. Clearing
  // the edited active entry routes through the live client, which still acts
  // on X — so an entry-keyed lock (`url:Y`) would not collide with a
  // concurrent clear of entry B at X, which performs the very same operation.
  it("locks an active-session clear on the client's key, not the entry's", () => {
    expect(
      resolve({
        server: { id: "A", config: Y },
        activeClientConfig: X,
        activeEntryConfig: Y,
      }).inFlightKey,
    ).toBe("url:https://x.example/mcp");
    expect(
      resolve({
        server: { id: "B", config: X },
        activeClientConfig: X,
        activeEntryConfig: Y,
      }).inFlightKey,
    ).toBe("url:https://x.example/mcp");
  });

  it("falls back to the active entry's config when there is no live client", () => {
    const id = resolve({
      server: { id: "B", config: X },
      activeClientConfig: undefined,
      activeEntryConfig: X,
    });
    expect(id.sharesActiveOAuthKey).toBe(true);
    expect(id.inFlightKey).toBe("url:https://x.example/mcp");
  });

  it("handles no active server at all", () => {
    const id = resolve({
      server: { id: "B", config: X },
      activeServerId: undefined,
      activeClientConfig: undefined,
      activeEntryConfig: undefined,
    });
    expect(id.isActive).toBe(false);
    expect(id.affectsActiveSession).toBe(false);
    expect(id.inFlightKey).toBe("url:https://x.example/mcp");
  });

  // A stdio active session has no OAuth key, so an active clear against it
  // falls back to the entry id rather than collapsing onto a shared URL key.
  it("falls back to the entry id when the session has no OAuth URL", () => {
    const stdio = { type: "stdio", command: "node" } as const;
    expect(
      resolve({
        server: { id: "A", config: stdio },
        activeClientConfig: stdio,
        activeEntryConfig: stdio,
      }).inFlightKey,
    ).toBe("id:A");
  });
});
