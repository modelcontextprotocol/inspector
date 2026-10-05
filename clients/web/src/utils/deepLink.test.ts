import { describe, it, expect } from "vitest";
import {
  parseDeepLink,
  deepLinkConfigEquals,
  deepLinkParseStatus,
  constantTimeEqual,
  DEEP_LINK_SERVER_ID,
} from "./deepLink";

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
      autoOpen: false,
    });
  });

  it("sets autoOpen only when the param equals the session token (same CSRF gate as autoConnect)", () => {
    const ok = parseDeepLink(
      `?serverUrl=https%3A%2F%2Fexample.com%2Fmcp&autoConnect=${TOKEN}&autoOpen=${TOKEN}`,
      TOKEN,
    );
    expect(ok?.autoOpen).toBe(true);
    const wrong = parseDeepLink(
      `?serverUrl=https%3A%2F%2Fexample.com%2Fmcp&autoConnect=${TOKEN}&autoOpen=1`,
      TOKEN,
    );
    expect(wrong?.autoOpen).toBe(false);
    const prefix = parseDeepLink(
      `?serverUrl=https%3A%2F%2Fexample.com%2Fmcp&autoConnect=${TOKEN}&autoOpen=${TOKEN.slice(0, -1)}`,
      TOKEN,
    );
    expect(prefix?.autoOpen).toBe(false);
  });

  it("rejects an autoConnect that is a strict prefix or extension of the token", () => {
    for (const guess of [TOKEN.slice(0, -1), TOKEN + "x", "Xok-abc"]) {
      expect(
        parseDeepLink(
          `?serverUrl=https%3A%2F%2Fexample.com%2Fmcp&autoConnect=${guess}`,
          TOKEN,
        ),
      ).toBeUndefined();
    }
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

  it("normalizes serverUrl (host case, trailing slash) to match the OAuth-store key form", () => {
    const link = parseDeepLink(
      "?serverUrl=" +
        encodeURIComponent("https://Example.COM") +
        "&autoConnect=" +
        TOKEN,
      TOKEN,
    );
    expect(link?.serverConfig).toEqual({
      type: "streamable-http",
      url: "https://example.com/",
    });
  });
});

describe("deepLinkParseStatus", () => {
  it("returns 'none' when no deep-link params are present", () => {
    expect(deepLinkParseStatus("", undefined)).toBe("none");
    expect(deepLinkParseStatus("?foo=bar", undefined)).toBe("none");
  });

  it("returns 'rejected' when deep-link params are present but parsing failed", () => {
    expect(
      deepLinkParseStatus(
        "?serverUrl=https%3A%2F%2Fexample.com%2Fmcp&autoConnect=wrong",
        undefined,
      ),
    ).toBe("rejected");
    expect(deepLinkParseStatus("?serverUrl=javascript:x", undefined)).toBe(
      "rejected",
    );
  });

  it("returns 'parsed' when a DeepLink was produced", () => {
    const link = parseDeepLink(
      "?serverUrl=https%3A%2F%2Fexample.com%2Fmcp&autoConnect=" + TOKEN,
      TOKEN,
    );
    expect(deepLinkParseStatus("?serverUrl=x&autoConnect=" + TOKEN, link)).toBe(
      "parsed",
    );
  });
});

describe("deepLinkConfigEquals", () => {
  const URL_A = "https://example.com/mcp";
  const URL_B = "https://example.com/sse";

  it("matches when both type and url are identical", () => {
    expect(
      deepLinkConfigEquals(
        { type: "streamable-http", url: URL_A },
        { type: "streamable-http", url: URL_A },
      ),
    ).toBe(true);
  });

  it("differs when only the type changed (sse↔streamable-http)", () => {
    expect(
      deepLinkConfigEquals(
        { type: "sse", url: URL_A },
        { type: "streamable-http", url: URL_A },
      ),
    ).toBe(false);
  });

  it("differs when only the url changed", () => {
    expect(
      deepLinkConfigEquals(
        { type: "streamable-http", url: URL_A },
        { type: "streamable-http", url: URL_B },
      ),
    ).toBe(false);
  });
});

describe("constantTimeEqual", () => {
  it("is true only for identical strings", () => {
    expect(constantTimeEqual("tok-abc", "tok-abc")).toBe(true);
    expect(constantTimeEqual("", "")).toBe(true);
    expect(constantTimeEqual("tok-abd", "tok-abc")).toBe(false);
    expect(constantTimeEqual("Xok-abc", "tok-abc")).toBe(false);
  });

  it("rejects a length mismatch in either direction, including prefixes", () => {
    expect(constantTimeEqual("tok-ab", "tok-abc")).toBe(false);
    expect(constantTimeEqual("tok-abcd", "tok-abc")).toBe(false);
    expect(constantTimeEqual("", "tok-abc")).toBe(false);
    expect(constantTimeEqual("tok-abc", "")).toBe(false);
  });

  it("does not mistake a missing code unit for a NUL one", () => {
    // charCodeAt past the candidate's end is NaN -> 0, the same value as
    // "\0"; the length term is what must reject this.
    expect(constantTimeEqual("ab", "ab\0")).toBe(false);
  });

  it("compares UTF-16 code units, so unnormalized forms differ", () => {
    // Built from code points so the two spellings stay visibly distinct in
    // source: U+00E9 (precomposed) vs "e" + U+0301 (combining acute).
    const precomposed = "caf" + String.fromCharCode(0xe9);
    const decomposed = "cafe" + String.fromCharCode(0x301);
    expect(constantTimeEqual(precomposed, precomposed)).toBe(true);
    expect(constantTimeEqual(decomposed, precomposed)).toBe(false);
  });
});
