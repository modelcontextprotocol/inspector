import { describe, it, expect } from "vitest";
import {
  decodeBase64ToBytes,
  decodeBase64ToUtf8,
  formatJson,
  formatXml,
  getMimeKind,
  isSafeHref,
  isTextualKind,
  looksLikeJson,
  PREVIEW_HTML_CSP,
  tryDecodeBase64ToBytes,
  tryDecodeBase64ToUtf8,
  wrapHtmlWithCsp,
} from "./contentViewerUtils";

const toBase64 = (text: string): string =>
  Buffer.from(text, "utf-8").toString("base64");

describe("getMimeKind", () => {
  it.each([
    ["image/png", "image"],
    ["image/svg+xml", "image"],
    ["audio/mp3", "audio"],
    ["application/pdf", "pdf"],
    ["text/markdown", "markdown"],
    ["text/x-markdown", "markdown"],
    ["application/json", "json"],
    ["application/vnd.api+json", "json"],
    ["text/csv", "csv"],
    ["text/html", "html"],
    ["text/css", "css"],
    ["text/xml", "xml"],
    ["application/xml", "xml"],
    ["application/atom+xml", "xml"],
    ["application/javascript", "text"],
    ["application/ecmascript", "text"],
    ["application/x-javascript", "text"],
    ["text/plain", "text"],
    ["application/octet-stream", "binary"],
    ["application/zip", "binary"],
  ])("classifies %s as %s", (mime, expected) => {
    expect(getMimeKind(mime)).toBe(expected);
  });

  it("ignores charset parameters and casing", () => {
    expect(getMimeKind("TEXT/CSV; charset=utf-8")).toBe("csv");
  });
});

describe("isTextualKind", () => {
  it("is true for text families, false for binary media", () => {
    expect(isTextualKind("json")).toBe(true);
    expect(isTextualKind("csv")).toBe(true);
    expect(isTextualKind("text")).toBe(true);
    expect(isTextualKind("image")).toBe(false);
    expect(isTextualKind("pdf")).toBe(false);
    expect(isTextualKind("binary")).toBe(false);
  });
});

describe("decodeBase64ToUtf8", () => {
  it("round-trips UTF-8 text including multibyte characters", () => {
    expect(decodeBase64ToUtf8(toBase64("héllo, 世界"))).toBe("héllo, 世界");
  });
});

describe("decodeBase64ToBytes", () => {
  it("decodes to the original byte sequence", () => {
    const bytes = decodeBase64ToBytes(toBase64("AB"));
    expect(Array.from(bytes)).toEqual([65, 66]);
  });
});

describe("tryDecodeBase64ToUtf8", () => {
  it("decodes valid base64 like the throwing variant", () => {
    expect(tryDecodeBase64ToUtf8(toBase64("héllo"))).toBe("héllo");
  });

  it("returns null instead of throwing on malformed base64", () => {
    expect(tryDecodeBase64ToUtf8("not%%base64")).toBeNull();
  });
});

describe("tryDecodeBase64ToBytes", () => {
  it("decodes valid base64 to bytes", () => {
    expect(Array.from(tryDecodeBase64ToBytes(toBase64("AB"))!)).toEqual([
      65, 66,
    ]);
  });

  it("returns null instead of throwing on malformed base64", () => {
    expect(tryDecodeBase64ToBytes("not%%base64")).toBeNull();
  });
});

describe("formatJson", () => {
  it("pretty-prints valid JSON", () => {
    expect(formatJson('{"a":1}')).toBe('{\n  "a": 1\n}');
  });

  it("returns the input unchanged when invalid", () => {
    expect(formatJson("{ broken")).toBe("{ broken");
  });
});

describe("looksLikeJson", () => {
  it("detects objects and arrays after leading whitespace", () => {
    expect(looksLikeJson('  {"a":1}')).toBe(true);
    expect(looksLikeJson("\n[1,2]")).toBe(true);
    expect(looksLikeJson("plain")).toBe(false);
  });
});

describe("formatXml", () => {
  it("indents nested elements", () => {
    const out = formatXml("<a><b>x</b></a>");
    expect(out).toBe("<a>\n  <b>x</b>\n</a>");
  });

  it("keeps self-closing tags at the same depth", () => {
    const out = formatXml("<root><item/><item/></root>");
    expect(out).toBe("<root>\n  <item/>\n  <item/>\n</root>");
  });

  it("collapses existing whitespace between tags", () => {
    const out = formatXml("<a>\n   <b>x</b>\n</a>");
    expect(out).toBe("<a>\n  <b>x</b>\n</a>");
  });

  it("never indents below zero on stray closing tags", () => {
    const out = formatXml("</a></b>");
    expect(out).toBe("</a>\n</b>");
  });
});

describe("wrapHtmlWithCsp", () => {
  it("injects the CSP meta at the top of an existing <head>", () => {
    const out = wrapHtmlWithCsp(
      "<html><head><title>t</title></head><body>x</body></html>",
    );
    expect(out).toContain(`<head><meta http-equiv="Content-Security-Policy"`);
    expect(out.indexOf("Content-Security-Policy")).toBeLessThan(
      out.indexOf("<title>"),
    );
  });

  it("adds a <head> when the document has <html> but no head", () => {
    const out = wrapHtmlWithCsp("<html><body>x</body></html>");
    expect(out).toContain("<head><meta http-equiv");
    expect(out).toContain("<body>x</body>");
  });

  it("wraps a bare fragment in a minimal document", () => {
    const out = wrapHtmlWithCsp("<p>hi</p>");
    expect(out).toBe(
      `<html><head><meta http-equiv="Content-Security-Policy" content="${PREVIEW_HTML_CSP}"></head><body><p>hi</p></body></html>`,
    );
  });

  it("preserves attributes on <head>/<html>", () => {
    const out = wrapHtmlWithCsp('<head lang="en"></head>');
    expect(out).toContain('<head lang="en"><meta http-equiv');
  });

  it("omits script-src so it falls through to default-src none", () => {
    expect(PREVIEW_HTML_CSP).not.toContain("script-src");
    expect(PREVIEW_HTML_CSP).toContain("default-src 'none'");
  });
});

describe("isSafeHref", () => {
  it.each([
    "https://x.com",
    "http://x.com",
    "mailto:a@b.c",
    "#anchor",
    "/path",
  ])("allows %s", (href) => {
    expect(isSafeHref(href)).toBe(true);
  });

  it.each(["javascript:alert(1)", "//evil.com", "data:text/html,x", undefined])(
    "rejects %s",
    (href) => {
      expect(isSafeHref(href)).toBe(false);
    },
  );
});
