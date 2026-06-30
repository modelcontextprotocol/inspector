import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { StrictMode } from "react";
import { renderHook } from "@testing-library/react";
import { useObjectUrl } from "./useObjectUrl";

// Revocation is deferred to a microtask; let the queue drain before asserting.
const flushMicrotasks = () => Promise.resolve();

describe("useObjectUrl", () => {
  beforeEach(() => {
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:mock-url");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("creates an object URL for a blob and revokes it on unmount", async () => {
    const blob = new Blob(["x"], { type: "text/plain" });
    const { result, unmount } = renderHook(() => useObjectUrl(blob));
    expect(result.current).toBe("blob:mock-url");
    expect(URL.createObjectURL).toHaveBeenCalledWith(blob);
    unmount();
    await flushMicrotasks();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:mock-url");
  });

  it("revokes the previous URL when the blob changes", async () => {
    // Unique URLs per call so the cleanup effect's [url] dep actually changes.
    let n = 0;
    vi.mocked(URL.createObjectURL).mockImplementation(() => `blob:url-${n++}`);
    const first = new Blob(["a"]);
    const second = new Blob(["b"]);
    const { rerender } = renderHook(({ blob }) => useObjectUrl(blob), {
      initialProps: { blob: first },
    });
    rerender({ blob: second });
    await flushMicrotasks();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:url-0");
    expect(URL.createObjectURL).toHaveBeenCalledTimes(2);
  });

  it("keeps the committed URL live under StrictMode double-invoke", async () => {
    // StrictMode runs effects setup → cleanup → setup with no re-render. A
    // synchronous revoke in cleanup would kill the committed URL; the deferred,
    // ref-guarded revoke must leave the URL consumers receive untouched.
    let n = 0;
    const revoked: string[] = [];
    vi.mocked(URL.createObjectURL).mockImplementation(() => `blob:url-${n++}`);
    vi.mocked(URL.revokeObjectURL).mockImplementation((url) => {
      revoked.push(url as string);
    });
    const blob = new Blob(["x"]);
    const { result } = renderHook(() => useObjectUrl(blob), {
      wrapper: StrictMode,
    });
    await flushMicrotasks();
    expect(result.current).toBeDefined();
    expect(revoked).not.toContain(result.current);
  });
});
