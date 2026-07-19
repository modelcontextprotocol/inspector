import { describe, it, expect, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { usePaginatedList } from "./usePaginatedList";

interface Params {
  connected: boolean;
  paginated: boolean;
  managedItems: string[];
  managedRefresh: () => Promise<unknown>;
  pagedItems: string[];
  pagedNextCursor?: string;
  pagedPageCount: number;
  loadPage: (cursor?: string) => Promise<unknown>;
}

function makeParams(over: Partial<Params> = {}): Params {
  return {
    connected: true,
    paginated: false,
    managedItems: ["m1", "m2"],
    managedRefresh: vi.fn(async () => []),
    pagedItems: ["p1"],
    pagedNextCursor: undefined,
    pagedPageCount: 0,
    loadPage: vi.fn(async () => ({})),
    ...over,
  };
}

describe("usePaginatedList", () => {
  it("shows the managed list and no paging in all-pages mode", () => {
    const params = makeParams();
    const { result } = renderHook(() => usePaginatedList(params));
    expect(result.current.items).toEqual(["m1", "m2"]);
    expect(result.current.paginated).toBe(false);
    expect(result.current.canLoadMore).toBe(false);
  });

  it("shows the paged list and derives paging in paginated mode", () => {
    const params = makeParams({
      paginated: true,
      pagedNextCursor: "c1",
      pagedPageCount: 2,
    });
    const { result } = renderHook(() => usePaginatedList(params));
    expect(result.current.items).toEqual(["p1"]);
    expect(result.current.canLoadMore).toBe(true);
    expect(result.current.loadedPages).toBe(2);
  });

  it("masks paging progress while disconnected", () => {
    const params = makeParams({
      connected: false,
      paginated: true,
      pagedNextCursor: "c1",
      pagedPageCount: 2,
    });
    const { result } = renderHook(() => usePaginatedList(params));
    expect(result.current.canLoadMore).toBe(false);
    expect(result.current.loadedPages).toBe(0);
  });

  it("onLoadMore fetches the next page from the current cursor", () => {
    const loadPage = vi.fn(async () => ({}));
    const params = makeParams({
      paginated: true,
      pagedNextCursor: "c1",
      loadPage,
    });
    const { result } = renderHook(() => usePaginatedList(params));
    void result.current.onLoadMore();
    expect(loadPage).toHaveBeenCalledWith("c1");
  });

  it("onLoadMore is a no-op with no next cursor", () => {
    const loadPage = vi.fn(async () => ({}));
    const params = makeParams({ paginated: true, loadPage });
    const { result } = renderHook(() => usePaginatedList(params));
    void result.current.onLoadMore();
    expect(loadPage).not.toHaveBeenCalled();
  });

  it("onRefresh reloads page 1 in paginated mode", () => {
    const loadPage = vi.fn(async () => ({}));
    const params = makeParams({ paginated: true, loadPage });
    const { result } = renderHook(() => usePaginatedList(params));
    void result.current.onRefresh();
    expect(loadPage).toHaveBeenCalledWith(undefined);
  });

  it("onRefresh re-fetches the aggregate in all-pages mode", () => {
    const managedRefresh = vi.fn(async () => []);
    const params = makeParams({ managedRefresh });
    const { result } = renderHook(() => usePaginatedList(params));
    void result.current.onRefresh();
    expect(managedRefresh).toHaveBeenCalledTimes(1);
  });
});
