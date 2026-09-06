import { describe, it, expect } from "vitest";
import {
  inferMimeFromUri,
  isGenericMime,
  isMarkdownMime,
} from "./inferMimeFromUri";

describe("isGenericMime", () => {
  it("names the types a server sends when it does not really know", () => {
    expect(isGenericMime("text/plain")).toBe(true);
    expect(isGenericMime("application/octet-stream")).toBe(true);
    // Normalised like `isMarkdownMime`, so parameters and casing still count.
    expect(isGenericMime("text/plain; charset=utf-8")).toBe(true);
    expect(isGenericMime("TEXT/PLAIN")).toBe(true);
  });

  it("does not treat a specific type as generic", () => {
    // A server that says `text/markdown` or `text/csv` knows its own resource,
    // and that declaration must outrank a URI suffix.
    expect(isGenericMime("text/markdown")).toBe(false);
    expect(isGenericMime("text/csv")).toBe(false);
    expect(isGenericMime("application/json")).toBe(false);
    expect(isGenericMime(undefined)).toBe(false);
  });
});

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

  it("matches a percent-encoded suffix", () => {
    // `reference%2Emd` names the same file as `reference.md`, and
    // `skillUriIdentity` already treats those spellings as equivalent — so
    // matching the raw string here disagreed with the rest of the app and left
    // an encoded `.md` with no MIME, no markdown renderer and no split.
    expect(inferMimeFromUri("skill://a/reference%2Emd")).toBe("text/markdown");
    expect(inferMimeFromUri("skill://a/report%2Epdf")).toBe("application/pdf");
    // A percent-encoded path segment separator is decoded too.
    expect(inferMimeFromUri("skill://a/docs%2Fnotes.md")).toBe("text/markdown");
  });

  it("inspects the PATH, not the whole URI", () => {
    // An authority ending in a mapped suffix is not a filename:
    // `https://documentation.md` has a pathname of `/` and no extension, and
    // routing a root resource into the markdown renderer on that basis is
    // wrong.
    expect(inferMimeFromUri("https://documentation.md")).toBeUndefined();
    expect(inferMimeFromUri("https://documentation.md/")).toBeUndefined();
    // The same host WITH a real markdown path still resolves.
    expect(inferMimeFromUri("https://documentation.md/a/readme.md")).toBe(
      "text/markdown",
    );
    // Non-special schemes SEP-2640 allows parse the same way.
    expect(inferMimeFromUri("skill://data-analysis/SKILL.md")).toBe(
      "text/markdown",
    );
  });

  it("decodes escape runs independently, so one bad octet cannot poison the path", () => {
    // `%FF` is a syntactically valid triplet that is not valid UTF-8, so a
    // single `decodeURIComponent` over the whole path throws and abandons the
    // rest — leaving the `%2E` in a perfectly acceptable URI undecoded.
    expect(inferMimeFromUri("skill://a/%FF/reference%2Emd")).toBe(
      "text/markdown",
    );
    expect(inferMimeFromUri("skill://a/%FF/report%2Epdf")).toBe(
      "application/pdf",
    );
  });

  it("falls back to the raw path on a malformed escape", () => {
    // `decodeURIComponent` throws on `%zz` or a lone `%`, and a server can send
    // either. A MIME guess is the wrong place to raise.
    expect(inferMimeFromUri("skill://a/bad%zz.md")).toBe("text/markdown");
    expect(inferMimeFromUri("skill://a/100%.md")).toBe("text/markdown");
    expect(inferMimeFromUri("skill://a/bad%zz.bin")).toBeUndefined();
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

  it("accepts a MIME carrying parameters", () => {
    // `text/markdown; charset=utf-8` is a perfectly ordinary response, and
    // ContentViewer accepts it. Rejecting it here skipped the frontmatter
    // split, so the fence stayed in the document AND the Frontmatter section
    // vanished.
    expect(isMarkdownMime("text/markdown; charset=utf-8")).toBe(true);
    expect(isMarkdownMime("text/markdown;charset=UTF-8")).toBe(true);
  });

  it("is case-insensitive", () => {
    expect(isMarkdownMime("TEXT/MARKDOWN")).toBe(true);
    expect(isMarkdownMime("Text/X-Markdown; charset=utf-8")).toBe(true);
  });

  it("rejects everything else, including undefined", () => {
    // The gate on frontmatter splitting: a YAML resource must not be split, or
    // a multi-document file loses its first document.
    expect(isMarkdownMime("text/yaml")).toBe(false);
    expect(isMarkdownMime("application/json")).toBe(false);
    expect(isMarkdownMime(undefined)).toBe(false);
  });
});
