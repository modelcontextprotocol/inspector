import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import type { OAuthStorage } from "@inspector/core/auth/storage.js";
import { useEmaIdpLoginState } from "@inspector/core/react/useEmaIdpLoginState.js";

describe("useEmaIdpLoginState", () => {
  let storage: OAuthStorage;

  beforeEach(() => {
    storage = {
      load: vi.fn().mockResolvedValue(undefined),
      getIdpSession: vi.fn().mockResolvedValue(undefined),
      clearIdpSession: vi.fn().mockResolvedValue(undefined),
      clear: vi.fn().mockResolvedValue(undefined),
      clearEnterpriseManagedResourceServers: vi
        .fn()
        .mockResolvedValue(undefined),
    } as unknown as OAuthStorage;
  });

  it("loads login state when active", async () => {
    const exp = Math.floor(Date.now() / 1000) + 3600;
    const payload = btoa(JSON.stringify({ exp }))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
    vi.mocked(storage.getIdpSession).mockResolvedValue({
      idToken: `h.${payload}.s`,
    });

    const { result } = renderHook(() =>
      useEmaIdpLoginState(storage, "https://idp.test", true),
    );

    await waitFor(() => {
      expect(result.current.loginState).toBe("logged_in");
    });
  });

  it("logout clears session and resets state", async () => {
    const exp = Math.floor(Date.now() / 1000) + 3600;
    const payload = btoa(JSON.stringify({ exp }))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
    vi.mocked(storage.getIdpSession).mockResolvedValue({
      idToken: `h.${payload}.s`,
    });

    const { result } = renderHook(() =>
      useEmaIdpLoginState(storage, "https://idp.test", true),
    );

    await waitFor(() => {
      expect(result.current.loginState).toBe("logged_in");
    });

    act(() => {
      result.current.logout();
    });

    await waitFor(() => {
      expect(storage.clearIdpSession).toHaveBeenCalledWith("https://idp.test");
      expect(storage.clear).toHaveBeenCalledWith("ema-idp:https://idp.test");
      expect(storage.clearEnterpriseManagedResourceServers).toHaveBeenCalled();
      expect(result.current.loginState).toBe("none");
    });
  });

  it("logout swallows a clear failure without an unhandled rejection and keeps state", async () => {
    const exp = Math.floor(Date.now() / 1000) + 3600;
    const payload = btoa(JSON.stringify({ exp }))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
    vi.mocked(storage.getIdpSession).mockResolvedValue({
      idToken: `h.${payload}.s`,
    });
    vi.mocked(storage.clearIdpSession).mockRejectedValue(
      new Error("storage backend unreachable"),
    );
    const unhandled = vi.fn();
    const onUnhandled = (event: PromiseRejectionEvent) => {
      event.preventDefault();
      unhandled();
    };
    window.addEventListener("unhandledrejection", onUnhandled);

    try {
      const { result } = renderHook(() =>
        useEmaIdpLoginState(storage, "https://idp.test", true),
      );

      await waitFor(() => {
        expect(result.current.loginState).toBe("logged_in");
      });

      act(() => {
        result.current.logout();
      });

      await waitFor(() => {
        expect(storage.clearIdpSession).toHaveBeenCalledWith(
          "https://idp.test",
        );
      });
      // Give the rejected promise a turn to settle so any unhandled rejection
      // would have fired.
      await act(async () => {
        await Promise.resolve();
      });

      // Clear failed, so the session is still present: state stays "logged_in"
      // and no unhandled rejection escaped.
      expect(result.current.loginState).toBe("logged_in");
      expect(unhandled).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener("unhandledrejection", onUnhandled);
    }
  });

  it("reports 'expired' for an expired token with no refresh token", async () => {
    const exp = Math.floor(Date.now() / 1000) - 3600;
    const payload = btoa(JSON.stringify({ exp }))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
    vi.mocked(storage.getIdpSession).mockResolvedValue({
      idToken: `h.${payload}.s`,
    });

    const { result } = renderHook(() =>
      useEmaIdpLoginState(storage, "https://idp.test", true),
    );

    await waitFor(() => {
      expect(result.current.loginState).toBe("expired");
    });
  });

  it("does not refresh while inactive, then refreshes when activated", async () => {
    vi.mocked(storage.getIdpSession).mockResolvedValue(undefined);

    const { result, rerender } = renderHook(
      ({ active }: { active: boolean }) =>
        useEmaIdpLoginState(storage, "https://idp.test", active),
      { initialProps: { active: false } },
    );

    // Inactive: the open-driven refresh effect short-circuits.
    expect(storage.getIdpSession).not.toHaveBeenCalled();
    expect(result.current.loginState).toBe("none");

    rerender({ active: true });
    await waitFor(() => {
      expect(storage.getIdpSession).toHaveBeenCalledWith("https://idp.test");
    });
    expect(result.current.loginState).toBe("none");
  });

  it("refresh() resets to 'none' when there is no issuer (empty normalized)", async () => {
    const { result } = renderHook(() =>
      useEmaIdpLoginState(storage, undefined, true),
    );

    // The active effect calls refresh(), which short-circuits to "none"
    // without ever touching storage because the issuer is empty.
    await act(async () => {
      await result.current.refresh();
    });

    expect(storage.getIdpSession).not.toHaveBeenCalled();
    expect(result.current.loginState).toBe("none");
  });

  it("logout() is a no-op when there is no issuer", () => {
    const { result } = renderHook(() =>
      useEmaIdpLoginState(storage, undefined, false),
    );

    act(() => {
      result.current.logout();
    });

    expect(storage.clearIdpSession).not.toHaveBeenCalled();
    expect(storage.clear).not.toHaveBeenCalled();
    expect(
      storage.clearEnterpriseManagedResourceServers,
    ).not.toHaveBeenCalled();
    expect(result.current.loginState).toBe("none");
  });
  it("a failed read for a new issuer reports none, not the old issuer's state", async () => {
    const exp = Math.floor(Date.now() / 1000) + 3600;
    const payload = btoa(JSON.stringify({ exp }))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
    vi.mocked(storage.getIdpSession).mockResolvedValue({
      idToken: `h.${payload}.s`,
    });

    const { result, rerender } = renderHook(
      ({ issuer }: { issuer: string }) =>
        useEmaIdpLoginState(storage, issuer, true),
      { initialProps: { issuer: "https://idp.test" } },
    );

    await waitFor(() => {
      expect(result.current.loginState).toBe("logged_in");
    });

    // The storage backend goes away *and* the issuer changes. The rejection
    // must not surface as an unhandled promise, and the new issuer must not
    // inherit the previous one's "logged_in" — nobody has authenticated
    // against it, and a read that never succeeded cannot say otherwise.
    const unhandled = vi.fn();
    process.on("unhandledRejection", unhandled);
    try {
      vi.mocked(storage.getIdpSession).mockRejectedValue(
        new Error("storage unreachable"),
      );
      await act(async () => {
        rerender({ issuer: "https://other-idp.test" });
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
    } finally {
      process.off("unhandledRejection", unhandled);
    }

    expect(storage.getIdpSession).toHaveBeenCalledWith(
      "https://other-idp.test",
    );
    expect(unhandled).not.toHaveBeenCalled();
    expect(result.current.loginState).toBe("none");
  });

  it("keeps the last answer when a re-read of the same issuer fails", async () => {
    const exp = Math.floor(Date.now() / 1000) + 3600;
    const payload = btoa(JSON.stringify({ exp }))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
    vi.mocked(storage.getIdpSession).mockResolvedValue({
      idToken: `h.${payload}.s`,
    });

    const { result } = renderHook(() =>
      useEmaIdpLoginState(storage, "https://idp.test", true),
    );

    await waitFor(() => {
      expect(result.current.loginState).toBe("logged_in");
    });

    // A transient storage outage is not evidence that the session ended, so
    // the issuer we are still looking at keeps the answer we actually got.
    vi.mocked(storage.getIdpSession).mockRejectedValue(
      new Error("storage unreachable"),
    );
    await act(async () => {
      await result.current.refresh().catch(() => {});
    });

    expect(result.current.loginState).toBe("logged_in");
  });

  it("ignores an overtaken read that resolves last for the same issuer", async () => {
    const jwt = (secondsFromNow: number) => {
      const payload = btoa(
        JSON.stringify({ exp: Math.floor(Date.now() / 1000) + secondsFromNow }),
      )
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=+$/, "");
      return `h.${payload}.s`;
    };

    // Two reads for the *same* issuer overlap, and the older one resolves
    // last. Issuer keying cannot tell them apart — both carry this issuer —
    // so only the read token stops the superseded answer from committing.
    let releaseFirst: () => void = () => {};
    const first = new Promise<{ idToken: string }>((resolve) => {
      releaseFirst = () => resolve({ idToken: jwt(3600) });
    });
    vi.mocked(storage.getIdpSession)
      .mockReturnValueOnce(first)
      .mockResolvedValue({ idToken: jwt(-3600) });

    const { result } = renderHook(() =>
      useEmaIdpLoginState(storage, "https://idp.test", true),
    );

    // Second read starts and finishes while the first is still pending.
    await act(async () => {
      await result.current.refresh();
    });
    expect(result.current.loginState).toBe("expired");

    await act(async () => {
      releaseFirst();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(result.current.loginState).toBe("expired");
  });

  it("a logout supersedes a read that was already in flight", async () => {
    const exp = Math.floor(Date.now() / 1000) + 3600;
    const payload = btoa(JSON.stringify({ exp }))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");

    let releaseRead: () => void = () => {};
    const pending = new Promise<{ idToken: string }>((resolve) => {
      releaseRead = () => resolve({ idToken: `h.${payload}.s` });
    });
    vi.mocked(storage.getIdpSession).mockReturnValue(pending);

    const { result } = renderHook(() =>
      useEmaIdpLoginState(storage, "https://idp.test", true),
    );

    act(() => {
      result.current.logout();
    });
    // Let the clear settle on its own before releasing the read, so the read
    // is unambiguously the *last* writer — without the token it would land on
    // top of the clear and report the cleared session as logged in.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(result.current.loginState).toBe("none");

    await act(async () => {
      releaseRead();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(storage.clearIdpSession).toHaveBeenCalledWith("https://idp.test");
    expect(result.current.loginState).toBe("none");
  });
});
