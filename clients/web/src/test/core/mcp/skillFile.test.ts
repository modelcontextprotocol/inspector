import { describe, it, expect } from "vitest";
import {
  parseSkillFrontmatter,
  splitSkillFile,
} from "@inspector/core/mcp/skillFile.js";

describe("splitSkillFile", () => {
  it("separates a leading frontmatter fence from the body", () => {
    expect(splitSkillFile("---\nname: a\n---\n\n# Title\n\nBody\n")).toEqual({
      frontmatter: "name: a",
      body: "# Title\n\nBody\n",
    });
  });

  it("reports no frontmatter for a file that has none", () => {
    expect(splitSkillFile("# Title\n\nBody\n")).toEqual({
      body: "# Title\n\nBody\n",
    });
  });

  it("leaves an unterminated opening fence alone rather than eating the file", () => {
    // `---` with no closing fence is not frontmatter. Treating it as such would
    // truncate the document to nothing, which is far worse than showing it.
    const text = "---\nnot really frontmatter\n\n# Title\n";
    expect(splitSkillFile(text)).toEqual({ body: text });
  });

  it("does not treat a horizontal rule mid-file as frontmatter", () => {
    const text = "# Title\n\n---\n\nAfter the rule\n";
    expect(splitSkillFile(text)).toEqual({ body: text });
  });

  it("handles CRLF line endings", () => {
    expect(splitSkillFile("---\r\nname: a\r\n---\r\n\r\n# Title\r\n")).toEqual({
      frontmatter: "name: a",
      body: "# Title\r\n",
    });
  });

  it("returns an empty body when the file is nothing but frontmatter", () => {
    expect(splitSkillFile("---\nname: a\n---\n")).toEqual({
      frontmatter: "name: a",
      body: "",
    });
  });

  it("handles a closing fence with no trailing newline", () => {
    // The file ends ON the fence, so there is no newline after it to split at.
    expect(splitSkillFile("---\nname: a\n---")).toEqual({
      frontmatter: "name: a",
      body: "",
    });
  });

  it("keeps a body that follows the fence with no blank line", () => {
    // The blank line between fence and body is a convention, not a rule —
    // stripping unconditionally would eat the first line of a file without one.
    expect(splitSkillFile("---\nname: a\n---\nBody\n")).toEqual({
      frontmatter: "name: a",
      body: "Body\n",
    });
  });

  it("keeps every frontmatter line, not just the first", () => {
    expect(
      splitSkillFile("---\nname: a\ndescription: b\n---\n\nBody\n"),
    ).toEqual({ frontmatter: "name: a\ndescription: b", body: "Body\n" });
  });
});

describe("parseSkillFrontmatter (#2248)", () => {
  it("parses a mapping of fields", () => {
    expect(parseSkillFrontmatter("name: demo\ndescription: A demo")).toEqual({
      fields: { name: "demo", description: "A demo" },
    });
  });

  it("keeps non-string scalars as their YAML 1.2 core types", () => {
    const parsed = parseSkillFrontmatter("n: 1\nb: true\nl: [1, 2]");
    expect(parsed).toEqual({ fields: { n: 1, b: true, l: [1, 2] } });
  });

  it("leaves a timestamp-shaped value a string", () => {
    // The other side of the comparison arrived over JSON-RPC and can only hold
    // JSON types, so a `Date` here would report a conforming server as broken.
    // This is the YAML 1.2 core schema doing its job — under 1.1 it would be a
    // Date and the check would be wrong.
    const parsed = parseSkillFrontmatter("when: 2001-12-14t21:59:43.10-05:00");
    expect(parsed).toEqual({
      fields: { when: "2001-12-14t21:59:43.10-05:00" },
    });
  });

  it("reads an empty block as a mapping of no fields, not an error", () => {
    expect(parseSkillFrontmatter("")).toEqual({ fields: {} });
    expect(parseSkillFrontmatter("# just a comment")).toEqual({ fields: {} });
  });

  it("reports an explicit null scalar as an error, not as no fields", () => {
    // `null` and `~` parse to the same value an EMPTY block does, but only the
    // empty one is a degenerate mapping — returning `{ fields: {} }` for an
    // explicit null scalar contradicts this function's own contract (Copilot).
    for (const src of ["null", "~", "  null  ", "# lead\nnull"]) {
      expect(parseSkillFrontmatter(src)).toEqual({
        error: expect.stringContaining("mapping"),
      });
    }
  });

  it("still reads a comment-only block as a mapping of no fields", () => {
    // The distinction is made on the SOURCE, so this must not regress.
    expect(parseSkillFrontmatter("# just a comment\n\n  # another")).toEqual({
      fields: {},
    });
  });

  it("does not mistake a leading # inside a value for a comment", () => {
    // Comments are stripped only at the start of a line; a `#` inside a value
    // is part of it, and treating it as a comment would call a block with real
    // content empty.
    expect(parseSkillFrontmatter('name: "#hashtag"')).toEqual({
      fields: { name: "#hashtag" },
    });
  });

  it("reports a scalar block as an error rather than as no fields", () => {
    // `just a string` parses successfully as a scalar. Reporting it as an
    // empty mapping would present a malformed file as one that merely omitted
    // every field.
    const parsed = parseSkillFrontmatter("just a string");
    expect(parsed).toEqual({ error: expect.stringContaining("mapping") });
  });

  it("reports a sequence block as an error", () => {
    expect(parseSkillFrontmatter("- one\n- two")).toEqual({
      error: expect.stringContaining("mapping"),
    });
  });

  it("reports invalid YAML with the parser's own message", () => {
    const parsed = parseSkillFrontmatter("a: [1,");
    expect("error" in parsed && parsed.error.length > 0).toBe(true);
  });
});
