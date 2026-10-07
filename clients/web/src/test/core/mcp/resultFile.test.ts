import { describe, it, expect } from "vitest";
import {
  RawResultUnavailableError,
  RESULT_FILE_FORMATS,
  renderRawResult,
  renderResultForFile,
  renderedByteLength,
} from "@inspector/core/mcp/resultFile";

const PNG_BYTES = [0x89, 0x50, 0x4e, 0x47];
const PNG_B64 = btoa(String.fromCharCode(...PNG_BYTES));

describe("renderResultForFile", () => {
  it("lists both formats", () => {
    expect(RESULT_FILE_FORMATS).toEqual(["raw", "json"]);
  });

  it("json is the whole result, two-space indented, newline-terminated", () => {
    const result = { content: [{ type: "text", text: "hi" }] };
    expect(renderResultForFile(result, "tools/call", "json")).toBe(
      JSON.stringify(result, null, 2) + "\n",
    );
  });

  it("raw delegates to the raw renderer", () => {
    expect(
      renderResultForFile(
        { content: [{ type: "text", text: "hi" }] },
        "tools/call",
        "raw",
      ),
    ).toBe("hi");
  });
});

describe("renderRawResult", () => {
  it("joins the text of every text-bearing tool block, embedded resources included", () => {
    const result = {
      content: [
        { type: "text", text: "one" },
        { type: "image", data: PNG_B64, mimeType: "image/png" },
        { type: "resource", resource: { uri: "x://a", text: "two" } },
        { type: "resource_link", uri: "x://b", name: "b" },
        "not a block",
        null,
      ],
    };
    expect(renderRawResult(result, "tools/call")).toBe("one\ntwo");
  });

  it("decodes a single binary tool block when there is no text", () => {
    const out = renderRawResult(
      { content: [{ type: "image", data: PNG_B64, mimeType: "image/png" }] },
      "tools/call",
    );
    expect(Array.from(out as Uint8Array)).toEqual(PNG_BYTES);
  });

  it("decodes a single blob from a resources/read result", () => {
    const out = renderRawResult(
      { contents: [{ uri: "x://a", blob: PNG_B64 }] },
      "resources/read",
    );
    expect(Array.from(out as Uint8Array)).toEqual(PNG_BYTES);
  });

  it("reads resources/read text from `contents`, not `content`", () => {
    expect(
      renderRawResult(
        {
          contents: [{ uri: "x://a", text: "r" }],
          content: [{ text: "ignored" }],
        },
        "resources/read",
      ),
    ).toBe("r");
  });

  it("refuses a result with no payload", () => {
    expect(() => renderRawResult({ content: [] }, "tools/call")).toThrow(
      new RawResultUnavailableError("tools/call", 0),
    );
    expect(() => renderRawResult(null, "tools/call")).toThrow(
      /no text or binary content/,
    );
    expect(() =>
      renderRawResult({ content: "not a list" }, "tools/call"),
    ).toThrow(RawResultUnavailableError);
  });

  it("refuses several binaries with no text", () => {
    let caught: unknown;
    try {
      renderRawResult(
        {
          content: [
            { type: "image", data: PNG_B64 },
            { type: "audio", data: PNG_B64 },
          ],
        },
        "tools/call",
      );
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(RawResultUnavailableError);
    const err = caught as RawResultUnavailableError;
    expect(err.name).toBe("RawResultUnavailableError");
    expect(err.binaryCount).toBe(2);
    expect(err.method).toBe("tools/call");
    expect(err.message).toMatch(/2 binary blocks and no text/);
  });
});

describe("renderedByteLength", () => {
  it("counts UTF-8 bytes for strings and length for bytes", () => {
    expect(renderedByteLength("é")).toBe(2);
    expect(renderedByteLength(new Uint8Array(3))).toBe(3);
  });
});
