import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { useObjectUrl } from "./useObjectUrl";

describe("useObjectUrl", () => {
  beforeEach(() => {
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:mock-url");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("creates an object URL for a blob and revokes it on unmount", () => {
    const blob = new Blob(["x"], { type: "text/plain" });
    const { result, unmount } = renderHook(() => useObjectUrl(blob));
    expect(result.current).toBe("blob:mock-url");
    expect(URL.createObjectURL).toHaveBeenCalledWith(blob);
    unmount();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:mock-url");
  });

  it("revokes the previous URL when the blob changes", () => {
    // Unique URLs per call so the cleanup effect's [url] dep actually changes.
    let n = 0;
    vi.mocked(URL.createObjectURL).mockImplementation(() => `blob:url-${n++}`);
    const first = new Blob(["a"]);
    const second = new Blob(["b"]);
    const { rerender } = renderHook(({ blob }) => useObjectUrl(blob), {
      initialProps: { blob: first },
    });
    rerender({ blob: second });
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:url-0");
    expect(URL.createObjectURL).toHaveBeenCalledTimes(2);
  });
});
