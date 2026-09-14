import { describe, it, expect, vi, beforeEach } from "vitest";
import { InsecureTokenEndpointError } from "@modelcontextprotocol/client";
import {
  insecureTokenEndpointMessage,
  insecureTokenEndpointTitle,
} from "../utils/oauthUx";

const show = vi.fn();
vi.mock("@mantine/notifications", () => ({
  notifications: { show: (...args: unknown[]) => show(...args) },
}));

const { showInsecureTokenEndpointNotice } =
  await import("./insecureTokenEndpointNotice");

const ENDPOINT = "http://tenant.example.localhost:3300/api/oauth/token";

beforeEach(() => {
  show.mockClear();
});

describe("showInsecureTokenEndpointNotice", () => {
  it("claims the SDK error and shows the terminal notice", () => {
    const handled = showInsecureTokenEndpointNotice(
      new InsecureTokenEndpointError(ENDPOINT),
      "Acme",
    );

    expect(handled).toBe(true);
    expect(show).toHaveBeenCalledTimes(1);
    expect(show).toHaveBeenCalledWith({
      title: insecureTokenEndpointTitle(),
      message: insecureTokenEndpointMessage({
        tokenEndpoint: ENDPOINT,
        serverName: "Acme",
      }),
      color: "red",
      // Non-recoverable, so the explanation must not vanish on a timer — there
      // is no second chance to read it.
      autoClose: false,
    });
  });

  it("works without a server name", () => {
    expect(
      showInsecureTokenEndpointNotice(new InsecureTokenEndpointError(ENDPOINT)),
    ).toBe(true);
    expect(show.mock.calls[0][0].message).toContain("this server");
  });

  it("declines any other error, leaving the caller's handling in place", () => {
    expect(showInsecureTokenEndpointNotice(new Error("boom"), "Acme")).toBe(
      false,
    );
    expect(show).not.toHaveBeenCalled();
  });
});
