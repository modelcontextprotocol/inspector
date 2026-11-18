import { describe, it, expect } from "vitest";
import {
  ACCEPT_LANGUAGE_HEADER,
  ACCEPT_LANGUAGE_META_KEY,
  CONTENT_LANGUAGE_META_KEY,
  acceptLanguageFromMeta,
  acceptLanguageHeaderFor,
} from "@inspector/core/mcp/acceptLanguage.js";

/** SEP-2792 `_meta` → `Accept-Language` mirroring (#2979). */
describe("acceptLanguage", () => {
  it("names the SEP-2792 keys and header", () => {
    expect(ACCEPT_LANGUAGE_META_KEY).toBe(
      "io.modelcontextprotocol/acceptLanguage",
    );
    expect(CONTENT_LANGUAGE_META_KEY).toBe(
      "io.modelcontextprotocol/contentLanguage",
    );
    expect(ACCEPT_LANGUAGE_HEADER).toBe("Accept-Language");
  });

  describe("acceptLanguageFromMeta", () => {
    it.each([
      ["a single tag", "en"],
      ["weighted ranges, spelled as written", "fr-CA, fr;q=0.9, en;q=0.5"],
      ["a wildcard", "*"],
      ["an interior tab", "en,\tfr"],
    ])("keeps %s verbatim", (_label, value) => {
      expect(
        acceptLanguageFromMeta({ [ACCEPT_LANGUAGE_META_KEY]: value }),
      ).toBe(value);
    });

    it.each([
      ["no _meta", undefined],
      ["a non-object _meta", "en"],
      ["an array _meta", ["en"]],
      ["a missing key", { other: "en" }],
      ["a non-string value", { [ACCEPT_LANGUAGE_META_KEY]: 42 }],
      ["an empty string", { [ACCEPT_LANGUAGE_META_KEY]: "" }],
      // Headers would trim these, breaking exact agreement with `_meta`.
      ["leading whitespace", { [ACCEPT_LANGUAGE_META_KEY]: " en" }],
      ["trailing whitespace", { [ACCEPT_LANGUAGE_META_KEY]: "en\t" }],
      // fetch would reject these outright.
      ["a CR/LF", { [ACCEPT_LANGUAGE_META_KEY]: "en\r\nX-Evil: 1" }],
      ["a control character", { [ACCEPT_LANGUAGE_META_KEY]: "en\u0000" }],
      ["non-ASCII", { [ACCEPT_LANGUAGE_META_KEY]: "français" }],
    ])("yields nothing for %s", (_label, meta) => {
      expect(acceptLanguageFromMeta(meta)).toBeUndefined();
    });
  });

  describe("acceptLanguageHeaderFor", () => {
    it("derives the header from a request's params._meta", () => {
      expect(
        acceptLanguageHeaderFor({
          jsonrpc: "2.0",
          id: 1,
          method: "tools/list",
          params: { _meta: { [ACCEPT_LANGUAGE_META_KEY]: "de-AT, de" } },
        }),
      ).toEqual({ "Accept-Language": "de-AT, de" });
    });

    it("applies to notifications too", () => {
      expect(
        acceptLanguageHeaderFor({
          jsonrpc: "2.0",
          method: "notifications/cancelled",
          params: { _meta: { [ACCEPT_LANGUAGE_META_KEY]: "ja" } },
        }),
      ).toEqual({ "Accept-Language": "ja" });
    });

    it.each([
      ["a non-object message", "nope"],
      ["a null message", null],
      ["a response (no params)", { jsonrpc: "2.0", id: 1, result: {} }],
      [
        "params without a preference",
        { jsonrpc: "2.0", id: 1, method: "ping", params: {} },
      ],
      [
        "an unmirrorable preference",
        {
          jsonrpc: "2.0",
          id: 1,
          method: "ping",
          params: { _meta: { [ACCEPT_LANGUAGE_META_KEY]: " en " } },
        },
      ],
    ])("yields nothing for %s", (_label, message) => {
      expect(acceptLanguageHeaderFor(message)).toBeUndefined();
    });
  });
});
