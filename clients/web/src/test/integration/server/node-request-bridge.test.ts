import { describe, it, expect } from "vitest";
import {
  fetchHeadersFromNode,
  fetchUrlForNodeRequest,
  isResponseHeaderAllowed,
} from "../../../../server/node-request-bridge.js";

describe("fetchUrlForNodeRequest", () => {
  it("uses the HTTP/1.1 host header", () => {
    expect(
      fetchUrlForNodeRequest({ host: "localhost:6274" }, "/api/config", "http"),
    ).toBe("http://localhost:6274/api/config");
  });

  it("falls back to the HTTP/2 :authority pseudo-header", () => {
    expect(
      fetchUrlForNodeRequest(
        { ":authority": "localhost:6274" },
        "/api/config",
        "https",
      ),
    ).toBe("https://localhost:6274/api/config");
  });
});

describe("fetchHeadersFromNode", () => {
  it("drops HTTP/2 pseudo-headers, which Headers rejects", () => {
    const headers = fetchHeadersFromNode({
      ":method": "GET",
      ":scheme": "https",
      ":authority": "localhost:6274",
      ":path": "/api/config",
      "x-mcp-remote-auth": "Bearer t",
    });
    expect([...headers.keys()]).toEqual(["x-mcp-remote-auth"]);
  });

  it("joins multi-value headers and skips empty ones", () => {
    const headers = fetchHeadersFromNode({
      "x-multi": ["a", "b"],
      origin: "https://localhost:6274",
      cookie: undefined,
      "x-empty": "",
    });
    expect(headers.get("x-multi")).toBe("a, b");
    expect(headers.get("origin")).toBe("https://localhost:6274");
    expect(headers.has("cookie")).toBe(false);
    expect(headers.has("x-empty")).toBe(false);
  });
});

describe("isResponseHeaderAllowed", () => {
  it("allows every header on HTTP/1.x", () => {
    expect(isResponseHeaderAllowed("Connection", 1)).toBe(true);
    expect(isResponseHeaderAllowed("content-type", 1)).toBe(true);
  });

  it("refuses connection-specific headers on HTTP/2, case-insensitively", () => {
    for (const name of [
      "Connection",
      "keep-alive",
      "Proxy-Connection",
      "transfer-encoding",
      "upgrade",
    ]) {
      expect(isResponseHeaderAllowed(name, 2)).toBe(false);
    }
    expect(isResponseHeaderAllowed("content-type", 2)).toBe(true);
  });
});
