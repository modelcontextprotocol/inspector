import { describe, it, expect } from "vitest";
import { inferMimeFromUri, isMarkdownMime } from "./inferMimeFromUri";

describe("inferMimeFromUri", () => {
  it("maps every suffix in the table", () => {
    // The whole table, so a typo in an entry cannot pass unnoticed — this is
    // the only thing that engages ContentViewer's per-MIME renderers when a
    // server omits `mimeType`.
    expect(inferMimeFromUri("skill://a/SKILL.md")).toBe("text/markdown");
    expect(inferMimeFromUri("skill://a/notes.markdown")).toBe("text/markdown");
    expect(inferMimeFromUri("file:///data.csv")).toBe("text/csv");
    expect(inferMimeFromUri("file:///a.json")).toBe("application/json");
    expect(inferMimeFromUri("file:///a.xml")).toBe("application/xml");
    expect(inferMimeFromUri("file:///a.html")).toBe("text/html");
    expect(inferMimeFromUri("file:///a.htm")).toBe("text/html");
    expect(inferMimeFromUri("file:///a.css")).toBe("text/css");
    expect(inferMimeFromUri("file:///a.pdf")).toBe("application/pdf");
  });

  it("is case-insensitive about the suffix", () => {
    expect(inferMimeFromUri("skill://a/SKILL.MD")).toBe("text/markdown");
  });

  it("ignores a query string and a fragment", () => {
    // A URI's suffix is a property of its path; `?v=2` must not defeat the
    // match, and a fragment must not be mistaken for one.
    expect(inferMimeFromUri("https://x/a.md?v=2")).toBe("text/markdown");
    expect(inferMimeFromUri("https://x/a.md#top")).toBe("text/markdown");
    expect(inferMimeFromUri("https://x/a.md?v=2#top")).toBe("text/markdown");
  });

  it("returns undefined for an unrecognised suffix, so callers can default", () => {
    expect(inferMimeFromUri("skill://a/notes.bin")).toBeUndefined();
    expect(inferMimeFromUri("skill://a/no-extension")).toBeUndefined();
    // A dot in the query must not be read as the path's extension.
    expect(inferMimeFromUri("https://x/file?name=a.md")).toBeUndefined();
  });
});

describe("isMarkdownMime", () => {
  it("accepts both spellings of markdown", () => {
    expect(isMarkdownMime("text/markdown")).toBe(true);
    expect(isMarkdownMime("text/x-markdown")).toBe(true);
  });

  it("rejects everything else, including undefined", () => {
    // The gate on frontmatter splitting: a YAML resource must not be split, or
    // a multi-document file loses its first document.
    expect(isMarkdownMime("text/yaml")).toBe(false);
    expect(isMarkdownMime("application/json")).toBe(false);
    expect(isMarkdownMime(undefined)).toBe(false);
  });
});
