import { describe, it, expect } from "vitest";
import {
  isSameOriginApiAllowedFlag,
  isSameOriginBrowserRequest,
  shouldRejectSameOriginRequest,
} from "../fetch-metadata.js";

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

describe("isSameOriginApiAllowedFlag", () => {
  it.each(["true", "TRUE", " True ", "1", "yes", "YES"])(
    "enables the opt-out for %p",
    (value) => {
      expect(isSameOriginApiAllowedFlag(value)).toBe(true);
    },
  );

  it.each([undefined, "", " ", "false", "0", "no", "on", "enabled", "truthy"])(
    "keeps the check enforcing for %p",
    (value) => {
      expect(isSameOriginApiAllowedFlag(value)).toBe(false);
    },
  );
});

describe("shouldRejectSameOriginRequest", () => {
  const sameOrigin = { "sec-fetch-site": "same-origin" };

  it("rejects a same-origin request by default", () => {
    expect(
      shouldRejectSameOriginRequest(
        sameOrigin,
        isSameOriginApiAllowedFlag(undefined),
      ),
    ).toBe(true);
  });

  it("allows a same-origin request when the opt-out is true", () => {
    expect(
      shouldRejectSameOriginRequest(
        sameOrigin,
        isSameOriginApiAllowedFlag("true"),
      ),
    ).toBe(false);
  });

  it.each(["", "false", "0", "no"])(
    "keeps rejecting when the opt-out is %p",
    (value) => {
      expect(
        shouldRejectSameOriginRequest(
          sameOrigin,
          isSameOriginApiAllowedFlag(value),
        ),
      ).toBe(true);
    },
  );

  it("never rejects a non-same-origin request", () => {
    expect(
      shouldRejectSameOriginRequest({ "sec-fetch-site": "same-site" }, false),
    ).toBe(false);
    expect(shouldRejectSameOriginRequest({}, false)).toBe(false);
  });
});
