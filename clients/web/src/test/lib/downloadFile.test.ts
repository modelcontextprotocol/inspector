/**
 * Tests for the downloadJsonFile helper. Mocks URL.createObjectURL +
 * URL.revokeObjectURL (happy-dom doesn't ship them) and asserts the temp
 * anchor's attributes + click + cleanup sequence.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { downloadJsonFile } from "../../lib/downloadFile";

describe("downloadJsonFile", () => {
  const originalCreate = URL.createObjectURL;
  const originalRevoke = URL.revokeObjectURL;
  let createMock: ReturnType<typeof vi.fn>;
  let revokeMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    createMock = vi.fn().mockReturnValue("blob:mock-url");
    revokeMock = vi.fn();
    // happy-dom doesn't implement URL.createObjectURL/revokeObjectURL.
    URL.createObjectURL = createMock as unknown as typeof URL.createObjectURL;
    URL.revokeObjectURL = revokeMock as unknown as typeof URL.revokeObjectURL;
  });

  afterEach(() => {
    URL.createObjectURL = originalCreate;
    URL.revokeObjectURL = originalRevoke;
    vi.restoreAllMocks();
  });

  it("creates an anchor with the right href + download attributes and clicks it", () => {
    const clickedAnchors: HTMLAnchorElement[] = [];
    const origCreateElement = document.createElement.bind(document);
    vi.spyOn(document, "createElement").mockImplementation(((tag: string) => {
      const el = origCreateElement(tag) as HTMLAnchorElement;
      if (tag === "a") {
        el.click = function click() {
          clickedAnchors.push(el);
        };
      }
      return el;
    }) as typeof document.createElement);

    downloadJsonFile("mcp.json", '{"hello":"world"}');

    expect(createMock).toHaveBeenCalledOnce();
    const blob = createMock.mock.calls[0]?.[0] as Blob;
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.type).toBe("application/json");

    expect(clickedAnchors).toHaveLength(1);
    const anchor = clickedAnchors[0]!;
    expect(anchor.getAttribute("href")).toBe("blob:mock-url");
    expect(anchor.getAttribute("download")).toBe("mcp.json");

    // After the call, the anchor must be removed and the URL revoked.
    expect(document.body.contains(anchor)).toBe(false);
    expect(revokeMock).toHaveBeenCalledWith("blob:mock-url");
  });

  it("still cleans up the anchor + URL when click() throws (try/finally guard)", () => {
    const removed: Node[] = [];
    const origCreateElement = document.createElement.bind(document);
    vi.spyOn(document, "createElement").mockImplementation(((tag: string) => {
      const el = origCreateElement(tag) as HTMLAnchorElement;
      if (tag === "a") {
        el.click = () => {
          throw new Error("simulated click failure");
        };
      }
      return el;
    }) as typeof document.createElement);
    // Stub removeChild outright so the throw doesn't double up with a
    // "not a child" error from a partially-mocked DOM.
    vi.spyOn(document.body, "removeChild").mockImplementation(((node: Node) => {
      removed.push(node);
      return node;
    }) as typeof document.body.removeChild);

    expect(() => downloadJsonFile("oops.json", '{"oops":true}')).toThrow(
      /simulated click failure/,
    );

    // Cleanup still ran despite the throw.
    expect(removed).toHaveLength(1);
    expect(revokeMock).toHaveBeenCalledWith("blob:mock-url");
  });

  it("passes the JSON string into the Blob constructor verbatim", async () => {
    downloadJsonFile("test.json", '{"x":1}');
    const blob = createMock.mock.calls[0]?.[0] as Blob;
    const text = await blob.text();
    expect(text).toBe('{"x":1}');
  });
});
