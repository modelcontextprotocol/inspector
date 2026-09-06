import { describe, it, expect } from "vitest";
import { splitSkillFile } from "./splitSkillFile";

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
