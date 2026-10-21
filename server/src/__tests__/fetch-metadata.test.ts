import { describe, it, expect } from "vitest";
import { isSameOriginBrowserRequest } from "../fetch-metadata.js";

describe("isSameOriginBrowserRequest", () => {
  it("flags a same-origin browser request", () => {
    expect(
      isSameOriginBrowserRequest({ "sec-fetch-site": "same-origin" }),
    ).toBe(true);
  });

  it("is case- and whitespace-insensitive", () => {
    expect(
      isSameOriginBrowserRequest({ "sec-fetch-site": " Same-Origin " }),
    ).toBe(true);
  });

  it.each(["same-site", "cross-site", "none"])(
    "allows Sec-Fetch-Site: %s",
    (site) => {
      expect(isSameOriginBrowserRequest({ "sec-fetch-site": site })).toBe(
        false,
      );
    },
  );

  it("allows requests without fetch metadata (CLI, curl, node)", () => {
    expect(isSameOriginBrowserRequest({})).toBe(false);
  });
});
