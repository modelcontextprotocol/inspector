import { describe, it, expect } from "vitest";
import { resourceContentsToBlock } from "./resourceContents";

describe("resourceContentsToBlock", () => {
  it("converts a text item to a text block", () => {
    expect(
      resourceContentsToBlock({ uri: "file:///a", text: "hello" }),
    ).toEqual({ type: "text", text: "hello" });
  });

  it("converts an image blob to an image block", () => {
    expect(
      resourceContentsToBlock({
        uri: "file:///a.png",
        blob: "AAAA",
        mimeType: "image/png",
      }),
    ).toEqual({ type: "image", data: "AAAA", mimeType: "image/png" });
  });

  it("converts an audio blob to an audio block", () => {
    expect(
      resourceContentsToBlock({
        uri: "file:///a.mp3",
        blob: "BBBB",
        mimeType: "audio/mpeg",
      }),
    ).toEqual({ type: "audio", data: "BBBB", mimeType: "audio/mpeg" });
  });

  it("renders a placeholder for unsupported binary blobs", () => {
    expect(
      resourceContentsToBlock({
        uri: "file:///a.bin",
        blob: "CCCC",
        mimeType: "application/octet-stream",
      }),
    ).toEqual({
      type: "text",
      text: "[Binary content (application/octet-stream) — preview not supported]",
    });
  });

  it("defaults the mime type when a blob omits it", () => {
    expect(resourceContentsToBlock({ uri: "file:///a", blob: "DDDD" })).toEqual(
      {
        type: "text",
        text: "[Binary content (application/octet-stream) — preview not supported]",
      },
    );
  });
});
