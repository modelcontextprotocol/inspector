import { describe, it, expect } from "vitest";
import { skillFileBytes } from "./skillFileBytes";

describe("skillFileBytes", () => {
  it("encodes a text content block as UTF-8", () => {
    expect(Array.from(skillFileBytes({ text: "hé" }))).toEqual([
      0x68, 0xc3, 0xa9,
    ]);
  });

  it("decodes a blob content block from base64", () => {
    expect(Array.from(skillFileBytes({ blob: "aGVsbG8=" }))).toEqual([
      104, 101, 108, 108, 111,
    ]);
  });

  it("prefers text when a server sends both", () => {
    expect(Array.from(skillFileBytes({ text: "a", blob: "Yg==" }))).toEqual([
      97,
    ]);
  });

  it("treats an empty string as content, not as absence", () => {
    // A zero-byte file is legal and has a perfectly good digest; falling
    // through to the throw here would report a real file as unreadable.
    expect(skillFileBytes({ text: "" })).toHaveLength(0);
  });

  it("throws for a response carrying neither field", () => {
    // Not an empty array: an empty array hashes to the digest of nothing, so a
    // silent fallback would report a confident digest *mismatch* rather than
    // the truth, which is that the server returned no content.
    expect(() => skillFileBytes({ mimeType: "text/markdown" })).toThrow(
      /neither text nor blob/,
    );
  });
});
