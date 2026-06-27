import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import type { OAuthStorage } from "@inspector/core/auth/storage.js";
import { useEmaIdpLoginState } from "@inspector/core/react/useEmaIdpLoginState.js";

describe("useEmaIdpLoginState", () => {
  let storage: OAuthStorage;

  beforeEach(() => {
    storage = {
      getIdpSession: vi.fn().mockResolvedValue(undefined),
      clearIdpSession: vi.fn(),
      clear: vi.fn(),
      clearEnterpriseManagedResourceServers: vi.fn(),
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

    expect(storage.clearIdpSession).toHaveBeenCalledWith("https://idp.test");
    expect(storage.clear).toHaveBeenCalledWith("ema-idp:https://idp.test");
    expect(storage.clearEnterpriseManagedResourceServers).toHaveBeenCalled();
    expect(result.current.loginState).toBe("none");
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
});
