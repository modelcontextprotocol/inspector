import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderWithMantine } from "../../../test/renderWithMantine";
import { HtmlFrame } from "./HtmlFrame";

describe("HtmlFrame", () => {
  let capturedBlob: Blob | undefined;

  beforeEach(() => {
    capturedBlob = undefined;
    vi.spyOn(URL, "createObjectURL").mockImplementation((blob) => {
      capturedBlob = blob as Blob;
      return "blob:html-url";
    });
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders a sandboxed iframe over a blob URL", () => {
    const { container } = renderWithMantine(<HtmlFrame html="<p>hello</p>" />);
    const iframe = container.querySelector("iframe");
    expect(iframe).toHaveAttribute("src", "blob:html-url");
    // Explicitly-empty sandbox: no scripts, forms, or same-origin.
    expect(iframe).toHaveAttribute("sandbox", "");
    expect(iframe).toHaveAttribute("title", "HTML preview");
  });

  it("serves an HTML blob with the CSP meta injected", async () => {
    renderWithMantine(<HtmlFrame html="<p>hello</p>" />);
    expect(capturedBlob?.type).toBe("text/html");
    const text = await capturedBlob!.text();
    expect(text).toContain('http-equiv="Content-Security-Policy"');
    expect(text).toContain("default-src 'none'");
    expect(text).not.toContain("script-src");
    expect(text).toContain("<p>hello</p>");
  });

  it("revokes the blob URL on unmount", () => {
    const { unmount } = renderWithMantine(<HtmlFrame html="<p>x</p>" />);
    unmount();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:html-url");
  });
});
