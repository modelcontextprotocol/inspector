import { describe, it, expect } from "vitest";
import { parseDeepLink, DEEP_LINK_SERVER_ID } from "./deepLink";

const TOKEN = "tok-abc";

describe("parseDeepLink", () => {
  it("returns undefined when no serverUrl param is present", () => {
    expect(parseDeepLink("?autoConnect=" + TOKEN, TOKEN)).toBeUndefined();
  });

  it("returns undefined when autoConnect is missing", () => {
    expect(
      parseDeepLink("?serverUrl=https%3A%2F%2Fexample.com%2Fmcp", TOKEN),
    ).toBeUndefined();
  });

  it("rejects when autoConnect does not match the session token (CSRF guard)", () => {
    expect(
      parseDeepLink(
        "?serverUrl=https%3A%2F%2Fexample.com%2Fmcp&autoConnect=1",
        TOKEN,
      ),
    ).toBeUndefined();
  });

  it("rejects when there is no session token to compare against", () => {
    expect(
      parseDeepLink(
        "?serverUrl=https%3A%2F%2Fexample.com%2Fmcp&autoConnect=" + TOKEN,
        undefined,
      ),
    ).toBeUndefined();
  });

  it("rejects non-http(s) serverUrl schemes", () => {
    for (const url of [
      "javascript:alert(1)",
      "file:///etc/passwd",
      "data:text/html,<script>",
      "not a url",
    ]) {
      expect(
        parseDeepLink(
          `?serverUrl=${encodeURIComponent(url)}&autoConnect=${TOKEN}`,
          TOKEN,
        ),
      ).toBeUndefined();
    }
  });

  it("parses a valid streamable-http deep link with the default transport", () => {
    const link = parseDeepLink(
      "?serverUrl=https%3A%2F%2Fexample.com%2Fmcp&autoConnect=" + TOKEN,
      TOKEN,
    );
    expect(link).toEqual({
      serverId: DEEP_LINK_SERVER_ID,
      serverConfig: { type: "streamable-http", url: "https://example.com/mcp" },
      openApp: undefined,
      appArgs: {},
    });
  });

  it("honors transport=sse and ignores unknown transport values", () => {
    const sse = parseDeepLink(
      "?serverUrl=https%3A%2F%2Fexample.com%2Fsse&transport=sse&autoConnect=" +
        TOKEN,
      TOKEN,
    );
    expect(sse?.serverConfig).toEqual({
      type: "sse",
      url: "https://example.com/sse",
    });
    const bogus = parseDeepLink(
      "?serverUrl=https%3A%2F%2Fexample.com%2Fmcp&transport=stdio&autoConnect=" +
        TOKEN,
      TOKEN,
    );
    expect(bogus?.serverConfig.type).toBe("streamable-http");
  });

  it("decodes base64url appArgs into an object", () => {
    const args = { zip: "10001", category: "electrician" };
    const encoded = btoa(JSON.stringify(args))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
    const link = parseDeepLink(
      `?serverUrl=https%3A%2F%2Fexample.com%2Fmcp&autoConnect=${TOKEN}&openApp=get_pros&appArgs=${encoded}`,
      TOKEN,
    );
    expect(link?.openApp).toBe("get_pros");
    expect(link?.appArgs).toEqual(args);
  });

  it("falls back to {} for malformed or non-object appArgs", () => {
    for (const bad of ["!!!", btoa("[1,2,3]"), btoa('"string"')]) {
      const link = parseDeepLink(
        `?serverUrl=https%3A%2F%2Fexample.com%2Fmcp&autoConnect=${TOKEN}&appArgs=${encodeURIComponent(bad)}`,
        TOKEN,
      );
      expect(link?.appArgs).toEqual({});
    }
  });
});
