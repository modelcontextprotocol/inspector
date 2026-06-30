import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderWithMantine } from "../../../test/renderWithMantine";
import { PdfFrame } from "./PdfFrame";

const PDF_BASE64 = Buffer.from("%PDF-1.4 fake", "utf-8").toString("base64");

describe("PdfFrame", () => {
  beforeEach(() => {
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:pdf-url");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders an iframe over a blob URL with a fit-width hash", () => {
    const { container } = renderWithMantine(<PdfFrame data={PDF_BASE64} />);
    const iframe = container.querySelector("iframe");
    expect(iframe).toHaveAttribute("src", "blob:pdf-url#view=FitH");
    expect(iframe).toHaveAttribute("title", "PDF preview");
    // The blob is built with the PDF MIME type.
    const blobArg = vi.mocked(URL.createObjectURL).mock.calls[0][0] as Blob;
    expect(blobArg.type).toBe("application/pdf");
  });

  it("revokes the blob URL on unmount", async () => {
    const { unmount } = renderWithMantine(<PdfFrame data={PDF_BASE64} />);
    unmount();
    // Revocation is deferred to a microtask (StrictMode-safe); let it drain.
    await Promise.resolve();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:pdf-url");
  });

  it("degrades to the binary notice when the base64 is malformed", () => {
    // `atob` throws on this; the frame must fall back instead of crashing.
    const { container } = renderWithMantine(<PdfFrame data="not%%base64" />);
    expect(container.querySelector("iframe")).toBeNull();
    expect(container.textContent).toContain("preview not supported");
  });
});
