/**
 * Tests for the download helpers. Mocks URL.createObjectURL +
 * URL.revokeObjectURL (happy-dom doesn't ship them) and asserts the temp
 * anchor's attributes + click + deferred cleanup sequence.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  downloadBlob,
  downloadJsonFile,
  buildExportFilename,
  fileNameFromUri,
  isHttpUrl,
} from "../../lib/downloadFile";

describe("downloadBlob / downloadJsonFile", () => {
  const originalCreate = URL.createObjectURL;
  const originalRevoke = URL.revokeObjectURL;
  let createMock: ReturnType<typeof vi.fn>;
  let revokeMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    createMock = vi.fn().mockReturnValue("blob:mock-url");
    revokeMock = vi.fn();
    // happy-dom doesn't implement URL.createObjectURL/revokeObjectURL.
    URL.createObjectURL = createMock as unknown as typeof URL.createObjectURL;
    URL.revokeObjectURL = revokeMock as unknown as typeof URL.revokeObjectURL;
  });

  afterEach(() => {
    vi.useRealTimers();
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
    // Revoke is deferred so the scheduled download can read the blob first.
    expect(revokeMock).not.toHaveBeenCalled();
    vi.runAllTimers();
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
    vi.runAllTimers();
    expect(revokeMock).toHaveBeenCalledWith("blob:mock-url");
  });

  it("passes the JSON string into the Blob constructor verbatim", async () => {
    downloadJsonFile("test.json", '{"x":1}');
    const blob = createMock.mock.calls[0]?.[0] as Blob;
    const text = await blob.text();
    expect(text).toBe('{"x":1}');
  });

  it("downloadBlob passes the given blob through and honours its type", async () => {
    const blob = new Blob(["plain text"], { type: "text/plain" });
    downloadBlob("note.txt", blob);
    expect(createMock).toHaveBeenCalledWith(blob);
    const passed = createMock.mock.calls[0]?.[0] as Blob;
    expect(passed.type).toBe("text/plain");
    expect(await passed.text()).toBe("plain text");
  });
});

describe("buildExportFilename", () => {
  const fixedNow = new Date("2026-03-17T10:00:42.123Z");

  it("includes kind, server id, and ISO timestamp with `:` swapped for `-`", () => {
    expect(buildExportFilename("protocol", "alpha", fixedNow)).toBe(
      "inspector-protocol-alpha-2026-03-17T10-00-42.123Z.json",
    );
  });

  it("omits the server-id segment when serverId is undefined", () => {
    expect(buildExportFilename("logs", undefined, fixedNow)).toBe(
      "inspector-logs-2026-03-17T10-00-42.123Z.json",
    );
  });

  it("omits the server-id segment when serverId is an empty string", () => {
    expect(buildExportFilename("logs", "", fixedNow)).toBe(
      "inspector-logs-2026-03-17T10-00-42.123Z.json",
    );
  });

  it("encodes server ids that contain filesystem-unsafe characters", () => {
    expect(buildExportFilename("network", "my server/v2", fixedNow)).toBe(
      "inspector-network-my%20server%2Fv2-2026-03-17T10-00-42.123Z.json",
    );
  });

  it("defaults `now` to the current time when not provided", () => {
    const name = buildExportFilename("protocol", "alpha");
    expect(name).toMatch(
      /^inspector-protocol-alpha-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}\.\d{3}Z\.json$/,
    );
  });
});

describe("fileNameFromUri", () => {
  it("returns the last path segment", () => {
    expect(fileNameFromUri("https://x/y/z/report.pdf")).toBe("report.pdf");
  });
  it("splits on backslashes as well as forward slashes", () => {
    expect(fileNameFromUri("C:\\Users\\me\\report.pdf")).toBe("report.pdf");
  });
  it("strips control/format chars and disallowed filename chars", () => {
    // U+200B (zero-width space, Cf) and U+202E (RTL override, Cf) are
    // stripped; the disallowed `*?` run collapses to a single `_`.
    const uri = "https://x/a\u200bb\u202ec*?.txt";
    expect(fileNameFromUri(uri)).toBe("abc_.txt");
  });
  it("truncates very long names to 255 characters", () => {
    const long = "a".repeat(300) + ".txt";
    expect(fileNameFromUri(`https://x/${long}`)).toHaveLength(255);
  });
  it("falls back to 'download' when nothing usable remains", () => {
    expect(fileNameFromUri("https://x/")).toBe("download");
  });
});

describe("isHttpUrl", () => {
  it("accepts http and https", () => {
    expect(isHttpUrl("https://example.com")?.href).toBe("https://example.com/");
    expect(isHttpUrl("http://localhost:3000/a")?.href).toBe(
      "http://localhost:3000/a",
    );
  });
  it("rejects other schemes and unparsable input", () => {
    expect(isHttpUrl("javascript:alert(1)")).toBeNull();
    expect(isHttpUrl("data:text/html,<b>")).toBeNull();
    expect(isHttpUrl("file:///etc/passwd")).toBeNull();
    expect(isHttpUrl("not a url")).toBeNull();
  });
});
