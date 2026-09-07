import { describe, it, expect } from "vitest";
import { listRowKey } from "./listRowKey";

describe("listRowKey", () => {
  it("combines the source index with the identifier", () => {
    expect(listRowKey("file:///a.txt", 0)).toBe("0:file:///a.txt");
  });

  it("distinguishes repeats of the same identifier", () => {
    const uri = "ui://hello-world/app.html";
    expect(listRowKey(uri, 0)).not.toBe(listRowKey(uri, 1));
  });

  it("produces a unique key for every row of a list with repeats", () => {
    const uris = ["a", "b", "a", "c", "b", "a"];
    const keys = uris.map((uri, index) => listRowKey(uri, index));
    expect(new Set(keys).size).toBe(uris.length);
  });

  // The index is a prefix, so an identifier that itself looks like a key must
  // not be able to impersonate a row at another position.
  it("does not collide when the identifier itself looks like a key", () => {
    expect(listRowKey("0:x", 1)).not.toBe(listRowKey("x", 10));
  });
});
